/*
 * Sondeo SQL sobre PGlite (PostgreSQL 18 compilado a WebAssembly).
 *
 * Por qué PGlite y no un Postgres de verdad: en esta máquina los binarios de
 * `embedded-postgres` no arrancan (STATUS_IN_PAGE_ERROR), y no hay Docker ni
 * psql. PGlite no tiene binarios: es un paquete de npm y ya.
 *
 * LO QUE ESTE BANCO NO PUEDE PROBAR, y hay que decirlo:
 *   - PGlite atiende UNA conexión. No hay pool, así que la disciplina de
 *     "SET LOCAL dentro de transacción para que no se filtre entre peticiones"
 *     queda sin verificar en condiciones reales.
 *   - Por lo mismo, la carrera de tres instancias por el cerrojo no es una
 *     carrera: se comprueba la semántica del SQL, no la concurrencia.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const prueba = [];
const ok = (n, cond, detalle = '') => prueba.push({ n, ok: !!cond, detalle });
const marca = {};

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');

  const t0 = Date.now();
  const db = await PGlite.create();
  marca.arranque = Date.now() - t0;

  const t1 = Date.now();
  await db.exec(fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8'));
  marca.esquema = Date.now() - t1;

  /*
   * HALLAZGO: un superusuario se salta RLS SIEMPRE, incluso con FORCE ROW
   * LEVEL SECURITY. Si la aplicación se conecta con el rol dueño de la base
   * —que es lo que dan por defecto Neon y casi cualquier proveedor— el
   * aislamiento no existe y nada avisa. Hace falta un rol propio sin
   * privilegios. Aquí se comprueba de las dos formas.
   */
  await db.exec(`
    CREATE ROLE app NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
  `);

  /* ---------- Datos: dos quinielas con una jornada del mismo nombre ---------- */
  const { rows: [u1] } = await db.query(
    `INSERT INTO usuarios (username, username_normalizado, email, email_normalizado, password)
     VALUES ('ana','ana','a@x.com','a@x.com','x') RETURNING id`);
  const { rows: [u2] } = await db.query(
    `INSERT INTO usuarios (username, username_normalizado, email, email_normalizado, password)
     VALUES ('beto','beto','b@x.com','b@x.com','x') RETURNING id`);

  const { rows: [qA] } = await db.query(
    `INSERT INTO quinielas (nombre, codigo_ingreso, propietario_id)
     VALUES ('Quiniela A','AAA111',$1) RETURNING id`, [u1.id]);
  const { rows: [qB] } = await db.query(
    `INSERT INTO quinielas (nombre, codigo_ingreso, propietario_id)
     VALUES ('Quiniela B','BBB222',$1) RETURNING id`, [u2.id]);

  const ids = {};
  for (const [q, jug, et] of [[qA.id, 'ana', 'A'], [qB.id, 'beto', 'B']]) {
    const { rows: [j] } = await db.query(
      `INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,$2) RETURNING id`, [q, jug]);
    const { rows: [jo] } = await db.query(
      `INSERT INTO jornadas (quiniela_id, nombre) VALUES ($1,'Jornada 1') RETURNING id`, [q]);
    const { rows: [p] } = await db.query(
      `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2, comodin)
       VALUES ($1,$2,0,'Saprissa','Alajuelense',true) RETURNING id`, [q, jo.id]);
    // Puntos ya congelados, para que el ranking tenga algo que sumar.
    const { rows: [pj] } = await db.query(
      `INSERT INTO puntos_jornada (quiniela_id, jornada_id, puntuacion, congelado_en)
       VALUES ($1,$2,'{"marcadorExacto":5,"resultadoCorrecto":3}'::jsonb, now()) RETURNING id`,
      [q, jo.id]);
    await db.query(
      `INSERT INTO puntos_jornada_jugador (quiniela_id, puntos_jornada_id, jugador_id, puntos)
       VALUES ($1,$2,$3,$4)`, [q, pj.id, j.id, et === 'A' ? 7 : 99]);
    ids[et] = { q, jugador: j.id, jornada: jo.id, partido: p.id };
  }

  /* ---------- El equivalente del tenantContext ---------- */
  async function enQuiniela(quinielaId, fn) {
    await db.exec('BEGIN');
    await db.query('SELECT set_config($1,$2,true)', ['app.quiniela_id', quinielaId]);
    await db.exec('SET LOCAL ROLE app');   // sin esto, el superusuario se salta RLS
    try {
      const r = await fn();
      await db.exec('COMMIT');
      return r;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }

  /* ---------- 1. ¿Aísla RLS? ---------- */

  const vistaA = await enQuiniela(ids.A.q, () =>
    db.query('SELECT nombre FROM jugadores').then(r => r.rows));
  ok('Un SELECT sin filtro sólo ve la quiniela del contexto',
     vistaA.length === 1 && vistaA[0].nombre === 'ana',
     `vio ${JSON.stringify(vistaA.map(r => r.nombre))}`);

  const robo = await enQuiniela(ids.A.q, () =>
    db.query('SELECT nombre FROM jugadores WHERE quiniela_id = $1', [ids.B.q]).then(r => r.rows));
  ok('Pedir a propósito la quiniela ajena devuelve vacío', robo.length === 0,
     `devolvió ${robo.length} filas`);

  // El hueco real del tenantPlugin de Mongoose: aggregate no pasa por el hook.
  const cuenta = await enQuiniela(ids.A.q, () =>
    db.query('SELECT count(*)::int AS n FROM jugadores').then(r => r.rows[0].n));
  ok('Una agregación tampoco escapa (es el hueco de aggregate en Mongoose)',
     cuenta === 1, `contó ${cuenta}`);

  // Un JOIN a través de tres tablas: cada una filtra por su cuenta.
  const join = await enQuiniela(ids.A.q, () =>
    db.query(`SELECT j.nombre, jo.nombre AS jornada, p.equipo1
                FROM jugadores j, jornadas jo, partidos p
               WHERE p.jornada_id = jo.id`).then(r => r.rows));
  ok('Un JOIN de tres tablas no cruza quinielas', join.length === 1,
     `devolvió ${join.length} filas`);

  let bloqueado = false, mensaje = '';
  try {
    await enQuiniela(ids.A.q, () =>
      db.query(`INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,'colado')`, [ids.B.q]));
  } catch (e) { bloqueado = /row-level security/i.test(e.message); mensaje = e.message; }
  ok('Escribir en una quiniela ajena lo rechaza la base', bloqueado, mensaje);

  let sinCtx = null;
  await db.exec('BEGIN');
  await db.exec('SET LOCAL ROLE app');
  sinCtx = (await db.query('SELECT count(*)::int AS n FROM jugadores')).rows[0].n;
  await db.exec('COMMIT');
  ok('Sin contexto de quiniela no se ve nada (la puerta de §5.2)', sinCtx === 0, `vio ${sinCtx}`);

  // Y la contraprueba: como superusuario, RLS NO protege. Esto es el aviso.
  const comoDueno = (await db.query('SELECT count(*)::int AS n FROM jugadores')).rows[0].n;
  ok('AVISO comprobado: el superusuario ve TODAS las quinielas', comoDueno === 2,
     `vio ${comoDueno} de 2`);

  /* ---------- 2. El cerrojo distribuido (C-05) ---------- */
  const tomar = async (instancia) => {
    const { rows } = await db.query(
      `INSERT INTO job_locks (nombre, instancia, tomado_en, expira_en)
       VALUES ('sync', $1, now(), now() + interval '5 minutes')
       ON CONFLICT (nombre) DO UPDATE
         SET instancia = EXCLUDED.instancia,
             tomado_en = EXCLUDED.tomado_en,
             expira_en = EXCLUDED.expira_en
         WHERE job_locks.expira_en <= now()
       RETURNING instancia`, [instancia]);
    return rows.length > 0;
  };
  const primero = await tomar('i1');
  const segundo = await tomar('i2');
  ok('El cerrojo: el primero entra, el segundo rebota', primero && !segundo,
     `primero=${primero} segundo=${segundo}`);

  await db.query(`UPDATE job_locks SET expira_en = now() - interval '1 second' WHERE nombre='sync'`);
  const tercero = await tomar('i3');
  ok('El cerrojo caducado lo puede tomar otro', tercero);

  /* ---------- 3. El ranking en UNA consulta ---------- */
  const t2 = Date.now();
  const tabla = await enQuiniela(ids.A.q, () => db.query(`
    SELECT j.nombre AS jugador,
           COALESCE(SUM(pjj.puntos), 0)::int AS puntos,
           COALESCE((SELECT SUM(rt.puntos)::int FROM respuestas_trivia rt
                      WHERE rt.jugador_id = j.id), 0) AS trivias
      FROM jugadores j
      LEFT JOIN puntos_jornada_jugador pjj ON pjj.jugador_id = j.id
     GROUP BY j.id, j.nombre
     ORDER BY 2 DESC`).then(r => r.rows));
  marca.ranking = Date.now() - t2;
  ok('El ranking sale en UNA consulta y sin los puntos de la otra quiniela',
     tabla.length === 1 && tabla[0].jugador === 'ana' && Number(tabla[0].puntos) === 7,
     JSON.stringify(tabla));

  /* ---------- 4. Coste de la transacción por petición ---------- */
  const N = 200;
  const t3 = Date.now();
  for (let i = 0; i < N; i++) await enQuiniela(ids.A.q, () => db.query('SELECT 1'));
  marca.conTx = ((Date.now() - t3) / N).toFixed(2);

  const t4 = Date.now();
  for (let i = 0; i < N; i++) await db.query('SELECT 1');
  marca.sinTx = ((Date.now() - t4) / N).toFixed(2);

  /* ---------- Informe ---------- */
  console.log('\n=============== TIEMPOS ===============');
  console.log(`arranque de PGlite            : ${marca.arranque} ms`);
  console.log(`aplicar el esquema entero     : ${marca.esquema} ms`);
  console.log(`--> arranque total del arnés  : ${marca.arranque + marca.esquema} ms`);
  console.log(`consulta con transacción+RLS  : ${marca.conTx} ms`);
  console.log(`consulta suelta, sin RLS      : ${marca.sinTx} ms`);
  console.log(`ranking completo              : ${marca.ranking} ms`);

  console.log('\n=============== AISLAMIENTO ===============');
  for (const p of prueba) {
    console.log(`${p.ok ? '  OK  ' : ' FALLA'} ${p.n}${p.ok ? '' : '\n         -> ' + p.detalle}`);
  }
  const fallos = prueba.filter(p => !p.ok).length;
  console.log(`\n${prueba.length - fallos}/${prueba.length} comprobaciones pasan.`);
  process.exitCode = fallos ? 1 : 0;
}

main().catch(e => { console.error('SONDEO ROTO:', e); process.exitCode = 1; });

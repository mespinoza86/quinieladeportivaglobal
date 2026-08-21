/*
 * LA PUERTA DE VERDAD del sondeo SQL.
 *
 * Es lo único que PGlite no puede comprobar, porque atiende una sola conexión:
 * que el contexto de quiniela NO se cuele de una petición a la siguiente cuando
 * varias comparten un `pool` de conexiones.
 *
 * Por qué es la comprobación que importa
 * --------------------------------------
 * El aislamiento se apoya en una variable de sesión, `app.quiniela_id`. Con un
 * pool, la conexión que atendió la petición de la quiniela A la reutiliza
 * después otra petición cualquiera. Si esa variable sobreviviera a la primera
 * petición, la segunda leería con el contexto de la primera.
 *
 * Y sería una fuga PEOR que C-02: intermitente, dependiente de la carga, y
 * silenciosa. Con poco tráfico no aparece nunca; con mucho, aparece a ratos.
 *
 * La defensa es que el contexto se fija con `SET LOCAL` (aquí, `set_config`
 * con `is_local = true`) DENTRO de una transacción: al terminar la transacción
 * PostgreSQL lo deshace. Eso es lo que este archivo pone a prueba de verdad.
 *
 * Cómo se ejecuta
 * ---------------
 *   1. Pon en el `.env` de la raíz la cadena CON pooler y el rol app_quiniela:
 *        DATABASE_URL=postgresql://app_quiniela:...-pooler...?sslmode=require
 *   2. cd sondeo-sql && npm install && node probar-pool.js
 *
 * ⚠️ Corre contra la base de Neon de verdad. Crea sus propios datos con nombres
 * que empiezan por `pool_` y los borra al terminar, pase lo que pase.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

/* ---------- Leer DATABASE_URL sin arrastrar dependencias ---------- */
function cadenaDeConexion() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const env = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(env)) return null;

  for (const linea of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

/* ---------- El equivalente exacto del tenantContext de la aplicación ---------- */
async function enQuiniela(pool, quinielaId, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // is_local = true: se deshace al cerrar la transacción. Es TODA la defensa.
    await c.query('SELECT set_config($1, $2, true)', ['app.quiniela_id', quinielaId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* la conexión ya no sirve */ }
    throw e;
  } finally {
    c.release();
  }
}

const prueba = [];
const ok = (n, cond, detalle = '') => prueba.push({ n, ok: !!cond, detalle });

async function main() {
  const cadena = cadenaDeConexion();
  if (!cadena) {
    console.error('Falta DATABASE_URL (variable de entorno o .env de la raíz).');
    console.error('Debe ser la cadena CON pooler y con el rol app_quiniela.');
    process.exitCode = 1;
    return;
  }

  // Nunca imprimir la cadena: lleva la contraseña dentro.
  const conPooler = /-pooler\./.test(cadena);
  const usuario = (cadena.match(/\/\/([^:]+):/) || [])[1] || '(desconocido)';
  console.log(`conexión              : usuario=${usuario}  pooler=${conPooler ? 'sí' : 'NO'}`);
  if (!conPooler) {
    console.log('⚠️  Esta cadena no es la del pooler. La prueba vale menos:');
    console.log('    lo que hay que verificar es justo el modo transacción del pooler.');
  }
  if (usuario !== 'app_quiniela') {
    console.log('⚠️  No estás conectando como app_quiniela. Si es el rol dueño,');
    console.log('    puede APAGAR RLS y la prueba no mide lo que dice medir.');
  }

  // max alto a propósito: cuantas más conexiones se reciclen, más ocasiones
  // hay de que un contexto mal fijado se cuele en la petición siguiente.
  const pool = new Pool({ connectionString: cadena, max: 10 });

  const QUINIELAS = 6;
  const RONDAS = 40;      // RONDAS × QUINIELAS peticiones concurrentes
  const marca = 'pool_' + Date.now().toString(36);
  const ids = [];

  try {
    /* ---------- 0. ¿Conecta, y con qué privilegios? ---------- */
    const quien = await pool.query(
      'SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const { u, rolsuper, rolbypassrls } = quien.rows[0];
    ok('El rol conectado no puede saltarse RLS', !rolsuper && !rolbypassrls,
       `usuario=${u} superusuario=${rolsuper} bypassrls=${rolbypassrls}`);

    /* ---------- Semilla: N quinielas, cada una con UN jugador propio ---------- */
    for (let i = 0; i < QUINIELAS; i++) {
      const { rows: [usr] } = await pool.query(
        `INSERT INTO usuarios (username, username_normalizado, email, email_normalizado, password)
         VALUES ($1,$1,$2,$2,'x') RETURNING id`,
        [`${marca}_u${i}`, `${marca}_u${i}@x`]);
      const { rows: [q] } = await pool.query(
        `INSERT INTO quinielas (nombre, codigo_ingreso, propietario_id)
         VALUES ($1,$2,$3) RETURNING id`,
        [`${marca}_q${i}`, `${marca}_c${i}`, usr.id]);

      const nombre = `${marca}_j${i}`;
      await enQuiniela(pool, q.id, c =>
        c.query('INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,$2)', [q.id, nombre]));

      ids.push({ quiniela: q.id, usuario: usr.id, jugador: nombre });
    }

    /* ---------- 1. La tormenta: todas las quinielas a la vez ---------- */
    const peticiones = [];
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      for (const q of ids) {
        peticiones.push(
          enQuiniela(pool, q.quiniela, async c => {
            const { rows } = await c.query('SELECT nombre FROM jugadores');
            return { esperado: q.jugador, visto: rows.map(r => r.nombre) };
          }));
      }
    }
    const resultados = await Promise.all(peticiones);

    const cruces = resultados.filter(r =>
      r.visto.length !== 1 || r.visto[0] !== r.esperado);

    ok(`${resultados.length} peticiones concurrentes, ninguna vio otra quiniela`,
       cruces.length === 0,
       cruces.length
         ? `${cruces.length} cruces. Ejemplo: esperaba [${cruces[0].esperado}] y vio [${cruces[0].visto.join(', ')}]`
         : `${QUINIELAS} quinielas × ${RONDAS} rondas`);

    /* ---------- 2. Una petición SIN contexto, después de la tormenta ---------- */
    // Si el contexto sobreviviera a la transacción, esta veria filas ajenas.
    const sueltas = [];
    for (let i = 0; i < 20; i++) {
      sueltas.push(pool.query('SELECT count(*)::int AS n FROM jugadores'));
    }
    const conFugas = (await Promise.all(sueltas)).filter(r => r.rows[0].n !== 0);
    ok('Sin contexto no se ve nada, ni reutilizando conexiones usadas',
       conFugas.length === 0,
       conFugas.length ? `${conFugas.length} de 20 vieron filas` : '20 de 20 vieron 0 filas');

    /* ---------- 3. Contexto y lectura intercalados a propósito ---------- */
    // Alterna quinielas distintas sobre el mismo pool, sin pausa, para forzar
    // que una conexión pase de una quiniela a otra entre peticiones.
    const alternas = [];
    for (let i = 0; i < 120; i++) {
      const q = ids[i % ids.length];
      alternas.push(enQuiniela(pool, q.quiniela, async c => {
        const { rows } = await c.query(
          'SELECT current_setting($1, true) AS ctx', ['app.quiniela_id']);
        return rows[0].ctx === q.quiniela;
      }));
    }
    const malos = (await Promise.all(alternas)).filter(x => !x).length;
    ok('Alternando quinielas sobre el mismo pool, el contexto siempre es el suyo',
       malos === 0, malos ? `${malos} de 120 leyeron un contexto ajeno` : '120 de 120');

    /* ---------- 4. Cuánto cuesta la transacción por petición ---------- */
    const N = 100;
    let t = Date.now();
    for (let i = 0; i < N; i++) await enQuiniela(pool, ids[0].quiniela, c => c.query('SELECT 1'));
    const conTx = (Date.now() - t) / N;

    t = Date.now();
    for (let i = 0; i < N; i++) await pool.query('SELECT 1');
    const sinTx = (Date.now() - t) / N;

    console.log(`\ncoste por consulta    : ${conTx.toFixed(2)} ms con transacción y contexto`);
    console.log(`                        ${sinTx.toFixed(2)} ms suelta`);
    console.log(`                        (+${(conTx - sinTx).toFixed(2)} ms es el precio del aislamiento)`);

  } finally {
    /* ---------- Limpieza, pase lo que pase ---------- */
    for (const q of ids) {
      try {
        // Borrar la quiniela arrastra en cascada lo de dominio, sin pasar por RLS.
        await pool.query('DELETE FROM quinielas WHERE id = $1', [q.quiniela]);
        await pool.query('DELETE FROM usuarios  WHERE id = $1', [q.usuario]);
      } catch (e) {
        console.error(`⚠️  No se pudo limpiar ${q.quiniela}: ${e.message}`);
      }
    }
    await pool.end();
  }

  /* ---------- Informe ---------- */
  console.log('\n=============== LA PUERTA ===============');
  for (const p of prueba) {
    console.log(`${p.ok ? '  OK  ' : ' FALLA'} ${p.n}`);
    console.log(`        ${p.detalle}`);
  }
  const fallos = prueba.filter(p => !p.ok).length;
  console.log(`\n${prueba.length - fallos}/${prueba.length} pasan.`);
  if (fallos) {
    console.log('\n⚠️  NO se sigue adelante con la migración. Una fuga aquí sería');
    console.log('    intermitente y dependiente de la carga: la peor de encontrar.');
  }
  process.exitCode = fallos ? 1 : 0;
}

main().catch(e => { console.error('ROTO:', e.message); process.exitCode = 1; });

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
 *   1. Pon en el `.env` de la raíz la cadena CON pooler y CON el rol
 *      app_quiniela (no la del dueño, que invalida la prueba):
 *
 *        DATABASE_URL=postgresql://app_quiniela:CLAVE@ep-...-pooler.REGION.aws.neon.tech/quiniela?sslmode=verify-full
 *
 *   2. cd sondeo-sql && npm install && node probar-pool.js
 *
 * Sobre `sslmode`: usa `verify-full` y no `require`. Las versiones nuevas de
 * `pg` tratan `require` como `verify-full` de todos modos y avisan por consola
 * de que en la proxima mayor cambiaran a la semantica de libpq, que es MAS
 * DEBIL. Escribirlo explicito quita el aviso y deja claro lo que se quiere.
 * Los certificados de Neon son de una autoridad publica, asi que verifican sin
 * configuracion extra.
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
    console.error('\n⛔ Esta cadena no es la del pooler (el host debe llevar "-pooler").');
    console.error('   Lo que hay que verificar es justo el modo transacción del pooler,');
    console.error('   asi que con la cadena directa la prueba no mide lo que dice medir.');
    process.exitCode = 1;
    return;
  }

  // max alto a propósito: cuantas más conexiones se reciclen, más ocasiones
  // hay de que un contexto mal fijado se cuele en la petición siguiente.
  const pool = new Pool({ connectionString: cadena, max: 10 });

  /*
   * ⛔ LA PUERTA DE LA PUERTA (Entrada 038)
   *
   * Conectarse con el rol dueño invalida toda esta prueba, y de una forma que
   * NO se ve en el resultado: como las tablas llevan FORCE ROW LEVEL SECURITY,
   * el dueño tambien queda sujeto a las politicas, asi que las ocho
   * comprobaciones saldrian en verde igual. Verde y sin valor: el dueño puede
   * APAGAR RLS cuando quiera, y la aplicacion no debe poder.
   *
   * Mirar rolsuper y rolbypassrls no basta para distinguirlo -el dueño de Neon
   * no es ninguna de las dos cosas-. Lo que lo distingue es si ES DUEÑO DE LAS
   * TABLAS. Eso es lo que se comprueba aqui, y por eso se aborta en vez de
   * avisar: un aviso en mitad de una salida en verde no lo lee nadie.
   */
  try {
    const { rows: [q] } = await pool.query(`
      SELECT current_user AS usuario,
             (SELECT count(*) FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user)::int AS tablas_propias,
             (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS superusuario,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`);

    if (q.superusuario || q.bypassrls || q.tablas_propias > 0) {
      console.error(`\n⛔ Estás conectando como "${q.usuario}", que NO sirve para esta prueba.`);
      if (q.tablas_propias > 0) {
        console.error(`   Es dueño de ${q.tablas_propias} tablas de public, asi que puede apagar RLS.`);
      }
      if (q.superusuario)  console.error('   Es superusuario: se salta RLS entero.');
      if (q.bypassrls)     console.error('   Tiene BYPASSRLS: se salta RLS entero.');
      console.error('\n   ⚠️ Lo peligroso es que la prueba saldria EN VERDE de todos modos,');
      console.error('      porque FORCE ROW LEVEL SECURITY tambien alcanza al dueño. Verde');
      console.error('      y sin valor. Por eso se para aqui.');
      console.error('\n   Arreglo: en el .env de la raiz, DATABASE_URL tiene que ser la del rol');
      console.error('   app_quiniela, no la del dueño. Se arma a mano cambiando usuario y');
      console.error('   contraseña sobre la del panel (paso 6 del Anexo C):');
      console.error('\n     DATABASE_URL=postgresql://app_quiniela:TU-CLAVE@ep-...-pooler.REGION.aws.neon.tech/quiniela?sslmode=verify-full');
      console.error('\n   Si no recuerdas la contraseña de app_quiniela, ponle una nueva desde');
      console.error("   el editor SQL de Neon:  ALTER ROLE app_quiniela PASSWORD '...';");
      await pool.end();
      process.exitCode = 1;
      return;
    }
    console.log(`rol comprobado        : ${q.usuario}, sin tablas propias y sin poder saltarse RLS`);
  } catch (e) {
    console.error('\n⛔ No se pudo conectar ni comprobar el rol:', e.message);
    await pool.end();
    process.exitCode = 1;
    return;
  }

  const QUINIELAS = 6;
  const RONDAS = 40;      // RONDAS × QUINIELAS peticiones concurrentes
  const marca = 'pool_' + Date.now().toString(36);
  const ids = [];

  try {
    /* ---------- 0. El rol, ya comprobado arriba, queda anotado ---------- */
    const quien = await pool.query(`
      SELECT current_user AS u,
             (SELECT count(*) FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user)::int AS propias`);
    const { u, propias } = quien.rows[0];
    ok('El rol conectado no puede saltarse ni desactivar RLS', propias === 0,
       `usuario=${u}, dueño de ${propias} tablas de public`);

    /* ---------- Semilla: N quinielas, cada una con UN jugador propio ---------- */
    console.log(`sembrando             : ${QUINIELAS} quinielas, una por jugador...`);
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
    console.log(`tormenta              : ${QUINIELAS * RONDAS} peticiones concurrentes...`);
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
    console.log(`sin contexto          : 20 consultas sobre conexiones ya usadas...`);
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
    console.log(`alternando            : 120 peticiones cambiando de quiniela...`);
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
    console.log(`midiendo el coste     : 200 consultas...`);
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

/*
 * Ensaya, contra PGlite, exactamente los tres archivos que se van a pegar en
 * el editor SQL de Neon. Sirve para no entregar pasos sin haberlos ejecutado.
 *
 * ⚠️ LA LECCION QUE COSTO UN FALLO EN PRODUCCION (Entrada 034)
 *
 * La primera version de este ensayo corria como `postgres`, que en PGlite es
 * SUPERUSUARIO, y los superusuarios SE SALTAN RLS. Por eso pasaba aqui y
 * fallaba en Neon, donde el rol dueño (`neondb_owner`) no es superusuario y SI
 * esta sujeto a las politicas, porque las tablas llevan FORCE ROW LEVEL
 * SECURITY.
 *
 * Ahora el ensayo crea un rol `duenio` NOSUPERUSER con CREATEROLE y corre todo
 * bajo el, que es lo que Neon da de verdad. Si algun dia vuelve a correrse como
 * superusuario, este archivo deja de probar lo que dice probar.
 *
 * ⚠️ LO QUE ESTE ENSAYO SIGUE SIN PODER REPRODUCIR (Entrada 037)
 *
 * Aqui `duenio` CREA el rol `app_quiniela`, y en PostgreSQL quien crea un rol
 * queda como administrador suyo y puede asumirlo con SET ROLE. En Neon eso NO
 * pasa: neondb_owner lo crea igual, pero al asumirlo responde
 * "permission denied to set role". Por eso `neon-preparar.sql` lleva un
 * GRANT app_quiniela TO CURRENT_USER explicito.
 *
 * Este ensayo no habria detectado esa diferencia, porque en PGlite el permiso
 * ya venia dado. Es la cuarta vez en esta sesion que el fallo esta en el borde
 * entre el guion y el sitio donde corre, y no en el SQL. Lo unico que lo
 * detecto fue la comprobacion 3 del propio guion, ejecutada en Neon.
 *
 * La otra diferencia que queda es el nombre de la base en el GRANT CONNECT,
 * que aqui se sustituye por la de PGlite.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const leer = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create();

  /*
   * El rol dueño, como el de Neon: puede crear objetos y roles, pero NO es
   * superusuario y NO puede saltarse RLS.
   */
  await db.exec('CREATE ROLE duenio NOSUPERUSER NOBYPASSRLS CREATEROLE CREATEDB');
  await db.exec('GRANT CREATE, USAGE ON SCHEMA public TO duenio');
  await db.exec('SET ROLE duenio');

  const comprobar = await db.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (comprobar.rows[0].rolsuper || comprobar.rows[0].rolbypassrls) {
    console.error('El ensayo corre con privilegios de mas: no probaria nada.');
    process.exitCode = 1;
    return;
  }
  console.log('rol del ensayo        -> duenio (sin superusuario, sin BYPASSRLS)');

  await db.exec(leer('esquema.sql'));
  console.log('esquema.sql           -> aplicado');

  const preparar = leer('neon-preparar.sql')
    .replace('ON DATABASE quiniela', 'ON DATABASE postgres');
  await db.exec(preparar);
  console.log('neon-preparar.sql     -> aplicado');

  const res = await db.exec(leer('neon-verificar.sql'));
  const tabla = res.filter(r => r.rows && r.rows.length && r.rows[0].prueba).pop();

  console.log('neon-verificar.sql    -> ejecutado\n');
  if (!tabla) { console.error('No devolvio la tabla de resultados'); process.exitCode = 1; return; }

  let fallos = 0;
  for (const f of tabla.rows) {
    if (f.resultado !== 'PASA') fallos++;
    console.log(`  ${f.resultado}  ${f.prueba}`);
    if (f.resultado !== 'PASA') console.log(`        -> ${f.detalle}`);
  }
  console.log(`\n${tabla.rows.length - fallos}/${tabla.rows.length} pasan.`);
  process.exitCode = fallos ? 1 : 0;
}

main().catch(e => { console.error('ROTO:', e.message); process.exitCode = 1; });

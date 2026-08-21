/*
 * Ensaya, contra PGlite, exactamente los tres archivos que se van a pegar en
 * el editor SQL de Neon. Sirve para no entregar pasos sin haberlos ejecutado.
 *
 * La unica diferencia con Neon es el nombre de la base en el GRANT CONNECT,
 * que aqui se sustituye por la de PGlite.
 */
'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create();

  const leer = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

  await db.exec(leer('esquema.sql'));
  console.log('esquema.sql          -> aplicado');

  const preparar = leer('neon-preparar.sql')
    .replace('ON DATABASE quiniela', 'ON DATABASE postgres')
    .replace('CAMBIAME-por-algo-largo-y-aleatorio', 'clave-de-ensayo');
  await db.exec(preparar);
  console.log('neon-preparar.sql    -> aplicado');

  const res = await db.exec(leer('neon-verificar.sql'));
  const tabla = res.filter(r => r.rows && r.rows.length && r.rows[0].prueba).pop();

  console.log('neon-verificar.sql   -> ejecutado\n');
  if (!tabla) { console.error('No devolvio la tabla de resultados'); process.exit(1); }

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

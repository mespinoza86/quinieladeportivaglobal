'use strict';

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const ejecutar = process.argv.includes('--execute');
const legacyUri = process.env.MONGO_URI_LEGACY_READONLY;
const targetUri = process.env.MONGO_URI_MULTIQUINIELA;
const legacyDbName = process.env.LEGACY_DB_NAME;
const targetDbName = process.env.TARGET_DB_NAME;
const ownerEmail = String(process.env.MIGRATION_OWNER_EMAIL || '').trim().toLowerCase();
const poolName = process.env.MIGRATION_POOL_NAME || 'Quiniela histórica';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!legacyUri || !targetUri || !legacyDbName || !targetDbName) fail('Faltan variables de conexión de migración.');
if (legacyDbName === targetDbName) fail('LEGACY_DB_NAME y TARGET_DB_NAME deben ser diferentes.');
if (legacyUri === targetUri) fail('Las URI de origen y destino no pueden ser idénticas.');
if (!ownerEmail) fail('Falta MIGRATION_OWNER_EMAIL para asignar la propiedad en la base nueva.');

const coleccionesDominio = [
  'jugadors', 'jornadas', 'resultados', 'resultadooficials', 'trivias',
  'respuestatrivias', 'equipos'
];

async function documentosSiExiste(db, nombre) {
  const existe = await db.listCollections({ name: nombre }, { nameOnly: true }).hasNext();
  return existe ? db.collection(nombre).find({}).toArray() : [];
}

async function main() {
  const origen = new MongoClient(legacyUri, { readPreference: 'secondaryPreferred' });
  const destino = new MongoClient(targetUri);
  await origen.connect();
  await destino.connect();
  try {
    const oldDb = origen.db(legacyDbName);
    const newDb = destino.db(targetDbName);
    const owner = await newDb.collection('usuarios').findOne({ emailNormalizado: ownerEmail });
    if (!owner) fail('El propietario debe registrarse primero en la aplicación nueva; no se encontró MIGRATION_OWNER_EMAIL.');

    const inventario = {};
    const datos = {};
    for (const nombre of coleccionesDominio) {
      datos[nombre] = await documentosSiExiste(oldDb, nombre);
      inventario[nombre] = datos[nombre].length;
    }

    console.log(JSON.stringify({ modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN', origen: legacyDbName, destino: targetDbName, poolName, inventario }, null, 2));
    if (!ejecutar) {
      console.log('Simulación terminada. No se escribió ningún documento. Usa --execute después de revisar los conteos.');
      return;
    }

    const marcadorMigracion = `legacy:${legacyDbName}`;
    let quiniela = await newDb.collection('quinielas').findOne({ marcadorMigracion });
    if (!quiniela) {
      const now = new Date();
      const doc = {
        nombre: poolName,
        codigoIngreso: `MIG${new ObjectId().toHexString().slice(-7).toUpperCase()}`,
        propietarioId: owner._id,
        estado: 'activa',
        marcadorMigracion,
        configuracion: { puntuacion: { marcadorExacto: 5, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4, triviasHabilitadas: true, puntosTriviaDefault: 1 }, incluirExpulsadosEnRanking: true },
        createdAt: now,
        updatedAt: now
      };
      const inserted = await newDb.collection('quinielas').insertOne(doc);
      quiniela = { ...doc, _id: inserted.insertedId };
    }

    await newDb.collection('membresias').updateOne(
      { quinielaId: quiniela._id, usuarioId: owner._id },
      { $set: { rol: 'propietario', estado: 'activo', aprobadoEn: new Date(), updatedAt: new Date() }, $setOnInsert: { solicitadoEn: new Date(), createdAt: new Date() } },
      { upsert: true }
    );

    for (const nombre of coleccionesDominio) {
      const documentos = datos[nombre];
      if (!documentos.length) continue;
      const ops = documentos.map(original => {
        const legacyId = original._id.toString();
        const copia = { ...original, quinielaId: quiniela._id, legacyId, migratedAt: new Date() };
        delete copia._id;
        return { updateOne: { filter: { quinielaId: quiniela._id, legacyId }, update: { $set: copia }, upsert: true } };
      });
      await newDb.collection(nombre).bulkWrite(ops, { ordered: false });
    }

    console.log(`Migración terminada en la quiniela ${quiniela._id}. La base anterior solo fue leída.`);
    console.log('Los jugadores históricos sin correo deben vincularse posteriormente a cuentas registradas; sus nombres permanecen en pronósticos y resultados.');
  } finally {
    await Promise.allSettled([origen.close(), destino.close()]);
  }
}

main().catch(error => { console.error(error); process.exit(1); });

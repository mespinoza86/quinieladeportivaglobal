/*
 * Levanta la aplicación entera para las pruebas de navegador: base de datos en
 * memoria y servidor HTTP, sin tocar nada real.
 *
 * Lo arranca Playwright a través de `webServer` en playwright.config.js, y no
 * al revés: así una prueba nunca puede correr contra un servidor a medio
 * levantar, porque Playwright espera a que /healthz responda.
 *
 * El entorno se prepara ANTES de importar server.js, porque ese módulo lee la
 * configuración al cargarse. Es la misma razón, y el mismo orden, que en
 * test/integracion.test.js.
 */
'use strict';

const { MongoMemoryReplSet } = require('mongodb-memory-server');

const PUERTO = Number(process.env.E2E_PUERTO || 3210);

(async () => {
  /*
   * Conjunto de réplicas, no un mongod suelto: las rutas que crean quinielas o
   * borran jornadas usan transacciones, y sin réplicas caerían a la rama sin
   * atomicidad. Las pruebas verían la aplicación funcionando de otra manera que
   * en producción.
   */
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI_MULTIQUINIELA = mongo.getUri('quiniela_e2e');
  process.env.SESSION_SECRET = 'secreto-solo-para-pruebas-e2e';
  process.env.APIFOOTBALL_COM_KEY = 'clave-falsa-no-se-usa';
  process.env.PORT = String(PUERTO);

  /*
   * `NODE_ENV=test` ya apaga los trabajos periódicos, pero se deja explícito:
   * un sincronizador corriendo durante las pruebas cambiaría resultados a mitad
   * de una comprobación y los fallos serían intermitentes.
   */
  process.env.JOBS_HABILITADOS = 'false';

  const servidor = require('../../server.js');
  await servidor.conectarMongoConReintentos();

  const escuchando = servidor.app.listen(PUERTO, () => {
    console.log(`E2E: aplicación en http://127.0.0.1:${PUERTO}`);
  });

  const cerrar = async () => {
    escuchando.close();
    await mongo.stop().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
})().catch(error => {
  console.error('E2E: no se pudo levantar la aplicación:', error);
  process.exit(1);
});

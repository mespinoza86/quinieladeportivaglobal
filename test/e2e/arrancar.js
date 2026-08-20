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

  /*
   * Proveedor de partidos falso y fijo (Fase C).
   *
   * La clave del API de arriba es de mentira, así que la pantalla de importar
   * partidos no podría cargar su desplegable de torneos y no habría nada que
   * probar. Se sustituye la consulta por rango por una lista pequeña y
   * determinista: dos ligas de dos países, más una femenil que el servidor
   * debe descartar.
   *
   * Se hace aquí y no en cada prueba porque es propiedad del ENTORNO —esta
   * aplicación de pruebas no habla con nadie de fuera—, no de un caso concreto.
   */
  servidor.proveedorDeEventos.porRango = async () => ([
    { apiFixtureId: 1, fecha: '2099-01-01 15:00', estado: 'NS', liga: 'Liga MX',
      pais: 'Mexico', apiLeagueId: 101, equipo1: 'America', equipo2: 'Chivas' },
    { apiFixtureId: 2, fecha: '2099-01-02 17:00', estado: 'NS', liga: 'Liga MX',
      pais: 'Mexico', apiLeagueId: 101, equipo1: 'Pumas', equipo2: 'Cruz Azul' },
    { apiFixtureId: 3, fecha: '2099-01-02 19:00', estado: 'NS', liga: 'Primera Division',
      pais: 'Costa Rica', apiLeagueId: 202, equipo1: 'Saprissa', equipo2: 'Alajuelense' },
    { apiFixtureId: 4, fecha: '2099-01-03 11:00', estado: 'NS', liga: 'Liga MX Femenil',
      pais: 'Mexico', apiLeagueId: 303, equipo1: 'Tigres', equipo2: 'Rayadas' }
  ]);
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

/*
 * Levanta la aplicación entera para las pruebas de navegador: base de datos en
 * memoria y servidor HTTP, sin tocar nada real.
 *
 * Lo arranca Playwright a través de `webServer` en playwright.config.js, y no
 * al revés: así una prueba nunca puede correr contra un servidor a medio
 * levantar, porque Playwright espera a que /healthz responda.
 *
 * ⚠️ La base es **PGlite**, no Mongo: PostgreSQL 18 compilado a WebAssembly,
 * dentro de este mismo proceso. Arranca en unos tres segundos y no necesita ni
 * red ni Docker.
 *
 * PGlite atiende UNA sola conexión, y aquí eso no estorba: `playwright.config.js`
 * corre con un solo trabajador y en serie a propósito, porque las pruebas
 * comparten la base y en paralelo se pisarían.
 */
'use strict';

const path = require('path');

const PUERTO = Number(process.env.E2E_PUERTO || 3210);

(async () => {
  /*
   * El entorno se prepara ANTES de construir la aplicación, porque se lee al
   * crearla. Es la misma razón, y el mismo orden, que en las demás suites.
   */
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'secreto-solo-para-pruebas-e2e';
  process.env.APIFOOTBALL_COM_KEY = 'clave-falsa-no-se-usa';
  process.env.PORT = String(PUERTO);

  /*
   * `NODE_ENV=test` ya bastaría, pero se deja explícito: un sincronizador
   * corriendo durante las pruebas cambiaría resultados a mitad de una
   * comprobación y los fallos serían intermitentes.
   */
  process.env.JOBS_HABILITADOS = 'false';

  const enMemoria = require(path.join(__dirname, '..', 'postgres-en-memoria'));
  const adaptador = await enMemoria.levantar();

  const proveedor = require('../../src/proveedor');

  /*
   * Proveedor de partidos falso y fijo (Fase C).
   *
   * La clave del API de arriba es de mentira, así que la pantalla de importar
   * partidos no podría cargar su desplegable de torneos y no habría nada que
   * probar. Se sustituye la puerta al exterior por una lista pequeña y
   * determinista: dos ligas de dos países, más una femenil que el servidor
   * debe descartar.
   *
   * Se hace aquí y no en cada prueba porque es propiedad del ENTORNO —esta
   * aplicación de pruebas no habla con nadie de fuera—, no de un caso concreto.
   */
  proveedor.usarFuente(async () => ([
    { match_id: '1', match_date: '2099-01-01', match_time: '15:00', match_status: 'NS',
      league_name: 'Liga MX', country_name: 'Mexico', league_id: '101',
      match_hometeam_name: 'America', match_awayteam_name: 'Chivas',
      team_home_badge: '', team_away_badge: '',
      match_hometeam_score: '', match_awayteam_score: '' },
    { match_id: '2', match_date: '2099-01-02', match_time: '17:00', match_status: 'NS',
      league_name: 'Liga MX', country_name: 'Mexico', league_id: '101',
      match_hometeam_name: 'Pumas', match_awayteam_name: 'Cruz Azul',
      team_home_badge: '', team_away_badge: '',
      match_hometeam_score: '', match_awayteam_score: '' },
    { match_id: '3', match_date: '2099-01-02', match_time: '19:00', match_status: 'NS',
      league_name: 'Primera Division', country_name: 'Costa Rica', league_id: '202',
      match_hometeam_name: 'Saprissa', match_awayteam_name: 'Alajuelense',
      team_home_badge: '', team_away_badge: '',
      match_hometeam_score: '', match_awayteam_score: '' },
    { match_id: '4', match_date: '2099-01-03', match_time: '11:00', match_status: 'NS',
      league_name: 'Liga MX Femenil', country_name: 'Mexico', league_id: '303',
      match_hometeam_name: 'Tigres', match_awayteam_name: 'Rayadas',
      team_home_badge: '', team_away_badge: '',
      match_hometeam_score: '', match_awayteam_score: '' }
  ]));

  const { crearApp } = require('../../src/servidor');
  const { app } = crearApp({ pool: adaptador, secretoSesion: process.env.SESSION_SECRET });

  /*
   * ⚠️ UNA PUERTA QUE SOLO EXISTE EN EL ARNES.
   *
   * Las pruebas corren en OTRO proceso, asi que no pueden leer la bandeja del
   * transporte de consola, que vive en memoria de este. Y el token no esta en
   * la base: solo su hash.
   *
   * Se registra AQUI y no en `crearApp`, asi que en produccion esta ruta no
   * existe -no es que responda 404 por una bandera: no esta declarada-. Es la
   * unica forma de que una prueba de navegador siga el flujo real del correo
   * sin abrir un agujero en la aplicacion.
   */
  app.get('/e2e/ultimo-correo', (req, res) => {
    const mensaje = require('../../src/correo').bandeja.at(-1);
    if (!mensaje) return res.status(404).json({ error: 'no se envio ningun correo' });
    res.json(mensaje);
  });

  const escuchando = app.listen(PUERTO, () => {
    console.log(`E2E: aplicación en http://127.0.0.1:${PUERTO}`);
  });

  const cerrar = async () => {
    escuchando.close();
    await require('../../src/db').cerrar().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
})().catch(error => {
  console.error('E2E: no se pudo levantar la aplicación:', error);
  process.exit(1);
});

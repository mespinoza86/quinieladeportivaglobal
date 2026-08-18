/*
 * Pruebas de navegador.
 *
 * Las 105 pruebas de `npm test` cubren bien el servidor, pero el frontend no
 * tenía ninguna: cada cambio de interfaz se venía comprobando a mano, pantalla
 * por pantalla. Estas automatizan justo eso.
 *
 * Corren aparte de `npm test` a propósito: necesitan navegador y tardan más, y
 * la suite rápida debe seguir siendo rápida. Se lanzan con `npm run test:e2e`.
 */
'use strict';

const { defineConfig, devices } = require('@playwright/test');

const PUERTO = Number(process.env.E2E_PUERTO || 3210);
const BASE = `http://127.0.0.1:${PUERTO}`;

module.exports = defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.js',

  /*
   * En serie y con un solo trabajador. Las pruebas comparten una base de datos
   * y el ranking es global a la quiniela: en paralelo se pisarían entre ellas y
   * los fallos serían intermitentes, que es la peor clase de prueba.
   */
  fullyParallel: false,
  workers: 1,

  // Un reintento sirve para distinguir un fallo real de una carga lenta.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  reporter: [['list']],

  use: {
    baseURL: BASE,
    // Solo se guardan al fallar: en verde no hacen falta y ocupan.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },

  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    /*
     * La aplicación se usa sobre todo desde el móvil —la interfaz entera está
     * construida en torno a `mobile-shell`—, así que el móvil no es un extra:
     * es el caso principal.
     */
    { name: 'movil', use: { ...devices['Pixel 5'] } }
  ],

  webServer: {
    command: 'node test/e2e/arrancar.js',
    url: `${BASE}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});

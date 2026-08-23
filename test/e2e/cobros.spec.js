/*
 * Cobros, por la interfaz.
 *
 * El recorrido entero: encender los cobros, anotar un abono y que el jugador lo
 * vea en su portada.
 *
 * Lo que se fija aquí y no en las pruebas de ruta: que **el jugador vea su
 * saldo sin tener que preguntarle a nadie**, que es todo el punto de esto.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/**
 * Deja lista una quiniela que cobra, con un socio dentro que ya es jugador.
 *
 * ⚠️ El socio necesita su propio CONTEXTO de navegador, no otra pestaña. Las
 * pestañas de un mismo contexto comparten el frasco de cookies, así que
 * registrar al socio tumbaría la sesión de la administradora y las peticiones
 * siguientes se harían con la cuenta equivocada.
 */
async function quinielaQueCobra(page, navegador, prefijo) {
  const jefa = await registrarse(page, prefijo + 'jefa');
  await crearQuiniela(page, 'Quiniela ' + prefijo);
  await activarAdminMode(page, jefa.password);

  const quiniela = await page.request.get('/api/quiniela-actual').then(r => r.json());

  const contextoSocio = await navegador.newContext();
  const otra = await contextoSocio.newPage();
  const socio = await registrarse(otra, prefijo + 'socio');

  await otra.request.post('/api/quinielas/unirse',
    { data: { codigoIngreso: quiniela.codigoIngreso } });

  const miembros = await page.request.get('/api/quiniela-actual/miembros').then(r => r.json());
  const pendiente = miembros.find(m => m.username === socio.username);
  await page.request.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`, { data: {} });

  // Y el socio entra a la quiniela, que si no no tiene ninguna seleccionada.
  await otra.request.post(`/api/quinielas/${quiniela.id}/seleccionar`, { data: {} });

  return { jefa, socio, otra, contextoSocio };
}

test('encender los cobros, anotar un abono y que el jugador lo vea', async ({ page, browser }) => {
  const { socio, otra } = await quinielaQueCobra(page, browser, 'cob');

  /* ---- 1. Encender los cobros en la configuración ---- */
  await page.goto('/configuracion-quiniela.html');
  await expect(page.locator('#cobrosPanel')).toBeVisible({ timeout: 10_000 });

  await page.locator('#jornadaActivo').check();
  await page.locator('#jornadaPrecio').fill('2000');
  await page.locator('#guardarCobros').click();
  await expect(page.locator('#cobrosMensaje')).toContainText('guardados', { timeout: 10_000 });

  /* ---- 2. Una jornada, que nace con su precio ---- */
  await page.request.post('/api/jornadas', {
    data: {
      nombre: 'J1',
      partidos: [{ equipo1: 'Alfa', equipo2: 'Beta', logoEquipo1: '', logoEquipo2: '',
                   comodin: false, apiFixtureId: '', apiLeagueId: '',
                   apiDate: '2099-01-01 15:00', apiStatus: '' }]
    }
  });

  /* ---- 3. Anotar un abono de 6000: cubre tres jornadas ---- */
  await page.goto('/cobros.html');
  await expect(page.locator('#cuentasPanel')).toBeVisible({ timeout: 10_000 });

  await page.locator('#abonoJugador').selectOption({ label: socio.username });
  await page.locator('#abonoMonto').fill('6000');
  await page.locator('#guardarAbono').click();
  await expect(page.locator('#abonoMensaje')).toContainText('anotado', { timeout: 10_000 });

  /*
   * ⚠️ La estimación va SIEMPRE con el precio al lado. Sin él parece una
   * promesa, y la jornada que viene puede costar el doble.
   */
  await expect(page.locator('#listaCuentas')).toContainText('saldo a favor');
  await expect(page.locator('#listaCuentas')).toContainText('al precio de hoy');

  /* ---- 4. Y el jugador lo ve en su portada, sin preguntarle a nadie ---- */
  await otra.goto('/index.html');
  await expect(otra.locator('#miCuentaCard')).toBeVisible({ timeout: 10_000 });
  await expect(otra.locator('#miCuentaContenido')).toContainText('J1');
  await expect(otra.locator('#miCuentaContenido')).toContainText('pagada');
  await expect(otra.locator('#miCuentaContenido')).toContainText('Saldo a favor');
});

test('sin cobros activos, la portada no enseña ninguna tarjeta de pagos', async ({ page, browser }) => {
  /*
   * Es el caso de todas las quinielas que existían antes de esto. Desplegar la
   * función no puede hacer aparecer una tarjeta de dinero donde no se cobra.
   */
  const { otra } = await quinielaQueCobra(page, browser, 'sincob');

  await otra.goto('/index.html');
  await otra.locator('#quinielaActualNombre').waitFor({ timeout: 10_000 });
  await expect(otra.locator('#miCuentaCard')).toBeHidden();
});

test('la pantalla de cobros avisa cuando no se cobra nada, en vez de quedarse vacía', async ({ page, browser }) => {
  await quinielaQueCobra(page, browser, 'avisa');

  await page.goto('/cobros.html');
  await expect(page.locator('#apagadoPanel')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#cuentasPanel')).toBeHidden();
});

test('un abono mal anotado se corrige, y los dos asientos quedan a la vista', async ({ page, browser }) => {
  const { socio } = await quinielaQueCobra(page, browser, 'corrige');

  await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { cobros: { torneo: { activo: false, precio: 0 },
                      jornada: { activo: true, precio: 2000 } } }
  });

  await page.goto('/cobros.html');
  await expect(page.locator('#cuentasPanel')).toBeVisible({ timeout: 10_000 });

  await page.locator('#abonoJugador').selectOption({ label: socio.username });
  await page.locator('#abonoMonto').fill('9999');
  await page.locator('#guardarAbono').click();
  await expect(page.locator('#abonoMensaje')).toContainText('anotado', { timeout: 10_000 });

  page.on('dialog', dialogo => dialogo.accept());
  await page.locator('#listaHistorial .anular').first().click();

  /*
   * No se borra: quedan el abono y su corrección. El día que alguien diga «yo
   * sí pagué», la discusión se resuelve mirando esto.
   */
  await expect(page.locator('#listaHistorial .info-card')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#listaHistorial')).toContainText('corrección');
});

/*
 * La pantalla del superadministrador, por la interfaz.
 *
 * ============================================================================
 * LO QUE SE PRUEBA AQUÍ ES QUIÉN NO ENTRA
 * ============================================================================
 *
 * Las 11 pruebas de ruta ya cubren las reglas. Esto cubre lo que sólo se ve
 * desde el navegador: que la pantalla **no se sirve** a quien no toca, que pide
 * la contraseña aunque tengas el correo en la lista, y que lo que enseña
 * después son las cuentas de verdad.
 *
 * Es la única pantalla que muestra los correos de todo el mundo, así que la
 * pregunta que importa no es «¿funciona?» sino «¿a quién se le abre?».
 *
 * `/e2e/dar-poder` es una puerta que sólo existe en el arnés (ver `arrancar.js`):
 * las cuentas se crean al vuelo, así que su correo no puede estar en la
 * variable de entorno desde el arranque.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela } = require('./ayudas');

/** Deja SIN superadministradores, que es como arranca el arnés. */
async function quitarPoder(page) {
  await page.request.post('/e2e/dar-poder', { data: { email: '' } });
}

test('⛔ sin estar en la lista, la pantalla ni siquiera se sirve', async ({ page }) => {
  const datos = await registrarse(page, 'curioso');
  await crearQuiniela(page, 'La suya');

  await quitarPoder(page);

  await page.goto('/superadmin.html');

  /*
   * Redirige a la portada. No es cosmético: quien no manda no debe poder ni
   * descargar el marcado de esta pantalla.
   */
  await expect(page).toHaveURL(/index\.html$/);

  // Y la tarjeta de la portada tampoco aparece.
  await expect(page.locator('#superadminCard')).toBeHidden();

  /* Los datos tampoco llegan, que es lo que de verdad protege. */
  const respuesta = await page.request.get('/api/superadmin/cuentas');
  expect(respuesta.status()).toBe(403);
});

test('⚠️ con el correo en la lista, pide la contraseña antes de enseñar nada', async ({ page }) => {
  const datos = await registrarse(page, 'jefa');
  await crearQuiniela(page, 'La de la jefa');

  await page.request.post('/e2e/dar-poder', { data: { email: datos.email } });

  await page.goto('/superadmin.html');

  // Se sirve, pero lo único visible es la puerta.
  await expect(page.locator('#confirmarPanel')).toBeVisible();
  await expect(page.locator('#cuentasPanel')).toBeHidden();

  // Una contraseña equivocada no abre nada.
  await page.locator('#password').fill('la-que-no-es');
  await page.locator('#confirmarBtn').click();
  await expect(page.locator('#confirmarError')).toBeVisible();
  await expect(page.locator('#cuentasPanel')).toBeHidden();

  // La buena sí.
  await page.locator('#password').fill(datos.password);
  await page.locator('#confirmarBtn').click();

  await expect(page.locator('#cuentasPanel')).toBeVisible();
  await expect(page.locator('#confirmarPanel')).toBeHidden();

  await quitarPoder(page);
});

test('la lista enseña los correos y las quinielas de cada quien', async ({ browser }) => {
  /*
   * Dos CONTEXTOS y no dos pestañas: las pestañas de un contexto comparten
   * cookies, así que registrar al socio tumbaría la sesión de la jefa. Es la
   * lección de la Entrada 061.
   */
  const contextoJefa = await browser.newContext();
  const contextoSocio = await browser.newContext();

  const paginaJefa = await contextoJefa.newPage();
  const paginaSocio = await contextoSocio.newPage();

  const jefa = await registrarse(paginaJefa, 'mandamas');
  await crearQuiniela(paginaJefa, 'La grande');

  const socio = await registrarse(paginaSocio, 'elsocio');
  await crearQuiniela(paginaSocio, 'La chica');

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: jefa.email } });

  await paginaJefa.goto('/superadmin.html');
  await paginaJefa.locator('#password').fill(jefa.password);
  await paginaJefa.locator('#confirmarBtn').click();
  await expect(paginaJefa.locator('#cuentasPanel')).toBeVisible();

  // El correo del socio sale, y su quiniela con él.
  const listado = paginaJefa.locator('#listado');
  await expect(listado).toContainText(socio.email);
  await expect(listado).toContainText('La chica');

  // Y quien manda se marca, sin botones para retirarse a sí mismo.
  await expect(listado).toContainText('Superadministrador');

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: '' } });
  await contextoJefa.close();
  await contextoSocio.close();
});

/*
 * El orden de «Mis quinielas», por la interfaz.
 *
 * Es la pantalla de justo después de entrar, y hasta el 11 de septiembre
 * enseñaba el formulario de CREAR como primera cosa, para todo el mundo. Marco
 * lo reportó con un síntoma que no se ve en ninguna prueba de ruta: **hubo
 * gente que, intentando entrar a su quiniela, creó otras**.
 *
 * Lo que se fija aquí y no en las rutas: qué se ve primero. El servidor puede
 * mandar la lista en el orden perfecto y la pantalla seguir enseñando el
 * formulario de crear encima — que es exactamente lo que pasaba.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela } = require('./ayudas');

/**
 * Los paneles VISIBLES, en el orden en que aparecen en la pantalla.
 *
 * ⚠️ Se leen del documento y se filtran por `hidden`, no se pregunta por cada
 * uno por separado: lo que se quiere comprobar es el ORDEN, y preguntar uno a
 * uno comprueba presencia. Es la diferencia que costó la Entrada 067.
 */
const panelesVisibles = page => page.evaluate(() =>
  [...document.querySelectorAll('#shell > section[id]')]
    .filter(s => !s.hidden)
    .map(s => s.id));

test('sin ninguna quiniela, lo primero es UNIRME y la lista ni aparece', async ({ page }) => {
  await registrarse(page, 'ordsin');

  await expect(page.locator('#panelUnirse')).toBeVisible({ timeout: 10_000 });

  const orden = await panelesVisibles(page);
  expect(orden).toEqual(['panelUnirse', 'panelCrear']);

  await expect(page.locator('#panelLista')).toBeHidden();
  await expect(page.locator('#heroTexto')).toContainText('pide el código');
});

test('con una quiniela, lo primero es la quiniela', async ({ page }) => {
  const jefa = await registrarse(page, 'ordcon');
  const nombre = await crearQuiniela(page, 'Quiniela ord');

  await page.goto('/quinielas.html');
  await expect(page.locator('#panelLista')).toBeVisible({ timeout: 10_000 });

  const orden = await panelesVisibles(page);
  expect(orden).toEqual(['panelLista', 'panelUnirse', 'panelCrear']);

  await expect(page.locator('#listaQuinielas')).toContainText(nombre);
  await expect(page.locator('#heroTexto')).toContainText('la última que usaste');

  /* Y el botón de entrar sigue haciendo lo suyo. */
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/index.html');
  expect(jefa.username).toBeTruthy();
});

test('⛔ con una solicitud pendiente, la lista va primero', async ({ page, browser }) => {
  /*
   * Fue la respuesta de Marco y es la correcta: a quien está esperando
   * aprobación hay que enseñarle que su solicitud está en camino. Con «Unirme»
   * delante, vuelve a meter el código — la misma confusión con otra cara.
   */
  const jefa = await registrarse(page, 'ordpend');
  await crearQuiniela(page, 'Quiniela pend');

  const quiniela = await page.request.get('/api/quiniela-actual').then(r => r.json());

  const contextoSocio = await browser.newContext();
  const otra = await contextoSocio.newPage();
  await registrarse(otra, 'ordpend-socio');

  /* Se une POR LA PANTALLA, que es el recorrido que hace la gente. */
  await otra.goto('/quinielas.html');
  await expect(otra.locator('#panelUnirse')).toBeVisible({ timeout: 10_000 });
  await otra.locator('#codigoIngreso').fill(quiniela.codigoIngreso);
  await otra.getByRole('button', { name: 'Solicitar ingreso' }).click();

  /*
   * ⚠️ Y la pantalla tiene que REORDENARSE SOLA sin recargar: acaba de pasar de
   * «no tengo nada» a «tengo una solicitud», y es el momento en que más
   * confunde ver «Unirme» todavía arriba.
   */
  await expect(otra.locator('#panelLista')).toBeVisible({ timeout: 10_000 });

  const orden = await panelesVisibles(otra);
  expect(orden).toEqual(['panelLista', 'panelUnirse', 'panelCrear']);

  await expect(otra.locator('#listaQuinielas')).toContainText('en espera de aprobación');
  await expect(otra.getByRole('button', { name: 'Entrar' })).toHaveCount(0);

  expect(jefa.username).toBeTruthy();
  await contextoSocio.close();
});

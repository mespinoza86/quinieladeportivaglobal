/*
 * Modo Administrador: qué se enseña cuando la comprobación de permisos falla.
 *
 * El fallo que esto fija (Entrada 062): `guest-content` venía visible de fábrica
 * y el `catch` sólo escribía en la consola, así que un error dejaba puesto el
 * menú público. El administrador veía una pantalla **que parecía correcta** —sin
 * sus opciones y sin ninguna explicación— y tenía que salir a Inicio y volver.
 *
 * Se simula la causa más probable: el servicio despertando, que responde una
 * página de error en HTML donde debería ir JSON.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela } = require('./ayudas');

/** Una respuesta que NO es JSON, como la de un servicio arrancando. */
const comoDespertando = ruta => ruta.fulfill({
  status: 502,
  contentType: 'text/html',
  body: '<html><body>Service Unavailable</body></html>'
});

async function comoAdministradora(page, prefijo) {
  const datos = await registrarse(page, prefijo);
  await crearQuiniela(page, 'Quiniela ' + prefijo);
  return datos;
}

test('⛔ si la comprobación falla, NO se queda el menú público puesto', async ({ page }) => {
  await comoAdministradora(page, 'admA');

  // Falla siempre: ni el primer intento ni el reintento lo consiguen.
  await page.route('**/api/quiniela-actual', comoDespertando);
  await page.goto('/adminmode.html');

  /*
   * Lo que NO puede pasar: que se vea el menú público. Era lo que hacía creer
   * que habías entrado bien y que ahí no había nada más.
   */
  await expect(page.locator('#admin-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#guest-content')).toBeHidden();
  await expect(page.locator('#admin-content')).toBeHidden();

  // Y se dice qué pasó, en vez de dejarlo sólo en la consola.
  await expect(page.locator('#adminErrorDetalle')).toContainText('arrancando');
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('un fallo pasajero se arregla solo: reintenta una vez', async ({ page }) => {
  await comoAdministradora(page, 'admB');

  /*
   * Falla la primera y funciona la segunda, que es justo lo que pasa con un
   * servicio despertando. Quien usa la aplicación no debería enterarse.
   */
  let intentos = 0;
  await page.route('**/api/quiniela-actual', ruta => {
    intentos += 1;
    return intentos === 1 ? comoDespertando(ruta) : ruta.continue();
  });

  await page.goto('/adminmode.html');

  // Sale el formulario de contraseña, que es lo correcto: entró bien.
  await expect(page.locator('#admin-login')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#admin-error')).toBeHidden();
  expect(intentos).toBeGreaterThanOrEqual(2);
});

test('el botón de reintentar arregla la pantalla sin recargar', async ({ page }) => {
  await comoAdministradora(page, 'admC');

  let caido = true;
  await page.route('**/api/quiniela-actual', ruta =>
    caido ? comoDespertando(ruta) : ruta.continue());

  await page.goto('/adminmode.html');
  await expect(page.locator('#admin-error')).toBeVisible({ timeout: 15_000 });

  caido = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();

  await expect(page.locator('#admin-login')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#admin-error')).toBeHidden();
});

test('con todo bien, se pide la contraseña y luego aparece el panel', async ({ page }) => {
  const datos = await comoAdministradora(page, 'admD');

  await page.goto('/adminmode.html');
  await expect(page.locator('#admin-login')).toBeVisible({ timeout: 15_000 });

  await page.locator('#adminPassword').fill(datos.password);
  await page.getByRole('button', { name: /Confirmar|Entrar|Activar/i }).click();

  await expect(page.locator('#admin-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#guest-content')).toBeHidden();

  // Y las tarjetas de administración están donde deben.
  await expect(page.locator('#admin-content')).toContainText('Cobros');
});

test('salir del modo administrador lleva a la portada, no al formulario', async ({ page }) => {
  /*
   * Antes se quedaba en «Confirmar acceso», que es la puerta por la que se
   * acaba de salir: pedirle la contraseña a quien acaba de decir que ya no
   * quiere ser administrador es lo contrario de lo que pidió.
   */
  const datos = await comoAdministradora(page, 'admE');

  await page.goto('/adminmode.html');
  await page.locator('#adminPassword').fill(datos.password);
  await page.getByRole('button', { name: /Confirmar|Entrar|Activar/i }).click();
  await expect(page.locator('#admin-content')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Salir de Admin mode' }).click();
  await page.waitForURL('**/index.html', { timeout: 15_000 });

  // Y sigue con la sesión abierta: salir del modo admin no es cerrar sesión.
  await expect(page.locator('#quinielaActualNombre')).toBeVisible({ timeout: 15_000 });
});

/*
 * Recuperar la contraseña, por la interfaz.
 *
 * Es el recorrido que hace alguien que la olvidó: el enlace del login, el
 * formulario, el correo, la pantalla de la contraseña nueva y volver a entrar.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { credenciales } = require('./ayudas');

/** Registra y confirma una cuenta, sin dejar sesión abierta. */
async function cuentaConfirmada(page, prefijo) {
  const datos = credenciales(prefijo);

  await page.goto('/registro.html');
  await page.locator('#username').fill(datos.username);
  await page.locator('#email').fill(datos.email);
  await page.locator('#password').fill(datos.password);
  await page.locator('#confirmarPassword').fill(datos.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.locator('#registroForm').waitFor({ state: 'hidden' });

  const correo = await (await page.request.get('/e2e/ultimo-correo')).json();
  await page.goto(`/verificar-correo.html?token=${correo.texto.match(/token=([a-f0-9]{64})/)[1]}`);
  await page.getByRole('button', { name: 'Iniciar sesión' }).waitFor();

  return datos;
}

test('quien olvidó su contraseña puede elegir otra y entrar', async ({ page }) => {
  const datos = await cuentaConfirmada(page, 'olv');

  // El enlace está donde uno se acuerda de que la olvidó.
  await page.goto('/login.html');
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  await page.waitForURL('**/olvide-password.html');

  await page.locator('#email').fill(datos.email);
  await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
  await page.locator('#olvideForm').waitFor({ state: 'hidden' });

  const correo = await (await page.request.get('/e2e/ultimo-correo')).json();
  expect(correo.asunto).toContain('Restablece tu contraseña');

  await page.goto(`/restablecer-password.html?token=${correo.texto.match(/token=([a-f0-9]{64})/)[1]}`);

  // ⚠️ El token no puede quedarse a la vista: abre la cuenta a quien lo tenga.
  expect(page.url()).not.toContain('token=');

  await page.locator('#password').fill('contrasena-nueva-1');
  await page.locator('#confirmar').fill('contrasena-nueva-1');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();

  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL('**/login.html');

  await page.locator('#identificador').fill(datos.username);
  await page.locator('#password').fill('contrasena-nueva-1');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.waitForURL('**/quinielas.html');
});

test('las contraseñas que no coinciden se avisan sin ir al servidor', async ({ page }) => {
  const datos = await cuentaConfirmada(page, 'nocoin');

  await page.goto('/olvide-password.html');
  await page.locator('#email').fill(datos.email);
  await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
  await page.locator('#olvideForm').waitFor({ state: 'hidden' });

  const correo = await (await page.request.get('/e2e/ultimo-correo')).json();
  await page.goto(`/restablecer-password.html?token=${correo.texto.match(/token=([a-f0-9]{64})/)[1]}`);

  await page.locator('#password').fill('contrasena-nueva-1');
  await page.locator('#confirmar').fill('otra-cosa-distinta-1');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();

  await expect(page.locator('#mensaje')).toContainText('no coinciden');
  // El formulario sigue ahí: se puede corregir sin volver a pedir el enlace.
  await expect(page.locator('#restablecerForm')).toBeVisible();
});

test('un enlace sin código ofrece pedir otro', async ({ page }) => {
  await page.goto('/restablecer-password.html');

  await expect(page.locator('#estado')).toContainText('no trae ningún código');
  await expect(page.getByRole('button', { name: 'Pedir otro enlace' })).toBeVisible();
});

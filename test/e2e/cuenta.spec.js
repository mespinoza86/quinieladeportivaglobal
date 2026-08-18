/*
 * Registro, sesión y creación de quiniela: el camino por el que entra todo el
 * mundo. Si esto se rompe, no importa qué más funcione.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { credenciales, registrarse, crearQuiniela } = require('./ayudas');

test('una cuenta nueva puede registrarse, crear quiniela y entrar', async ({ page }) => {
  const datos = await registrarse(page, 'alta');

  // La pantalla de quinielas saluda con el nombre de la cuenta.
  await expect(page.locator('#cuentaActual')).toHaveText(datos.username);
  await expect(page.getByText('Todavía no tienes quinielas.')).toBeVisible();

  const nombre = await crearQuiniela(page, 'Mi Quiniela');

  // Ya dentro: la portada de la aplicación.
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('body')).toContainText(nombre);
});

test('el registro rechaza una contraseña corta y lo explica', async ({ page }) => {
  const datos = credenciales('corta');

  await page.goto('/registro.html');
  await page.locator('#username').fill(datos.username);
  await page.locator('#email').fill(datos.email);

  /*
   * El campo tiene minlength=8, que el navegador impone antes de enviar. Se
   * quita para comprobar que el SERVIDOR también lo rechaza: la validación de
   * cliente es comodidad, no seguridad.
   */
  await page.locator('#password').evaluate(campo => campo.removeAttribute('minlength'));
  await page.locator('#confirmarPassword').evaluate(campo => campo.removeAttribute('minlength'));

  await page.locator('#password').fill('corta');
  await page.locator('#confirmarPassword').fill('corta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.locator('#registroMensaje')).toContainText(/al menos 8 caracteres/i);
  await expect(page).toHaveURL(/registro\.html/);
});

test('el login con contraseña incorrecta no revela si la cuenta existe', async ({ page, context }) => {
  const datos = await registrarse(page, 'enum');
  await context.clearCookies();

  await page.goto('/login.html');
  await page.locator('#identificador').fill(datos.username);
  await page.locator('#password').fill('contrasena-equivocada');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  /*
   * El mensaje es deliberadamente ambiguo. Si dijera solo "contraseña
   * incorrecta" estaría confirmando que esa cuenta existe, que es la vía normal
   * para armar una lista de usuarios reales antes de atacarlos.
   */
  const mensaje = page.locator('#errorMessage');
  await expect(mensaje).toContainText(/Usuario, correo o contraseña incorrectos/i);
  await expect(mensaje).not.toContainText(/^Contraseña incorrecta/i);

  // Y con la contraseña buena, entra.
  await page.locator('#password').fill(datos.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL('**/quinielas.html');
});

test('el ojo muestra y oculta la contraseña', async ({ page }) => {
  await page.goto('/login.html');

  const campo = page.locator('#password');
  const ojo = page.locator('.password-toggle');

  await campo.fill('secreto-visible');
  await expect(campo).toHaveAttribute('type', 'password');

  await ojo.click();
  await expect(campo).toHaveAttribute('type', 'text');
  await expect(ojo).toHaveAttribute('aria-label', /Ocultar/i);

  await ojo.click();
  await expect(campo).toHaveAttribute('type', 'password');

  /*
   * El botón está dentro del formulario. Si le faltara `type="button"`,
   * pulsarlo enviaría el formulario e intentaría iniciar sesión: se comprueba
   * que seguimos en el login y que el campo conserva lo escrito.
   */
  await expect(page).toHaveURL(/login\.html/);
  await expect(campo).toHaveValue('secreto-visible');
});

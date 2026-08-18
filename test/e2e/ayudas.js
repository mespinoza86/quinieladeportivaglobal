/*
 * Piezas compartidas por las pruebas de navegador.
 *
 * La base de datos es la misma para toda la corrida, así que cada prueba se
 * crea su propia cuenta y su propia quiniela en vez de reutilizar datos: una
 * prueba que dependa de lo que dejó otra falla según el orden, y esos fallos se
 * persiguen durante horas.
 */
'use strict';

let contador = 0;

/** Credenciales nuevas, distintas en cada llamada. */
function credenciales(prefijo = 'e2e') {
  contador += 1;
  const marca = `${prefijo}${Date.now().toString(36)}${contador}`;

  return {
    username: marca,
    email: `${marca}@ejemplo.com`,
    password: 'contrasena-larga-1'
  };
}

/** Registra una cuenta por la interfaz y deja la sesión iniciada. */
async function registrarse(page, prefijo) {
  const datos = credenciales(prefijo);

  await page.goto('/registro.html');
  await page.locator('#username').fill(datos.username);
  await page.locator('#email').fill(datos.email);
  await page.locator('#password').fill(datos.password);
  await page.locator('#confirmarPassword').fill(datos.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // El registro lleva a la pantalla de quinielas.
  await page.waitForURL('**/quinielas.html');

  return datos;
}

/**
 * Crea una quiniela y la deja seleccionada.
 *
 * El nombre lleva marca de tiempo por lo mismo que las credenciales: dos
 * quinielas con el mismo nombre en la misma corrida harían ambigua la búsqueda
 * por texto.
 */
async function crearQuiniela(page, nombre) {
  contador += 1;
  const completo = `${nombre} ${Date.now().toString(36)}${contador}`;

  await page.goto('/quinielas.html');
  await page.locator('#nombreQuiniela').fill(completo);
  await page.getByRole('button', { name: 'Crear quiniela' }).click();

  /*
   * Crear una quiniela lleva DIRECTO a la portada: el servidor ya la deja
   * seleccionada como activa en la sesión, así que no hay que volver a la lista
   * ni pulsar «Entrar».
   */
  await page.waitForURL('**/index.html');
  await page.locator('#quinielaActualNombre').waitFor();

  return completo;
}

/**
 * Entra en Admin Mode, que las rutas de administración exigen además del rol.
 *
 * La pantalla no navega a ningún sitio al activarlo: solo cambia qué sección se
 * muestra. Sin esperar a que aparezca la de administración, la prueba seguía
 * antes de que la sesión quedara marcada y el servidor respondía 401.
 */
async function activarAdminMode(page, password) {
  await page.goto('/adminmode.html');
  await page.locator('#adminPassword').waitFor({ state: 'visible' });
  await page.locator('#adminPassword').fill(password);
  await page.getByRole('button', { name: /Entrar a Admin mode/i }).click();
  await page.locator('#admin-content').waitFor({ state: 'visible' });
}

module.exports = { credenciales, registrarse, crearQuiniela, activarAdminMode };

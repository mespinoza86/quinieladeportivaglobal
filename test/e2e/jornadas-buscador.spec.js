/*
 * El buscador de ligas dinámico (Fase C, petición 9).
 *
 * Lo que se fija aquí no es el aspecto sino que el desplegable de torneos deje
 * de ser una lista fija: se llena con las ligas que DE VERDAD tienen partidos
 * en los próximos días, agrupadas por país, y sin las competiciones bloqueadas.
 *
 * Los partidos los sirve el proveedor falso de test/e2e/arrancar.js: dos ligas
 * de dos países más una femenil, que no debe aparecer.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

async function comoAdministradora(page, prefijo, nombre) {
  const datos = await registrarse(page, prefijo);
  await crearQuiniela(page, nombre);
  await activarAdminMode(page, datos.password);
  return datos;
}

test('el desplegable se llena con las ligas que tienen partidos, agrupadas por país', async ({ page }) => {
  await comoAdministradora(page, 'impA', 'Quiniela Importar');

  await page.goto('/jornadas.html');

  const torneo = page.locator('#torneoSelect');

  // Arranca diciendo que carga; lo que importa es en qué se convierte.
  await expect(torneo.locator('optgroup')).toHaveCount(2, { timeout: 10_000 });

  const paises = await torneo.locator('optgroup').evaluateAll(
    grupos => grupos.map(grupo => grupo.label)
  );
  expect(paises).toEqual(['Costa Rica', 'Mexico']);

  /*
   * El número entre paréntesis es cuántos partidos trae la liga en el rango.
   * No es adorno: dice de un vistazo si vale la pena entrar en esa liga.
   */
  await expect(torneo.locator('option', { hasText: 'Liga MX (2)' })).toHaveCount(1);
  await expect(torneo.locator('option', { hasText: 'Primera Division (1)' })).toHaveCount(1);
});

test('las competiciones bloqueadas no se ofrecen', async ({ page }) => {
  await comoAdministradora(page, 'impB', 'Quiniela Bloqueadas');

  await page.goto('/jornadas.html');
  await expect(page.locator('#torneoSelect optgroup')).toHaveCount(2, { timeout: 10_000 });

  /*
   * El proveedor falso devuelve «Liga MX Femenil». Una quiniela de la Primera
   * División no la quiere: se llama casi igual que la buena y se elige sin
   * querer. La descarta el servidor, que es donde vive ahora la única lista de
   * palabras bloqueadas.
   */
  const textos = await page.locator('#torneoSelect option').allTextContents();
  expect(textos.some(texto => /Femenil/i.test(texto))).toBe(false);
});

test('ya no queda ninguna opción de torneo escrita a mano en el HTML', async ({ page }) => {
  await comoAdministradora(page, 'impC', 'Quiniela Sin Lista Fija');

  /*
   * La comprobación se hace ANTES de que el guion cargue nada, sobre el marcado
   * servido: si alguien reintrodujera la lista de veinte torneos, aquí se vería.
   * Se pide la página como texto, no como pantalla, justo por eso.
   */
  const respuesta = await page.request.get('/jornadas.html');
  const html = await respuesta.text();

  expect(html).not.toContain('league_exact');
  expect(html).not.toContain('optgroup');
});

test('buscar por una liga trae solo sus partidos', async ({ page }) => {
  await comoAdministradora(page, 'impD', 'Quiniela Buscar');

  await page.goto('/jornadas.html');
  await expect(page.locator('#torneoSelect optgroup')).toHaveCount(2, { timeout: 10_000 });

  await page.locator('#torneoSelect').selectOption({ label: 'Primera Division (1)' });
  await page.locator('#buscarPartidosButton').click();

  await expect(page.locator('#estadoBusqueda')).toContainText('1 partidos', { timeout: 10_000 });
  await expect(page.locator('#partidosApiContainer')).toContainText('Saprissa');
  await expect(page.locator('#partidosApiContainer')).not.toContainText('Chivas');
});

test('si el proveedor falla, el desplegable no se queda vacío ni mudo', async ({ page }) => {
  await comoAdministradora(page, 'impE', 'Quiniela Proveedor Caido');

  /*
   * Un desplegable vacío y sin explicación es lo peor que puede encontrarse
   * quien viene a armar una jornada: parece que la aplicación está rota y no
   * hay nada que hacer. Con el proveedor caído deben quedar igualmente las dos
   * opciones que no dependen de él, y un mensaje que diga qué pasó.
   */
  await page.route('**/api/football/ligas-disponibles*', ruta =>
    ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Proveedor caído' }) })
  );

  await page.goto('/jornadas.html');

  await expect(page.locator('#rangoTexto')).toContainText('Proveedor caído', { timeout: 10_000 });
  await expect(page.locator('#torneoSelect option')).toHaveCount(2);
  await expect(page.locator('#torneoSelect')).toBeEnabled();
});

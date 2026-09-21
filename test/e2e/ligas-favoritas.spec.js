/*
 * Ligas favoritas de la quiniela.
 *
 * Lo que se fija aquí es el recorrido entero: se marcan en la configuración y
 * salen de primeras al armar una jornada, sin repetirse abajo en su país.
 *
 * El proveedor falso de test/e2e/arrancar.js sirve dos ligas de dos países:
 * «Liga MX» en México y «Primera Division» en Costa Rica.
 *
 * ⚠️ La pantalla cambió: antes era una lista de casillas con TODOS los torneos
 * de la semana —cientos de filas por las que bajar y bajar— y ahora es el mismo
 * desplegable escribible que al armar jornadas, con las elegidas listadas
 * debajo. Lo que se comprueba aquí es lo mismo que antes; la forma de pedirlo,
 * no.
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

/** Las favoritas escogidas ahora mismo, cada una con su botón de quitar. */
const elegidas = page => page.locator('#favoritasElegidas li');

/** Añade una liga por su nombre desde el desplegable, y guarda. */
async function marcarFavorita(page, nombre) {
  await page.goto('/configuracion-quiniela.html');

  /*
   * El panel nace oculto y sólo aparece si la cuenta puede configurar, así que
   * se espera al campo y no a un plazo.
   */
  await page.locator('#comboFavorita').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#comboFavorita').click();
  await page.locator('#comboFavoritaLista li', { hasText: nombre }).first().click();

  /* Aparece abajo ANTES de guardar: ése es el trato que hace la pantalla. */
  await expect(elegidas(page).filter({ hasText: nombre })).toHaveCount(1);

  await page.locator('#guardarFavoritas').click();
  await expect(page.locator('#favoritasMensaje')).toContainText('guardada', { timeout: 10_000 });
}

test('una liga favorita sale de primera al armar la jornada, y no se repite abajo', async ({ page }) => {
  await comoAdministradora(page, 'favA', 'Quiniela Favoritas');

  await marcarFavorita(page, 'Liga MX');

  await page.goto('/jornadas.html');

  const torneo = page.locator('#torneoSelect');
  await expect(torneo.locator('optgroup')).toHaveCount(3, { timeout: 10_000 });

  const grupos = await torneo.locator('optgroup').evaluateAll(
    lista => lista.map(grupo => grupo.label)
  );

  /*
   * Las favoritas van primero: ése es todo el punto. Y México ya no aparece
   * porque Liga MX era su única liga; un rótulo sin nada debajo no sirve.
   */
  expect(grupos).toEqual(['⭐ Favoritas', 'Costa Rica', 'Inglaterra']);

  await expect(torneo.locator('optgroup[label="⭐ Favoritas"] option')).toHaveText([/Liga MX \(2\)/]);

  // Y no se repite en su país: verla dos veces confunde más de lo que ayuda.
  const textos = await torneo.locator('option').allTextContents();
  expect(textos.filter(t => /Liga MX/.test(t))).toHaveLength(1);
});

test('una favorita se puede elegir y busca sólo sus partidos', async ({ page }) => {
  await comoAdministradora(page, 'favB', 'Quiniela Elegir Favorita');

  await marcarFavorita(page, 'Liga MX');

  await page.goto('/jornadas.html');
  await expect(page.locator('#torneoSelect optgroup')).toHaveCount(3, { timeout: 10_000 });

  await page.locator('#torneoSelect').selectOption({ label: 'Liga MX (2)' });
  await page.locator('#buscarPartidosButton').click();

  await expect(page.locator('#estadoBusqueda')).toContainText('2 partidos', { timeout: 10_000 });
  await expect(page.locator('#partidosApiContainer')).toContainText('Chivas');
  await expect(page.locator('#partidosApiContainer')).not.toContainText('Saprissa');
});

test('al volver a la configuración, la favorita sigue puesta y ya no se ofrece', async ({ page }) => {
  await comoAdministradora(page, 'favC', 'Quiniela Favorita Persiste');

  await marcarFavorita(page, 'Liga MX');
  await page.goto('/configuracion-quiniela.html');

  await expect(elegidas(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(elegidas(page).first()).toContainText('Liga MX');

  /*
   * ⛔ Y el desplegable ya NO la ofrece. Antes salía en dos sitios —bajo «Tus
   * favoritas» y bajo México— y desmarcarla en uno dejaba la otra casilla
   * marcada, así que se guardaba igual. Ahora lo que está escogido no se puede
   * volver a escoger: no hay dos sitios que puedan discrepar.
   */
  await page.locator('#comboFavorita').click();
  await expect(page.locator('#comboFavoritaLista li').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#comboFavoritaLista li', { hasText: 'Liga MX' })).toHaveCount(0);
});

test('⛔ una favorita que esta semana NO juega se puede quitar igual', async ({ page }) => {
  /*
   * El caso que la pantalla vieja tenía que resolver a mano, y por el que la
   * lista de abajo existe.
   *
   * Una favorita en descanso no viene en ninguna lista del proveedor. Si las
   * elegidas se pintaran de lo que el proveedor devolvió, desaparecería de la
   * pantalla **quedándose guardada**: marcada para siempre y sin manera de
   * quitarla. Viven en su propio arreglo justamente para esto.
   */
  await comoAdministradora(page, 'favE', 'Quiniela Favorita Dormida');

  /* Un id que el proveedor falso no conoce: guardada, y sin partidos. */
  await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { ligasFavoritas: [{ id: '4242', nombre: 'Liga Dormida' }] }
  });

  await page.goto('/configuracion-quiniela.html');

  await expect(elegidas(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(elegidas(page).first()).toContainText('Liga Dormida');

  await elegidas(page).first().getByRole('button', { name: /Quitar/ }).click();
  await page.locator('#guardarFavoritas').click();
  await expect(page.locator('#favoritasMensaje')).toContainText('quitaron', { timeout: 10_000 });

  /* Y se fue de verdad, no sólo de la pantalla. */
  const { configuracion } = await (await page.request.get('/api/quiniela-actual')).json();
  expect(configuracion.ligasFavoritas).toEqual([]);
});

test('se pueden quitar todas las favoritas', async ({ page }) => {
  await comoAdministradora(page, 'favD', 'Quiniela Quitar Favoritas');

  await marcarFavorita(page, 'Liga MX');
  await page.goto('/configuracion-quiniela.html');

  await expect(elegidas(page)).toHaveCount(1, { timeout: 10_000 });

  await elegidas(page).first().getByRole('button', { name: /Quitar/ }).click();
  await expect(elegidas(page).filter({ hasText: 'Liga MX' })).toHaveCount(0);

  await page.locator('#guardarFavoritas').click();
  await expect(page.locator('#favoritasMensaje')).toContainText('quitaron', { timeout: 10_000 });

  // Y el desplegable vuelve a estar como antes: dos países, sin grupo de favoritas.
  await page.goto('/jornadas.html');
  const grupos = await page.locator('#torneoSelect optgroup').evaluateAll(
    l => l.map(g => g.label)
  );
  expect(grupos).toEqual(['Costa Rica', 'Inglaterra', 'México']);
});

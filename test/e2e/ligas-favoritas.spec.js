/*
 * Ligas favoritas de la quiniela.
 *
 * Lo que se fija aquí es el recorrido entero: se marcan en la configuración y
 * salen de primeras al armar una jornada, sin repetirse abajo en su país.
 *
 * El proveedor falso de test/e2e/arrancar.js sirve dos ligas de dos países:
 * «Liga MX» en México y «Primera Division» en Costa Rica.
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

/** Marca una liga por su nombre en la pantalla de configuración y guarda. */
async function marcarFavorita(page, nombre) {
  await page.goto('/configuracion-quiniela.html');

  const lista = page.locator('#favoritasLista');
  await expect(lista.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 10_000 });

  await lista.locator('label', { hasText: nombre }).locator('input').check();
  await page.locator('#guardarFavoritas').click();
  await expect(page.locator('#favoritasMensaje')).toContainText('guardada', { timeout: 10_000 });
}

test('una liga favorita sale de primera al armar la jornada, y no se repite abajo', async ({ page }) => {
  await comoAdministradora(page, 'favA', 'Quiniela Favoritas');

  await marcarFavorita(page, 'Liga MX');

  await page.goto('/jornadas.html');

  const torneo = page.locator('#torneoSelect');
  await expect(torneo.locator('optgroup')).toHaveCount(2, { timeout: 10_000 });

  const grupos = await torneo.locator('optgroup').evaluateAll(
    lista => lista.map(grupo => grupo.label)
  );

  /*
   * Las favoritas van primero: ése es todo el punto. Y México ya no aparece
   * porque Liga MX era su única liga; un rótulo sin nada debajo no sirve.
   */
  expect(grupos).toEqual(['⭐ Favoritas', 'Costa Rica']);

  await expect(torneo.locator('optgroup[label="⭐ Favoritas"] option')).toHaveText([/Liga MX \(2\)/]);

  // Y no se repite en su país: verla dos veces confunde más de lo que ayuda.
  const textos = await torneo.locator('option').allTextContents();
  expect(textos.filter(t => /Liga MX/.test(t))).toHaveLength(1);
});

test('una favorita se puede elegir y busca sólo sus partidos', async ({ page }) => {
  await comoAdministradora(page, 'favB', 'Quiniela Elegir Favorita');

  await marcarFavorita(page, 'Liga MX');

  await page.goto('/jornadas.html');
  await expect(page.locator('#torneoSelect optgroup')).toHaveCount(2, { timeout: 10_000 });

  await page.locator('#torneoSelect').selectOption({ label: 'Liga MX (2)' });
  await page.locator('#buscarPartidosButton').click();

  await expect(page.locator('#estadoBusqueda')).toContainText('2 partidos', { timeout: 10_000 });
  await expect(page.locator('#partidosApiContainer')).toContainText('Chivas');
  await expect(page.locator('#partidosApiContainer')).not.toContainText('Saprissa');
});

test('al volver a la configuración, la favorita sigue marcada y no se ofrece dos veces', async ({ page }) => {
  await comoAdministradora(page, 'favC', 'Quiniela Favorita Persiste');

  await marcarFavorita(page, 'Liga MX');
  await page.goto('/configuracion-quiniela.html');

  const lista = page.locator('#favoritasLista');
  await expect(lista.locator('input[type="checkbox"]:checked')).toHaveCount(1, { timeout: 10_000 });

  /*
   * Sale bajo «Tus favoritas» y ya no bajo México. Si apareciera en los dos
   * sitios, desmarcarla en uno dejaría la otra casilla marcada y se guardaría
   * igual: la lista se arma de lo que esté marcado.
   */
  await expect(lista.locator('label', { hasText: 'Liga MX' })).toHaveCount(1);
  await expect(lista.locator('h3', { hasText: 'Tus favoritas' })).toBeVisible();
});

test('se pueden quitar todas las favoritas', async ({ page }) => {
  await comoAdministradora(page, 'favD', 'Quiniela Quitar Favoritas');

  await marcarFavorita(page, 'Liga MX');
  await page.goto('/configuracion-quiniela.html');

  const lista = page.locator('#favoritasLista');
  await expect(lista.locator('input[type="checkbox"]:checked')).toHaveCount(1, { timeout: 10_000 });

  await lista.locator('input[type="checkbox"]:checked').uncheck();
  await page.locator('#guardarFavoritas').click();
  await expect(page.locator('#favoritasMensaje')).toContainText('quitaron', { timeout: 10_000 });

  // Y el desplegable vuelve a estar como antes: dos países, sin grupo de favoritas.
  await page.goto('/jornadas.html');
  const grupos = await page.locator('#torneoSelect optgroup').evaluateAll(
    l => l.map(g => g.label)
  );
  expect(grupos).toEqual(['Costa Rica', 'Mexico']);
});

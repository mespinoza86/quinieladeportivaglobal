/*
 * El borrador en la pantalla de jornadas (tajada 6 de §22).
 *
 * ⚠️ Es el recorrido completo y el único que puede comprobarlo de verdad:
 * elegir la liga, ver la jornada propuesta, confirmarla, y que la semana
 * siguiente ya no se proponga la misma.
 *
 * El proveedor falso del arnés manda dos partidos de Liga MX con `match_round`
 * «9», y la Primera de Costa Rica sin ronda.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/** Deja la quiniela armándose por Liga MX. */
async function conLigaMX(page, password) {
  await activarAdminMode(page, password);
  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });

  await page.locator('#precioPorDefecto').fill('2000');
  await page.locator('#alAcumuladoPorDefecto').fill('1000');
  await page.locator('#botonElegirLiga').click();
  await page.locator('.action-card', { hasText: 'Liga MX' }).first()
    .getByRole('button', { name: 'Elegir' }).click();

  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');
}

test('⛔ una quiniela customizada NO ve el panel', async ({ page }) => {
  /*
   * Es el caso por defecto y el de todas las quinielas que ya existían. Quien
   * arma sus jornadas a mano no tiene por qué ver un panel explicándole algo
   * que no ha pedido.
   */
  const datos = await registrarse(page, 'custom');
  await crearQuiniela(page, 'A mano');
  await activarAdminMode(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#jornadaSelect').waitFor();

  await expect(page.locator('#panelBorrador')).toBeHidden();
});

test('la jornada propuesta se ve con sus partidos y su nombre', async ({ page }) => {
  const datos = await registrarse(page, 'propone');
  await crearQuiniela(page, 'De Liga MX');
  await conLigaMX(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  await expect(page.locator('#borradorTitulo')).toContainText('Jornada 9');
  await expect(page.locator('#borradorTitulo')).toContainText('Liga MX');
  await expect(page.locator('#borradorNombre')).toHaveValue('Jornada 9');

  /* Los dos partidos de Liga MX del proveedor falso, y sólo ésos. */
  const filas = page.locator('#borradorPartidos .action-card');
  await expect(filas).toHaveCount(2);
  await expect(filas.first()).toContainText('America vs Chivas');
});

test('⛔ confirmar la crea, y la semana siguiente ya no se propone', async ({ page }) => {
  /*
   * El recorrido entero, y el que de verdad importa: cruza lo que dice el
   * proveedor con lo que quedó en la base. Si la ronda no se guardara al crear
   * —que es lo que se perdía en la Entrada 099—, el borrador volvería a proponer
   * la misma jornada para siempre.
   */
  const datos = await registrarse(page, 'confirma');
  await crearQuiniela(page, 'Confirmando');
  await conLigaMX(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  /* Se le pone comodín al primero, que es lo que se decide al confirmar. */
  await page.locator('#borradorPartidos .borrador-comodin').first().check();
  await page.locator('#crearDelBorrador').click();

  /* La pantalla se recarga y el borrador ya no tiene nada que proponer. */
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });
  await expect(page.locator('#borradorTitulo')).toContainText('No hay más jornadas');

  /* Y la jornada existe de verdad, con su comodín y su ronda. */
  const jornada = await (await page.request.get('/api/jornadas/Jornada%209')).json();
  expect(jornada.partidos).toHaveLength(2);
  expect(jornada.partidos[0].comodin).toBe(true);
  expect(jornada.partidos[0].apiRound).toBe('9');
});

test('quitar un partido del borrador lo deja fuera de la jornada', async ({ page }) => {
  const datos = await registrarse(page, 'quita');
  await crearQuiniela(page, 'Quitando uno');
  await conLigaMX(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  await page.locator('#borradorPartidos .borrador-entra').last().uncheck();
  await page.locator('#crearDelBorrador').click();
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  const jornada = await (await page.request.get('/api/jornadas/Jornada%209')).json();
  expect(jornada.partidos).toHaveLength(1);
});

test('⛔ sin ningún partido marcado no se crea nada', async ({ page }) => {
  /*
   * Una jornada sin partidos no es una jornada. El servidor también lo rechaza,
   * pero decirlo aquí evita un viaje y un mensaje de error genérico.
   */
  const datos = await registrarse(page, 'vacia');
  await crearQuiniela(page, 'Vacia');
  await conLigaMX(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  for (const casilla of await page.locator('#borradorPartidos .borrador-entra').all()) {
    await casilla.uncheck();
  }
  await page.locator('#crearDelBorrador').click();

  await expect(page.locator('#borradorAviso')).toContainText('No queda ningún partido');
  await expect(page.locator('#borradorPartidos .action-card')).toHaveCount(2,
    'sigue en la pantalla: no se perdió el borrador');
});

test('cuando se acaban las jornadas se ofrecen las tres salidas', async ({ page }) => {
  /*
   * Marco lo pidió así: «se le proponen las opciones y él decide». Cambiar de
   * liga, archivar la quiniela, o seguir armándolas a mano.
   */
  const datos = await registrarse(page, 'salidas');
  await crearQuiniela(page, 'Fin de temporada');
  await conLigaMX(page, datos.password);

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });
  await page.locator('#crearDelBorrador').click();
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  const salidas = page.locator('#borradorSalidas');
  await expect(salidas).toBeVisible();
  await expect(salidas.getByRole('link', { name: 'Cambiar de liga' })).toBeVisible();
  await expect(salidas.getByRole('button', { name: 'Armarla a mano' })).toBeVisible();

  /* Y «a mano» esconde el panel, sin tocar nada de la quiniela. */
  await salidas.getByRole('button', { name: 'Armarla a mano' }).click();
  await expect(page.locator('#panelBorrador')).toBeHidden();
});

test('⛔ si el proveedor simplemente no trae nada, NO se ofrece archivar', async ({ page }) => {
  /*
   * ⚠️ Esta prueba nació de una mutación que no caía: enseñar las tres salidas
   * SIEMPRE pasaba, porque la única prueba que las miraba llegaba por el camino
   * bueno —fin de temporada—.
   *
   * Y la diferencia importa mucho: «ya creaste todas las jornadas de esta liga»
   * es el fin de la temporada, y ahí archivar tiene sentido. «El proveedor no
   * devolvió nada esta semana» es un bache temporal, y proponer archivar la
   * quiniela por eso es alarmante y equivocado.
   */
  const datos = await registrarse(page, 'bache');
  await crearQuiniela(page, 'Sin partidos');
  await activarAdminMode(page, datos.password);

  /*
   * Se apunta a una liga que el proveedor falso no conoce. El arnés filtra por
   * `league_id` igual que el proveedor de verdad, así que devuelve una lista
   * vacía sin devolver un error.
   */
  await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { tipo: 'liga', ligaId: '999', ligaNombre: 'Liga fantasma' }
  });

  await page.goto('/jornadas.html');
  await page.locator('#panelBorrador').waitFor({ state: 'visible' });

  await expect(page.locator('#borradorResumen')).toContainText('no devolvió partidos');
  await expect(page.locator('#borradorSalidas')).toBeHidden();
});

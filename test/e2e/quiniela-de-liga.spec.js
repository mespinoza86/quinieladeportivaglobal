/*
 * Elegir de qué liga es una quiniela (tajada 5 de §22).
 *
 * ⚠️ Esto es lo que ninguna prueba de servidor puede ver: que la pantalla
 * distinga las ligas que se pueden armar solas de las que no, y que diga POR QUÉ
 * — que es la mitad del valor de la función.
 *
 * El proveedor falso del arnés manda Liga MX **con** `match_round` y la Primera
 * de Costa Rica **sin** él, a propósito: son los dos casos.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

test('al crear la quiniela se puede decir que es de una liga', async ({ page }) => {
  const datos = await registrarse(page, 'liga');

  await page.goto('/quinielas.html');
  await page.locator('#nombreQuiniela').fill(`De liga ${Date.now()}`);
  await page.locator('input[name="tipoQuiniela"][value="liga"]').check();
  await page.getByRole('button', { name: 'Crear quiniela' }).click();

  /*
   * ⭐ La elección sólo decide a dónde se aterriza: la lista de ligas la sirve
   * una ruta que exige quiniela activa, y hasta crearla no había ninguna.
   *
   * ⛔ Y se pasa por el Admin Mode ANTES, con el destino a cuestas. Crear una
   * quiniela la selecciona, y seleccionar BORRA el Admin Mode: sin este rodeo
   * se aterrizaba en Configurar con la llave recién retirada.
   */
  await page.waitForURL('**/adminmode.html?volver=*');
  expect(decodeURIComponent(page.url())).toContain('/configuracion-quiniela.html#liga');
});

test('⛔ la liga que no publica la jornada se ve, pero no se puede elegir', async ({ page }) => {
  /*
   * Esconderla sería peor: quien busca esa liga y no la encuentra piensa que la
   * aplicación no la conoce y se queda intentándolo. Verla con su motivo cierra
   * la pregunta.
   */
  const datos = await registrarse(page, 'motivo');
  await crearQuiniela(page, 'Con motivo');
  await activarAdminMode(page, datos.password);

  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });
  await page.locator('#botonElegirLiga').click();

  /* Liga MX trae ronda: se puede elegir. */
  const conRonda = page.locator('.action-card', { hasText: 'Liga MX' }).first();
  await conRonda.waitFor();
  await expect(conRonda.getByRole('button', { name: 'Elegir' })).toBeVisible();

  /* La Primera de Costa Rica no: se ve, con el motivo, y sin botón. */
  const sinRonda = page.locator('.action-card', { hasText: 'Primera Division' }).first();
  await expect(sinRonda).toBeVisible();
  await expect(sinRonda).toContainText('no publica el número de jornada');
  await expect(sinRonda.getByRole('button', { name: 'Elegir' })).toHaveCount(0);
});

test('elegir una liga la deja guardada, con su precio de partida', async ({ page }) => {
  const datos = await registrarse(page, 'elige');
  await crearQuiniela(page, 'Eligiendo');
  await activarAdminMode(page, datos.password);

  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });

  await page.locator('#precioPorDefecto').fill('2000');
  await page.locator('#alAcumuladoPorDefecto').fill('1000');

  await page.locator('#botonElegirLiga').click();
  await page.locator('.action-card', { hasText: 'Liga MX' }).first()
    .getByRole('button', { name: 'Elegir' }).click();

  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');

  /*
   * ⚠️ NO se compara el número con formato. `es-CR` separa los miles con un
   * espacio duro, no con un punto, así que fijar «2.000» hacía fallar la
   * prueba por el FORMATO y no por el dato — y perseguir eso cuesta un rato
   * tonto.
   *
   * Lo que la pantalla tiene que hacer es EXPLICAR de dónde sale el número;
   * que el número sea correcto se comprueba abajo contra la configuración
   * guardada, donde no hay formato que valga.
   */
  await expect(page.locator('#ligaResumen')).toContainText('acumulado');

  /* Y sobrevive a recargar: se guardó de verdad, no sólo en la pantalla. */
  await page.reload();
  await page.locator('#panelLiga').waitFor({ state: 'visible' });
  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');

  const { configuracion } = await (await page.request.get('/api/quiniela-actual')).json();
  expect(configuracion.precioPorDefecto).toEqual({ precio: 2000, alAcumulado: 1000 });
});

test('⛔ dejar de armarla por liga limpia la liga, no la deja colgando', async ({ page }) => {
  /*
   * Una quiniela «customizada» que conserva su `ligaId` es un dato que miente
   * esperando a confundir: el día que alguien la vuelva a poner de liga, se
   * encontraría con una elegida que nadie eligió.
   */
  const datos = await registrarse(page, 'quita');
  await crearQuiniela(page, 'Quitando');
  await activarAdminMode(page, datos.password);

  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });

  await page.locator('#botonElegirLiga').click();
  await page.locator('.action-card', { hasText: 'Liga MX' }).first()
    .getByRole('button', { name: 'Elegir' }).click();
  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');

  page.once('dialog', d => d.accept());
  await page.locator('#quitarLiga').click();

  await expect(page.locator('#ligaResumen')).toContainText('eliges los partidos tú');

  const configuracion = await (await page.request.get('/api/quiniela-actual')).json();
  expect(configuracion.configuracion.ligaId).toBeNull();
});

test('⛔ crear una quiniela de liga y configurarla, SIN activar nada a mano', async ({ page }) => {
  /*
   * ⚠️ Ésta es la prueba que faltaba, y su ausencia costó un fallo que llegó a
   * producción: las demás llaman a `activarAdminMode()` antes de tocar la
   * pantalla, así que ninguna recorría lo que recorre una persona de verdad.
   *
   * ⛔ Y el fallo era éste: seleccionar una quiniela BORRA el Admin Mode —va
   * atado a una quiniela concreta— y crear una la selecciona. Así que se
   * aterrizaba en Configurar con la llave recién retirada, y todo contestaba
   * «confirma tu contraseña» sin que se entendiera por qué la pedían justo
   * después de crear la quiniela.
   *
   * Aquí NO se llama a `activarAdminMode`: el recorrido tiene que pasar por la
   * puerta él solo.
   */
  const datos = await registrarse(page, 'entero');

  await page.goto('/quinielas.html');
  await page.locator('#nombreQuiniela').fill(`Entera ${Date.now()}`);
  await page.locator('input[name="tipoQuiniela"][value="liga"]').check();
  await page.getByRole('button', { name: 'Crear quiniela' }).click();

  /* Primero la puerta, con el destino a cuestas. */
  await page.waitForURL('**/adminmode.html?volver=*');
  await page.locator('#adminPassword').fill(datos.password);
  await page.getByRole('button', { name: /Entrar a Admin mode/i }).click();

  /* Y de ahí, a configurar, ya con la llave puesta. */
  await page.waitForURL('**/configuracion-quiniela.html#liga');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });

  /* La lista se abre sola, y elegir funciona sin más pasos. */
  await page.locator('.action-card', { hasText: 'Liga MX' }).first()
    .getByRole('button', { name: 'Elegir' }).click();

  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');
});

test('⛔ «volver» no saca a nadie fuera del sitio', async ({ page }) => {
  /*
   * Una redirección abierta: un enlace con `?volver=https://otro-sitio` llevaría
   * a alguien RECIÉN autenticado a un sitio ajeno, que es justo el momento en
   * que menos desconfía. Sólo se admiten rutas de aquí.
   */
  const datos = await registrarse(page, 'abierta');
  await crearQuiniela(page, 'Sin salir');

  await page.goto('/adminmode.html?volver=https://ejemplo.invalido/robar');
  await page.locator('#adminPassword').fill(datos.password);
  await page.getByRole('button', { name: /Entrar a Admin mode/i }).click();

  await page.locator('#admin-content').waitFor({ state: 'visible' });
  expect(page.url()).toContain('/adminmode.html');
});

test('⛔ sin modo administrador se explica qué hacer, no se suelta el error crudo', async ({ page }) => {
  /*
   * El caso que queda vivo aunque el recorrido de crear pase por la puerta:
   * volver a esta pantalla más tarde, cuando la hora del Admin Mode ya venció.
   *
   * ⚠️ «Confirma tu contraseña para entrar al modo administrador» es correcto y
   * no dice QUÉ HACER. Aquí se convierte en un enlace, que es la diferencia
   * entre un aviso y un callejón.
   */
  await registrarse(page, 'sinllave');
  await crearQuiniela(page, 'Sin llave');

  /* Se entra directo, sin activar el Admin Mode. */
  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });
  await page.locator('#botonElegirLiga').click();

  const aviso = page.locator('#ligaMensaje');
  await expect(aviso).toContainText('modo administrador');
  await expect(aviso.getByRole('link', { name: 'Entrar ahora' })).toBeVisible();

  /* Y el enlace lleva de vuelta aquí, no a un sitio cualquiera. */
  const destino = await aviso.getByRole('link', { name: 'Entrar ahora' }).getAttribute('href');
  expect(decodeURIComponent(destino)).toContain('/configuracion-quiniela.html#liga');
});

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
const {
  registrarse, crearQuiniela, activarAdminMode, abrirSelectorDeLiga, elegirLiga
} = require('./ayudas');

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

test('elegir una liga la deja guardada, con su precio de partida', async ({ page }) => {
  const datos = await registrarse(page, 'elige');
  await crearQuiniela(page, 'Eligiendo');
  await activarAdminMode(page, datos.password);

  await elegirLiga(page, 'Liga MX', { precio: 2000, alAcumulado: 1000 });

  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');

  /*
   * ⛔ Y el selector se RECOGE al elegir. Dejarlo abierto después de haber
   * escogido invita a volver a tocarlo sin querer, y la pantalla tiene que
   * contar lo que hay —«De Liga MX»—, no seguir preguntando.
   */
  await expect(page.locator('#selectorLiga')).toBeHidden();
  await expect(page.locator('#abrirSelector')).toHaveText('Cambiar de liga');

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

  await elegirLiga(page, 'Liga MX');
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

  /*
   * ⭐ El selector se abre SOLO, sin pulsar «Armarlas por liga».
   *
   * Está plegado en todas las demás pantallas, y aquí no puede estarlo: quien
   * acaba de decir «la quiero de una liga» y aterriza aquí tiene que poder
   * elegirla, no buscar primero el botón que descubre el sitio donde se elige.
   */
  await expect(page.locator('#selectorLiga')).toBeVisible();
  await expect(page.locator('#abrirSelector')).toBeHidden();

  await page.locator('#comboLiga').click();
  await page.locator('#comboLigaLista li', { hasText: 'Liga MX' }).first().click();

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
  await abrirSelectorDeLiga(page);

  /* Abrir el desplegable es lo que va a pedirle las ligas al servidor. */
  await page.locator('#comboLiga').click();

  const aviso = page.locator('#ligaMensaje');
  await expect(aviso).toContainText('modo administrador');
  await expect(aviso.getByRole('link', { name: 'Entrar ahora' })).toBeVisible();

  /* Y el enlace lleva de vuelta aquí, no a un sitio cualquiera. */
  const destino = await aviso.getByRole('link', { name: 'Entrar ahora' }).getAttribute('href');
  expect(decodeURIComponent(destino)).toContain('/configuracion-quiniela.html#liga');
});


/* ==================== El desplegable escribible ==================== */

/** Deja el panel listo y el selector desplegado, con el Admin Mode puesto. */
async function conPanel(page, prefijo) {
  const datos = await registrarse(page, prefijo);
  await crearQuiniela(page, `Combo ${prefijo}`);
  await activarAdminMode(page, datos.password);

  await abrirSelectorDeLiga(page);
  return datos;
}

test('al hacer clic se abre con todas las ligas', async ({ page }) => {
  await conPanel(page, 'abre');

  /*
   * ⭐ Pulsar «Armarlas por liga» YA deja la lista abierta, porque enfoca el
   * campo y enfocarlo la abre. Es lo que tiene que pasar: se pulsa el botón
   * para elegir una liga, así que enseñarlas es el siguiente paso obvio y no
   * uno que haya que pedir aparte.
   *
   * ⚠️ Antes esta prueba daba por hecho que empezaba cerrada, y era cierto sólo
   * mientras el campo estaba siempre a la vista.
   */
  await expect(page.locator('#comboLigaLista')).toBeVisible();

  /* Cerrada a mano, volver a pinchar la abre otra vez con todo. */
  await page.locator('#comboLiga').press('Escape');
  await expect(page.locator('#comboLigaLista')).toBeHidden();

  await page.locator('#comboLiga').click();

  await expect(page.locator('#comboLigaLista')).toBeVisible();
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(1);
});

test('escribir filtra el desplegable, por país y por competición', async ({ page }) => {
  await conPanel(page, 'filtra');
  await page.locator('#comboLiga').click();

  /* Por país. */
  await page.locator('#comboLiga').fill('Costa Rica');
  await expect(page.locator('#comboLigaLista li', { hasText: 'Primera Division' })).toHaveCount(1);
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(0);

  /* Y por competición. */
  await page.locator('#comboLiga').fill('Liga MX');
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(1);
  await expect(page.locator('#comboLigaLista li', { hasText: 'Primera Division' })).toHaveCount(0);
});

test('⛔ buscar sin tildes encuentra lo que las tiene', async ({ page }) => {
  /*
   * El país del proveedor falso se escribe «México», CON tilde, igual que lo
   * manda el de verdad. Nadie escribe la tilde al buscar.
   */
  await conPanel(page, 'tildes');
  await page.locator('#comboLiga').click();

  await page.locator('#comboLiga').fill('mexico');
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(1);

  await page.locator('#comboLiga').fill('méxico');
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(1);
});

test('⛔ lo que no se puede armar solo se ve, con su motivo, y no se puede elegir', async ({ page }) => {
  await conPanel(page, 'motivo');
  await page.locator('#comboLiga').click();

  const sinRonda = page.locator('#comboLigaLista li', { hasText: 'Primera Division' }).first();
  await expect(sinRonda).toBeVisible();
  await expect(sinRonda).toContainText('no publica el número de jornada');
  await expect(sinRonda).toHaveAttribute('aria-disabled', 'true');

  /*
   * ⚠️ Y no entra en el recorrido del teclado: sólo las elegibles llevan
   * `data-indice`. Comprobarlo así es mejor que simular un clic sobre algo
   * deshabilitado — eso mide lo que hace el navegador, no lo que decide esta
   * pantalla.
   */
  await expect(sinRonda).not.toHaveAttribute('data-indice', /.*/);
  await expect(page.locator('#comboLiga')).toHaveValue('');
});

test('elegir una liga la escribe en la casilla y cierra el desplegable', async ({ page }) => {
  await conPanel(page, 'elige');
  await page.locator('#comboLiga').click();
  await page.locator('#comboLigaLista li', { hasText: 'Liga MX' }).first().click();

  await expect(page.locator('#comboLigaLista')).toBeHidden();
  await expect(page.locator('#comboLiga')).toHaveValue('Liga MX');
  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');
});

test('se elige con el teclado, sin tocar el ratón', async ({ page }) => {
  /*
   * ⚠️ Un desplegable hecho a mano que sólo responde al ratón es peor que un
   * `<select>` nativo, que sí se maneja con flechas. Si se va a construir,
   * tiene que hacer al menos lo que hace el que se sustituye.
   */
  await conPanel(page, 'teclado');

  await page.locator('#comboLiga').click();
  await page.locator('#comboLiga').fill('Liga MX');
  await page.locator('#comboLiga').press('ArrowDown');
  await page.locator('#comboLiga').press('Enter');

  await expect(page.locator('#comboLiga')).toHaveValue('Liga MX');
  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');
});

test('Escape cierra sin elegir nada', async ({ page }) => {
  await conPanel(page, 'escape');

  await page.locator('#comboLiga').click();
  await expect(page.locator('#comboLigaLista')).toBeVisible();

  await page.locator('#comboLiga').press('Escape');

  await expect(page.locator('#comboLigaLista')).toBeHidden();
  await expect(page.locator('#ligaResumen')).toContainText('eliges los partidos tú');
});

test('pinchar fuera cierra el desplegable', async ({ page }) => {
  await conPanel(page, 'fuera');

  await page.locator('#comboLiga').click();
  await expect(page.locator('#comboLigaLista')).toBeVisible();

  await page.locator('#ligaResumen').click();
  await expect(page.locator('#comboLigaLista')).toBeHidden();
});

test('⛔ filtrar NO vuelve a preguntarle al proveedor', async ({ page }) => {
  /*
   * La cuota es una sola para todas las quinielas y ya se agotó una vez.
   * «Costa Rica» son once letras: once consultas si el filtro fuera del
   * servidor.
   */
  await conPanel(page, 'sincuota');
  await page.locator('#comboLiga').click();
  await expect(page.locator('#comboLigaLista')).toBeVisible();

  let consultas = 0;
  page.on('request', r => { if (r.url().includes('/api/football/')) consultas += 1; });

  await page.locator('#comboLiga').fill('Costa Rica');
  await expect(page.locator('#comboLigaLista li', { hasText: 'Primera Division' })).toHaveCount(1);

  expect(consultas).toBe(0);
});

test('⛔ las ligas FAVORITAS salen en el desplegable, y arriba', async ({ page }) => {
  /*
   * ============================================================================
   * ESTA PRUEBA REPRODUCE UN FALLO QUE LLEGÓ A PRODUCCIÓN
   * ============================================================================
   *
   * `aplicarFavoritas` SACA las favoritas de `paises` y las devuelve en su
   * propio arreglo. La primera versión del selector sólo leía `paises`, así que
   * **las ligas favoritas no aparecían**. Ni al abrir ni al buscar.
   *
   * Marco lo encontró usándolo: escribió «Costa Rica» y no salió nada, porque
   * la Primera División estaba entre sus ocho favoritas. Lo que veía era el
   * resto del mundo — justo lo que no le sirve.
   *
   * ⛔ Y ninguna prueba lo veía por una razón que vale más que el fallo: la
   * quiniela de pruebas **no tenía favoritas**, así que `datos.favoritas`
   * siempre llegaba vacío. El caso no existía en el entorno de pruebas.
   */
  const datos = await conPanel(page, 'favoritas');

  /* Se marca Liga MX como favorita, igual que Marco tiene ocho marcadas. */
  const marcada = await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { ligasFavoritas: [{ id: '101', nombre: 'Liga MX' }] }
  });
  expect(marcada.ok()).toBeTruthy();

  /*
   * ⚠️ Se vuelve a ABRIR el selector: al recargar queda plegado otra vez.
   * `abrirSelectorDeLiga` navega, así que hace de recarga y de apertura.
   */
  await abrirSelectorDeLiga(page);
  await page.locator('#comboLiga').click();

  /* Sigue estando… */
  await expect(page.locator('#comboLigaLista li', { hasText: 'Liga MX' })).toHaveCount(1);

  /* …bajo su propio encabezado, y ANTES que las demás. */
  await expect(page.locator('#comboLigaLista .combo-grupo').first()).toContainText('Tus favoritas');

  const textos = await page.locator('#comboLigaLista li').allTextContents();
  const dondeFavoritas = textos.findIndex(t => t.includes('Tus favoritas'));
  const dondeLigaMX = textos.findIndex(t => t.includes('Liga MX'));
  expect(dondeLigaMX).toBeGreaterThan(dondeFavoritas);

  /* Y se puede elegir, que es el punto entero. */
  await page.locator('#comboLigaLista li', { hasText: 'Liga MX' }).first().click();
  await expect(page.locator('#ligaResumen')).toContainText('Liga MX');
});

test('⛔ una favorita que esta semana no juega se ve, y dice por qué', async ({ page }) => {
  /*
   * `aplicarFavoritas` arma estas entradas desde lo GUARDADO, no desde un
   * partido real: llegan con `partidos: 0` y sin `automatizable`. Sin tratarlas
   * aparte dirían «no publica el número de jornada», que es mentira — lo que
   * pasa es que esa liga no juega esta semana.
   */
  await conPanel(page, 'nojuega');

  await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { ligasFavoritas: [{ id: '999', nombre: 'Liga fantasma' }] }
  });

  /*
   * ⚠️ Se vuelve a ABRIR el selector: al recargar queda plegado otra vez.
   * `abrirSelectorDeLiga` navega, así que hace de recarga y de apertura.
   */
  await abrirSelectorDeLiga(page);
  await page.locator('#comboLiga').click();

  const fantasma = page.locator('#comboLigaLista li', { hasText: 'Liga fantasma' }).first();
  await expect(fantasma).toContainText('No juega esta semana');
  await expect(fantasma).toHaveAttribute('aria-disabled', 'true');
});

test('⛔ tus favoritas van PRIMERO, también para el teclado', async ({ page }) => {
  /*
   * ⚠️ Esta prueba necesitó una segunda liga elegible en el proveedor falso: con
   * una sola, ordenar no cambia nada y la mutación que manda las favoritas al
   * final pasaba entera.
   *
   * Y se comprueba con el TECLADO a propósito. El orden en pantalla y el orden
   * por el que se mueve el teclado salían de dos construcciones distintas y
   * podían discrepar —resaltabas una liga y Enter elegía otra—; ahora salen de
   * la misma lista, y esto lo fija.
   */
  await conPanel(page, 'primero');

  /* Premier League es favorita; Liga MX no. Sin ordenar, Liga MX iría antes. */
  await page.request.patch('/api/quiniela-actual/configuracion', {
    data: { ligasFavoritas: [{ id: '404', nombre: 'Premier League' }] }
  });

  /*
   * ⚠️ Se vuelve a ABRIR el selector: al recargar queda plegado otra vez.
   * `abrirSelectorDeLiga` navega, así que hace de recarga y de apertura.
   */
  await abrirSelectorDeLiga(page);
  await page.locator('#comboLiga').click();

  /* Al abrir se resalta la primera: pulsar Enter debe elegir la favorita. */
  await page.locator('#comboLiga').press('Enter');

  await expect(page.locator('#ligaResumen')).toContainText('Premier League');
});

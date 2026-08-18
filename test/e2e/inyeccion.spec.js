/*
 * Regresión de S-04 en un navegador de verdad.
 *
 * Las pruebas de arquitectura comprueban que las plantillas van etiquetadas.
 * Esto comprueba lo que de verdad importa: que un nombre con marcado dentro
 * llega a la pantalla como TEXTO y no como HTML, y que no ejecuta nada.
 *
 * El vector es el campo libre de administración —el nombre de la jornada, el de
 * un equipo—, no el nombre de usuario: el registro solo admite
 * `[a-zA-Z0-9_.-]`. Quien lo explota es el dueño de una quiniela contra sus
 * propios miembros, que en un modelo donde cualquiera crea quinielas sigue
 * importando.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

const NOMBRE_CON_MARCADO = '<img src=x onerror="window.__inyectado = true">J1';
const EQUIPO_CON_MARCADO = '<b>Alfa</b>';

test('un nombre de jornada con marcado se muestra como texto y no se ejecuta', async ({ page }) => {
  const datos = await registrarse(page, 'xss');
  await crearQuiniela(page, 'Quiniela XSS');
  await activarAdminMode(page, datos.password);

  /*
   * Se crea por la API y no por el formulario: lo que se prueba es el
   * RENDERIZADO, y el formulario podría filtrar el nombre por su cuenta y
   * ocultar el fallo que se quiere detectar.
   */
  const creada = await page.evaluate(async ([jornada, equipo]) => {
    const respuesta = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: jornada,
        partidos: [{ equipo1: equipo, equipo2: 'Beta' }]
      })
    });
    return { ok: respuesta.ok, estado: respuesta.status };
  }, [NOMBRE_CON_MARCADO, EQUIPO_CON_MARCADO]);

  expect(creada.ok, `El servidor rechazó la jornada: ${creada.estado}`).toBe(true);

  await page.goto('/ver_jornadas.html');

  // El desplegable de jornadas debe traer el nombre tal cual, sin interpretar.
  const selector = page.locator('#jornadaSelect');
  await expect(selector.locator('option').first()).toHaveText(NOMBRE_CON_MARCADO);

  // La lista de partidos muestra el equipo como texto, no en negrita.
  const lista = page.locator('#partidosJornadaList');
  await expect(lista).toContainText(EQUIPO_CON_MARCADO);
  await expect(lista.locator('b')).toHaveCount(0);

  /*
   * Lo definitivo: la imagen del `onerror` no llegó a existir, así que el
   * manejador nunca corrió. Se comprueba la bandera Y la ausencia de la
   * etiqueta, porque una sola de las dos podría pasar por casualidad.
   */
  await expect(page.locator('#partidosJornadaList img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__inyectado)).toBeUndefined();
});

test('el marcado tampoco se ejecuta en la tabla por jornada ni en la de posiciones', async ({ page }) => {
  const datos = await registrarse(page, 'xss2');
  await crearQuiniela(page, 'Quiniela XSS Tablas');
  await activarAdminMode(page, datos.password);

  const creada = await page.evaluate(async nombre => {
    const respuesta = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, partidos: [{ equipo1: 'Uno', equipo2: 'Dos' }] })
    });
    return respuesta.ok;
  }, NOMBRE_CON_MARCADO);

  expect(creada).toBe(true);

  for (const ruta of ['/clasificacion-jornada.html', '/resultados-totales.html']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');

    expect(
      await page.evaluate(() => window.__inyectado),
      `Se ejecutó marcado inyectado en ${ruta}`
    ).toBeUndefined();
  }

  // Y en la tabla por jornada el nombre aparece completo, como texto.
  await page.goto('/clasificacion-jornada.html');
  await expect(page.locator('#jornadaSelect option').first()).toHaveText(NOMBRE_CON_MARCADO);
});

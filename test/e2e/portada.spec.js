/*
 * La portada: la rejilla de tarjetas por la que se llega a todo lo demás.
 *
 * Aquí no se comprueba lógica de servidor sino maquetación, que es justo lo que
 * hasta ahora se venía mirando a ojo. Las dos pruebas fijan los dos arreglos de
 * la Fase A —la tarjeta que faltaba y la que se estiraba— para que un cambio de
 * CSS futuro los rompa en rojo y no en silencio.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela } = require('./ayudas');

/** Deja una cuenta con quiniela y la portada cargada. */
async function abrirPortada(page, prefijo) {
  await registrarse(page, prefijo);
  await crearQuiniela(page, 'Portada');
  await page.goto('/index.html');
  await page.locator('.quick-actions').waitFor();
}

test('la tabla por jornada tiene tarjeta propia en la portada y navega', async ({ page }) => {
  await abrirPortada(page, 'tarjeta');

  /*
   * Se busca dentro de `.quick-actions` a propósito: la barra inferior ya
   * enlazaba a esta pantalla, y una prueba que aceptara ese enlace pasaría sin
   * que la tarjeta existiera, que es exactamente lo que se quería arreglar.
   */
  const tarjeta = page.locator('.quick-actions a[href="clasificacion-jornada.html"]');
  await expect(tarjeta).toHaveCount(1);
  await expect(tarjeta).toBeVisible();

  await tarjeta.click();
  await page.waitForURL('**/clasificacion-jornada.html');
  await expect(page.locator('h1')).toHaveText('Tabla por jornada');
});

test('ninguna tarjeta de la portada se estira de forma desproporcionada', async ({ page }) => {
  await abrirPortada(page, 'medida');

  /*
   * El fallo original: en escritorio la rejilla pasa a dos columnas y el panel
   * del rotador, que es alto, le tocaba media fila. Su tarjeta vecina —«Llenar
   * Quiniela»— se estiraba hasta igualarlo y salía un bloque verde de 261 px al
   * lado de tarjetas de 88.
   *
   * Se mide contra la mediana de las demás y no contra un número fijo, porque
   * un número fijo se rompe en cuanto cambie el tipo de letra o el relleno. Lo
   * que se quiere fijar es la proporción: una tarjeta puede ser algo más alta
   * que sus compañeras por llevar dos líneas de texto, no tres veces más alta.
   */
  const alturas = await page.locator('.quick-actions > a.action-card:visible').evaluateAll(
    tarjetas => tarjetas.map(t => ({
      destino: t.getAttribute('href'),
      alto: t.getBoundingClientRect().height,
      ancho: t.getBoundingClientRect().width
    }))
  );

  expect(alturas.length).toBeGreaterThan(4);

  const ordenadas = alturas.map(t => t.alto).sort((a, b) => a - b);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)];

  for (const tarjeta of alturas) {
    expect(tarjeta.alto, `la tarjeta ${tarjeta.destino} mide ${tarjeta.alto}px de alto y la mediana es ${mediana}px`)
      .toBeLessThanOrEqual(mediana * 1.8);
  }

  /*
   * Y en escritorio la rejilla es de dos columnas, así que ninguna tarjeta debe
   * ocupar el ancho entero. En móvil sí lo ocupa, y ahí es lo correcto.
   */
  const anchoRejilla = (await page.locator('.quick-actions').boundingBox()).width;
  const llenar = alturas.find(t => t.destino === 'llenar_jornada_user.html');
  expect(llenar, 'no se encontró la tarjeta de llenar quiniela').toBeTruthy();

  const esEscritorio = page.viewportSize().width >= 720;
  if (esEscritorio) {
    expect(llenar.ancho).toBeLessThan(anchoRejilla * 0.75);
  }
});

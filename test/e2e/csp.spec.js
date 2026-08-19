/*
 * Barrido de todas las pantallas buscando violaciones de la política de
 * seguridad.
 *
 * Al cerrar la CSP (Entrada 024), un manejador en atributo que se quedara
 * suelto NO da un error visible: el navegador se limita a no ejecutarlo. El
 * botón carga, se puede pulsar, y no hace nada. Es el fallo más difícil de
 * diagnosticar de todos, y por eso conviene una prueba que lo cace sola.
 *
 * El navegador sí registra la violación en la consola, y eso es lo que se mira
 * aquí, pantalla por pantalla.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

const PAGINAS = fs
  .readdirSync(path.join(__dirname, '..', '..', 'public'))
  .filter(archivo => archivo.endsWith('.html'))
  .sort();

test('ninguna pantalla viola la política de seguridad', async ({ page }) => {
  /*
   * Con sesión, quiniela y Admin Mode: muchas pantallas redirigen al login si
   * no hay contexto, y una redirección no prueba nada sobre su marcado.
   */
  const datos = await registrarse(page, 'csp');
  await crearQuiniela(page, 'Quiniela CSP');
  await activarAdminMode(page, datos.password);

  const violaciones = [];

  page.on('console', mensaje => {
    const texto = mensaje.text();
    if (/Content Security Policy|Refused to execute|Refused to load/i.test(texto)) {
      violaciones.push(`${page.url()} → ${texto}`);
    }
  });

  page.on('pageerror', error => {
    // Un `html is not defined` significaría que falta cargar el ayudante.
    violaciones.push(`${page.url()} → ${error.message}`);
  });

  expect(PAGINAS.length, 'Se esperaban al menos 25 pantallas').toBeGreaterThanOrEqual(25);

  for (const pagina of PAGINAS) {
    await page.goto(`/${pagina}`);
    await page.waitForLoadState('domcontentloaded');
  }

  expect(violaciones, violaciones.join('\n')).toEqual([]);
});

test('los botones de navegación siguen funcionando sin manejadores en atributo', async ({ page }) => {
  const datos = await registrarse(page, 'nav');
  await crearQuiniela(page, 'Quiniela Navegacion');
  await activarAdminMode(page, datos.password);

  /*
   * El caso concreto que la CSP habría roto en silencio: estos botones llevaban
   * `onclick="window.location.href='…'"` en el marcado. Ahora el destino va en
   * `data-ir-a` y lo conecta navegacion.js.
   */
  await page.goto('/ver_jornadas.html');

  const volver = page.locator('[data-ir-a]').first();
  await expect(volver).toBeVisible();

  const destino = await volver.getAttribute('data-ir-a');
  await volver.click();
  await page.waitForURL(`**/${destino.replace(/^\//, '')}`);
});

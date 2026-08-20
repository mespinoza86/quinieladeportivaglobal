/*
 * Barrido de TODOS los botones que solo navegan.
 *
 * La prueba de CSP (csp.spec.js) recorre las 32 pantallas buscando violaciones,
 * y otra pulsa UN boton para comprobar que el patron funciona. Ninguna de las
 * dos prueba los 23 botones, y ese era el hueco: al pasar de `onclick` a
 * `data-ir-a` (Entrada 024) hubo que tocar 23 pantallas a mano, y un boton que
 * se quedara sin conectar NO da error visible. Se pulsa y no pasa nada.
 *
 * Aqui se pulsan todos, uno por uno, y se comprueba que la pantalla cambia a la
 * que el atributo declara. Es la prueba de humo que la Entrada 024 dejo
 * pendiente, automatizada en vez de mirada una vez.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

const PUBLICO = path.join(__dirname, '..', '..', 'public');

/*
 * Las pantallas se descubren leyendo el marcado, no de una lista escrita a
 * mano: una pantalla nueva con un boton nuevo entra sola en el barrido, que es
 * el unico modo de que esta prueba siga sirviendo dentro de seis meses.
 */
const PANTALLAS = fs
  .readdirSync(PUBLICO)
  .filter(archivo => archivo.endsWith('.html'))
  .filter(archivo => fs.readFileSync(path.join(PUBLICO, archivo), 'utf8').includes('data-ir-a'))
  .sort();

function soloRuta(url) {
  return new URL(url).pathname;
}

function comoRuta(destino) {
  return destino.startsWith('/') ? destino : '/' + destino;
}

/*
 * Tres pantallas —las dos de llenar jornada y la de trivias— abren un modal de
 * «Validar jugador» NADA MAS CARGAR: el script dispara un `change` sobre el
 * combo de jugadores para preseleccionar al usuario, y eso pide la contrasena.
 * El modal es `position: fixed` a pantalla completa, asi que mientras este
 * arriba NINGUN boton de debajo se puede pulsar. Se cancela antes de barrer.
 *
 * Costo encontrarlo: el sintoma era que el clic se colgaba sin decir por que.
 */
async function cerrarModalSiEstorba(page) {
  const modal = page.locator('.modal-overlay');

  // La inmensa mayoria de pantallas no tiene modal: se sale sin esperar nada.
  if (!(await modal.count())) return;

  /*
   * El modal lo abre una peticion, asi que NO esta arriba cuando termina de
   * cargar el documento: aparece un instante despues. Mirar si estorba justo
   * al cargar hacia que unas veces se cerrara y otras no, y el fallo salia en
   * una pantalla distinta en cada corrida.
   */
  await modal.first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (!(await modal.first().isVisible())) return;

  const cancelar = modal.locator('button', { hasText: /Cancelar/i }).first();
  if (await cancelar.count()) {
    await cancelar.click();
    await modal.first().waitFor({ state: 'hidden' });
  }
}

test('todos los botones de navegacion llevan a donde dicen', async ({ page }) => {
  /*
   * Veintitres pantallas, cada una con su carga y su clic, no caben en los 30
   * segundos que le bastan a las demas. El plazo se sube solo para esta.
   */
  test.setTimeout(180_000);

  /*
   * Con sesion, quiniela y Admin Mode: catorce de estas pantallas estan detras
   * de la guardia de administracion y sin eso redirigen, y una redireccion no
   * prueba nada sobre sus botones.
   */
  const datos = await registrarse(page, 'barrido');
  await crearQuiniela(page, 'Quiniela Barrido');
  await activarAdminMode(page, datos.password);

  expect(PANTALLAS.length, 'Se esperaban al menos 20 pantallas con boton').toBeGreaterThanOrEqual(20);

  const fallos = [];
  const vacias = [];
  let pulsados = 0;

  for (const pantalla of PANTALLAS) {
    const ruta = '/' + pantalla;

    await page.goto(ruta, { waitUntil: 'domcontentloaded' });

    if (soloRuta(page.url()) !== ruta) {
      fallos.push(pantalla + ': redirigio a ' + soloRuta(page.url()) + ' y no se pudo probar');
      continue;
    }

    await cerrarModalSiEstorba(page);

    /*
     * De paso, y sin coste: una tarjeta de aviso visible y sin nada dentro se
     * pinta como una barra amarilla vacia. Llenar Jornada arrastraba una desde que el
     * cierre paso a ser por partido (Entrada 019) y el contenedor se quedo en el
     * marcado sin que ningun script volviera a escribir en el.
     */
    const avisosVacios = await page.evaluate(() => Array.from(document.querySelectorAll(".info-card"))
      .filter(nodo => getComputedStyle(nodo).display !== "none" && !nodo.textContent.trim())
      .length);
    if (avisosVacios) vacias.push(pantalla + ": " + avisosVacios + " tarjeta(s) de aviso vacias");

    const cuantos = await page.locator('[data-ir-a]').count();

    for (let i = 0; i < cuantos; i += 1) {
      // El clic anterior nos saco de la pantalla; se vuelve antes del siguiente.
      if (soloRuta(page.url()) !== ruta) {
        await page.goto(ruta, { waitUntil: 'domcontentloaded' });
        await cerrarModalSiEstorba(page);
      }

      const boton = page.locator('[data-ir-a]').nth(i);
      const destino = comoRuta(await boton.getAttribute('data-ir-a'));

      if (!(await boton.isVisible())) {
        fallos.push(pantalla + ' -> ' + destino + ': el boton no es visible');
        continue;
      }

      pulsados += 1;

      try {
        /*
         * Plazo corto y explicito. Sin el, un boton tapado por un modal se come
         * el plazo entero de la prueba y el informe dice «timeout» sin decir
         * cual de los veintitres fue.
         */
        await boton.click({ timeout: 5_000 });
        await page.waitForURL(url => soloRuta(url.toString()) === destino, { timeout: 5_000 });
      } catch (error) {
        fallos.push(pantalla + ' -> ' + destino + ': se quedo en ' + soloRuta(page.url()));
      }
    }
  }

  expect(fallos, fallos.join(' | ')).toEqual([]);
  expect(vacias, vacias.join(' | ')).toEqual([]);
  expect(pulsados, 'No se pulso ningun boton').toBeGreaterThanOrEqual(20);
});

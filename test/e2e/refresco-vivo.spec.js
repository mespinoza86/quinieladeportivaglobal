/*
 * El refresco de las pantallas de resultados.
 *
 * ============================================================================
 * ⛔ LO QUE MARCO VEÍA
 * ============================================================================
 *
 * *«Si estoy en ver resultados puntos, se me reinicia todo, como cada 20 o 30
 * segundos»*. Cinco pantallas tenían, cada una por su cuenta:
 *
 *     setInterval(() => recargarloTodo(), 30000);
 *
 * Tres peticiones por vuelta, un `innerHTML = ''` y la lista redibujada entera
 * — aunque no hubiera cambiado ni una coma. De ahí que se perdiera el sitio
 * donde ibas leyendo.
 *
 * ⚠️ Y treinta segundos no adelantaban ninguna noticia: el sincronizador
 * consulta al proveedor cada SESENTA, así que la mitad de esas vueltas pedían
 * algo que el servidor todavía no podía saber.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/** Deja una jornada cerrada, con pronóstico y resultado oficial. */
async function conJornadaCerrada(page, username) {
  const estados = await page.evaluate(async ([usuario]) => {
    const a = await fetch('/api/jornadas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'J1', partidos: [
        { equipo1: 'Alfa', equipo2: 'Beta', apiDate: '2099-01-01 15:00' }
      ] })
    });

    /* ⚠️ El pronóstico ANTES de cerrar: con el partido cerrado se rechaza. */
    const b = await fetch('/api/resultados', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador: usuario, jornada: 'J1',
        pronosticos: [{ marcador1: 1, marcador2: 0 }] })
    });

    const c = await fetch('/api/resultados-oficiales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jornada: 'J1',
        resultados: [{ marcador1: 1, marcador2: 0, final: true }] })
    });

    return { jornada: a.status, pronostico: b.status, oficiales: c.status };
  }, [username]);

  expect(estados, 'no se pudo preparar la jornada').toEqual({
    jornada: 200, pronostico: 200, oficiales: 200
  });
}

test('⛔ con nada nuevo que contar, la pantalla NO se repinta', async ({ page }) => {
  test.setTimeout(150000);

  const datos = await registrarse(page, 'refresco');
  await crearQuiniela(page, 'Refresco');
  await activarAdminMode(page, datos.password);
  await conJornadaCerrada(page, datos.username);

  await page.goto('/verResultados_puntos.html');
  /*
   * ⚠️ Se espera por el NUMERO de opciones y no a que una sea visible: un
   * `<option>` dentro de un `<select>` cerrado nunca es visible para
   * Playwright, asi que esa espera se agota siempre.
   */
  await expect(page.locator('#jugadorSelect option')).toHaveCount(2, { timeout: 15000 });
  await page.locator('#jugadorSelect').selectOption({ index: 1 });
  await page.locator('#resultadosContainer .match-card').first().waitFor();

  /*
   * ⭐ Se marca el nodo que hay en pantalla. Si la pantalla se repinta, ese
   * nodo concreto desaparece y la marca con él.
   *
   * ⚠️ Es mejor que contar peticiones: lo que molestaba a Marco no era el
   * tráfico —que también—, era PERDER EL SITIO. Y eso sólo pasa si el DOM se
   * rehace. Esto mide exactamente eso.
   */
  await page.evaluate(() => {
    document.querySelector('#resultadosContainer .match-card').dataset.testigo = 'aqui-estaba';
  });

  let peticiones = 0;
  page.on('request', r => {
    if (r.url().includes('/api/resultados-oficiales')) peticiones++;
  });

  /* Más de un ciclo completo: con el de 30 s habría repintado dos veces. */
  await page.waitForTimeout(70000);

  const sigue = await page.evaluate(() =>
    Boolean(document.querySelector('#resultadosContainer .match-card[data-testigo="aqui-estaba"]')));

  expect(sigue,
    'la pantalla se repintó aunque no había nada nuevo: se pierde el sitio donde ibas')
    .toBe(true);

  /*
   * Y una sola consulta en el minuto, no tres. La vuelta pregunta SÓLO por los
   * oficiales —lo único que cambia mientras miras— en vez de recargarlo todo.
   */
  expect(peticiones,
    'se esperaba una consulta por minuto, y ligera').toBeLessThanOrEqual(1);
});

/*
 * ⚠️ AQUI HABIA UNA PRUEBA DE LA PESTANA ESCONDIDA, Y SE FUE A `test/refresco.test.js`.
 *
 * Costaba setenta segundos de espera y no era fiable: Playwright no esconde
 * una pestana de forma reproducible cuando corre sin ventana, y devolvia una
 * peticion donde esperaba cero.
 *
 * Una prueba lenta Y fragil es de las que se acaban borrando. Esa regla es
 * logica pura, asi que se comprueba en Node, en milisegundos y sin dudas.
 * Aqui se queda solo lo que NO se puede probar de otra forma: que en una
 * pantalla de verdad la lista no se repinta sola.
 */

/*
 * Ninguna pantalla enseña marcado como texto.
 *
 * ============================================================================
 * POR QUÉ ESTA PRUEBA, Y POR QUÉ ASÍ
 * ============================================================================
 *
 * El usuario encontró código HTML a la vista en cuatro pantallas: las etiquetas
 * de estado en «ver resultados / puntos», las casillas de «generar trivias»
 * —que además impedían crear ninguna—, la tabla de totales y la insignia de
 * comodín.
 *
 * Dos causas distintas, el mismo síntoma: una cadena con etiquetas interpolada
 * en una plantilla `html`, y un `.join('')` que borra la marca de «esto ya es
 * HTML». Los centinelas de `architecture.test.js` cubren las dos causas leyendo
 * el código, pero un centinela sólo caza lo que sabe buscar — y el que existía
 * pasó en verde con el fallo delante, porque reconocía una forma concreta.
 *
 * ⚠️ **Esto no busca causas: busca el SÍNTOMA.** Si en el texto visible de una
 * pantalla aparece `&lt;div` o `&lt;span`, algo se escapó que no debía, venga
 * de donde venga. Es la red que caza también las formas que a nadie se le
 * ocurrieron todavía.
 *
 * Se mira `innerText` y no `innerHTML`: `innerText` es lo que la persona LEE.
 * Un `<span>` bien renderizado no aparece ahí; uno escapado, sí.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/*
 * Las pantallas que pintan datos con plantillas. No se barren todas: las que no
 * componen marcado no pueden tener este fallo, y cada una cuesta una carga.
 */
const PANTALLAS = [
  '/index.html',
  '/jornadas.html',
  '/ver_jornadas.html',
  '/admin_trivias.html',
  '/verResultados_puntos.html',
  '/ver_resultados_totales_de_jugadores.html',
  '/resultados.html',
  '/ver-resultados-oficiales.html',
  '/clasificacion-jornada.html',
  '/resultados-totales.html',
  '/miembros.html',
  '/cobros.html',
  '/configuracion-quiniela.html'
];

/**
 * Lo que delata marcado escapado en el texto que se lee.
 *
 * ⚠️ Se busca `<etiqueta`, NO `&lt;etiqueta`, y esa distinción es la diferencia
 * entre una prueba que sirve y una que no puede fallar nunca.
 *
 * `&lt;` es cómo se REPRESENTA el carácter en el código HTML; el nodo de texto
 * contiene el carácter `<` de verdad, y `innerText` devuelve eso. La primera
 * versión buscaba `&lt;` en `innerText` — una señal que jamás iba a aparecer—,
 * así que pasaba en verde con el fallo delante. Se descubrió imprimiendo el
 * texto real de la pantalla en vez de confiar en la aserción.
 *
 * Se exige un nombre de etiqueta conocido justo detrás del `<` para no
 * confundirse con un texto legítimo del tipo «2 < 3».
 */
const SENALES = /<\/?(div|span|p|input|label|button|strong|img|li|ul|h[1-6])[\s>/]/i;

test('⛔ ninguna pantalla enseña marcado HTML como texto', async ({ page }) => {
  test.setTimeout(120_000);

  const datos = await registrarse(page, 'escapado');
  await crearQuiniela(page, 'Quiniela Escapado');
  await activarAdminMode(page, datos.password);

  /*
   * Una jornada con partidos y un pronóstico: sin datos, la mitad de estas
   * pantallas no pinta nada y la prueba pasaría sin mirar ninguna plantilla.
   * Es la diferencia entre «no encontró marcado escapado» y «no encontró nada».
   */
  const preparado = await page.evaluate(async ([usuario]) => {
    const post = (ruta, cuerpo) => fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });

    const jornada = 'Jornada Escapado';

    const creada = await post('/api/jornadas', {
      nombre: jornada,
      partidos: [
        { equipo1: 'Alfa', equipo2: 'Beta', apiDate: '2099-01-01 15:00', comodin: true },
        { equipo1: 'Gamma', equipo2: 'Delta', apiDate: '2099-01-01 17:00' }
      ]
    });
    if (!creada.ok) return { paso: 'jornada', cuerpo: await creada.json() };

    const pron = await post('/api/resultados', {
      jugador: usuario, jornada,
      pronosticos: [{ marcador1: 2, marcador2: 1 }, { marcador1: 0, marcador2: 0 }]
    });
    if (!pron.ok) return { paso: 'pronosticos', cuerpo: await pron.json() };

    return { paso: 'ok' };
  }, [datos.username]);

  expect(preparado.paso, `No se pudo preparar: ${JSON.stringify(preparado.cuerpo)}`).toBe('ok');

  const hallazgos = [];

  for (const pantalla of PANTALLAS) {
    await page.goto(pantalla, { waitUntil: 'domcontentloaded' });

    /*
     * Un momento para que las plantillas se pinten: casi todas rellenan tras un
     * `fetch`. Sin esto se leería el marcado vacío y no habría nada que mirar.
     */
    await page.waitForTimeout(700);

    /*
     * ⛔ Y SE ELIGE ALGO EN CADA DESPLEGABLE, que es lo que hace que la pantalla
     * pinte de verdad.
     *
     * La primera versión de esta prueba pasaba en verde **con el fallo
     * devuelto a propósito**: `admin_trivias.html` no pinta ni un partido hasta
     * que se selecciona una jornada, así que se estaba mirando una pantalla
     * vacía y se daba por buena. Una prueba que no encuentra nada porque no hay
     * nada que mirar no dice «está bien»: no dice nada.
     */
    const desplegables = await page.locator('select').all();

    for (const select of desplegables) {
      /*
       * ⚠️ Se salta lo que no está visible y el plazo es CORTO. `selectOption`
       * sobre un desplegable oculto espera 30 segundos a que sea accionable, y
       * con varios se agotaba el plazo del test entero: el fallo salía como
       * «la página se cerró», que no dice nada de lo que pasa.
       */
      if (!(await select.isVisible().catch(() => false))) continue;

      const valores = await select.locator('option').evaluateAll(
        nodos => nodos.map(n => n.value).filter(Boolean));

      if (!valores.length) continue;

      await select.selectOption(valores[0], { timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(600);
    }

    const texto = await page.evaluate(() => document.body.innerText || '');
    const encontrado = texto.match(SENALES) || [];

    if (encontrado.length) {
      /*
       * El segundo argumento de `slice` es el índice FINAL, no la longitud. La
       * primera versión ponía `120` fijo, así que en cuanto el hallazgo estaba
       * más allá del carácter 120 el mensaje salía VACÍO: la prueba fallaba
       * bien y no decía qué había encontrado.
       */
      const donde = texto.search(SENALES);
      const inicio = Math.max(0, donde - 40);
      const extracto = texto.slice(inicio, inicio + 160).replace(/\s+/g, ' ').trim();

      hallazgos.push(`${pantalla} → …${extracto}…`);
    }
  }

  expect(hallazgos, hallazgos.join('\n')).toEqual([]);
});

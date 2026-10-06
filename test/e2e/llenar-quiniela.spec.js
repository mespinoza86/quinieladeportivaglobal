/*
 * Llenar la quiniela: el cero, el blanco, y lo que NO se puede borrar.
 *
 * ============================================================================
 * POR QUÉ ESTO NECESITA UNA PRUEBA DE NAVEGADOR Y NO LE BASTA UNA DE RUTA
 * ============================================================================
 *
 * La regla que se arregló en la Entrada 068 —«un partido a medias no se guarda,
 * y lo que ya estaba se queda como está»— **vive en la pantalla**, no en el
 * servidor. El servidor sólo obedece: lo que llega como `null` no se toca.
 *
 * Quien decide mandar `null` es `llenar_jornada_user.js`, así que una prueba de
 * ruta puede pasar en verde con la pantalla mandando otra vez dos vacíos y
 * borrándolo todo. Esto recorre el camino de la persona: escribe, guarda, borra
 * medio marcador, vuelve a guardar y comprueba que su pronóstico sigue ahí.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

const FUTURO_1 = '2099-01-01 15:00';
const FUTURO_2 = '2099-01-01 17:00';

/** Crea una jornada con dos partidos que todavía no empiezan. */
async function jornadaAbierta(page) {
  const nombre = `Jornada Llenar ${Date.now().toString(36)}`;

  const r = await page.evaluate(async ([nombreJornada, fecha1, fecha2]) => {
    const res = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombreJornada,
        partidos: [
          { equipo1: 'Alfa', equipo2: 'Beta', apiDate: fecha1 },
          { equipo1: 'Gamma', equipo2: 'Delta', apiDate: fecha2 }
        ]
      })
    });
    return res.ok ? { ok: true } : { ok: false, cuerpo: await res.json() };
  }, [nombre, FUTURO_1, FUTURO_2]);

  expect(r.ok, `No se pudo crear la jornada: ${JSON.stringify(r.cuerpo)}`).toBe(true);
  return nombre;
}

/**
 * Abre la pantalla de llenar, lista para escribir.
 *
 * ⛔ YA NO HAY MURO DE CONTRASEÑA, y por eso esta ayuda ya no recibe una.
 *
 * «Llenar quiniela» pedía la contraseña de tu propia cuenta antes de dejarte
 * ver nada. Se quitó el 5 de octubre de 2026: no protegía nada —la ruta de
 * guardar ya rechaza con un 403 lo que no es tuyo— y costaba un paso en la
 * acción que todo el mundo hace cada semana.
 *
 * ⚠️ AQUEL MURO TAPABA UNA CARRERA, y al quitarlo hubo que arreglarla de
 * verdad. «Cargar los pronósticos guardados» escribe en campos que puede que
 * todavía no existan, y cuando eso pasa no falla ni reintenta: deja la pantalla
 * vacía teniendo pronósticos guardados. Mientras alguien tecleaba su contraseña
 * daba tiempo de sobra a pintarlos; sin muro, no. Ahora la pantalla espera al
 * pintado antes de escribir, y esto lo comprueba.
 */
async function abrirPantalla(page) {
  /*
   * ⚠️ El oyente se prepara ANTES de navegar: la respuesta puede llegar
   * mientras se carga la página, y suscribirse después sería perdérsela.
   */
  const cargados = page.waitForResponse(respuesta =>
    /^\/api\/resultados\/[^/]+\/[^/]+$/.test(new URL(respuesta.url()).pathname)
    && respuesta.request().method() === 'GET');

  await page.goto('/llenar_jornada_user.html');

  await page.locator('#resultadoEquipo1_0').waitFor({ state: 'visible' });
  await cargados;
}

const marcadores = page => page.evaluate(() =>
  [0, 1].map(i => [
    document.getElementById(`resultadoEquipo1_${i}`)?.value ?? null,
    document.getElementById(`resultadoEquipo2_${i}`)?.value ?? null
  ]));

/**
 * Espera a que la pantalla enseñe estos marcadores.
 *
 * ⚠️ Con `poll` y no con una lectura suelta. La razón era una carrera de la
 * aplicación: «cargar los guardados» competía con «pintar los partidos», y si
 * ganaba la primera escribía en campos que aún no existían — la pantalla
 * quedaba en blanco teniendo pronósticos guardados. Se veía sólo cuando la red
 * iba muy rápida, que es justo lo que pasa contra PGlite en memoria.
 *
 * ⭐ **Esa carrera SE ARREGLÓ el 5 de octubre de 2026**, al quitar el muro de
 * contraseña que la disimulaba: ahora la pantalla espera al pintado. El `poll`
 * se queda de todas formas, porque lo que se quiere comprobar es que los
 * marcadores ACABAN estando, no en qué milisegundo llegan.
 */
async function esperarMarcadores(page, esperados, mensaje) {
  await expect.poll(() => marcadores(page), { timeout: 10_000, message: mensaje })
    .toEqual(esperados);
}

async function llenar(page, indice, local, visitante) {
  await page.locator(`#resultadoEquipo1_${indice}`).fill(local);
  await page.locator(`#resultadoEquipo2_${indice}`).fill(visitante);
}

/*
 * ⛔ ESTA PANTALLA YA NO ABRE VENTANAS DEL NAVEGADOR.
 *
 * Tenía once `alert()` y un `confirm()`. Ahora contesta en el renglón
 * `#avisoLlenar`, que está debajo de los botones, como el resto de la
 * aplicación. Por eso la ayuda ya no escucha diálogos: lee ese renglón.
 *
 * ⚠️ Y el aviso de «partidos a medias» pasó a ser de DOS CLICS: el primero
 * advierte y el segundo guarda igual. Era un `confirm()`, que es una pregunta
 * de verdad —hay que poder decir que no—, así que no se podía cambiar por un
 * aviso a secas.
 */
const aviso = page => page.locator('#avisoLlenar');

/** Pulsa «Guardar» una vez y devuelve lo que quedó escrito en el aviso. */
async function pulsarGuardar(page) {
  await aviso(page).evaluate(nodo => { nodo.textContent = ''; }).catch(() => {});
  await page.getByRole('button', { name: /Guardar/i }).first().click();

  await expect.poll(() => aviso(page).textContent(), { timeout: 10_000 })
    .not.toBe('');

  return (await aviso(page).textContent()) || '';
}

/**
 * Guarda del todo: pulsa, y si lo que sale es la advertencia de los partidos a
 * medias, vuelve a pulsar para confirmar.
 *
 * Devuelve `{ advertencia, resumen }`: la advertencia es '' cuando no hizo
 * falta confirmar nada.
 */
async function guardar(page) {
  const primero = await pulsarGuardar(page);

  if (!/Pulsa otra vez/i.test(primero)) return { advertencia: '', resumen: primero };

  return { advertencia: primero, resumen: await pulsarGuardar(page) };
}

test('⛔ dejar un partido a medias NO borra el pronóstico ya guardado', async ({ page }) => {
  const datos = await registrarse(page, 'llenar');
  await crearQuiniela(page, 'Llenar');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page);

  // 1. Los dos partidos, completos. El segundo es un 0-0 a propósito: tiene que
  //    guardarse como pronóstico de verdad, no confundirse con «vacío».
  await llenar(page, 0, '2', '1');
  await llenar(page, 1, '0', '0');
  await guardar(page);

  await page.reload();
  await abrirPantalla(page);

  await esperarMarcadores(page, [['2', '1'], ['0', '0']],
    'el 0-0 tiene que sobrevivir a la recarga');

  // 2. Se borra SÓLO el marcador visitante del primero: queda a medias.
  await page.locator('#resultadoEquipo2_0').fill('');

  const { advertencia } = await guardar(page);

  expect(advertencia, 'un partido a medias tiene que avisar antes de guardar').toBeTruthy();
  expect(advertencia, 'el aviso tiene que decir que lo guardado se respeta')
    .toMatch(/se queda como está/i);

  // 3. Y lo guardado sigue intacto. Esto es lo que se rompía.
  await page.reload();
  await abrirPantalla(page);

  await esperarMarcadores(page, [['2', '1'], ['0', '0']],
    'el 2-1 no lo pidió borrar nadie');
});

test('⛔ los pronósticos guardados salen aunque la jornada tarde en llegar', async ({ page }) => {
  /*
   * ============================================================================
   * EL FALLO QUE ESTO FIJA, CONTADO POR QUIEN LO SUFRIÓ
   * ============================================================================
   *
   * Marco, usándolo de verdad: «cuando entro a llenar jornadas, a veces no me
   * carga los marcadores que yo puse. Quedan los cuadros grises sin nada».
   *
   * La pantalla lanza DOS peticiones a la vez: `/api/auth/me`, que al llegar
   * dispara «cargar los pronósticos guardados», y `/api/jornada-actual`, que al
   * llegar pinta los partidos. Si ganaba la primera, se escribía en casillas
   * que todavía no existían — y eso **no falla, no avisa y no reintenta**: deja
   * la pantalla vacía teniendo pronósticos guardados.
   *
   * ⭐ «A VECES» ES LO QUE HACE ESTA PRUEBA NECESARIA. Las demás de este
   * archivo pasaban por casualidad, según quién ganara la carrera ese día. Aquí
   * se RETRASA la jornada a propósito para que pierda SIEMPRE: así el fallo, si
   * vuelve, es seguro y no intermitente.
   */
  const datos = await registrarse(page, 'carrera');
  await crearQuiniela(page, 'Carrera');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page);
  await llenar(page, 0, '3', '1');
  await llenar(page, 1, '2', '2');
  await guardar(page);

  /* Medio segundo de retraso: suficiente para que `auth/me` gane de calle. */
  await page.route('**/api/jornada-actual*', async ruta => {
    await new Promise(seguir => setTimeout(seguir, 500));
    await ruta.continue();
  });

  /*
   * ⚠️ SIN `reload()` antes: `abrirPantalla` ya navega. Haciendo las dos cosas,
   * la respuesta que espera se dispara en la primera carga, antes de que la
   * ayuda se suscriba, y la prueba se queda esperando una que ya pasó.
   */
  await abrirPantalla(page);

  await esperarMarcadores(page, [['3', '1'], ['2', '2']],
    'con la jornada lenta, los pronósticos guardados TIENEN que salir igual');
});

test('borrar los DOS marcadores sí quita el pronóstico', async ({ page }) => {
  const datos = await registrarse(page, 'llenarq');
  await crearQuiniela(page, 'LlenarQ');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page);
  await llenar(page, 0, '2', '1');
  await llenar(page, 1, '3', '3');
  await guardar(page);

  await page.reload();
  await abrirPantalla(page);

  // Los dos en blanco es la forma de decir «no quiero pronosticar éste».
  await page.locator('#resultadoEquipo1_0').fill('');
  await page.locator('#resultadoEquipo2_0').fill('');

  const { advertencia } = await guardar(page);

  expect(advertencia,
    'vaciar los dos es una decisión, no un descuido: no tiene que preguntar').toBe('');

  await page.reload();
  await abrirPantalla(page);

  await esperarMarcadores(page, [['', ''], ['3', '3']],
    'el primero se quitó; el segundo sigue');
});

test('el texto que se copia no inventa ceros donde no hay pronóstico', async ({ page }) => {
  const datos = await registrarse(page, 'copiar');
  await crearQuiniela(page, 'Copiar');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page);

  // Uno con 0-0 de verdad, y el otro sin nada.
  await llenar(page, 0, '0', '0');

  /*
   * ⚠️ Se lee del área de texto y no del portapapeles: pedir permiso de
   * portapapeles depende del navegador y del contexto, y esta prueba corre
   * también en el proyecto móvil. Lo que se comprueba es lo que se compone.
   */
  const texto = await page.evaluate(() => {
    const partidos = Array.from(document.querySelectorAll('.partido-container'));
    return partidos.map((div, i) => {
      const uno = document.getElementById(`resultadoEquipo1_${i}`).value;
      const dos = document.getElementById(`resultadoEquipo2_${i}`).value;
      return `${marcadorVisible(uno)}-${marcadorVisible(dos)}`;
    }).join(' | ');
  });

  expect(texto, 'el 0-0 escrito es un cero; el partido vacío es un guion')
    .toBe('0-0 | –-–');
});

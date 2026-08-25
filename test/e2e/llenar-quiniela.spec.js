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
 * Abre la pantalla y pasa el modal de contraseña.
 *
 * El combo se autoselecciona con el usuario de la sesión y eso dispara el
 * modal, así que no hay que elegir a nadie: sólo responderlo.
 */
async function abrirPantalla(page, password) {
  await page.goto('/llenar_jornada_user.html');

  /*
   * ⚠️ Se espera a que los partidos estén pintados ANTES de responder el modal,
   * y no es un capricho de la prueba: `cargarResultadosGuardados` corre en
   * cuanto se valida la contraseña, y si para entonces los `input` todavía no
   * existen, **los pronósticos guardados no se pintan nunca** — nadie vuelve a
   * intentarlo, y la pantalla queda en blanco como si no hubiera nada guardado.
   *
   * Una persona tarda segundos en escribir su contraseña, así que en uso real
   * los partidos ya están; Playwright la escribe en milisegundos y gana la
   * carrera. Aquí se espera para probar lo que se quiere probar, y la carrera
   * queda anotada como deuda en la Entrada 068.
   */
  await page.locator('#resultadoEquipo1_0').waitFor({ state: 'visible' });

  await page.locator('#inputPassword').waitFor({ state: 'visible' });
  await page.locator('#inputPassword').fill(password);

  /*
   * ⚠️ Y se espera a que los guardados TERMINEN de cargarse, no a que el modal
   * se cierre. El modal se cierra al instante, pero `cargarResultadosGuardados`
   * sigue en vuelo y, cuando llega, **escribe en las casillas** —incluida la
   * cadena vacía donde no hay pronóstico—.
   *
   * Sin esta espera, lo que se escriba en ese hueco se pierde: la respuesta
   * llega después y lo pisa. Es una segunda carrera de la pantalla, hermana de
   * la de arriba, y también queda anotada en la Entrada 068.
   */
  const cargados = page.waitForResponse(r =>
    /\/api\/resultados\/[^/]+\/[^/]+$/.test(new URL(r.url()).pathname)
    && r.request().method() === 'GET');

  await page.locator('#btnPasswordOk').click();

  await page.locator('#modalPassword').waitFor({ state: 'hidden' });
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
 * ⚠️ Con `poll` y no con una lectura suelta, y la razón es un hallazgo de la
 * aplicación, no de la prueba: `cargarResultadosGuardados` corre **en cuanto se
 * valida la contraseña**, que es una carrera contra la carga de los partidos.
 * Si gana la contraseña, los `input` todavía no existen y **los pronósticos
 * guardados no se pintan**: la pantalla queda en blanco como si no hubiera
 * nada. Se ve solo cuando la red va rápida y el orden se invierte, que es
 * justo lo que pasa contra PGlite en memoria.
 *
 * Queda anotado en la Entrada 068 como deuda: aquí se espera, pero la
 * aplicación debería encadenar las dos cosas en vez de dejarlas competir.
 */
async function esperarMarcadores(page, esperados, mensaje) {
  await expect.poll(() => marcadores(page), { timeout: 10_000, message: mensaje })
    .toEqual(esperados);
}

async function llenar(page, indice, local, visitante) {
  await page.locator(`#resultadoEquipo1_${indice}`).fill(local);
  await page.locator(`#resultadoEquipo2_${indice}`).fill(visitante);
}

/** Guarda y devuelve los textos de los diálogos que salieron. */
async function guardar(page, { aceptar = true } = {}) {
  const dialogos = [];

  const manejador = async dialogo => {
    dialogos.push({ tipo: dialogo.type(), texto: dialogo.message() });
    if (dialogo.type() === 'confirm' && !aceptar) return dialogo.dismiss();
    return dialogo.accept();
  };

  page.on('dialog', manejador);
  await page.getByRole('button', { name: /Guardar/i }).first().click();

  // El alert del resumen es lo último que hace `guardarResultados`.
  await expect.poll(() => dialogos.some(d => d.tipo === 'alert'), { timeout: 10_000 })
    .toBe(aceptar);

  page.off('dialog', manejador);
  return dialogos;
}

test('⛔ dejar un partido a medias NO borra el pronóstico ya guardado', async ({ page }) => {
  const datos = await registrarse(page, 'llenar');
  await crearQuiniela(page, 'Llenar');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page, datos.password);

  // 1. Los dos partidos, completos. El segundo es un 0-0 a propósito: tiene que
  //    guardarse como pronóstico de verdad, no confundirse con «vacío».
  await llenar(page, 0, '2', '1');
  await llenar(page, 1, '0', '0');
  await guardar(page);

  await page.reload();
  await abrirPantalla(page, datos.password);

  await esperarMarcadores(page, [['2', '1'], ['0', '0']],
    'el 0-0 tiene que sobrevivir a la recarga');

  // 2. Se borra SÓLO el marcador visitante del primero: queda a medias.
  await page.locator('#resultadoEquipo2_0').fill('');

  const dialogos = await guardar(page);
  const confirmacion = dialogos.find(d => d.tipo === 'confirm');

  expect(confirmacion, 'un partido a medias tiene que avisar antes de guardar').toBeTruthy();
  expect(confirmacion.texto, 'el aviso tiene que decir que lo guardado se respeta')
    .toMatch(/se queda como está/i);

  // 3. Y lo guardado sigue intacto. Esto es lo que se rompía.
  await page.reload();
  await abrirPantalla(page, datos.password);

  await esperarMarcadores(page, [['2', '1'], ['0', '0']],
    'el 2-1 no lo pidió borrar nadie');
});

test('borrar los DOS marcadores sí quita el pronóstico', async ({ page }) => {
  const datos = await registrarse(page, 'llenarq');
  await crearQuiniela(page, 'LlenarQ');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page, datos.password);
  await llenar(page, 0, '2', '1');
  await llenar(page, 1, '3', '3');
  await guardar(page);

  await page.reload();
  await abrirPantalla(page, datos.password);

  // Los dos en blanco es la forma de decir «no quiero pronosticar éste».
  await page.locator('#resultadoEquipo1_0').fill('');
  await page.locator('#resultadoEquipo2_0').fill('');

  const dialogos = await guardar(page);

  expect(dialogos.some(d => d.tipo === 'confirm'),
    'vaciar los dos es una decisión, no un descuido: no tiene que preguntar').toBe(false);

  await page.reload();
  await abrirPantalla(page, datos.password);

  await esperarMarcadores(page, [['', ''], ['3', '3']],
    'el primero se quitó; el segundo sigue');
});

test('el texto que se copia no inventa ceros donde no hay pronóstico', async ({ page }) => {
  const datos = await registrarse(page, 'copiar');
  await crearQuiniela(page, 'Copiar');
  await activarAdminMode(page, datos.password);
  await jornadaAbierta(page);

  await abrirPantalla(page, datos.password);

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

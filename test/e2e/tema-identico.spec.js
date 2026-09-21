/*
 * ⛔ LA RED DE SEGURIDAD DE LA PASADA DE FICHAS
 * ============================================================================
 *
 * Llevar 188 colores escritos a mano a fichas de tema NO debe cambiar ni un
 * color del tema oscuro. Y «no debe» no es una promesa: es lo que se comprueba.
 *
 * ⚠️ EL PRIMER INTENTO FUE CON FOTOS DE PANTALLA, Y NO SERVÍA.
 *
 * Las pantallas llevan datos generados al azar en cada corrida —el nombre de la
 * quiniela lleva marca de tiempo, el código de ingreso es aleatorio—, así que
 * dos fotos del MISMO código salen distintas. La prueba marcaba en rojo
 * justamente esos textos, que es ruido, y habría hecho falta subir la tolerancia
 * hasta dejarla ciega para lo que sí importa.
 *
 * ⭐ Esto mide lo que de verdad se quiere fijar: el COLOR CALCULADO de cada
 * pieza. Es inmune al texto, a la fecha y al ancho de la pantalla, y dice qué
 * cambió y dónde en vez de «1.378 píxeles».
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/*
 * Una pieza de cada familia. No hace falta mirarlo todo: lo que se comprueba es
 * que las fichas den el mismo valor que daban los colores escritos a mano.
 */
const PANTALLAS = {
  "quinielas.html": [
    ["body", "background-color"],
    ["body", "color"],
    [".hero-card", "background-image"],
    [".app-panel", "background-color"],
    [".app-panel", "border-color"],
    [".helper-text", "color"],
    [".field-label", "color"],
    ["button", "background-image"],
    ["button", "color"],
    [".ghost-button", "color"],
    [".ghost-button", "border-color"],
    ["input", "background-color"],
    ["input", "color"],
    [".checkbox-fila", "color"],
    [".radio-grupo .checkbox-fila", "background-color"],
    [".radio-grupo .checkbox-fila", "border-color"]
  ],
  "index.html": [
    [".action-card", "background-color"],
    [".action-card .icon", "background-color"],
    [".bottom-nav", "background-color"],
    [".bottom-nav a", "color"],
    [".bottom-nav a.active", "background-color"],
    [".eyebrow", "color"],
    ["h1", "color"]
  ],
  "llenar_jornada_user.html": [
    [".partido-container", "background-color"],
    [".match-score", "background-color"],
    [".match-score", "border-color"],
    [".match-score-vacio", "color"],
    [".stepper-btn", "background-color"],
    [".stepper-btn", "color"],
    [".stepper input", "background-color"],
    [".pick-label", "color"],
    [".status-pill", "color"],
    [".comodin-badge", "background-color"],
    ["select", "background-color"],
    [".secondary-button", "background-color"]
  ]
};

/*
 * Los colores del tema oscuro, tal y como estaban ANTES de la pasada de fichas.
 * Capturados del CSS original, no del ya modificado — una base sacada del
 * codigo que se quiere comprobar no demuestra nada.
 */
const COLORES_DEL_OSCURO = {
  "quinielas.html": {
    "body { background-color }": "rgb(7, 17, 31)",
    "body { color }": "rgb(248, 250, 252)",
    ".hero-card { background-image }": "linear-gradient(145deg, rgba(34, 197, 94, 0.25), rgba(16, 35, 61, 0.96))",
    ".app-panel { background-color }": "rgba(255, 255, 255, 0.08)",
    ".app-panel { border-color }": "rgba(255, 255, 255, 0.12)",
    ".helper-text { color }": "rgb(159, 176, 199)",
    ".field-label { color }": "rgb(250, 204, 21)",
    "button { background-image }": "linear-gradient(135deg, rgb(34, 197, 94), rgb(22, 163, 74))",
    "button { color }": "rgb(4, 19, 10)",
    ".ghost-button { color }": "rgb(159, 176, 199)",
    ".ghost-button { border-color }": "rgba(255, 255, 255, 0.12)",
    "input { background-color }": "rgba(255, 255, 255, 0.92)",
    "input { color }": "rgb(15, 23, 42)",
    ".checkbox-fila { color }": "rgb(248, 250, 252)",
    ".radio-grupo .checkbox-fila { background-color }": "rgba(34, 197, 94, 0.1)",
    ".radio-grupo .checkbox-fila { border-color }": "rgb(34, 197, 94)"
  },
  "index.html": {
    ".action-card { background-color }": "rgba(255, 255, 255, 0.08)",
    ".action-card .icon { background-color }": "rgba(255, 255, 255, 0.14)",
    ".bottom-nav { background-color }": "rgba(6, 16, 31, 0.88)",
    ".bottom-nav a { color }": "rgb(248, 250, 252)",
    ".bottom-nav a.active { background-color }": "rgba(34, 197, 94, 0.18)",
    ".eyebrow { color }": "rgb(250, 204, 21)",
    "h1 { color }": "rgb(248, 250, 252)"
  },
  "llenar_jornada_user.html": {
    ".partido-container { background-color }": "rgba(255, 255, 255, 0.07)",
    ".match-score { background-color }": "rgba(255, 255, 255, 0.05)",
    ".match-score { border-color }": "rgba(255, 255, 255, 0.12)",
    ".match-score-vacio { color }": "rgb(159, 176, 199)",
    ".stepper-btn { background-color }": "rgba(255, 255, 255, 0.08)",
    ".stepper-btn { color }": "rgb(248, 250, 252)",
    ".stepper input { background-color }": "rgba(255, 255, 255, 0.92)",
    ".pick-label { color }": "rgb(159, 176, 199)",
    ".status-pill { color }": "rgb(255, 215, 0)",
    ".comodin-badge { background-color }": "rgb(250, 204, 21)",
    "select { background-color }": "rgba(255, 255, 255, 0.92)",
    ".secondary-button { background-color }": "rgba(255, 255, 255, 0.12)"
  }
};

test('⛔ la pasada de fichas no cambia NINGÚN color del tema oscuro', async ({ page }) => {
  const datos = await registrarse(page, 'tema');
  await crearQuiniela(page, 'Tema');
  await activarAdminMode(page, datos.password);

  await page.evaluate(async () => {
    await fetch("/api/jornadas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "J1", partidos: [
        { equipo1: "Alfa", equipo2: "Beta", apiDate: "2099-01-01 15:00", comodin: true }
      ] })
    });
  });

  const todos = {};

  for (const [pantalla, piezas] of Object.entries(PANTALLAS)) {
    await page.goto("/" + pantalla);
    await page.waitForLoadState("networkidle");

    const colores = await page.evaluate(lista => {
      const salida = {};
      for (const [selector, propiedad] of lista) {
        const elemento = document.querySelector(selector);
        salida[selector + " { " + propiedad + " }"] = elemento
          ? getComputedStyle(elemento)[propiedad]
          : "NO EXISTE EN ESTA PANTALLA";
      }
      return salida;
    }, piezas);

    /*
     * ⛔ Una pieza que no aparece es un AGUJERO en la red, no un caso normal.
     * Si el selector deja de existir, esta prueba seguiría verde sin comprobar
     * nada — que es la forma silenciosa de quedarse sin red.
     */
    for (const [pieza, valor] of Object.entries(colores)) {
      expect(valor, pantalla + " -> " + pieza + ": la red tiene un agujero aqui")
        .not.toBe("NO EXISTE EN ESTA PANTALLA");

      expect(valor, pantalla + " -> " + pieza + " se quedo sin color: ficha mal escrita")
        .not.toBe("rgba(0, 0, 0, 0)");
    }

    todos[pantalla] = colores;
  }

  /*
   * ⛔ LOS VALORES VAN AQUI DENTRO, NO EN UNA INSTANTANEA.
   *
   * Estaban en un archivo de `toMatchSnapshot`, y Playwright le pone el
   * SISTEMA OPERATIVO al nombre: `colores-oscuro-movil-win32.txt`. En el
   * ordenador de Marco existia; en el CI, que corre en Ubuntu, no — y las
   * pruebas de navegador reventaron ahi sin haber roto nada.
   *
   * ⚠️ Y la instantanea era la herramienta equivocada de todos modos: esto son
   * VALORES DE CSS, iguales en cualquier sistema y a cualquier anchura. Meter
   * el sistema operativo en la comparacion no aportaba nada y anadia un sitio
   * mas donde fallar.
   */
  expect(JSON.parse(JSON.stringify(todos))).toEqual(COLORES_DEL_OSCURO);
});

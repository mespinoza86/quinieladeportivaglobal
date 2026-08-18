/*
 * Construcción de HTML sin agujeros de inyección (hallazgo S-04).
 *
 * El frontend pinta casi todo con plantillas e `innerHTML`. Eso no es malo por
 * sí solo —el marcado es constante y lo escribimos nosotros—; lo peligroso es
 * lo que se mete DENTRO: nombres de jornada, de equipo y textos de trivia, que
 * son campos libres de administración. Y la CSP vigente permite `unsafe-inline`
 * tanto en `script-src` como en `script-src-attr`, porque el frontend depende de
 * 63 manejadores en atributo, así que un `<img onerror=…>` que llegue al DOM sí
 * se ejecuta.
 *
 * Se eligió esta vía, y no reescribir 58 plantillas a `createElement`, porque el
 * frontend no tiene pruebas de navegador: convertir a nodos DOM cambia el HTML
 * generado y no habría forma de comprobar que las pantallas siguen igual.
 * Etiquetar la plantilla deja el marcado byte a byte idéntico y solo cambia lo
 * que se interpola, que es exactamente el agujero.
 *
 * Uso:
 *
 *     contenedor.innerHTML = html`<h3>${jornada.nombre}</h3>`;
 *
 * Todo lo interpolado se escapa. Cuando lo interpolado ES html ya construido
 * —el caso típico de componer una lista— se marca con `crudo()`:
 *
 *     const filas = partidos.map(p => html`<li>${p.equipo1}</li>`);
 *     lista.innerHTML = html`<ul>${crudo(filas.join(''))}</ul>`;
 *
 * Un arreglo se une sin separador, así que `${filas}` equivale a lo anterior
 * sin tener que llamar a `join('')`.
 */
(function (global) {
  'use strict';

  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };

  /**
   * Escapa un valor para incrustarlo en HTML.
   *
   * Se escapan también las comillas, no solo `<` y `>`: sin eso, un valor
   * interpolado dentro de un atributo —`title="${nombre}"`— puede cerrar el
   * atributo y añadir uno nuevo, que es la mitad de los casos reales.
   *
   * `null` y `undefined` dan cadena vacía, no las palabras "null"/"undefined".
   */
  function escapar(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>'"]/g, caracter => MAPA[caracter]);
  }

  /*
   * La marca de "esto ya es HTML". Se usa una clase propia en vez de una
   * bandera en un objeto plano para que un valor que venga del servidor no
   * pueda hacerse pasar por HTML seguro simplemente trayendo el campo puesto.
   */
  function HtmlCrudo(texto) {
    this.texto = texto;
  }

  HtmlCrudo.prototype.toString = function () {
    return this.texto;
  };

  /** Marca un texto como HTML ya construido, que no debe volver a escaparse. */
  function crudo(texto) {
    return new HtmlCrudo(texto === null || texto === undefined ? '' : String(texto));
  }

  function resolver(valor) {
    if (valor instanceof HtmlCrudo) return valor.texto;
    if (Array.isArray(valor)) return valor.map(resolver).join('');
    return escapar(valor);
  }

  /**
   * Plantilla etiquetada: el marcado pasa tal cual y los datos se escapan.
   *
   * Devuelve un `HtmlCrudo`, de modo que una plantilla puede anidarse dentro de
   * otra sin escaparse dos veces y sin tener que envolverla en `crudo()`.
   */
  function html(cadenas, ...valores) {
    let salida = cadenas[0];

    for (let i = 0; i < valores.length; i++) {
      salida += resolver(valores[i]) + cadenas[i + 1];
    }

    return crudo(salida);
  }

  global.escapar = escapar;
  global.crudo = crudo;
  global.html = html;
  global.HtmlCrudo = HtmlCrudo;

  // `globalThis` en el segundo término es lo que hace que las pruebas puedan
  // cargar este archivo en Node, donde no existe `window`.
})(typeof window !== 'undefined' ? window : globalThis);

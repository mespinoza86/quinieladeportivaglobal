/*
 * Juntar el nombre de una liga con su país: «Liga Premier · Inglaterra».
 *
 * ============================================================================
 * ⛔ POR QUÉ ESTO ES UN ARCHIVO PROPIO, PARA CINCO LÍNEAS
 * ============================================================================
 *
 * Lo necesitan TRES pantallas: la liga de la quiniela, las ligas favoritas y el
 * armado de la jornada semana a semana. Las dos primeras cargan
 * `combo-de-ligas.js` y la tercera no —y no tendría sentido que lo hiciera: son
 * trescientas líneas de desplegable que ahí no se usan—.
 *
 * Así que las opciones eran copiarlo o sacarlo. Copiado, el día que se cambie
 * el separador quedarían dos formas distintas de decir lo mismo dentro de la
 * misma aplicación, y nadie avisaría.
 *
 * ============================================================================
 * ⛔ POR QUÉ EXISTE
 * ============================================================================
 *
 * Hay una «Liga Premier» en Inglaterra y otras con ese mismo nombre en más
 * países. Al elegir una, la pantalla se quedaba con el nombre pelado y ya no
 * había forma de saber cuál habías cogido. El país es lo que lo desambigua.
 */
(function () {
  'use strict';

  /**
   * @param {string} nombre  El de la liga.
   * @param {string} [pais]  Vacío en las competiciones internacionales.
   *
   * ⚠️ SIN PAÍS DEVUELVE EL NOMBRE SOLO, nunca «Liga Premier · ». Las
   * competiciones internacionales llegan sin país del proveedor, y un separador
   * suelto al final se lee como un dato que se quedó cargando.
   */
  window.ligaConPais = function ligaConPais(nombre, pais) {
    const n = String(nombre || '').trim();
    const p = String(pais || '').trim();
    if (!n) return '';
    return p ? `${n} · ${p}` : n;
  };
})();

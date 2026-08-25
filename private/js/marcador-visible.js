/*
 * Cómo se ENSEÑA un marcador. Una sola regla, en un solo sitio.
 *
 * ============================================================================
 * ⛔ UN MARCADOR EN BLANCO NO ES UN CERO (Entrada 068)
 * ============================================================================
 *
 * Cinco sitios del frontend escribían `p.marcador1 || '0'`. Con eso, un partido
 * que la persona NO pronosticó salía impreso como **0**, y el texto que se
 * copia al portapapeles o se manda por WhatsApp decía que había pronosticado
 * 0-0. La base estaba bien —ahí es `NULL`— pero el papel que circula por el
 * grupo mentía, y es justo el papel que alguien saca el día de la discusión.
 *
 * ============================================================================
 * ⚠️ Y SON TRES ESTADOS, NO DOS
 * ============================================================================
 *
 * `/api/resultados-con-equipos` devuelve un campo `oculto` para los pronósticos
 * ajenos de partidos que todavía no empiezan —la privacidad se decide partido a
 * partido, Entrada 019—. **Ningún script lo miraba.** Así que el administrador
 * que copiaba los pronósticos de todos ANTES de la jornada obtenía un texto en
 * el que los treinta jugadores habían pronosticado 0-0.
 *
 * Los tres estados y su marca:
 *
 *   - pronosticó            → el número, tal cual. El 0 se imprime «0».
 *   - no pronosticó         → «–»
 *   - todavía no es visible → «🔒»
 *
 * El cero de verdad tiene que seguir viéndose como cero: distinguirlo del
 * blanco es el asunto entero de esta función.
 */
(function (global) {
  'use strict';

  /** Lo que se enseña cuando no hay pronóstico. */
  const SIN_PRONOSTICO = '–';

  /** Lo que se enseña cuando lo hay pero todavía no se puede ver. */
  const NO_VISIBLE = '🔒';

  /**
   * Texto de un marcador para enseñarlo.
   *
   * ⚠️ La comprobación es contra `null`, `undefined` y cadena vacía **una por
   * una**, nunca con `||`: `0 || '–'` da «–», que es exactamente el fallo que
   * esto viene a corregir, sólo que al revés.
   *
   * `oculto` manda sobre todo lo demás: si el dato no se puede ver, da igual
   * que exista o no, y decir cuál de las dos cosas es ya sería filtrarlo.
   */
  function marcadorVisible(valor, oculto = false) {
    if (oculto) return NO_VISIBLE;
    if (valor === null || valor === undefined) return SIN_PRONOSTICO;
    if (typeof valor === 'string' && valor.trim() === '') return SIN_PRONOSTICO;
    return String(valor);
  }

  /**
   * ¿Este pronóstico tiene los dos marcadores puestos?
   *
   * Lo usa la pantalla de llenar la quiniela para saber qué partidos quedaron a
   * medias. Un solo marcador no es medio pronóstico: no es pronóstico, porque
   * no se puede puntuar contra nada.
   */
  function pronosticoCompleto(marcador1, marcador2) {
    const puesto = valor =>
      valor !== null && valor !== undefined &&
      !(typeof valor === 'string' && valor.trim() === '');

    return puesto(marcador1) && puesto(marcador2);
  }

  global.marcadorVisible = marcadorVisible;
  global.pronosticoCompleto = pronosticoCompleto;
  global.MARCADOR_SIN_PRONOSTICO = SIN_PRONOSTICO;
  global.MARCADOR_NO_VISIBLE = NO_VISIBLE;

  // `globalThis` en el segundo término es lo que permite cargarlo en Node desde
  // las pruebas, donde no existe `window`. Mismo patrón que `html-seguro.js`.
})(typeof window !== 'undefined' ? window : globalThis);

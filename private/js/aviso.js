/*
 * Decir algo en el renglón de avisos de una pantalla, y decir QUÉ es.
 *
 * ============================================================================
 * ⛔ POR QUÉ EXISTE
 * ============================================================================
 *
 * En el proyecto hay más de cien sitios que escriben en un `.form-message`, y
 * casi todos lo hacían igual tanto para «guardado» como para «no se pudo». El
 * renglón salía del mismo color en los dos casos, así que un fallo se leía con
 * el mismo tono que un acierto.
 *
 * Ponerle verde por defecto fue peor —se probó, y «Código de quiniela
 * inválido» salía en verde—, así que el color por defecto es neutro y aquí se
 * marca lo que SÍ se sabe qué es.
 *
 * ⚠️ NO SE CONVIRTIERON LOS CIEN SITIOS. Sólo los de fallo, que son los que
 * tienen que destacar. Lo demás se queda neutro, que es honesto: no dice que
 * algo salió bien ni que salió mal, y se puede ir marcando sin prisa.
 */
(function () {
  'use strict';

  function escribir(elemento, texto, clase) {
    if (!elemento) return;

    elemento.textContent = texto == null ? '' : String(texto);

    /*
     * ⚠️ Se quitan las DOS y se pone la que toca. Sin quitar la contraria, un
     * fallo después de un acierto se quedaría con las dos clases y el color
     * dependería del orden del CSS, no de lo que pasó.
     */
    elemento.classList.remove('form-message--error', 'form-message--ok');
    if (clase) elemento.classList.add(clase);
  }

  /** Algo salió mal. Sale en rojo y con un símbolo delante. */
  window.avisoFallo = (elemento, texto) =>
    escribir(elemento, texto, 'form-message--error');

  /** Algo salió bien. */
  window.avisoBien = (elemento, texto) =>
    escribir(elemento, texto, 'form-message--ok');

  /** Borra el renglón y su color. Vacío no ocupa sitio: lo esconde el CSS. */
  window.avisoNada = elemento => escribir(elemento, '', null);
})();

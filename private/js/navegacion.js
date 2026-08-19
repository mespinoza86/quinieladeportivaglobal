/*
 * Botones que solo navegan.
 *
 * Antes cada uno llevaba `onclick="window.location.href='…'"` en el propio
 * marcado. Eso obliga a que la política de seguridad permita
 * `script-src-attr 'unsafe-inline'`, y con esa puerta abierta un `<img
 * onerror=…>` que llegara al DOM se ejecutaría. Al pasar el destino a un
 * atributo de datos, el marcado deja de contener código y la política puede
 * cerrarse.
 *
 * Se declara así:
 *
 *     <button type="button" data-ir-a="index.html">Volver</button>
 */
(function () {
  'use strict';

  function conectar() {
    document.querySelectorAll('[data-ir-a]').forEach(elemento => {
      // Una pantalla podría cargar el script dos veces; que no se enganche doble.
      if (elemento.dataset.navegacionLista === '1') return;
      elemento.dataset.navegacionLista = '1';

      elemento.addEventListener('click', () => {
        window.location.href = elemento.dataset.irA;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', conectar);
  } else {
    conectar();
  }
})();

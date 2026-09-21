/*
 * El tema de la aplicación: oscuro, de día o de cancha.
 *
 * ============================================================================
 * ⛔ ESTE ARCHIVO SE CARGA SIN `defer`, Y ESO NO ES UN DESCUIDO
 * ============================================================================
 *
 * Con `defer` el navegador pinta la página ANTES de ejecutarlo, así que quien
 * tenga el tema de día vería medio segundo de pantalla negra en cada carga —y
 * al revés—. Ese destello es de las cosas que más baratas parecen y más cantan.
 *
 * ⚠️ Lo normal sería un `<script>` de cuatro líneas dentro del `<head>`, pero
 * aquí NO se puede: `script-src` no admite código en línea desde la Entrada 024.
 * Por eso es un archivo aparte, y por eso va sin `defer`: es la única forma de
 * marcar el `<html>` antes de que se pinte nada.
 *
 * ⭐ Y si este archivo no llegara a cargarse, la aplicación se ve OSCURA, que es
 * lo que `:root` trae de fábrica. El fallo degrada a «no puedo cambiar de tema»,
 * nunca a «no se ve nada».
 */
(function () {
  'use strict';

  var LLAVE = 'quiniela-tema';

  /*
   * El orden es el del botón al ir pulsando. El oscuro va primero porque es el
   * de fábrica: Marco lo pidió así.
   *
   * ⚠️ Cada uno de éstos tiene que tener su bloque de fichas en la hoja de
   * estilos. Ofrecer un tema sin fichas no da error: se vería el oscuro
   * fingiendo ser otra cosa, porque las fichas se heredan de `:root`.
   */
  var TEMAS = [
    { id: 'oscuro', icono: '🌙', nombre: 'Oscuro' },
    { id: 'dia',    icono: '☀️', nombre: 'De día' },
    { id: 'cancha', icono: '⚽', nombre: 'Cancha' }
  ];

  /*
   * ⚠️ Leer de `localStorage` PUEDE LANZAR, no sólo devolver vacío: en una
   * ventana privada o con las cookies bloqueadas, tocarlo es una excepción. Y si
   * ésta subiera, el resto del archivo no correría y la página se quedaría sin
   * tema — por un ajuste del navegador que no tiene nada que ver.
   */
  function guardado() {
    try {
      return localStorage.getItem(LLAVE);
    } catch (error) {
      return null;
    }
  }

  function guardar(id) {
    try {
      localStorage.setItem(LLAVE, id);
    } catch (error) {
      /* Se pierde al cerrar, pero la sesión de ahora funciona igual. */
    }
  }

  function valido(id) {
    for (var i = 0; i < TEMAS.length; i++) {
      if (TEMAS[i].id === id) return TEMAS[i];
    }
    return TEMAS[0];
  }

  var actual = valido(guardado());

  /*
   * ⛔ ESTO CORRE AHORA, CON EL `<body>` TODAVÍA SIN EXISTIR.
   *
   * `document.documentElement` sí existe ya —es el `<html>`—, y marcarlo aquí es
   * lo que evita el destello. Cualquier cosa que toque el `<body>` tiene que
   * esperar, y por eso el botón se monta más abajo.
   */
  document.documentElement.dataset.tema = actual.id;

  /* ==================== El botón ==================== */

  /*
   * ⭐ El botón lo pone este archivo, no las 39 páginas.
   *
   * Añadirlo a mano en cada `.html` habría sido 39 sitios donde olvidarse de
   * uno, y 39 que tocar el día que cambie. Aquí se monta solo en todas.
   */
  function montarBoton() {
    if (document.getElementById('botonTema')) return;

    var boton = document.createElement('button');
    boton.id = 'botonTema';
    boton.type = 'button';
    boton.className = 'boton-tema';

    function pintar() {
      var siguiente = TEMAS[(TEMAS.indexOf(actual) + 1) % TEMAS.length];

      boton.textContent = actual.icono;

      /*
       * ⚠️ El rótulo dice A DÓNDE LLEVA, no dónde estás. Un botón que enseña la
       * luna puede leerse como «estás en oscuro» o como «ponlo oscuro», y son
       * cosas contrarias; el texto de ayuda deshace esa duda.
       */
      var texto = 'Tema: ' + actual.nombre + '. Pulsa para cambiar a ' + siguiente.nombre + '.';
      boton.title = texto;
      boton.setAttribute('aria-label', texto);
    }

    boton.addEventListener('click', function () {
      actual = TEMAS[(TEMAS.indexOf(actual) + 1) % TEMAS.length];
      document.documentElement.dataset.tema = actual.id;
      guardar(actual.id);
      pintar();
    });

    pintar();
    document.body.appendChild(boton);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarBoton);
  } else {
    montarBoton();
  }
})();

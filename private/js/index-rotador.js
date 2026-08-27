/*
 * El carrusel de la portada.
 *
 * Antes la rotación vivía dentro de index-live.js y era un booleano: ranking o
 * en vivo, nada más. La Fase B añade un tercer panel —el top 3 de la jornada— y
 * un booleano no da para tres, así que la rotación sale a su propio archivo y
 * pasa a recorrer una LISTA.
 *
 * El acuerdo entre este archivo y los que llenan los paneles es una sola cosa:
 * un panel con `display:none` puesto a mano es un panel que no tiene nada que
 * enseñar, y se salta. Así cada panel decide si merece turno sin que el rotador
 * sepa de rankings, de partidos ni de jornadas.
 *
 * Los paneles arrancan ocultos en el HTML y se destapan solos al tener
 * contenido. Al revés —visibles y que se oculten— el rotador enseñaría durante
 * un segundo tarjetas vacías en cada carga.
 */
document.addEventListener('DOMContentLoaded', () => {
  const contenedor = document.querySelector('.home-rotator');
  if (!contenedor) return;

  const INTERVALO_MS = 10000;
  const TRANSICION_MS = 80;

  /*
   * ⚠️ Se recuerda el PANEL mostrado, no su posición.
   *
   * Antes se guardaba un índice, y la lista se recalcula en cada giro porque
   * los paneles se llenan a destiempo. Si al arrancar sólo había uno listo y
   * después aparecían los otros, el índice volvía a caer en el mismo y **el
   * primer panel se quedaba veinte segundos** en pantalla. Se veía como «a
   * veces tarda el doble en cambiar», y era eso.
   *
   * Con la referencia al elemento da igual cómo crezca o mengüe la lista: se
   * busca dónde está ahora el último que se enseñó y se pasa al siguiente.
   */
  let ultimo = null;

  /*
   * Un panel con `display:none` en línea es uno que dijo «no tengo nada que
   * enseñar». Los que sí tienen contenido no llevan estilo en línea: su
   * visibilidad la decide la clase `.active`, que pone y quita este archivo.
   */
  function panelesConContenido() {
    return Array.from(contenedor.querySelectorAll('.rotator-panel'))
      .filter(panel => panel.style.display !== 'none');
  }

  /** Deja activo un panel y solo uno. */
  function mostrar(panel) {
    const activos = contenedor.querySelectorAll('.rotator-panel.active');
    activos.forEach(otro => {
      if (otro !== panel) otro.classList.remove('active');
    });

    if (panel.classList.contains('active')) return;

    /*
     * El retardo no es adorno: la animación de entrada es un `fadeSlideIn` que
     * arranca al ganar la clase, y sin dejar salir al anterior los dos se
     * superponen medio segundo.
     */
    setTimeout(() => panel.classList.add('active'), TRANSICION_MS);
  }

  function girar() {
    /*
     * La lista se recalcula en cada giro. Los paneles se llenan por su cuenta y
     * a destiempo —cada uno espera a su petición—, así que congelarla en el
     * arranque dejaría fuera al que tardara más en decidirse.
     */
    const paneles = panelesConContenido();
    if (!paneles.length) return;

    /*
     * `indexOf` da -1 si el último ya no está en la lista —porque se quedó sin
     * contenido, o porque es el primer giro—, y entonces `-1 + 1` es 0: se
     * empieza por el principio. Sale bien sin tener que tratar el caso aparte.
     */
    const siguiente = paneles[(paneles.indexOf(ultimo) + 1) % paneles.length];

    mostrar(siguiente);
    ultimo = siguiente;
  }

  girar();
  setInterval(girar, INTERVALO_MS);
});

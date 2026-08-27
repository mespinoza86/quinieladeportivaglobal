/*
 * El podio de la jornada actual, en la portada (petición 5 de la Fase B).
 *
 * Junto al top 3 general y a los partidos en vivo, porque responde a otra
 * pregunta: la tabla general dice quién va ganando la temporada, y esta quién
 * ganó el fin de semana. Es la información que más se pregunta y estaba a dos
 * pantallas de distancia.
 *
 * No decide por su cuenta cuál es la jornada: pide /api/clasificacion-jornada
 * sin parámetro y el servidor le da la sugerida, la misma que abren llenar
 * quiniela y resultados oficiales. Tres pantallas, una regla.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const tarjeta = document.getElementById('jornadaPodioCard');
  const contenedor = document.getElementById('jornadaPodioContainer');
  const subtitulo = document.getElementById('jornadaPodioNombre');

  if (!tarjeta || !contenedor) return;

  /** Se queda fuera de la rotación: el rotador salta lo que está oculto. */
  function noMostrar() {
    tarjeta.style.display = 'none';
  }

  try {
    const respuesta = await fetch('/api/clasificacion-jornada');
    const datos = await respuesta.json();

    if (!respuesta.ok || !datos.jornada) return noMostrar();

    const podio = (datos.clasificacion || []).slice(0, 3);

    /*
     * Una jornada recién creada tiene clasificación vacía o toda a cero. Un
     * podio de ceros no dice nada y ocupa un turno del carrusel, así que en ese
     * caso la tarjeta no aparece.
     */
    if (!podio.length || podio.every(fila => !fila.puntos)) return noMostrar();

    const medallas = ['🥇', '🥈', '🥉'];

    if (subtitulo) {
      subtitulo.textContent = datos.estado === 'confirmada'
        ? datos.jornada
        : `${datos.jornada} · provisional`;
    }

    contenedor.innerHTML = podio.map((fila, indice) => html`
      <div class="ranking-row ranking-${indice + 1}">
        <div class="ranking-position">${medallas[indice]}</div>
        <div class="ranking-player">
          <strong>${fila.jugador}</strong>
          <span>${fila.puntos} puntos</span>
        </div>
      </div>
    `).join('');

    /*
     * ⛔ Se QUITA el estilo en línea; ver `index-live.js`. Ponerlo a `block`
     * dejaba el panel ocupando su alto aunque no tuviera el turno, porque un
     * estilo en línea gana sobre la clase y `.rotator-panel` sólo lo hacía
     * transparente. Eso era el hueco de la portada.
     */
    tarjeta.style.removeProperty('display');

  } catch (error) {
    console.error('Error cargando el podio de la jornada:', error);
    noMostrar();
  }
});

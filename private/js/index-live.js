document.addEventListener('DOMContentLoaded', async () => {
  const rankingCard = document.getElementById('rankingCard');
  const liveCard = document.getElementById('liveMatchesCard');
  const container = document.getElementById('liveMatchesContainer');

  if (!rankingCard || !liveCard || !container) return;

  function marcador(valor) {
    return valor !== null && valor !== undefined && valor !== '' ? valor : '-';
  }

  function estaEnVivo(partido) {
    return partido.estado === 'LIVE' || partido.estado === 'MT';
  }

  /*
   * Devuelve HTML ya construido, así que se etiqueta con `html`: de ese modo
   * quien lo interpole lo recibe como HtmlCrudo y no se escapa dos veces.
   */
  function liveBadge(partido) {
    if (partido.estado === 'MT') {
      return html`
        <span class="status-pill status-live">
          <span class="live-dot"></span>
          MT
        </span>
      `;
    }

    if (partido.estado === 'LIVE' && partido.minuto) {
      return html`
        <span class="status-pill status-live">
          <span class="live-dot"></span>
          ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
        </span>
      `;
    }

    return '';
  }

/*
 * Aquí vivía `mostrarPanel`, un booleano entre dos tarjetas. La rotación se
 * mudó a index-rotador.js cuando la Fase B añadió una tercera: este archivo ya
 * solo se ocupa de SU panel, y dice si tiene algo que enseñar ocultándose o no.
 */

  try {
    const res = await fetch('/api/resultados-oficiales');
    const jornadas = await res.json();

    const partidosLive = [];

    jornadas.forEach(jornada => {
      (jornada.partidos || []).forEach(partido => {
        if (estaEnVivo(partido)) {
          partidosLive.push({
            jornada: jornada.nombre,
            ...partido
          });
        }
      });
    });

    if (partidosLive.length === 0) {
      liveCard.style.display = 'none';
      return;
    }

    container.innerHTML = partidosLive.map(partido => html`
      <div class="live-match-row">
        <div class="live-match-main">
          <strong>${partido.equipo1}</strong>

          <span class="live-score">
            ${marcador(partido.marcador1)} - ${marcador(partido.marcador2)}
          </span>

          <strong>${partido.equipo2}</strong>
        </div>

        <div class="live-match-meta">
          ${liveBadge(partido)}
          <span>${partido.jornada}</span>
        </div>
      </div>
    `).join('');

    liveCard.style.display = 'block';

  } catch (error) {
    console.error('Error cargando partidos en vivo:', error);
    liveCard.style.display = 'none';
  }
});
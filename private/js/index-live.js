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

  function liveBadge(partido) {
    if (partido.estado === 'MT') {
      return `
        <span class="status-pill status-live">
          <span class="live-dot"></span>
          MT
        </span>
      `;
    }

    if (partido.estado === 'LIVE' && partido.minuto) {
      return `
        <span class="status-pill status-live">
          <span class="live-dot"></span>
          ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
        </span>
      `;
    }

    return '';
  }

  function mostrarPanel(panel) {
  if (panel === 'ranking') {
    liveCard.classList.remove('active');

    setTimeout(() => {
      rankingCard.classList.add('active');
    }, 80);
  } else {
    rankingCard.classList.remove('active');

    setTimeout(() => {
      liveCard.classList.add('active');
    }, 80);
  }
}

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
      rankingCard.classList.add('active');
      return;
    }

    container.innerHTML = partidosLive.map(partido => `
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
    rankingCard.classList.add('active');

    let mostrandoRanking = true;

    setInterval(() => {
      mostrandoRanking = !mostrandoRanking;
      mostrarPanel(mostrandoRanking ? 'ranking' : 'live');
    }, 10000);

  } catch (error) {
    console.error('Error cargando partidos en vivo:', error);
    liveCard.style.display = 'none';
    rankingCard.classList.add('active');
  }
});
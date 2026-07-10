function marcador(valor) {
  return valor !== null && valor !== undefined && valor !== '' ? valor : '-';
}

function formatearFecha(fecha) {
  if (!fecha) return '';

  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;

  return d.toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

function estadoPartidoHTML(partido) {
  if (!partido) return '';

  if (partido.estado === 'TC') {
    return `<span class="status-pill status-finished">TC</span>`;
  }

  if (partido.estado === 'MT') {
    return `<span class="status-pill status-live"><span class="live-dot"></span>MT</span>`;
  }

  if (partido.estado === 'LIVE' && partido.minuto) {
    return `<span class="status-pill status-live">
      <span class="live-dot"></span>
      ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
    </span>`;
  }

  return `<span class="status-pill status-scheduled">${formatearFecha(partido.fecha)}</span>`;
}

function partidoYaInicio(trivia) {
  if (['LIVE', 'MT', 'TC'].includes(trivia.estado)) return true;

  if (!trivia.fecha) return false;

  const fecha = new Date(String(trivia.fecha).replace(' ', 'T'));

  if (Number.isNaN(fecha.getTime())) return false;

  return fecha <= new Date();
}

document.addEventListener("DOMContentLoaded", async function () {
  const jornadaSelect = document.getElementById('jornada-select');
  const verResultadosBtn = document.getElementById('ver-resultados-btn');
  const resultadosCards = document.getElementById('resultados-cards');

  try {
    const jornadasRes = await fetch('/api/trivias-jornadas');
    const jornadasTrivia = await jornadasRes.json();

    function mostrarMensaje(mensaje) {
      resultadosCards.innerHTML = `<div class="resultados-mensaje">${mensaje}</div>`;
    }

    jornadaSelect.innerHTML = '';

    if (!Array.isArray(jornadasTrivia) || jornadasTrivia.length === 0) {
      jornadaSelect.innerHTML = '<option value="">No hay trivias creadas</option>';
      mostrarMensaje('No hay trivias creadas todavía.');
      return;
    }

    jornadasTrivia.forEach(jornada => {
      const option = document.createElement('option');
      option.value = jornada.jornadaNombre;
      option.textContent = jornada.jornadaNombre;
      jornadaSelect.appendChild(option);
    });

    jornadaSelect.value = jornadasTrivia[jornadasTrivia.length - 1].jornadaNombre;
    await mostrarResultadosTrivia(jornadaSelect.value);

    async function intentarMostrarJornadaSeleccionada() {
      await mostrarResultadosTrivia(jornadaSelect.value);
    }

    verResultadosBtn.addEventListener('click', intentarMostrarJornadaSeleccionada);
    jornadaSelect.addEventListener('change', intentarMostrarJornadaSeleccionada);

    document.getElementById('volver-btn-top').addEventListener('click', function () {
      window.location.href = '/index.html';
    });

    document.getElementById('volver-btn-bottom').addEventListener('click', function () {
      window.location.href = '/index.html';
    });

    setInterval(async () => {
      if (jornadaSelect.value) {
        await mostrarResultadosTrivia(jornadaSelect.value);
      }
    }, 30000);

  } catch (error) {
    console.error('Error cargando resultados de trivias:', error);
    resultadosCards.innerHTML = `<div class="resultados-mensaje">Error cargando resultados de trivias.</div>`;
  }
});

async function mostrarResultadosTrivia(jornadaNombre) {
  const resultadosCards = document.getElementById('resultados-cards');
  resultadosCards.innerHTML = '';

  const res = await fetch(`/api/resultados-trivias/${encodeURIComponent(jornadaNombre)}`);
  const data = await res.json();

  if (!res.ok) {
    resultadosCards.innerHTML = `<div class="resultados-mensaje">${data.error || 'No se pueden ver estos resultados aún.'}</div>`;
    return;
  }

  if (!data.trivias || data.trivias.length === 0) {
    resultadosCards.innerHTML = `<div class="resultados-mensaje">Todavía no hay partidos de trivia iniciados o cerrados para esta jornada.</div>`;
    return;
  }

  const triviasVisibles = data.trivias.filter(partidoYaInicio);

  if (triviasVisibles.length === 0) {
    resultadosCards.innerHTML = `<div class="resultados-mensaje">Todavía no hay partidos de trivia iniciados o cerrados para esta jornada.</div>`;
    return;
  }

  const partidosMap = new Map();

  triviasVisibles.forEach(trivia => {
    const key = `${trivia.partidoIndex}_${trivia.equipo1}_vs_${trivia.equipo2}`;

    if (!partidosMap.has(key)) {
      partidosMap.set(key, {
        equipo1: trivia.equipo1,
        equipo2: trivia.equipo2,
        estado: trivia.estado || 'PROGRAMADO',
        minuto: trivia.minuto ?? null,
        fecha: trivia.fecha || '',
        marcador1: trivia.marcador1 ?? null,
        marcador2: trivia.marcador2 ?? null,
        trivias: []
      });
    }

    partidosMap.get(key).trivias.push(trivia);
  });

  let index = 0;

  partidosMap.forEach(partido => {
    index++;
    const grupoId = `detalle-trivia-${index}`;
    const totalPreguntas = partido.trivias.length;

    const card = document.createElement('article');
    card.className = 'match-card';

    card.innerHTML = `
      <div class="match-main">
        <div class="match-left">
          <div class="match-title">${partido.equipo1} vs ${partido.equipo2}</div>
          <div class="match-meta">
            <span>📅 ${formatearFecha(partido.fecha)}</span>
          </div>
        </div>

        <div class="match-score">
          <span>Marcador</span>
          <strong>${marcador(partido.marcador1)} - ${marcador(partido.marcador2)}</strong>
          <span>${totalPreguntas} trivias</span>
        </div>

        <div class="match-status">
          ${estadoPartidoHTML(partido)}
        </div>
      </div>

      <button type="button" class="match-toggle-btn" data-grupo="${grupoId}">
        <span>Ver resultados</span>
        <span class="toggle-icon">›</span>
      </button>

      <div class="players-detail trivia-results-detail" id="${grupoId}">
        ${partido.trivias.map(trivia => `
          <div class="trivia-result-block">
            <div class="trivia-result-question">
              <strong>${trivia.pregunta}</strong>
              <span>Correcta: ${trivia.respuestaCorrecta}</span>
            </div>

            <div class="players-header trivia-header">
              <span>Jugador</span>
              <span>Respuesta</span>
              <span>Puntos</span>
            </div>

            ${
              trivia.respuestas.length > 0
                ? trivia.respuestas.map(r => `
                    <div class="player-row">
                      <span>${r.jugador}</span>
                      <span>${r.respuesta || '-'}</span>
                      <span>${r.puntos || 0}</span>
                    </div>
                  `).join('')
                : `<div class="player-row">
                    <span>Sin respuestas</span>
                    <span>-</span>
                    <span>0</span>
                  </div>`
            }
          </div>
        `).join('')}
      </div>
    `;

    resultadosCards.appendChild(card);
  });

  document.querySelectorAll('.match-toggle-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const grupoId = this.dataset.grupo;
      const detalle = document.getElementById(grupoId);
      const abierto = detalle.classList.toggle('open');

      this.querySelector('span:first-child').textContent = abierto ? 'Minimizar' : 'Ver resultados';
      this.querySelector('.toggle-icon').textContent = abierto ? '⌃' : '›';
    });
  });

  document.getElementById('volver-btn-bottom').style.display = 'block';
  document.getElementById('volver-btn-top').style.display = 'block';
}

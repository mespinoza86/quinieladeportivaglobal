document.addEventListener('DOMContentLoaded', async () => {
  const jornadaSelect = document.getElementById('jornadaSelect');
  const fechaCierre = document.getElementById('fechaCierre');
  const partidosTriviaContainer = document.getElementById('partidosTriviaContainer');
  const guardarCambiosBtn = document.getElementById('guardarCambiosBtn');
  const resolverTriviasBtn = document.getElementById('resolverTriviasBtn');
  const mensaje = document.getElementById('mensaje');

  let jornadas = [];
  let triviasExistentes = [];

  const TIPOS = [
  { tipo: 'primer_gol', pregunta: '¿Qué equipo anota primero?' },
  { tipo: 'mas_amarillas', pregunta: '¿Qué equipo tendrá más tarjetas amarillas?' },
  { tipo: 'mas_rojas', pregunta: '¿Qué equipo tendrá más tarjetas rojas?' },
  { tipo: 'ambos_anotan', pregunta: '¿Ambos equipos anotan?' },
  { tipo: 'gol_primer_tiempo', pregunta: '¿Habrá gol en el primer tiempo?' },
  { tipo: 'gol_segundo_tiempo', pregunta: '¿Habrá gol en el segundo tiempo?' },
  { tipo: 'hubo_tiempo_extra', pregunta: '¿Habrá tiempo extra?' },
  { tipo: 'hubo_penales', pregunta: '¿Habrá penales?' }
];


  async function cargarJornadas() {
    try {
      const res = await fetch('/api/jornadas');
      jornadas = await res.json();

      jornadaSelect.innerHTML = '<option value="">Seleccione jornada</option>';

      jornadas.forEach(jornada => {
        const option = document.createElement('option');
        option.value = jornada.nombre;
        option.textContent = jornada.nombre;
        jornadaSelect.appendChild(option);
      });

    } catch (error) {
      console.error('Error cargando jornadas:', error);
      mensaje.textContent = 'Error cargando jornadas.';
    }
  }

  
  function datetimeLocalCostaRicaToISO(valor) {
  if (!valor) return null;

  // valor viene tipo: 2026-07-03T14:00
  // Lo forzamos a Costa Rica UTC-6
  const fecha = new Date(`${valor}:00-06:00`);

  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function convertirADatetimeLocal(fecha) {
  const d = new Date(fecha);

  if (Number.isNaN(d.getTime())) return '';

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);

  const get = tipo => partes.find(p => p.type === tipo)?.value;

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

  async function cargarTriviasDeJornada() {
    mensaje.textContent = '';
    partidosTriviaContainer.innerHTML = '';

    const jornadaNombre = jornadaSelect.value;

    if (!jornadaNombre) {
      partidosTriviaContainer.innerHTML = '<div class="resultados-mensaje">Seleccione una jornada.</div>';
      return;
    }

    const jornada = jornadas.find(j => j.nombre === jornadaNombre);

    if (!jornada || !Array.isArray(jornada.partidos)) {
      partidosTriviaContainer.innerHTML = '<div class="resultados-mensaje">No se encontraron partidos para esta jornada.</div>';
      return;
    }

    try {
      const res = await fetch(`/api/admin/trivias/${encodeURIComponent(jornadaNombre)}`);

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      triviasExistentes = await res.json();

      if (triviasExistentes.length > 0 && triviasExistentes[0].fechaCierre) {
        fechaCierre.value = convertirADatetimeLocal(triviasExistentes[0].fechaCierre);
      } else if (jornada.fechaCierre) {
        fechaCierre.value = convertirADatetimeLocal(jornada.fechaCierre);
      } else {
        fechaCierre.value = '';
      }

      pintarPartidos(jornada.partidos);

    } catch (error) {
      console.error('Error cargando trivias:', error);
      mensaje.textContent = 'Error cargando trivias.';
    }
  }

  function existeTrivia(partidoIndex, tipo) {
    return triviasExistentes.some(t =>
      Number(t.partidoIndex) === Number(partidoIndex) && t.tipo === tipo
    );
  }

  function pintarPartidos(partidos) {
  partidosTriviaContainer.innerHTML = '';

  partidos.forEach((partido, index) => {
    const card = document.createElement('div');
    card.className = 'trivia-match-card';

    if (partido.comodin) {
      card.classList.add('trivia-match-comodin');
    }

    const tituloComodin = partido.comodin
      ? `
        <div class="comodin-badge">⭐ COMODÍN</div>
      `
      : '';

    card.innerHTML = `
      ${tituloComodin}

      <h3 class="${partido.comodin ? 'trivia-title-comodin' : ''}">
        ${index + 1}. ${partido.equipo1} vs ${partido.equipo2}
      </h3>

      <div class="trivia-question-card">
        ${TIPOS.map(item => {
          const checked = existeTrivia(index, item.tipo) ? 'checked' : '';

          return `
            <label class="trivia-admin-option">
              <input
                type="checkbox"
                class="trivia-tipo-checkbox"
                data-partido-index="${index}"
                value="${item.tipo}"
                ${checked}
              >
              ${item.pregunta}
            </label>
          `;
        }).join('')}
      </div>
    `;

    partidosTriviaContainer.appendChild(card);
  });
}


  function obtenerConfiguracionSeleccionada() {
    const mapa = new Map();

    document.querySelectorAll('.trivia-tipo-checkbox:checked').forEach(input => {
      const partidoIndex = Number(input.dataset.partidoIndex);

      if (!mapa.has(partidoIndex)) {
        mapa.set(partidoIndex, []);
      }

      mapa.get(partidoIndex).push(input.value);
    });

    return Array.from(mapa.entries()).map(([partidoIndex, tipos]) => ({
      partidoIndex,
      tipos
    }));
  }

  function fechaCierreEsValida() {
  const iso = datetimeLocalCostaRicaToISO(fechaCierre.value);
  if (!iso) return false;

  return new Date(iso) > new Date();
}


  async function guardarCambios() {
    mensaje.textContent = '';

    const jornadaNombre = jornadaSelect.value;
    const configuracion = obtenerConfiguracionSeleccionada();

    if (!jornadaNombre) {
      mensaje.textContent = 'Debe seleccionar una jornada.';
      return;
    }

    if (!fechaCierre.value) {
      mensaje.textContent = 'Debe seleccionar fecha de cierre.';
      return;
    }

    if (!fechaCierreEsValida()) {
      const continuar = confirm(
        'La fecha de cierre ya pasó.\n\nSi guarda así, los jugadores no podrán llenar estas trivias. ¿Desea continuar?'
      );

      if (!continuar) return;
    }

    const confirmar = confirm(
      'Se guardarán los cambios de trivias.\n\nSi quitó preguntas, se borrarán sus respuestas y puntos.\n\n¿Desea continuar?'
    );

    if (!confirmar) return;

    guardarCambiosBtn.disabled = true;
    guardarCambiosBtn.textContent = 'Guardando...';

    try {
      const res = await fetch(`/api/admin/trivias/${encodeURIComponent(jornadaNombre)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        fechaCierre: datetimeLocalCostaRicaToISO(fechaCierre.value),
        configuracion
    })

      });

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        mensaje.textContent = data.error || 'Error guardando cambios.';
        return;
      }

      mensaje.textContent = data.mensaje || 'Cambios guardados correctamente.';

      await cargarTriviasDeJornada();

    } catch (error) {
      console.error('Error guardando cambios:', error);
      mensaje.textContent = 'Error guardando cambios.';
    } finally {
      guardarCambiosBtn.disabled = false;
      guardarCambiosBtn.textContent = 'Guardar Cambios de Trivias';
    }
  }

  async function resolverTrivias() {
    mensaje.textContent = 'Resolviendo trivias...';
    resolverTriviasBtn.disabled = true;

    try {
      const res = await fetch('/api/admin/trivias/resolver', {
        method: 'POST'
      });

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      const data = await res.json();
      mensaje.textContent = data.mensaje || data.error || 'Proceso finalizado.';

      await cargarTriviasDeJornada();

    } catch (error) {
      console.error('Error resolviendo trivias:', error);
      mensaje.textContent = 'Error resolviendo trivias.';
    } finally {
      resolverTriviasBtn.disabled = false;
    }
  }

  jornadaSelect.addEventListener('change', cargarTriviasDeJornada);
  guardarCambiosBtn.addEventListener('click', guardarCambios);
  resolverTriviasBtn.addEventListener('click', resolverTrivias);

  await cargarJornadas();
});
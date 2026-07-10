document.addEventListener('DOMContentLoaded', async () => {
  const jugadorSelect = document.getElementById('jugadorSelect');
  const guardarBtn = document.getElementById('guardarBtn');
  const triviasContainer = document.getElementById('triviasContainer');
  const mensaje = document.getElementById('mensaje');
  const tituloTrivia = document.getElementById('tituloTrivia');
  const subtituloTrivia = document.getElementById('subtituloTrivia');
  const infoCierreTrivia = document.getElementById('infoCierreTrivia');

  let trivias = [];
  let jornadaTrivia = null;
  let jugadorValidado = null;
  let jornadaData = null;
  let oficialesJornada = [];
  let intervaloContadores = null;

  await cargarJugadores();
  await cargarUltimaTrivia();

  jugadorSelect.addEventListener('change', validarJugadorSeleccionado);
  guardarBtn.addEventListener('click', guardarRespuestas);

  async function cargarJugadores() {
    const res = await fetch('/api/jugadores');
    const jugadores = await res.json();

    jugadorSelect.innerHTML = '<option value="">Seleccione un jugador</option>';

    jugadores.forEach(jugador => {
      const option = document.createElement('option');
      option.value = jugador;
      option.textContent = jugador;
      jugadorSelect.appendChild(option);
    });
  }

  async function cargarUltimaTrivia() {
    mensaje.textContent = '';

    const res = await fetch('/api/trivias/latest');
    const data = await res.json();

    if (!res.ok || !data.trivias || data.trivias.length === 0) {
      triviasContainer.innerHTML = '<div class="resultados-mensaje">No hay trivias disponibles.</div>';
      guardarBtn.style.display = 'none';
      infoCierreTrivia.innerHTML = '';
      return;
    }

    trivias = data.trivias;
    jornadaTrivia = data.jornadaNombre;

    tituloTrivia.textContent = `Trivia - ${jornadaTrivia}`;
    subtituloTrivia.textContent = 'Puedes modificar solo las trivias de partidos que aún no han iniciado.';

    await cargarDatosJornadaYOficiales();

    infoCierreTrivia.innerHTML = `
      <div>
        <strong>Cierre por partido:</strong>
        cada trivia se bloquea cuando inicia su partido.
      </div>
    `;

    pintarTrivias([]);
  }

  async function cargarDatosJornadaYOficiales() {
    jornadaData = null;
    oficialesJornada = [];

    try {
      const jornadaRes = await fetch(`/api/jornadas/${encodeURIComponent(jornadaTrivia)}`);
      if (jornadaRes.ok) {
        jornadaData = await jornadaRes.json();
      }

      const oficialesRes = await fetch('/api/resultados-oficiales');
      const oficialesData = await oficialesRes.json();

      const oficial = oficialesData.find(o => o.nombre === jornadaTrivia);
      oficialesJornada = oficial ? oficial.partidos : [];
    } catch (error) {
      console.error('Error cargando jornada/oficiales:', error);
    }
  }

  function obtenerPartidoBase(trivia) {
    return jornadaData?.partidos?.[Number(trivia.partidoIndex)] || null;
  }

  function buscarOficial(partidoBase, trivia) {
    if (!partidoBase && !trivia) return null;

    const equipo1 = partidoBase?.equipo1 || trivia?.equipo1;
    const equipo2 = partidoBase?.equipo2 || trivia?.equipo2;

    return oficialesJornada.find(o =>
      (o.equipo1 === equipo1 && o.equipo2 === equipo2) ||
      (o.equipo1 === equipo2 && o.equipo2 === equipo1)
    );
  }

  function obtenerFechaPartido(apiDate) {
  if (!apiDate) return null;

  const raw = String(apiDate).trim();

  // Si algún día viene con zona horaria incluida
  // respetamos esa zona
  if (raw.includes('T') && /Z|[+-]\d{2}:\d{2}$/.test(raw)) {
    const fecha = new Date(raw);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  // apiDate viene de APIFootball como hora Costa Rica
  const limpio = raw.replace(' ', 'T');

  const fecha = new Date(`${limpio}:00-06:00`);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha;
}


  function formatearFechaPartido(apiDate) {
    const fecha = obtenerFechaPartido(apiDate);

    if (!fecha) return 'Fecha no disponible';

    return fecha.toLocaleString('es-CR', {
      timeZone: 'America/Costa_Rica',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  function triviaBloqueada(trivia) {
    const partidoBase = obtenerPartidoBase(trivia);
    const oficial = buscarOficial(partidoBase, trivia);

    if (oficial && ['LIVE', 'MT', 'TC'].includes(oficial.estado)) {
      return true;
    }

    const fecha = obtenerFechaPartido(partidoBase?.apiDate);

    if (!fecha) return false;

    return fecha <= new Date();
  }

  function estadoTriviaHTML(trivia) {
    const partidoBase = obtenerPartidoBase(trivia);
    const bloqueada = triviaBloqueada(trivia);
    const fecha = obtenerFechaPartido(partidoBase?.apiDate);

    if (bloqueada) {
      return `
        <div class="match-meta" style="justify-content:center; margin-bottom:10px;">
          <span>📅 ${formatearFechaPartido(partidoBase?.apiDate)}</span>
          <span class="status-pill status-finished">🔒 Trivia cerrada</span>
        </div>
      `;
    }

    if (!fecha) {
      return `
        <div class="match-meta" style="justify-content:center; margin-bottom:10px;">
          <span>📅 Fecha no disponible</span>
          <span class="status-pill status-scheduled">Disponible</span>
        </div>
      `;
    }

    return `
      <div class="match-meta" style="justify-content:center; margin-bottom:10px;">
        <span>📅 ${formatearFechaPartido(partidoBase?.apiDate)}</span>
        <span class="status-pill status-scheduled">Disponible</span>
        <span>
          ⏳ Cierra en:
          <strong class="contador-trivia-partido" data-fecha="${fecha.toISOString()}"></strong>
        </span>
      </div>
    `;
  }

  function iniciarContadores() {
    if (intervaloContadores) clearInterval(intervaloContadores);

    intervaloContadores = setInterval(() => {
      document.querySelectorAll('.contador-trivia-partido').forEach(span => {
        const fecha = new Date(span.dataset.fecha);
        const diff = fecha - new Date();

        if (diff <= 0) {
          span.textContent = 'Trivia cerrada';
          return;
        }

        const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
        const horas = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const segundos = Math.floor((diff % (1000 * 60)) / 1000);

        span.textContent = dias > 0
          ? `${dias}d ${horas}h ${minutos}m ${segundos}s`
          : `${horas}h ${minutos}m ${segundos}s`;
      });
    }, 1000);
  }

  async function validarJugadorSeleccionado() {
    const jugador = jugadorSelect.value;

    jugadorValidado = null;
    mensaje.textContent = '';
    limpiarRespuestas();

    if (!jugador) return;

    const jugadorData = await fetch(`/api/jugador/${encodeURIComponent(jugador)}`).then(r => r.json());

    if (!jugadorData.password) {
      alert('Su jugador no tiene contraseña aún, hable con el administrador.');
      jugadorSelect.value = '';
      return;
    }

    let passwordCorrecta = false;

    while (!passwordCorrecta) {
      const passwordIngresada = await pedirPasswordModal();

      if (passwordIngresada === null) {
        jugadorSelect.value = '';
        limpiarRespuestas();
        return;
      }

      const resp = await fetch(`/api/jugadores/${encodeURIComponent(jugador)}/verificar-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordIngresada })
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        alert(data.error || 'Contraseña incorrecta');
      } else {
        passwordCorrecta = true;
        jugadorValidado = jugador;
        await cargarRespuestasGuardadas(jugador);
      }
    }
  }

  async function cargarRespuestasGuardadas(jugador) {
    if (!jugador || !jornadaTrivia) return;

    const res = await fetch(
      `/api/respuestas-trivia/${encodeURIComponent(jugador)}/${encodeURIComponent(jornadaTrivia)}`
    );

    const respuestasPrevias = await res.json();
    pintarTrivias(respuestasPrevias);
  }

  function respuestaPrevia(respuestasPrevias, triviaId) {
    const encontrada = respuestasPrevias.find(r => String(r.triviaId) === String(triviaId));
    return encontrada ? encontrada.respuesta : '';
  }

  function pintarTrivias(respuestasPrevias = []) {
    const grupos = {};

    trivias.forEach(trivia => {
      const key = `${trivia.partidoIndex}_${trivia.equipo1} vs ${trivia.equipo2}`;

      if (!grupos[key]) {
        grupos[key] = {
          titulo: `${trivia.equipo1} vs ${trivia.equipo2}`,
          trivias: []
        };
      }

      grupos[key].trivias.push(trivia);
    });

    triviasContainer.innerHTML = Object.keys(grupos).map(key => {
      const grupo = grupos[key];
      const primeraTrivia = grupo.trivias[0];
      const partidoCerrado = triviaBloqueada(primeraTrivia);

      return `
        <div class="trivia-match-card ${partidoCerrado ? 'partido-cerrado' : ''}">
          ${estadoTriviaHTML(primeraTrivia)}

          <h3>${grupo.titulo}</h3>

          ${grupo.trivias.map(trivia => {
            const previa = respuestaPrevia(respuestasPrevias, trivia._id);
            const bloqueada = triviaBloqueada(trivia);

            return `
              <div class="trivia-question-card">
                <p>${trivia.pregunta}</p>

                <select
                  class="respuesta-trivia"
                  data-trivia-id="${trivia._id}"
                  ${bloqueada ? 'disabled' : ''}
                >
                  <option value="">Seleccione respuesta</option>
                  ${trivia.opciones.map(opcion => `
                    <option value="${opcion}" ${previa === opcion ? 'selected' : ''}>
                      ${opcion}
                    </option>
                  `).join('')}
                </select>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }).join('');

    iniciarContadores();
  }

  function limpiarRespuestas() {
    document.querySelectorAll('.respuesta-trivia').forEach(select => {
      if (!select.disabled) {
        select.value = '';
      }
    });
  }

  function pedirPasswordModal() {
    return new Promise(resolve => {
      const modal = document.getElementById('modalPassword');
      const input = document.getElementById('inputPassword');
      const btnOk = document.getElementById('btnPasswordOk');
      const btnCancel = document.getElementById('btnPasswordCancel');

      modal.style.display = 'flex';
      input.value = '';
      input.focus();

      function cerrarModal() {
        modal.style.display = 'none';
        btnOk.removeEventListener('click', okHandler);
        btnCancel.removeEventListener('click', cancelHandler);
        input.removeEventListener('keydown', enterHandler);
      }

      function okHandler() {
        const val = input.value;
        cerrarModal();
        resolve(val);
      }

      function cancelHandler() {
        cerrarModal();
        resolve(null);
      }

      function enterHandler(e) {
        if (e.key === 'Enter') {
          okHandler();
        }
      }

      btnOk.addEventListener('click', okHandler);
      btnCancel.addEventListener('click', cancelHandler);
      input.addEventListener('keydown', enterHandler);
    });
  }

  async function guardarRespuestas() {
    mensaje.textContent = '';

    if (!trivias || trivias.length === 0) {
      alert('No hay trivias disponibles.');
      return;
    }

    const jugador = jugadorSelect.value;

    if (!jugador) {
      alert('Seleccione un jugador.');
      return;
    }

    if (jugador !== jugadorValidado) {
      alert('Debe seleccionar el jugador y validar la contraseña antes de guardar.');
      return;
    }

    const selectsEditables = Array.from(document.querySelectorAll('.respuesta-trivia'))
      .filter(select => !select.disabled);

    const respuestas = selectsEditables
      .map(select => ({
        triviaId: select.dataset.triviaId,
        respuesta: select.value
      }))
      .filter(item => item.respuesta);

    if (respuestas.length === 0) {
      alert('Debe responder al menos una trivia abierta.');
      return;
    }

    const faltantes = selectsEditables.length - respuestas.length;

    if (faltantes > 0) {
      const continuar = confirm(
        'Faltan trivias abiertas por responder.\n\n¿Está seguro que desea guardar?'
      );

      if (!continuar) return;
    }

    const res = await fetch('/api/respuestas-trivia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador, respuestas })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Error guardando trivias.');
      return;
    }

    alert('Trivias guardadas correctamente.');
    mensaje.textContent = data.mensaje || 'Trivias guardadas correctamente.';

    await cargarRespuestasGuardadas(jugador);
  }
});
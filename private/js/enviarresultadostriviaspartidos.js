let textoResultado = '';
let triviasCache = [];
let respuestasCache = [];

document.addEventListener('DOMContentLoaded', () => {
  const jornadaSelect = document.getElementById('jornadaSelect');
  const partidoSelect = document.getElementById('partidoSelect');
  const copiarButton = document.getElementById('copiarResultadosButton');
  const whatsappButton = document.getElementById('enviarWhatsappButton');
  const resultadoTexto = document.getElementById('resultadoTexto');

  async function cargarJornadas() {
    try {
      const res = await fetch('/api/trivias-jornadas');
      const jornadas = await res.json();

      jornadaSelect.innerHTML = '<option value="">-- Selecciona --</option>';

      jornadas.forEach(j => {
        const option = document.createElement('option');
        option.value = j.jornadaNombre;
        option.textContent = j.jornadaNombre;
        jornadaSelect.appendChild(option);
      });

    } catch (err) {
      console.error('Error cargando jornadas con trivias:', err);
      alert('Error cargando jornadas con trivias');
    }
  }

  async function cargarPartidosDeJornada() {
    const jornada = jornadaSelect.value;

    partidoSelect.innerHTML = '<option value="">-- Selecciona partido --</option>';
    resultadoTexto.value = '';
    textoResultado = '';
    triviasCache = [];
    respuestasCache = [];

    if (!jornada) return;

    try {
      const res = await fetch(
        `/api/admin/respuestas-trivias-jornada/${encodeURIComponent(jornada)}`
      );

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Error cargando trivias');
        return;
      }

      triviasCache = data.trivias || [];
      respuestasCache = data.respuestas || [];

      const partidosMap = new Map();

      triviasCache.forEach(trivia => {
        const key = `${trivia.partidoIndex}_${trivia.equipo1}_vs_${trivia.equipo2}`;

        if (!partidosMap.has(key)) {
          partidosMap.set(key, {
            partidoIndex: trivia.partidoIndex,
            equipo1: trivia.equipo1,
            equipo2: trivia.equipo2
          });
        }
      });

      partidosMap.forEach(partido => {
        const option = document.createElement('option');
        option.value = partido.partidoIndex;
        option.textContent = `${partido.equipo1} vs ${partido.equipo2}`;
        partidoSelect.appendChild(option);
      });

    } catch (err) {
      console.error('Error cargando partidos de trivia:', err);
      alert('Error cargando partidos de trivia');
    }
  }

  function respuestaDeJugador(respuestas, jugador, triviaId) {
    const r = respuestas.find(resp =>
      resp.jugador === jugador &&
      String(resp.triviaId) === String(triviaId)
    );

    return r ? r.respuesta : 'Sin responder';
  }

  async function copiarResultados() {
    const jornadaSeleccionada = jornadaSelect.value;
    const partidoIndex = partidoSelect.value;

    if (!jornadaSeleccionada) {
      alert('Selecciona una jornada');
      return;
    }

    if (partidoIndex === '') {
      alert('Selecciona un partido');
      return;
    }

    const triviasPartido = triviasCache.filter(t =>
      String(t.partidoIndex) === String(partidoIndex)
    );

    if (triviasPartido.length === 0) {
      textoResultado = 'No hay trivias creadas para este partido.';
      resultadoTexto.value = textoResultado;
      return;
    }

    const partidoTitulo = `${triviasPartido[0].equipo1} vs ${triviasPartido[0].equipo2}`;
    const jugadores = [...new Set(respuestasCache.map(r => r.jugador))].sort();

    textoResultado = '';
    textoResultado += `===============================\n`;
    textoResultado += `TRIVIAS - ${jornadaSeleccionada}\n`;
    textoResultado += `Partido: ${partidoTitulo}\n`;
    textoResultado += `===============================\n\n`;

    if (jugadores.length === 0) {
      textoResultado += 'Aún no hay respuestas registradas para este partido.\n';
    } else {
      jugadores.forEach(jugador => {
        textoResultado += `-------------------------------\n`;
        textoResultado += `Nombre: ${jugador}\n`;
        textoResultado += `-------------------------------\n`;

        triviasPartido.forEach((trivia, index) => {
          const respuesta = respuestaDeJugador(respuestasCache, jugador, trivia._id);

          textoResultado += `${index + 1}. ${trivia.pregunta}\n`;
          textoResultado += `   Respuesta: ${respuesta}\n`;
        });

        textoResultado += `\n`;
      });
    }

    resultadoTexto.value = textoResultado;

    await navigator.clipboard.writeText(textoResultado);

    alert('Respuestas de trivias copiadas al portapapeles');
  }

  function enviarWhatsApp() {
    if (!textoResultado) {
      alert('Primero genera las respuestas copiándolas');
      return;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(textoResultado)}`;
    window.open(url, '_blank');
  }

  jornadaSelect.addEventListener('change', cargarPartidosDeJornada);
  copiarButton.addEventListener('click', copiarResultados);
  whatsappButton.addEventListener('click', enviarWhatsApp);

  cargarJornadas();
});
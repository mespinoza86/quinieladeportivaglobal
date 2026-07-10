let textoResultado = '';

document.addEventListener('DOMContentLoaded', () => {
  const jornadaSelect = document.getElementById('jornadaSelect');
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

  function respuestaDeJugador(respuestas, jugador, triviaId) {
    const r = respuestas.find(resp =>
      resp.jugador === jugador &&
      String(resp.triviaId) === String(triviaId)
    );

    return r ? r.respuesta : 'Sin responder';
  }

  async function copiarResultados() {
    const jornadaSeleccionada = jornadaSelect.value;

    if (!jornadaSeleccionada) {
      alert('Selecciona una jornada');
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/respuestas-trivias-jornada/${encodeURIComponent(jornadaSeleccionada)}`
      );

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Error cargando respuestas de trivias');
        return;
      }

      const trivias = data.trivias || [];
      const respuestas = data.respuestas || [];

      if (trivias.length === 0) {
        textoResultado = 'No hay trivias creadas para esta jornada.';
        resultadoTexto.value = textoResultado;
        return;
      }

      const jugadores = [...new Set(respuestas.map(r => r.jugador))].sort();

      textoResultado = '';
      textoResultado += `===============================\n`;
      textoResultado += `TRIVIAS - ${jornadaSeleccionada}\n`;
      textoResultado += `===============================\n\n`;

      jugadores.forEach(jugador => {
        textoResultado += `-------------------------------\n`;
        textoResultado += `Nombre: ${jugador}\n`;
        textoResultado += `-------------------------------\n`;

        let partidoActual = '';

        trivias.forEach((trivia, index) => {
          const partido = `${trivia.equipo1} vs ${trivia.equipo2}`;

          if (partido !== partidoActual) {
            partidoActual = partido;
            textoResultado += `\n${partido}\n`;
          }

          const respuesta = respuestaDeJugador(respuestas, jugador, trivia._id);

          textoResultado += `${index + 1}. ${trivia.pregunta}\n`;
          textoResultado += `   Respuesta: ${respuesta}\n`;
        });

        textoResultado += `\n`;
      });

      if (jugadores.length === 0) {
        textoResultado += 'Aún no hay respuestas registradas para esta jornada.\n';
      }

      resultadoTexto.value = textoResultado;

      await navigator.clipboard.writeText(textoResultado);

      alert('Respuestas de trivias copiadas al portapapeles');

    } catch (err) {
      console.error('Error copiando respuestas de trivias:', err);
      alert('Error al copiar respuestas de trivias');
    }
  }

  function enviarWhatsApp() {
    if (!textoResultado) {
      alert('Primero genera las respuestas copiándolas');
      return;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(textoResultado)}`;
    window.open(url, '_blank');
  }

  copiarButton.addEventListener('click', copiarResultados);
  whatsappButton.addEventListener('click', enviarWhatsApp);

  cargarJornadas();
});
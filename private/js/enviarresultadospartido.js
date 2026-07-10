let textoResultado = '';
let jornadasCache = [];

document.addEventListener('DOMContentLoaded', () => {
  const jornadaSelect = document.getElementById('jornadaSelect');
  const partidoSelect = document.getElementById('partidoSelect');
  const copiarButton = document.getElementById('copiarResultadosButton');
  const whatsappButton = document.getElementById('enviarWhatsappButton');
  const resultadoTexto = document.getElementById('resultadoTexto');

  async function cargarJornadas() {
    try {
      const res = await fetch('/api/jornadas');
      jornadasCache = await res.json();

      jornadaSelect.innerHTML = '<option value="">-- Selecciona --</option>';

      jornadasCache.forEach(j => {
        const option = document.createElement('option');
        option.value = j.nombre;
        option.textContent = j.nombre;
        jornadaSelect.appendChild(option);
      });

    } catch (err) {
      console.error('Error cargando jornadas:', err);
      alert('Error cargando jornadas');
    }
  }

  function cargarPartidos() {
    const jornadaNombre = jornadaSelect.value;
    const jornada = jornadasCache.find(j => j.nombre === jornadaNombre);

    partidoSelect.innerHTML = '<option value="">-- Selecciona partido --</option>';

    if (!jornada || !Array.isArray(jornada.partidos)) return;

    jornada.partidos.forEach((p, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${index + 1}. ${p.equipo1} vs ${p.equipo2}`;
      partidoSelect.appendChild(option);
    });
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

    try {
      const jornada = jornadasCache.find(j => j.nombre === jornadaSeleccionada);
      const partido = jornada.partidos[Number(partidoIndex)];

      const jugadoresRes = await fetch('/api/jugadores');
      const jugadores = await jugadoresRes.json();

      textoResultado = '';

      textoResultado += `-------------------------------\n`;
      textoResultado += `Jornada: ${jornadaSeleccionada}\n`;
      textoResultado += `Partido: ${partido.equipo1} vs ${partido.equipo2}\n`;
      textoResultado += `-------------------------------\n\n`;

      for (const jugador of jugadores) {
        const resJugador = await fetch(
          `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornadaSeleccionada)}`
        );

        if (resJugador.status === 404) continue;

        const pronosticos = await resJugador.json();

        if (!Array.isArray(pronosticos) || !pronosticos[Number(partidoIndex)]) continue;

        const p = pronosticos[Number(partidoIndex)];

        textoResultado += `${jugador}: ${p.equipo1} ${p.marcador1 || '0'} - ${p.marcador2 || '0'} ${p.equipo2}\n`;
      }

      if (!textoResultado.trim()) {
        textoResultado = 'No hay resultados disponibles para este partido.';
      }

      resultadoTexto.value = textoResultado;
      await navigator.clipboard.writeText(textoResultado);

      alert('Resultados del partido copiados al portapapeles');

    } catch (err) {
      console.error('Error copiando resultados por partido:', err);
      alert('Error al copiar resultados por partido');
    }
  }

  function enviarWhatsApp() {
    if (!textoResultado) {
      alert('Primero genera los resultados copiándolos');
      return;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(textoResultado)}`;
    window.open(url, '_blank');
  }

  jornadaSelect.addEventListener('change', cargarPartidos);
  copiarButton.addEventListener('click', copiarResultados);
  whatsappButton.addEventListener('click', enviarWhatsApp);

  cargarJornadas();
});
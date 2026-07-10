document.addEventListener('DOMContentLoaded', () => {
  const { jsPDF } = window.jspdf;

  const jornadaSelect = document.getElementById('jornadaSelect');
  const generarPdfBtn = document.getElementById('generarPdfBtn');

  function limpiarTexto(texto) {
    return (texto || '')
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function cargarJornadas() {
    const res = await fetch('/api/jornadas');
    const jornadas = await res.json();

    jornadaSelect.innerHTML = '';

    jornadas.forEach(j => {
      const opt = document.createElement('option');
      opt.value = j.nombre;
      opt.textContent = j.nombre;
      jornadaSelect.appendChild(opt);
    });
  }

  async function cargarJugadores() {
    const res = await fetch('/api/jugadores');
    return await res.json();
  }

  async function cargarResultados() {
    const res = await fetch('/api/resultados');
    return await res.json();
  }

  async function cargarResultadosOficiales() {
    const res = await fetch('/api/resultados-oficiales');
    return await res.json();
  }

  async function cargarJornada(nombre) {
    const res = await fetch(`/api/jornadas/${encodeURIComponent(nombre)}`);
    return await res.json();
  }

  function determinarResultado(marcador1, marcador2) {
    if (marcador1 > marcador2) return 'gano';
    if (marcador1 < marcador2) return 'perdio';
    return 'empato';
  }

  function calcularPuntosPronosticados(pronosticado, oficial) {
    if (
      !pronosticado || !oficial ||
      pronosticado.marcador1 === "" || pronosticado.marcador2 === "" ||
      oficial.marcador1 === "" || oficial.marcador2 === "" ||
      pronosticado.marcador1 == null || pronosticado.marcador2 == null ||
      oficial.marcador1 == null || oficial.marcador2 == null
    ) return 0;

    const marcador1Oficial = parseInt(oficial.marcador1, 10);
    const marcador2Oficial = parseInt(oficial.marcador2, 10);
    const marcador1Pronostico = parseInt(pronosticado.marcador1, 10);
    const marcador2Pronostico = parseInt(pronosticado.marcador2, 10);
    const comodin = oficial.comodin || false;

    const resultadoOficialEquipo1 = determinarResultado(marcador1Oficial, marcador2Oficial);
    const resultadoPronosticoEquipo1 = determinarResultado(marcador1Pronostico, marcador2Pronostico);

    let puntosJornada = 0;

    if (resultadoOficialEquipo1 === resultadoPronosticoEquipo1) {
      puntosJornada += comodin ? 4 : 3;
    }

    if (
      marcador1Oficial === marcador1Pronostico &&
      marcador2Oficial === marcador2Pronostico
    ) {
      puntosJornada += comodin ? 3 : 2;
    }

    return puntosJornada;
  }

  function buscarPartidoPorEquipos(partidos, equipo1, equipo2) {
    return partidos.find(p =>
      (p.equipo1 === equipo1 && p.equipo2 === equipo2) ||
      (p.equipo1 === equipo2 && p.equipo2 === equipo1)
    );
  }

  generarPdfBtn.addEventListener('click', async () => {
    const jornadaSeleccionada = jornadaSelect.value;

    if (!jornadaSeleccionada) {
      alert('Selecciona una jornada primero');
      return;
    }

    const jugadores = await cargarJugadores();
    const resultados = await cargarResultados();
    const resultadosOficiales = await cargarResultadosOficiales();
    const jornadaData = await cargarJornada(jornadaSeleccionada);

    const partidosJornada = jornadaData.partidos || [];
    const jornadaOficial = resultadosOficiales.find(j => j.nombre === jornadaSeleccionada);

    if (!jornadaOficial) {
      alert('No se encontraron resultados oficiales para la jornada');
      return;
    }

    const partidosOficial = jornadaOficial.partidos || [];

    const doc = new jsPDF();
    doc.setFont("times", "normal");
    doc.setFontSize(16);
    doc.text(`Resultados y Pronosticos - ${limpiarTexto(jornadaSeleccionada)}`, 10, 10);

    let y = 20;

    doc.setFontSize(14);
    doc.text('Marcador Oficial:', 10, y);
    y += 8;

    partidosOficial.forEach(p => {
      const texto = `${limpiarTexto(p.equipo1)} ${p.marcador1} - ${p.marcador2} ${limpiarTexto(p.equipo2)}`;
      doc.text(texto, 10, y);
      y += 6;
    });

    y += 10;

    for (const jugador of jugadores) {
      doc.setFont("times", "bold");
      doc.setFontSize(14);
      doc.text(`Jugador: ${limpiarTexto(jugador)}`, 10, y);
      y += 4;

      doc.setLineWidth(0.5);
      doc.line(10, y, 200, y);
      y += 8;

      const clave = `${jugador}_${jornadaSeleccionada}`;
      const resultadoJugador = resultados.find(r => r[0] === clave);

      if (!resultadoJugador) {
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        doc.text('No hay pronosticos para esta jornada.', 10, y);
        y += 10;
        continue;
      }

      const partidosPronosticados = resultadoJugador[1];
      let puntosTotales = 0;

      doc.setFont("times", "normal");
      doc.setFontSize(12);
      doc.text('Partido', 10, y);
      doc.text('Pronostico', 90, y);
      doc.text('Oficial', 125, y);
      doc.text('Pts', 170, y);
      y += 4;

      doc.setLineWidth(0.3);
      doc.line(10, y, 200, y);
      y += 6;

      partidosPronosticados.forEach((pron, index) => {
        const partidoBase = partidosJornada[index];

        if (!partidoBase) return;

        const pronConEquipos = {
          ...pron,
          equipo1: partidoBase.equipo1,
          equipo2: partidoBase.equipo2
        };

        const partidoOficial = buscarPartidoPorEquipos(
          partidosOficial,
          partidoBase.equipo1,
          partidoBase.equipo2
        );

        let oficialParaCalculo = partidoOficial;

        if (
          partidoOficial &&
          partidoOficial.equipo1 === partidoBase.equipo2 &&
          partidoOficial.equipo2 === partidoBase.equipo1
        ) {
          oficialParaCalculo = {
            ...partidoOficial,
            equipo1: partidoBase.equipo1,
            equipo2: partidoBase.equipo2,
            marcador1: partidoOficial.marcador2,
            marcador2: partidoOficial.marcador1
          };
        }

        const puntos = oficialParaCalculo
          ? calcularPuntosPronosticados(pronConEquipos, oficialParaCalculo)
          : 0;

        puntosTotales += puntos;

        const partidoStr = `${limpiarTexto(partidoBase.equipo1)} vs ${limpiarTexto(partidoBase.equipo2)}`;
        const pronosticoStr = `${pron.marcador1} - ${pron.marcador2}`;
        const oficialStr = oficialParaCalculo
          ? `${oficialParaCalculo.marcador1} - ${oficialParaCalculo.marcador2}`
          : 'N/A';

        doc.setFont("times", "normal");
        doc.text(partidoStr, 10, y);
        doc.text(pronosticoStr, 90, y);
        doc.text(oficialStr, 125, y);
        doc.text(String(puntos), 170, y);
        y += 6;

        if (index === partidosPronosticados.length - 1) {
          doc.setLineWidth(0.3);
          doc.line(10, y, 200, y);
          y += 8;
        }

        if (y > 280) {
          doc.addPage();
          doc.setFont("times", "normal");
          y = 10;
        }
      });

      doc.setLineWidth(0.5);
      doc.line(10, y, 200, y);
      y += 6;

      doc.setFont("times", "bold");
      doc.setFontSize(13);
      doc.text(`Puntos totales: ${puntosTotales}`, 10, y);
      y += 8;

      doc.setLineWidth(0.5);
      doc.line(10, y, 200, y);
      y += 10;

      if (y > 280) {
        doc.addPage();
        doc.setFont("times", "normal");
        y = 10;
      }
    }

    doc.save(`Resultados_${limpiarTexto(jornadaSeleccionada)}.pdf`);
  });

  cargarJornadas();
});
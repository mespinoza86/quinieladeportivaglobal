document.addEventListener('DOMContentLoaded', () => {
  const { jsPDF } = window.jspdf;

  const jornadaSelect = document.getElementById('jornadaSelect');
  const generarPdfBtn = document.getElementById('generarPdfBtn');
  let puntuacion = { marcadorExacto: 5, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4 };
  fetch('/api/quiniela-actual').then(r => r.json()).then(q => { puntuacion = { ...puntuacion, ...q.configuracion?.puntuacion }; });

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

    if (
      marcador1Oficial === marcador1Pronostico &&
      marcador2Oficial === marcador2Pronostico
    ) {
      return comodin ? puntuacion.comodinExacto : puntuacion.marcadorExacto;
    }
    return resultadoOficialEquipo1 === resultadoPronosticoEquipo1
      ? (comodin ? puntuacion.comodinResultado : puntuacion.resultadoCorrecto)
      : 0;
  }

  /*
   * ⛔ POR EL ID DEL PARTIDO, NUNCA POR LOS NOMBRES.
   *
   * Se llamaba `buscarPartidoPorEquipos` y hacía exactamente eso: cruzar por el
   * nombre de los equipos aceptando el orden invertido. El 13 de noviembre de
   * 2026 la Jornada 13 era de eliminatorias de IDA Y VUELTA —«Colombia vs
   * Chile» el día 13 y «Chile vs Colombia» el 17— y cada partido se llevaba el
   * oficial de su espejo. En este archivo eso salía impreso en el PDF.
   *
   * El comentario largo está en `llenar_jornada_user.js`.
   */
  function buscarOficialDelPartido(partidosOficial, partidoBase) {
    if (!partidoBase?.id) return undefined;
    return partidosOficial.find(p => p.partidoId === partidoBase.id);
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

        const partidoOficial = buscarOficialDelPartido(partidosOficial, partidoBase);

        /*
         * ⛔ AQUÍ SE VOLTEABA EL MARCADOR SI EL OFICIAL VENÍA «AL REVÉS», Y ESO
         * NO PUEDE PASAR.
         *
         * `/api/resultados-oficiales` saca los equipos de la MISMA fila de
         * `partidos` que `/api/jornadas/:nombre`, así que vienen en el mismo
         * orden por construcción.
         *
         * ⚠️ Y mientras el cruce se hacía por nombres aceptando el orden
         * invertido, este bloque sí se disparaba —con el oficial del partido
         * equivocado— y además le daba la vuelta al marcador. Dos errores que
         * se tapaban entre ellos, y acababan impresos en el PDF.
         *
         * ⭐ Que el PROVEEDOR mande local y visitante al revés sí pasa, y se
         * arregla en `sincronizador.reescribirJornadaDesdeCache`, antes de
         * guardar. Cuando llega aquí ya está en nuestra orientación.
         */
        const oficialParaCalculo = partidoOficial;

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

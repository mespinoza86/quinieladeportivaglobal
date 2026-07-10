document.addEventListener("DOMContentLoaded", async function () {
    try {
        const jornadaSelect = document.getElementById('jornada-select');
        const verResultadosBtn = document.getElementById('ver-resultados-btn');
        const resultadosCards = document.getElementById('resultados-cards');

        let resultadosData = await fetch('/api/resultados').then(r => r.json());
        let oficialesData = await fetch('/api/resultados-oficiales').then(r => r.json());
        let jornadasData = await fetch('/api/jornadas').then(r => r.json());

        function mostrarMensaje(mensaje) {
            resultadosCards.innerHTML = `<div class="resultados-mensaje">${mensaje}</div>`;
        }

        function jornadaTienePartidosCerrados(jornada) {
            if (!jornada || !Array.isArray(jornada.partidos)) return false;

            return jornada.partidos.some(partido => {
                if (!partido.apiDate) return false;

                const fecha = new Date(String(partido.apiDate).replace(' ', 'T'));

                if (Number.isNaN(fecha.getTime())) return false;

                return fecha <= new Date();
            });
        }

        jornadaSelect.innerHTML = '';

        jornadasData.forEach(jornada => {
            const option = document.createElement('option');
            option.value = jornada.nombre;
            option.textContent = jornada.nombre;
            option.dataset.cerrada = jornadaTienePartidosCerrados(jornada) ? 'true' : 'false';
            jornadaSelect.appendChild(option);
        });

        const jornadasConPartidosCerrados = jornadasData.filter(jornadaTienePartidosCerrados);

        if (jornadasConPartidosCerrados.length > 0) {
            const ultimaJornada = jornadasConPartidosCerrados[jornadasConPartidosCerrados.length - 1].nombre;
            jornadaSelect.value = ultimaJornada;
            mostrarResultados(ultimaJornada, resultadosData, oficialesData);
        } else {
            mostrarMensaje('Todavía no hay partidos cerrados para mostrar.');
        }

        async function intentarMostrarJornadaSeleccionada() {
            const selectedOption = jornadaSelect.options[jornadaSelect.selectedIndex];

            if (!selectedOption || selectedOption.dataset.cerrada !== 'true') {
                mostrarMensaje('Todavía no hay partidos cerrados en esta jornada.');
                return;
            }

            mostrarResultados(jornadaSelect.value, resultadosData, oficialesData);
        }

        async function refrescarResultadosActuales() {
            resultadosData = await fetch('/api/resultados').then(r => r.json());
            oficialesData = await fetch('/api/resultados-oficiales').then(r => r.json());
            jornadasData = await fetch('/api/jornadas').then(r => r.json());

            const jornadaSeleccionada = jornadaSelect.value;
            const jornadaActual = jornadasData.find(j => j.nombre === jornadaSeleccionada);

            if (!jornadaActual || !jornadaTienePartidosCerrados(jornadaActual)) return;

            mostrarResultados(jornadaSeleccionada, resultadosData, oficialesData);
        }

        verResultadosBtn.addEventListener('click', intentarMostrarJornadaSeleccionada);
        jornadaSelect.addEventListener('change', intentarMostrarJornadaSeleccionada);

        document.getElementById('volver-btn-top').addEventListener('click', () => {
            window.location.href = '/index.html';
        });

        document.getElementById('volver-btn-bottom').addEventListener('click', () => {
            window.location.href = '/index.html';
        });

        setInterval(refrescarResultadosActuales, 30000);

    } catch (error) {
        console.error("Error al cargar los datos:", error);
    }
});

async function obtenerPartidosJornada(jornada) {
    const response = await fetch(`/api/jornadas/${encodeURIComponent(jornada)}`);

    if (!response.ok) {
        console.error("No se pudo obtener la información de la jornada");
        return { partidos: [] };
    }

    return await response.json();
}

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

function formatearFechaPartido(apiDate) {
    if (!apiDate) return 'Fecha no disponible';

    const fecha = new Date(String(apiDate).replace(' ', 'T'));

    if (Number.isNaN(fecha.getTime())) return apiDate;

    return fecha.toLocaleString('es-CR', {
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
        return `<span class="status-pill status-live"><span class="live-dot"></span>${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}</span>`;
    }

    return `<span class="status-pill status-scheduled">${formatearFecha(partido.fecha)}</span>`;
}

function buscarOficialPorPartido(resultadosOficiales, partidoBase) {
    return resultadosOficiales.find(p =>
        (p.equipo1 === partidoBase.equipo1 && p.equipo2 === partidoBase.equipo2) ||
        (p.equipo1 === partidoBase.equipo2 && p.equipo2 === partidoBase.equipo1)
    );
}

function normalizarOficial(partidoOficial, partidoBase) {
    if (!partidoOficial) return null;

    const invertido =
        partidoOficial.equipo1 === partidoBase.equipo2 &&
        partidoOficial.equipo2 === partidoBase.equipo1;

    if (!invertido) return partidoOficial;

    return {
        ...partidoOficial,
        equipo1: partidoBase.equipo1,
        equipo2: partidoBase.equipo2,
        marcador1: partidoOficial.marcador2,
        marcador2: partidoOficial.marcador1
    };
}

function partidoYaCerro(partidoBase, partidoOficial) {
    if (partidoOficial && ['LIVE', 'MT', 'TC'].includes(partidoOficial.estado)) {
        return true;
    }

    if (!partidoBase.apiDate) return false;

    const fecha = new Date(String(partidoBase.apiDate).replace(' ', 'T'));

    if (Number.isNaN(fecha.getTime())) return false;

    return fecha <= new Date();
}

function mostrarResultados(jornada, resultadosData, oficialesData) {
    const resultadosCards = document.getElementById('resultados-cards');
    resultadosCards.innerHTML = '';

    const resultadosJornada = resultadosData.filter(jugador => {
        const partes = jugador[0].split('_');
        return partes[1] === jornada;
    });

    const resultadoOficialJornada = oficialesData.find(oficial => oficial.nombre === jornada);
    const resultadosOficiales = resultadoOficialJornada ? resultadoOficialJornada.partidos : [];

    obtenerPartidosJornada(jornada).then(jornadaData => {
        const partidosJornada = jornadaData.partidos || [];
        const partidosMap = new Map();

        resultadosJornada.forEach(jugadorResultados => {
            const keyJugadorJornada = jugadorResultados[0];
            const nombreJugador = keyJugadorJornada.split('_')[0];
            const pronosticos = jugadorResultados[1];

            pronosticos.forEach((pronostico, index) => {
                const partidoBase = partidosJornada[index];
                if (!partidoBase) return;

                const partidoOficialRaw = buscarOficialPorPartido(resultadosOficiales, partidoBase);
                const partidoOficial = normalizarOficial(partidoOficialRaw, partidoBase);

                if (!partidoYaCerro(partidoBase, partidoOficial)) {
                    return;
                }

                const partidoClave = `${partidoBase.equipo1} vs ${partidoBase.equipo2}`;

                if (!partidosMap.has(partidoClave)) {
                    partidosMap.set(partidoClave, {
                        jugadores: [],
                        partido: partidoBase,
                        oficial: partidoOficial
                    });
                }

                partidosMap.get(partidoClave).jugadores.push({
                    nombreJugador,
                    marcador1: pronostico.marcador1,
                    marcador2: pronostico.marcador2
                });
            });
        });

        if (partidosMap.size === 0) {
            resultadosCards.innerHTML = `<div class="resultados-mensaje">Todavía no hay partidos cerrados para mostrar en esta jornada.</div>`;
            return;
        }

        let partidoIndex = 0;

        partidosMap.forEach((data) => {
            partidoIndex++;

            const partidoOficial = data.oficial;
            const grupoId = `detalle-partido-${partidoIndex}`;

            const oficialEquipo1 = partidoOficial ? partidoOficial.equipo1 : data.partido.equipo1;
            const oficialEquipo2 = partidoOficial ? partidoOficial.equipo2 : data.partido.equipo2;
            const oficialMarcador1 = partidoOficial ? marcador(partidoOficial.marcador1) : '-';
            const oficialMarcador2 = partidoOficial ? marcador(partidoOficial.marcador2) : '-';

            const esComodin = !!data.partido.comodin;

            const card = document.createElement('article');
            card.className = `match-card ${esComodin ? 'match-card-comodin' : ''}`;

            card.innerHTML = `
                <div class="match-card-header">
                    ${esComodin ? '<span class="match-comodin-badge">⭐ COMODÍN</span>' : ''}

                    <div class="match-main">
                        <div class="match-left">
                            <div class="match-title ${esComodin ? 'match-title-comodin' : ''}">
                                ${data.partido.equipo1} vs ${data.partido.equipo2}
                            </div>

                            <div class="match-meta">
                                <span>📅 ${formatearFechaPartido(data.partido.apiDate)}</span>
                            </div>
                        </div>

                        <div class="match-score">
                            <span>${oficialEquipo1}</span>
                            <strong>${oficialMarcador1} - ${oficialMarcador2}</strong>
                            <span>${oficialEquipo2}</span>
                        </div>

                        <div class="match-status">
                            ${partidoOficial ? estadoPartidoHTML(partidoOficial) : '<span class="status-pill status-finished">Cerrado</span>'}
                        </div>
                    </div>
                </div>

                <button type="button" class="match-toggle-btn" data-grupo="${grupoId}">
                    <span>Ver resultados</span>
                    <span class="toggle-icon">›</span>
                </button>

                <div class="players-detail" id="${grupoId}">
                    <div class="players-header">
                        <span>Jugador</span>
                        <span>Pronóstico</span>
                        <span>Puntos</span>
                    </div>

                    ${data.jugadores.map(jugador => {
                        const puntosObtenidos = calcularPuntos(
                            { marcador1: jugador.marcador1, marcador2: jugador.marcador2 },
                            partidoOficial
                        );

                        return `
                            <div class="player-row">
                                <span>${jugador.nombreJugador}</span>
                                <span>${data.partido.equipo1} ${marcador(jugador.marcador1)} - ${marcador(jugador.marcador2)} ${data.partido.equipo2}</span>
                                <span>${puntosObtenidos}</span>
                            </div>
                        `;
                    }).join('')}
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
    });
}

function calcularPuntos(pronostico, partidoOficial) {
    let puntos = 0;

    if (!partidoOficial) return puntos;

    const marcador1Pronosticado = parseInt(pronostico.marcador1, 10);
    const marcador2Pronosticado = parseInt(pronostico.marcador2, 10);
    const marcador1Oficial = parseInt(partidoOficial.marcador1, 10);
    const marcador2Oficial = parseInt(partidoOficial.marcador2, 10);
    const esComodin = partidoOficial.comodin || false;

    if (
        !isNaN(marcador1Pronosticado) &&
        !isNaN(marcador2Pronosticado) &&
        !isNaN(marcador1Oficial) &&
        !isNaN(marcador2Oficial)
    ) {
        if (
            marcador1Pronosticado === marcador1Oficial &&
            marcador2Pronosticado === marcador2Oficial
        ) {
            puntos += esComodin ? 7 : 5;
        } else {
            const resultadoPronosticado =
                marcador1Pronosticado === marcador2Pronosticado
                    ? 'empate'
                    : marcador1Pronosticado > marcador2Pronosticado
                        ? 'gana1'
                        : 'gana2';

            const resultadoOficial =
                marcador1Oficial === marcador2Oficial
                    ? 'empate'
                    : marcador1Oficial > marcador2Oficial
                        ? 'gana1'
                        : 'gana2';

            if (resultadoPronosticado === resultadoOficial) {
                puntos += esComodin ? 4 : 3;
            }
        }
    }

    return puntos;
}

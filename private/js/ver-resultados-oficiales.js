document.addEventListener('DOMContentLoaded', () => {
    const jornadaSelect = document.getElementById('jornadaSelect');
    const resultadosOficialesContainer = document.getElementById('resultadosOficialesContainer');
    const searchResultadosOficialesButton = document.getElementById('searchResultadosOficialesButton');

    let resultadosOficialesCache = [];

    function logoHTML(url, nombre) {
        if (!url) return '';
        return `<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
    }

    function marcador(valor) {
        return valor !== null && valor !== undefined && valor !== '' ? valor : '-';
    }

    function formatearFecha(fecha) {
        if (!fecha) return '';

        const d = new Date(fecha);

        if (Number.isNaN(d.getTime())) {
            return fecha;
        }

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
        return `<span class="status-pill status-live">
            <span class="live-dot"></span>
            MT
        </span>`;
    }

    if (partido.estado === 'LIVE' && partido.minuto) {
        return `<span class="status-pill status-live">
            <span class="live-dot"></span>
            ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
        </span>`;
    }

    return `<span class="status-pill status-scheduled">${formatearFecha(partido.fecha)}</span>`;
}


    function renderizarResultados(jornada) {
        const resultados = resultadosOficialesCache.find(r => r.nombre === jornada);

        if (resultados && resultados.partidos && resultados.partidos.length) {
            resultadosOficialesContainer.innerHTML = resultados.partidos.map(partido => `
            <div class="match-card resultado official-result-card ${partido.comodin ? 'official-card-comodin' : ''}">

            <div class="official-status-column">
                ${partido.comodin ? '<span class="official-comodin-badge">⭐ COMODÍN</span>' : '<span>Normal</span>'}
                ${estadoPartidoHTML(partido)}
            </div>


                <div class="match-teams official-teams-column">
                    <div class="team-side">
                        ${logoHTML(partido.logoEquipo1, partido.equipo1)}
                        <strong class="${partido.comodin ? 'official-team-comodin' : ''}">${partido.equipo1}</strong>
                    </div>

                    <span class="match-score">
                        ${marcador(partido.marcador1)} - ${marcador(partido.marcador2)}
                    </span>

                    <div class="team-side">
                        ${logoHTML(partido.logoEquipo2, partido.equipo2)}
                        <strong class="${partido.comodin ? 'official-team-comodin' : ''}">${partido.equipo2}</strong>
                    </div>
                </div>

            </div>
            `).join('');
        } else {
            resultadosOficialesContainer.innerHTML = '<p>No hay resultados oficiales para esta jornada.</p>';
        }
    }

    async function cargarDatosIniciales() {
        try {
            resultadosOficialesContainer.innerHTML = '<p>Cargando resultados oficiales...</p>';

            const jornadasResponse = await fetch('/api/jornadas');
            const jornadas = await jornadasResponse.json();

            jornadaSelect.innerHTML = jornadas
                .map(j => `<option value="${j.nombre}">${j.nombre}</option>`)
                .join('');

            const resultadosResponse = await fetch('/api/resultados-oficiales');
            resultadosOficialesCache = await resultadosResponse.json();



            if (jornadas.length > 0) {
                const jornadaActual = jornadaSelect.value || jornadas[jornadas.length - 1].nombre;

                jornadaSelect.innerHTML = jornadas
                .map(j => `<option value="${j.nombre}">${j.nombre}</option>`)
                .join('');

            jornadaSelect.value = jornadaActual;
            renderizarResultados(jornadaActual);
        }else {
                resultadosOficialesContainer.innerHTML = '<p>No hay jornadas registradas.</p>';
            }

        } catch (error) {
            console.error('Error cargando resultados oficiales:', error);
            resultadosOficialesContainer.innerHTML = '<p>Error cargando resultados oficiales.</p>';
        }
    }

    searchResultadosOficialesButton.addEventListener('click', () => {
        renderizarResultados(jornadaSelect.value);
    });

    jornadaSelect.addEventListener('change', () => {
        renderizarResultados(jornadaSelect.value);
    });

    cargarDatosIniciales();
    setInterval(() => {
    cargarDatosIniciales();
    }, 30000);

});
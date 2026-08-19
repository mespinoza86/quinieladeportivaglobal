document.addEventListener('DOMContentLoaded', () => {
    const jornadaSelect = document.getElementById('jornadaSelect');
    const resultadosOficialesContainer = document.getElementById('resultadosOficialesContainer');
    const searchResultadosOficialesButton = document.getElementById('searchResultadosOficialesButton');

    let resultadosOficialesCache = [];

    function logoHTML(url, nombre) {
        if (!url) return '';
        return html`<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
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
        return html`<span class="status-pill status-finished">TC</span>`;
    }

    if (partido.estado === 'MT') {
        return html`<span class="status-pill status-live">
            <span class="live-dot"></span>
            MT
        </span>`;
    }

    if (partido.estado === 'LIVE' && partido.minuto) {
        return html`<span class="status-pill status-live">
            <span class="live-dot"></span>
            ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
        </span>`;
    }

    return html`<span class="status-pill status-scheduled">${formatearFecha(partido.fecha)}</span>`;
}


    function renderizarResultados(jornada) {
        const resultados = resultadosOficialesCache.find(r => r.nombre === jornada);

        if (resultados && resultados.partidos && resultados.partidos.length) {
            resultadosOficialesContainer.innerHTML = resultados.partidos.map(partido => html`
            <div class="match-card resultado official-result-card ${partido.comodin ? 'official-card-comodin' : ''}">

            <div class="official-status-column">
                ${partido.comodin ? html`<span class="official-comodin-badge">⭐ COMODÍN</span>` : html`<span>Normal</span>`}
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

            /*
             * Fase B. Antes esta pantalla abría en `jornadas[jornadas.length - 1]`
             * —el último elemento del arreglo, sin orden garantizado— y en la
             * práctica dejaba al usuario buscando su jornada a mano. Ahora la
             * sugiere el servidor con la misma regla que las otras dos
             * pantallas: la del partido más próximo sin resultado definitivo.
             *
             * La respuesta trae también los nombres, que es lo único que esta
             * pantalla necesita de las jornadas: los partidos que pinta salen de
             * /api/resultados-oficiales, que es otra cosa.
             */
            const [actualResponse, resultadosResponse] = await Promise.all([
                fetch('/api/jornada-actual'),
                fetch('/api/resultados-oficiales')
            ]);

            const actual = await actualResponse.json();
            resultadosOficialesCache = await resultadosResponse.json();

            const jornadas = actual.jornadas || [];

            if (!jornadas.length) {
                resultadosOficialesContainer.innerHTML = '<p>No hay jornadas registradas.</p>';
                return;
            }

            /*
             * `jornadaSelect.value` primero: esto se recarga solo cada 30
             * segundos, y pisar la jornada que el usuario acaba de elegir con la
             * sugerida sería sacarle de donde estaba mirando cada medio minuto.
             * La sugerencia manda en la primera carga, no en las siguientes.
             */
            const elegida = jornadaSelect.value
                || (jornadas.some(j => j.nombre === actual.sugerida) ? actual.sugerida : jornadas[0].nombre);

            jornadaSelect.innerHTML = jornadas
                .map(j => html`<option value="${j.nombre}">${j.nombre}</option>`)
                .join('');

            jornadaSelect.value = elegida;
            renderizarResultados(elegida);

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
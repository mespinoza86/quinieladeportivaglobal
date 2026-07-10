document.addEventListener('DOMContentLoaded', () => {
    const jornadaSelect = document.getElementById('jornadaSelect');
    const partidosContainer = document.getElementById('partidosContainer');
    const actualizarDesdeApiButton = document.getElementById('actualizarDesdeApiButton');
    const guardarButton = document.getElementById('saveResultadosOficialesButton');
    const estadoSync = document.getElementById('estadoSync');

    function mostrarEstado(mensaje) {
        estadoSync.style.display = 'block';
        estadoSync.textContent = mensaje;
    }

    async function cargarJornadas() {
        const response = await fetch('/api/jornadas');
        const jornadas = await response.json();

        jornadaSelect.innerHTML = jornadas
            .map(jornada => `<option value="${jornada.nombre}">${jornada.nombre}</option>`)
            .join('');

        if (jornadas.length > 0) {
            await cargarResultadosGuardados();
        }
    }

    async function cargarResultadosGuardados() {
        const jornada = jornadaSelect.value;
        if (!jornada) return;

        mostrarEstado('Cargando resultados guardados...');

        try {
            const response = await fetch(`/api/resultados-oficiales/${encodeURIComponent(jornada)}`);
            const data = await response.json();

            if (!response.ok) {
                mostrarEstado(data.error || 'No se pudieron cargar los resultados guardados.');
                return;
            }

            mostrarEstado('Resultados guardados cargados.');
            renderizarResultados(data.partidos || []);

        } catch (error) {
            console.error('Error cargando resultados guardados:', error);
            mostrarEstado('Error cargando resultados guardados.');
        }
    }

    async function actualizarDesdeApi() {
        const jornada = jornadaSelect.value;
        if (!jornada) return;

        mostrarEstado('Actualizando marcadores desde API...');

        try {
            const response = await fetch(`/api/sync-resultados-oficiales/${encodeURIComponent(jornada)}`, {
                method: 'POST'
            });

            const data = await response.json();

            if (!response.ok) {
                mostrarEstado(data.error || 'No se pudo actualizar desde API.');
                return;
            }

            mostrarEstado('Marcadores actualizados desde API. Revisa y guarda si todo está correcto.');
            renderizarResultados(data.resultados || []);

        } catch (error) {
            console.error('Error actualizando desde API:', error);
            mostrarEstado('Error actualizando desde API.');
        }
    }

    function valorInput(valor) {
        return valor !== null && valor !== undefined && valor !== '' ? valor : '';
    }

    function renderizarResultados(partidos) {
        if (!partidos.length) {
            partidosContainer.innerHTML = `
                <div class="info-card">
                    No hay partidos para esta jornada.
                </div>
            `;
            return;
        }

        partidosContainer.innerHTML = partidos.map((partido, index) => `
            <div class="match-card partido" data-comodin="${partido.comodin ? 'true' : 'false'}">
                <div class="match-teams">
                    <div class="team-side">
                        ${partido.logoEquipo1 ? `<img src="${partido.logoEquipo1}" class="team-logo" alt="${partido.equipo1}">` : ''}
                        <strong>${partido.equipo1}</strong>
                    </div>

                    <span class="vs">vs</span>

                    <div class="team-side">
                        ${partido.logoEquipo2 ? `<img src="${partido.logoEquipo2}" class="team-logo" alt="${partido.equipo2}">` : ''}
                        <strong>${partido.equipo2}</strong>
                    </div>
                </div>

                <div class="two-column">
                    <div>
                        <label class="field-label">${partido.equipo1}</label>
                        <input
                            type="number"
                            min="0"
                            class="marcador-input"
                            data-equipo="${partido.equipo1}"
                            value="${valorInput(partido.marcador1)}"
                        />
                    </div>

                    <div>
                        <label class="field-label">${partido.equipo2}</label>
                        <input
                            type="number"
                            min="0"
                            class="marcador-input"
                            data-equipo="${partido.equipo2}"
                            value="${valorInput(partido.marcador2)}"
                        />
                    </div>
                </div>

                <div class="match-meta">
                    <span>${partido.comodin ? 'Comodín' : 'Normal'}</span>
                    <span>Resultado oficial 90 minutos</span>
                </div>
            </div>
        `).join('');
    }

    guardarButton.addEventListener('click', async () => {
        const jornada = jornadaSelect.value;

        const resultados = Array.from(partidosContainer.querySelectorAll('.partido')).map(partido => {
            const inputs = partido.querySelectorAll('input');

        return {
    equipo1: inputs[0].dataset.equipo,
    marcador1: inputs[0].value === '' ? null : Number(inputs[0].value),
    equipo2: inputs[1].dataset.equipo,
    marcador2: inputs[1].value === '' ? null : Number(inputs[1].value),
    comodin: partido.dataset.comodin === 'true',
    estado: 'TC'
};

        });

        const response = await fetch('/api/resultados-oficiales', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ jornada, resultados })
        });

        if (!response.ok) {
            alert('Error guardando resultados oficiales');
            return;
        }

        alert('Resultados oficiales guardados');
    });

    jornadaSelect.addEventListener('change', cargarResultadosGuardados);
    actualizarDesdeApiButton.addEventListener('click', actualizarDesdeApi);

    cargarJornadas();
});
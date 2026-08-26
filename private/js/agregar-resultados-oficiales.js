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
            .map(jornada => html`<option value="${jornada.nombre}">${jornada.nombre}</option>`)
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

        partidosContainer.innerHTML = partidos.map((partido, index) => {
            /*
             * ¿Este partido ya se jugó? Lo dice que esté fijado de antes, o que
             * el proveedor lo dé por terminado. De ahí sale si la casilla viene
             * marcada.
             */
            const yaJugado = partido.final === true || partido.estado === 'TC';

            return html`
            <div class="match-card partido" data-comodin="${partido.comodin ? 'true' : 'false'}">
                <div class="match-teams">
                    <div class="team-side">
                        ${partido.logoEquipo1 ? html`<img src="${partido.logoEquipo1}" class="team-logo" alt="${partido.equipo1}">` : ''}
                        <strong>${partido.equipo1}</strong>
                    </div>

                    <span class="vs">vs</span>

                    <div class="team-side">
                        ${partido.logoEquipo2 ? html`<img src="${partido.logoEquipo2}" class="team-logo" alt="${partido.equipo2}">` : ''}
                        <strong>${partido.equipo2}</strong>
                    </div>
                </div>

                <div class="two-column">
                    <div>
                        <label class="field-label">${partido.equipo1}</label>
                        <input
                            type="number"
                            min="0"
                            max="99"
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
                            max="99"
                            class="marcador-input"
                            data-equipo="${partido.equipo2}"
                            value="${valorInput(partido.marcador2)}"
                        />
                    </div>
                </div>

                ${/*
                   * La casilla viene MARCADA si el partido ya se jugó —fijado
                   * por ti antes, o dado por terminado por el proveedor—. Sin
                   * eso, el uso normal (cargar los resultados el domingo por la
                   * noche) obligaría a marcar diez casillas a mano, y quien
                   * olvide una deja ese partido a merced del proveedor sin
                   * enterarse.
                   *
                   * Se desmarca a propósito cuando el partido NO ha terminado,
                   * que es justo el caso en el que fijarlo sería un error.
                   */''}
                <label class="checkbox-fila">
                    <input type="checkbox" class="marcador-final" ${yaJugado ? 'checked' : ''} />
                    <span>
                        Ya terminó — este resultado es <strong>definitivo</strong>
                        y el proveedor no volverá a cambiarlo
                    </span>
                </label>

                <div class="match-meta">
                    <span>${partido.comodin ? 'Comodín' : 'Normal'}</span>
                    <span>${partido.final
                        ? '🔒 Fijado: el proveedor ya no lo toca'
                        : (yaJugado
                            ? 'Terminado — al guardar quedará fijado'
                            : 'Sin terminar: lo actualiza el proveedor')}</span>
                </div>
            </div>
        `;
        }).join('');
    }

    guardarButton.addEventListener('click', async () => {
        const jornada = jornadaSelect.value;

        const resultados = Array.from(partidosContainer.querySelectorAll('.partido')).map(partido => {
            /*
             * ⚠️ Los marcadores se buscan por CLASE, no por posición.
             *
             * Antes era `partido.querySelectorAll('input')` con `inputs[0]` e
             * `inputs[1]`, y al añadir la casilla de «ya terminó» ese arreglo
             * pasó a tener tres elementos. Leer por posición habría seguido
             * funcionando hoy y se habría roto en cuanto alguien moviera un
             * campo de sitio — sin fallar, cogiendo el input de al lado.
             */
            const marcadores = partido.querySelectorAll('.marcador-input');
            const final = partido.querySelector('.marcador-final');

            return {
                equipo1: marcadores[0].dataset.equipo,
                marcador1: marcadores[0].value === '' ? null : Number(marcadores[0].value),
                equipo2: marcadores[1].dataset.equipo,
                marcador2: marcadores[1].value === '' ? null : Number(marcadores[1].value),
                comodin: partido.dataset.comodin === 'true',
                /*
                 * La casilla es lo que declara que el partido terminó, y es la
                 * única señal que funciona cuando el proveedor está caído y por
                 * tanto nunca va a decir TC. Sin marcar, el resultado se guarda
                 * igual pero el proveedor puede seguir actualizándolo.
                 */
                final: Boolean(final?.checked)
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
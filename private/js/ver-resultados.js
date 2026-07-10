document.addEventListener('DOMContentLoaded', () => {
    const jugadorSelect = document.getElementById('jugadorSelect');
    const jornadaSelect = document.getElementById('jornadaSelect');
    const searchResultadosButton = document.getElementById('searchResultadosButton');
    const resultadosContainer = document.getElementById('resultadosContainer');

    let verTodosAutorizado = false;
    let passwordGuardada = '';

    function logoHTML(url, nombre) {
        if (!url) return '';
        return `<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
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

    function partidoYaCerro(partidoBase, partidoOficial) {
        if (partidoOficial && ['LIVE', 'MT', 'TC'].includes(partidoOficial.estado)) return true;
        if (!partidoBase?.apiDate) return false;

        const fecha = new Date(String(partidoBase.apiDate).replace(' ', 'T'));
        if (Number.isNaN(fecha.getTime())) return false;

        return fecha <= new Date();
    }

    function estadoPartidoHTML(partido) {
        if (!partido) return '<span class="status-pill status-finished">Cerrado</span>';

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

        return `<span class="status-pill status-scheduled">Programado</span>`;
    }

    function buscarOficialPorPartido(partidosOficiales, partidoBase) {
        return partidosOficiales.find(partido =>
            (partido.equipo1 === partidoBase.equipo1 && partido.equipo2 === partidoBase.equipo2) ||
            (partido.equipo1 === partidoBase.equipo2 && partido.equipo2 === partidoBase.equipo1)
        );
    }

    function pedirPassword() {
        return new Promise((resolve) => {
            const modal = document.getElementById('passwordModal');
            const input = document.getElementById('passwordInput');
            const aceptar = document.getElementById('passwordAceptar');
            const cancelar = document.getElementById('passwordCancelar');

            modal.style.display = 'flex';
            input.value = '';
            input.focus();

            aceptar.onclick = () => {
                const val = input.value.trim();
                modal.style.display = 'none';
                resolve(val || null);
            };

            cancelar.onclick = () => {
                modal.style.display = 'none';
                resolve(null);
            };
        });
    }

    async function verificarPasswordJugador(jugador, password) {
        const resp = await fetch(`/api/jugadores/${encodeURIComponent(jugador)}/verificar-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await resp.json();

        return {
            ok: resp.ok && data.success,
            error: data.error || 'Contraseña incorrecta'
        };
    }

    function crearBotonVerTodos() {
        const existente = document.getElementById('verTodosPartidosBtn');
        if (existente) existente.remove();

        const btn = document.createElement('button');
        btn.id = 'verTodosPartidosBtn';
        btn.type = 'button';
        btn.className = 'secondary-button';
        btn.textContent = 'Ver todos los partidos';

        btn.addEventListener('click', async () => {
            const jugador = jugadorSelect.value;

            if (!jugador) {
                alert('Seleccione un jugador.');
                return;
            }

            const password = await pedirPassword();

            if (!password) {
                resultadosContainer.insertAdjacentHTML('beforeend', `
                    <div class="resultados-mensaje">Debe ingresar contraseña para ver todos los partidos.</div>
                `);
                return;
            }

            const validacion = await verificarPasswordJugador(jugador, password);

            if (!validacion.ok) {
                resultadosContainer.insertAdjacentHTML('beforeend', `
                    <div class="resultados-mensaje" style="color:#ffb3b3;">Contraseña incorrecta.</div>
                `);
                return;
            }

            verTodosAutorizado = true;
            passwordGuardada = password;

            await buscarResultados(true);
        });

        resultadosContainer.appendChild(btn);
    }

    function loadJugadores() {
        fetch('/api/jugadores')
            .then(res => res.json())
            .then(jugadores => {
                if (Array.isArray(jugadores)) {
                    jugadorSelect.innerHTML = '<option value="">Selecciona un jugador</option>';
                    jugadores.forEach(j => {
                        const option = document.createElement('option');
                        option.value = j;
                        option.textContent = j;
                        jugadorSelect.appendChild(option);
                    });
                }
            })
            .catch(console.error);
    }

    function loadJornadas() {
        fetch('/api/jornadas')
            .then(res => res.json())
            .then(jornadas => {
                if (Array.isArray(jornadas)) {
                    jornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';
                    jornadas.forEach(j => {
                        const option = document.createElement('option');
                        option.value = j.nombre;
                        option.textContent = j.nombre;
                        jornadaSelect.appendChild(option);
                    });

                    if (jornadas.length > 0) {
                        jornadaSelect.value = jornadas[jornadas.length - 1].nombre;
                    }
                }
            })
            .catch(console.error);
    }

    async function obtenerJornada(jornadaNombre) {
        const res = await fetch(`/api/jornadas/${encodeURIComponent(jornadaNombre)}`);
        if (!res.ok) return null;
        return await res.json();
    }

    async function buscarResultados(mostrarTodos = verTodosAutorizado) {
        const jugador = jugadorSelect.value;
        const jornada = jornadaSelect.value;

        if (!jugador || !jornada) {
            resultadosContainer.textContent = 'Por favor, seleccione un jugador y una jornada.';
            return;
        }

        resultadosContainer.textContent = 'Cargando resultados...';

        try {
         const resPronosticos = await fetch(
    `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
);

resultadosContainer.innerHTML = '';

if (resPronosticos.status === 404) {
    resultadosContainer.textContent = 'El jugador no ha pronosticado resultados para esta jornada.';
    return;
}

if (!resPronosticos.ok) {
    resultadosContainer.textContent = 'Error al obtener resultados.';
    return;
}

const partidos = await resPronosticos.json();

if (!Array.isArray(partidos) || partidos.length === 0) {
    resultadosContainer.textContent = 'El jugador no ha pronosticado resultados para esta jornada.';
    return;
}


            const jornadaData = await obtenerJornada(jornada);
            const partidosJornada = jornadaData?.partidos || [];

            const oficialesRes = await fetch('/api/resultados-oficiales');
            const oficialesData = await oficialesRes.json();

            const oficialJornada = Array.isArray(oficialesData)
                ? oficialesData.find(o => o.nombre === jornada)
                : null;

            const partidosOficiales = oficialJornada ? oficialJornada.partidos : [];

            let partidosMostrados = 0;
            let partidosOcultos = 0;

            
                partidos.forEach((p, index) => {
                const partidoBase = partidosJornada[index] || p;
                const partidoOficial = buscarOficialPorPartido(partidosOficiales, partidoBase);
                const cerrado = partidoYaCerro(partidoBase, partidoOficial);

                if (!cerrado && !mostrarTodos) {
                    partidosOcultos++;
                    return;
                }

                partidosMostrados++;

                const div = document.createElement('div');
                div.classList.add('match-card', 'resultado');

                if (!cerrado) {
                    div.classList.add('partido-cerrado');
                }

                if (partidoBase?.comodin || partidoOficial?.comodin) {
                    div.classList.add('match-card-comodin');
                }

                div.innerHTML = `
                    <div class="match-card-header">
                        ${(partidoBase?.comodin || partidoOficial?.comodin) ? '<span class="match-comodin-badge">⭐ COMODÍN</span>' : ''}

                        <div class="match-main">
                            <div class="match-left">
                                <div class="match-title ${(partidoBase?.comodin || partidoOficial?.comodin) ? 'match-title-comodin' : ''}">
                                    ${p.equipo1} vs ${p.equipo2}
                                </div>

                                <div class="match-meta">
                                    <span>📅 ${formatearFechaPartido(partidoBase.apiDate)}</span>
                                    ${!cerrado ? '<span class="status-pill status-scheduled">Aún no cerrado</span>' : ''}
                                </div>
                            </div>

                            <div class="match-score">
                                <span>Pronóstico</span>
                                <strong>${p.marcador1 ?? '-'} - ${p.marcador2 ?? '-'}</strong>
                            </div>

                            <div class="match-status">
                                ${cerrado
                                    ? estadoPartidoHTML(partidoOficial)
                                    : '<span class="status-pill status-scheduled">Privado</span>'
                                }
                            </div>
                        </div>
                    </div>

                    <div class="match-teams">
                        <div class="team-side">
                            ${logoHTML(p.logoEquipo1, p.equipo1)}
                            <strong>${p.equipo1}</strong>
                        </div>

                        <span class="match-score">
                            ${p.marcador1 ?? '-'} - ${p.marcador2 ?? '-'}
                        </span>

                        <div class="team-side">
                            ${logoHTML(p.logoEquipo2, p.equipo2)}
                            <strong>${p.equipo2}</strong>
                        </div>
                    </div>
                `;

                resultadosContainer.appendChild(div);
            });

            if (partidosMostrados === 0) {
                resultadosContainer.innerHTML = 'Todavía no hay partidos cerrados para mostrar en esta jornada.';
            }

            if (partidosOcultos > 0 && !mostrarTodos) {
                resultadosContainer.insertAdjacentHTML('beforeend', `
                    <div class="resultados-mensaje">
                        Hay ${partidosOcultos} partido(s) que aún no han cerrado.
                    </div>
                `);

                crearBotonVerTodos();
            }

        } catch (err) {
            console.error(err);
            resultadosContainer.textContent = 'Error al obtener resultados.';
        }
    }

    searchResultadosButton.addEventListener('click', () => {
        verTodosAutorizado = false;
        passwordGuardada = '';
        buscarResultados(false);
    });

    jugadorSelect.addEventListener('change', () => {
        verTodosAutorizado = false;
        passwordGuardada = '';

        if (jugadorSelect.value && jornadaSelect.value) {
            buscarResultados(false);
        }
    });

    jornadaSelect.addEventListener('change', () => {
        verTodosAutorizado = false;
        passwordGuardada = '';

        if (jugadorSelect.value && jornadaSelect.value) {
            buscarResultados(false);
        }
    });

    setInterval(() => {
        if (jugadorSelect.value && jornadaSelect.value) {
            buscarResultados(verTodosAutorizado);
        }
    }, 30000);

    loadJugadores();
    loadJornadas();
});

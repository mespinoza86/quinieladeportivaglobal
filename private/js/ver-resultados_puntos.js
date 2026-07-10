document.addEventListener('DOMContentLoaded', () => {
    const jugadorSelect = document.getElementById('jugadorSelect');
    const jornadaSelect = document.getElementById('jornadaSelect');
    const searchResultadosButtonpuntos = document.getElementById('searchResultadosButtonpuntos');
    const resultadosContainer = document.getElementById('resultadosContainer');
    const puntosContainer = document.getElementById('puntosContainer');
    const totalPuntosContainer = document.getElementById('totalPuntosContainer');

    let verTodosAutorizado = false;
    let passwordGuardada = '';

    function isValidScore(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === 'string' && v.trim() === '') return false;
        return Number.isFinite(Number(v));
    }

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
        if (!partido) return '';

        if (partido.estado === 'TC') {
            return `<span class="status-pill status-finished">TC</span>`;
        }

        if (partido.estado === 'MT') {
            return `<span class="status-pill status-live"><span class="live-dot"></span>MT</span>`;
        }

        if (partido.estado === 'LIVE' && partido.minuto) {
            return `<span class="status-pill status-live">
                <span class="live-dot"></span>
                ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
            </span>`;
        }
        
        return `<span class="status-pill status-scheduled">${formatearFechaPartido(partido.fecha)}</span>`;
    }

    function buscarOficialPorPartido(partidosOficiales, partidoBase) {
        return partidosOficiales.find(partido =>
            (partido.equipo1 === partidoBase.equipo1 && partido.equipo2 === partidoBase.equipo2) ||
            (partido.equipo1 === partidoBase.equipo2 && partido.equipo2 === partidoBase.equipo1)
        );
    }

    function calcularPuntos(pronostico, resultadoOficial) {
        if (!pronostico || !resultadoOficial) return 0;

        const m1p = pronostico.marcador1;
        const m2p = pronostico.marcador2;
        const m1o = resultadoOficial.marcador1;
        const m2o = resultadoOficial.marcador2;
        const comodin = Boolean(resultadoOficial.comodin);

        if (!isValidScore(m1p) || !isValidScore(m2p) || !isValidScore(m1o) || !isValidScore(m2o)) {
            return 0;
        }

        const n1p = Number(m1p);
        const n2p = Number(m2p);
        const n1o = Number(m1o);
        const n2o = Number(m2o);

        let puntos = 0;

        const ganadorPron = n1p > n2p ? 1 : n1p < n2p ? -1 : 0;
        const ganadorOfi = n1o > n2o ? 1 : n1o < n2o ? -1 : 0;

        if (ganadorPron === ganadorOfi) {
            puntos += comodin ? 4 : 3;
        }

        if (n1p === n1o && n2p === n2o) {
            puntos += comodin ? 3 : 2;
        }

        return puntos;
    }

    function pedirPassword() {
        return new Promise((resolve) => {
            const modal = document.getElementById("passwordModal");
            const input = document.getElementById("passwordInput");
            const okBtn = document.getElementById("passwordOk");
            const cancelBtn = document.getElementById("passwordCancel");

            modal.style.display = "flex";
            input.value = "";
            input.focus();

            function cerrar(valor) {
                modal.style.display = "none";
                okBtn.removeEventListener("click", aceptar);
                cancelBtn.removeEventListener("click", cancelar);
                input.removeEventListener("keydown", enterHandler);
                resolve(valor);
            }

            function aceptar() {
                cerrar(input.value);
            }

            function cancelar() {
                cerrar(null);
            }

            function enterHandler(e) {
                if (e.key === 'Enter') aceptar();
            }

            okBtn.addEventListener("click", aceptar);
            cancelBtn.addEventListener("click", cancelar);
            input.addEventListener("keydown", enterHandler);
        });
    }

    async function loadJugadores() {
        const response = await fetch('/api/jugadores');
        const jugadores = await response.json();

        jugadorSelect.innerHTML = '<option value="">Selecciona un jugador</option>';

        if (Array.isArray(jugadores)) {
            jugadores.forEach(jugador => {
                const option = document.createElement('option');
                option.value = jugador;
                option.textContent = jugador;
                jugadorSelect.appendChild(option);
            });
        }
    }

    async function loadJornadas() {
        const response = await fetch('/api/jornadas');
        const jornadas = await response.json();

        jornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';

        if (Array.isArray(jornadas)) {
            jornadas.forEach(jornada => {
                const option = document.createElement('option');
                option.value = jornada.nombre;
                option.textContent = jornada.nombre;
                jornadaSelect.appendChild(option);
            });

            if (jornadas.length > 0) {
                jornadaSelect.value = jornadas[jornadas.length - 1].nombre;
            }
        }
    }

    async function obtenerJornada(jornadaNombre) {
        const res = await fetch(`/api/jornadas/${encodeURIComponent(jornadaNombre)}`);
        if (!res.ok) return null;
        return await res.json();
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
                totalPuntosContainer.innerHTML = `<p>Debe ingresar contraseña para ver todos los partidos.</p>`;
                return;
            }

            const validacion = await verificarPasswordJugador(jugador, password);

            if (!validacion.ok) {
                totalPuntosContainer.innerHTML = `<p style="color:#ffb3b3;">Contraseña incorrecta.</p>`;
                return;
            }

            verTodosAutorizado = true;
            passwordGuardada = password;

            await buscarResultados(true);
        });

        totalPuntosContainer.appendChild(btn);
    }

    async function buscarResultados(mostrarTodos = verTodosAutorizado) {
        const jugador = jugadorSelect.value;
        const jornada = jornadaSelect.value;

        if (!jugador || !jornada) {
            resultadosContainer.textContent = 'Por favor, seleccione un jugador y una jornada.';
            return;
        }

        resultadosContainer.innerHTML = 'Cargando resultados...';
        puntosContainer.innerHTML = '';
        totalPuntosContainer.innerHTML = '';

        try {
            const resPronosticos = await fetch(
                                    `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
            );

            if (resPronosticos.status === 404) {
                resultadosContainer.textContent = 'El jugador no ha pronosticado esta jornada.';
                return;
            }

            const partidos = await resPronosticos.json();


            if (!Array.isArray(partidos) || partidos.length === 0) {
                resultadosContainer.textContent = 'El jugador no ha pronosticado esta jornada.';
                return;
            }

            const jornadaData = await obtenerJornada(jornada);
            const partidosJornada = jornadaData?.partidos || [];

            const oficialesResponse = await fetch('/api/resultados-oficiales');
            const resultadosOficiales = await oficialesResponse.json();

            const resultadoOficial = Array.isArray(resultadosOficiales)
                ? resultadosOficiales.find(j => j.nombre === jornada)
                : null;

            const partidosOficiales = resultadoOficial ? resultadoOficial.partidos : [];

            resultadosContainer.innerHTML = '';

            let totalPuntos = 0;
            let partidosMostrados = 0;
            let partidosOcultos = 0;

            partidos.forEach((partidoPronosticado, index) => {
                const partidoBase = partidosJornada[index] || partidoPronosticado;

                const resultadoOficialCorrespondiente = buscarOficialPorPartido(
                    partidosOficiales,
                    partidoBase
                );

                const cerrado = partidoYaCerro(partidoBase, resultadoOficialCorrespondiente);

                if (!cerrado && !mostrarTodos) {
                    partidosOcultos++;
                    return;
                }

                partidosMostrados++;

                const puntos = cerrado
                    ? calcularPuntos(partidoPronosticado, resultadoOficialCorrespondiente)
                    : 0;

                if (cerrado) {
                    totalPuntos += puntos;
                }

                const oficialTexto = resultadoOficialCorrespondiente &&
                    isValidScore(resultadoOficialCorrespondiente.marcador1) &&
                    isValidScore(resultadoOficialCorrespondiente.marcador2)
                    ? `${resultadoOficialCorrespondiente.marcador1}-${resultadoOficialCorrespondiente.marcador2}`
                    : 'N/A';

                const partidoDiv = document.createElement('div');
                partidoDiv.classList.add('match-card', 'resultado');

                if (!cerrado) {
                    partidoDiv.classList.add('partido-cerrado');
                }

                if (resultadoOficialCorrespondiente?.comodin || partidoBase?.comodin) {
                    partidoDiv.classList.add('match-card-comodin');
                }

                partidoDiv.innerHTML = `
                    <div class="match-card-header">
                        ${(resultadoOficialCorrespondiente?.comodin || partidoBase?.comodin) ? '<span class="match-comodin-badge">⭐ COMODÍN</span>' : ''}

                        <div class="match-main">
                            <div class="match-left">
                                <div class="match-title ${(resultadoOficialCorrespondiente?.comodin || partidoBase?.comodin) ? 'match-title-comodin' : ''}">
                                    ${partidoPronosticado.equipo1} vs ${partidoPronosticado.equipo2}
                                </div>

                                <div class="match-meta">
                                    <span>📅 ${formatearFechaPartido(partidoBase.apiDate)}</span>                                    
                                    ${!cerrado ? '<span class="status-pill status-scheduled">Aún no cerrado</span>' : ''}
                                </div>
                            </div>

                            <div class="match-score">
                                <span>Pronóstico</span>
                                <strong>${partidoPronosticado.marcador1 ?? '-'} - ${partidoPronosticado.marcador2 ?? '-'}</strong>
                                <span>Oficial: ${cerrado ? oficialTexto : 'Pendiente'}</span>
                            </div>

                            <div class="match-status">
                                ${cerrado
                                    ? (resultadoOficialCorrespondiente ? estadoPartidoHTML(resultadoOficialCorrespondiente) : '<span class="status-pill status-finished">Cerrado</span>')
                                    : '<span class="status-pill status-scheduled">Privado</span>'
                                }
                            </div>
                        </div>
                    </div>

                    <div class="match-teams">
                        <div class="team-side">
                            ${logoHTML(partidoPronosticado.logoEquipo1, partidoPronosticado.equipo1)}
                            <strong>${partidoPronosticado.equipo1}</strong>
                        </div>

                        <span class="match-score">
                            ${partidoPronosticado.marcador1 ?? '-'} - ${partidoPronosticado.marcador2 ?? '-'}
                        </span>

                        <div class="team-side">
                            ${logoHTML(partidoPronosticado.logoEquipo2, partidoPronosticado.equipo2)}
                            <strong>${partidoPronosticado.equipo2}</strong>
                        </div>
                    </div>

                    <div class="match-meta">
                        <span>Oficial: ${cerrado ? oficialTexto : 'Pendiente'}</span>
                        <span>Puntos: ${cerrado ? puntos : '-'}</span>
                    </div>
                `;

                resultadosContainer.appendChild(partidoDiv);
            });

            if (partidosMostrados === 0) {
                resultadosContainer.innerHTML = 'Todavía no hay partidos cerrados para mostrar en esta jornada.';
            }

            totalPuntosContainer.innerHTML = `
                <h3>Total de Puntos Obtenidos en partidos visibles: ${totalPuntos}</h3>
                ${partidosOcultos > 0 && !mostrarTodos
                    ? `<p>Hay ${partidosOcultos} partido(s) que aún no han cerrado.</p>`
                    : ''
                }
            `;

            if (partidosOcultos > 0 && !mostrarTodos) {
                crearBotonVerTodos();
            }

        } catch (error) {
            console.error('Error al buscar resultados:', error);
            resultadosContainer.textContent = 'Error al obtener resultados.';
        }
    }

    searchResultadosButtonpuntos.addEventListener('click', () => {
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

    async function iniciar() {
        await loadJugadores();
        await loadJornadas();
    }

    iniciar();
});
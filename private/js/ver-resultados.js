document.addEventListener('DOMContentLoaded', () => {
    const jugadorSelect = document.getElementById('jugadorSelect');
    const jornadaSelect = document.getElementById('jornadaSelect');
    const searchResultadosButton = document.getElementById('searchResultadosButton');
    const resultadosContainer = document.getElementById('resultadosContainer');

    let verTodosAutorizado = false;

    /* Quien esta mirando: para seleccionarte solo y no ponerte cortina. */
    let yoSoy = null;
    let passwordGuardada = '';

    function logoHTML(url, nombre) {
        if (!url) return '';
        return html`<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
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
        if (!partido) return html`<span class="status-pill status-finished">Cerrado</span>`;

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

        return html`<span class="status-pill status-scheduled">Programado</span>`;
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
            error: data.error || 'Contraseña incorrecta.'
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

    /* Devuelve la promesa: el arranque necesita esperar a que estén los dos. */
    function loadJugadores() {
        return fetch('/api/jugadores')
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

    /*
     * ⭐ SE CAMBIA DE RUTA POR TRÁFICO, NO POR CORRECCIÓN.
     *
     * `/api/jornadas` a secas trae LA TEMPORADA ENTERA con todos sus partidos
     * para rellenar un desplegable de nombres. `/api/jornada-actual` trae los
     * nombres y cuál es la que toca, en una petición pequeña.
     *
     * ⚠️ Lo de antes —`jornadas[jornadas.length - 1]`— NO estaba mal: `listar()`
     * hace `ORDER BY j.secuencia`, así que acertaba siempre. Se comprobó
     * volviendo al original y las pruebas seguían verdes. El motivo del cambio
     * es el peso y la consistencia con las otras tres pantallas, nada más.
     */
    function loadJornadas() {
        return fetch('/api/jornada-actual')
            .then(res => res.json())
            .then(data => {
                const jornadas = data.jornadas || [];

                jornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';

                jornadas.forEach(j => {
                    const option = document.createElement('option');
                    option.value = j.nombre;
                    option.textContent = j.nombre;
                    jornadaSelect.appendChild(option);
                });

                if (data.sugerida) jornadaSelect.value = data.sugerida;
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

        /*
         * ⛔ MIRANDO LO TUYO NO HAY CORTINA NI CONTRASEÑA.
         *
         * El servidor ya decide esto por identidad —`esAdmin(req) || yo ===
         * jugador`— así que tus propios pronósticos de partidos SIN cerrar ya
         * llegaron completos. La pantalla los escondía igual hasta que
         * escribieras tu contraseña: un trámite que no protegía nada, porque el
         * dato ya estaba en el navegador.
         *
         * ⚠️ Para los demás jugadores NO cambia nada: sus partidos sin cerrar
         * llegan vacíos del servidor, así que la cortina sigue donde estaba.
         */
        if (yoSoy && jugador === yoSoy) mostrarTodos = true;

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

            /*
             * ⚠️ Una jornada, no todas. El tráfico se paga: ver el porqué
             * largo en `llenar_jornada_user.js`.
             */
            const oficialesRes = await fetch(
                '/api/resultados-oficiales?jornada=' + encodeURIComponent(jornada));
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

                div.innerHTML = html`
                    <div class="match-card-header">
                        ${(partidoBase?.comodin || partidoOficial?.comodin) ? html`<span class="match-comodin-badge">⭐ COMODÍN</span>` : ''}

                        <div class="match-main">
                            <div class="match-left">
                            <!--
                              ⛔ AQUÍ ESTABA «Zeledon vs Sporting FC», Y SOBRABA.

                              Los dos nombres vuelven a salir abajo, cada uno con su
                              escudo. Decir lo mismo dos veces en la misma tarjeta es
                              lo que se lleva quitando desde que Marco lo señaló.
                            -->

                                <div class="match-meta">
                                    <span>📅 ${formatearFechaPartido(partidoBase.apiDate)}</span>
                                    ${!cerrado ? html`<span class="status-pill status-scheduled">Aún no cerrado</span>` : ''}
                                </div>
                            </div>

                            <!--
                              ⛔ Quitada: repetía el pronóstico que la fila de
                              equipos ya enseña doce líneas más abajo. Misma
                              duplicación que en «Puntos», y el mismo arreglo.
                            -->

                            <div class="match-status">
                                ${cerrado
                                    ? estadoPartidoHTML(partidoOficial)
                                    : html`<span class="status-pill status-scheduled">Privado</span>`
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
                            <strong>${p.marcador1 ?? '-'} - ${p.marcador2 ?? '-'}</strong>
                            <span class="match-score-rotulo">Tu pronóstico</span>
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
                resultadosContainer.insertAdjacentHTML('beforeend', html`
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

    /* Una vez por minuto, y sólo repinta si cambió. Ver `refresco-vivo.js`. */
    refrescoEnVivo(
        () => (jugadorSelect.value && jornadaSelect.value) ? jornadaSelect.value : null,
        () => buscarResultados(verTodosAutorizado)
    );

    /*
     * ============================================================================
     * ⭐ AL ENTRAR, LO TUYO DE LA ÚLTIMA JORNADA — SIN TOCAR NADA
     * ============================================================================
     *
     * Marco: *«cuando uno entra, por default salgan los resultados de la última
     * jornada del user actual»*. Es lo que ya hace llenar quiniela.
     *
     * ⚠️ Y SÓLO si estás en la lista. Un administrador que no juega esta quiniela
     * no aparece entre los jugadores; ahí no se toca nada y la pantalla queda
     * esperando, como hoy.
     */
    async function seleccionarmeSiJuego() {
        try {
            const datos = await (await fetch('/api/auth/me')).json();
            yoSoy = datos?.usuario?.username || null;
        } catch (error) {
            return false;     // Sin sesión legible, la pantalla sigue como hoy.
        }

        if (!yoSoy) return false;

        /*
         * ⚠️ Se comprueba que la opción EXISTE antes de asignarla: a un `<select>`
         * se le puede poner un valor que no está entre sus opciones y no da error
         * — se queda vacío, y la pantalla parecería rota sin motivo.
         */
        if (![...jugadorSelect.options].some(o => o.value === yoSoy)) return false;

        jugadorSelect.value = yoSoy;
        return true;
    }

    (async () => {
        await Promise.all([loadJugadores(), loadJornadas()]);

        /*
         * El `change` es lo que dispara la búsqueda, y ya estaba enganchado. Se
         * lanza a mano porque asignar `.value` desde código NO lo emite solo.
         */
        if (await seleccionarmeSiJuego()) {
            jugadorSelect.dispatchEvent(new Event('change'));
        }
    })();
});

document.addEventListener('DOMContentLoaded', () => {
    const jugadorSelect = document.getElementById('jugadorSelect');
    const jornadaSelect = document.getElementById('jornadaSelect');
    const searchResultadosButtonpuntos = document.getElementById('searchResultadosButtonpuntos');
    const resultadosContainer = document.getElementById('resultadosContainer');
    const puntosContainer = document.getElementById('puntosContainer');
    const totalPuntosContainer = document.getElementById('totalPuntosContainer');

    let verTodosAutorizado = false;

    /*
     * Quien esta mirando. Se sabe al arrancar y sirve para dos cosas:
     * seleccionarte solo, y no ponerte cortina en tu propia tabla.
     */
    let yoSoy = null;
    let passwordGuardada = '';
    let puntuacion = { marcadorExacto: 5, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4 };
    fetch('/api/quiniela-actual').then(r => r.json()).then(q => { puntuacion = { ...puntuacion, ...q.configuracion?.puntuacion }; });

    function isValidScore(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === 'string' && v.trim() === '') return false;
        return Number.isFinite(Number(v));
    }

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
        if (!partido) return '';

        if (partido.estado === 'TC') {
            return html`<span class="status-pill status-finished">TC</span>`;
        }

        if (partido.estado === 'MT') {
            return html`<span class="status-pill status-live"><span class="live-dot"></span>MT</span>`;
        }

        if (partido.estado === 'LIVE' && partido.minuto) {
            return html`<span class="status-pill status-live">
                <span class="live-dot"></span>
                ${partido.minuto}${String(partido.minuto).includes('+') ? '' : "'"}
            </span>`;
        }
        
        return html`<span class="status-pill status-scheduled">${formatearFechaPartido(partido.fecha)}</span>`;
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

        const ganadorPron = n1p > n2p ? 1 : n1p < n2p ? -1 : 0;
        const ganadorOfi = n1o > n2o ? 1 : n1o < n2o ? -1 : 0;
        if (n1p === n1o && n2p === n2o) {
            return comodin ? puntuacion.comodinExacto : puntuacion.marcadorExacto;
        }
        return ganadorPron === ganadorOfi
            ? (comodin ? puntuacion.comodinResultado : puntuacion.resultadoCorrecto)
            : 0;
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

    /*
     * ⭐ SE CAMBIA DE RUTA POR TRÁFICO, NO POR CORRECCIÓN.
     *
     * `/api/jornadas` a secas devuelve LA TEMPORADA ENTERA con todos sus
     * partidos —equipos, escudos, fechas, comodines— para rellenar un
     * desplegable de nombres. `/api/jornada-actual` trae los nombres Y cuál es
     * la que toca, en una sola petición pequeña.
     *
     * ⚠️ Y CONVIENE DEJAR ESCRITO LO QUE **NO** ERA UN FALLO. Lo de antes era
     * `jornadas[jornadas.length - 1]`, que parece «el último que salga, sin
     * orden garantizado» — y no lo es: `listar()` hace `ORDER BY j.secuencia`,
     * así que acertaba siempre. Se comprobó devolviendo el código al original:
     * las pruebas seguían en verde, porque ahí no había nada roto.
     *
     * Usar la ruta que el servidor mantiene como única fuente sigue siendo lo
     * correcto —ya lo hacen otras tres pantallas—, pero por consistencia y por
     * peso, no porque esto estuviera eligiendo mal.
     */
    async function loadJornadas() {
        const response = await fetch('/api/jornada-actual');
        const data = await response.json();
        const jornadas = data.jornadas || [];

        jornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';

        jornadas.forEach(jornada => {
            const option = document.createElement('option');
            option.value = jornada.nombre;
            option.textContent = jornada.nombre;
            jornadaSelect.appendChild(option);
        });

        if (data.sugerida) jornadaSelect.value = data.sugerida;
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

        /*
         * ⛔ MIRANDO LO TUYO NO HAY CORTINA NI CONTRASEÑA.
         *
         * El servidor ya decide esto por identidad, y lo hace bien:
         *
         *     const todo = esAdmin(req) || yo === jugador;
         *     const visible = todo || fila.bloqueado;
         *
         * O sea que tus propios pronósticos de partidos SIN cerrar ya te
         * llegaron completos. La pantalla los escondía igual hasta que
         * escribieras tu contraseña — un trámite que no protegía nada, porque el
         * dato ya estaba en el navegador.
         *
         * ⚠️ Para los demás jugadores NO cambia nada: sus partidos sin cerrar
         * llegan vacíos del servidor, así que la cortina y su contraseña siguen
         * donde estaban. Esto sólo deja de estorbar en tu propia tabla.
         */
        const esMiTabla = Boolean(yoSoy) && jugador === yoSoy;
        if (esMiTabla) mostrarTodos = true;

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

            /*
             * ⚠️ Una jornada, no todas. El tráfico se paga: ver el porqué
             * largo en `llenar_jornada_user.js`.
             */
            const oficialesResponse = await fetch(
                '/api/resultados-oficiales?jornada=' + encodeURIComponent(jornada));
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

                partidoDiv.innerHTML = html`
                    <div class="match-card-header">
                        ${(resultadoOficialCorrespondiente?.comodin || partidoBase?.comodin) ? html`<span class="match-comodin-badge">⭐ COMODÍN</span>` : ''}

                        <div class="match-main">
                            <div class="match-left">
                                <div class="match-title ${(resultadoOficialCorrespondiente?.comodin || partidoBase?.comodin) ? 'match-title-comodin' : ''}">
                                    ${partidoPronosticado.equipo1} vs ${partidoPronosticado.equipo2}
                                </div>

                                <div class="match-meta">
                                    <span>📅 ${formatearFechaPartido(partidoBase.apiDate)}</span>                                    
                                    ${!cerrado ? html`<span class="status-pill status-scheduled">Aún no cerrado</span>` : ''}
                                </div>
                            </div>

                            <!--
                              ⛔ AQUÍ HABÍA UNA CAJA QUE REPETÍA TODA LA TARJETA.
                              Enseñaba «Pronóstico 1-2» y «Oficial: 1-2», y doce
                              líneas más abajo la fila de equipos volvía a poner
                              el pronóstico y el renglón del pie volvía a poner
                              el oficial. Lo mismo dos veces, en la misma tarjeta.
                              Cada dato se dice UNA vez: el marcador con los
                              equipos, y el oficial y los puntos en el pie.
                            -->

                            <div class="match-status">
                                ${cerrado
                                    ? (resultadoOficialCorrespondiente
                                        ? estadoPartidoHTML(resultadoOficialCorrespondiente)
                                        : html`<span class="status-pill status-finished">Cerrado</span>`)
                                    : html`<span class="status-pill status-scheduled">Privado</span>`
                                }
                            </div>
                        </div>
                    </div>

                    <div class="match-teams">
                        <div class="team-side">
                            ${logoHTML(partidoPronosticado.logoEquipo1, partidoPronosticado.equipo1)}
                            <strong>${partidoPronosticado.equipo1}</strong>
                        </div>

                        <!--
                          ⚠️ El número va rotulado. Antes se entendía porque la
                          caja de arriba decía «Pronóstico»; al quitarla, un
                          «1 - 2» suelto entre dos escudos se lee igual de bien
                          como marcador del partido que como apuesta, y son
                          cosas distintas — la de al lado dice el oficial.
                        -->
                        <span class="match-score">
                            <strong>${partidoPronosticado.marcador1 ?? '-'} - ${partidoPronosticado.marcador2 ?? '-'}</strong>
                            <span class="match-score-rotulo">Tu pronóstico</span>
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

            totalPuntosContainer.innerHTML = html`
                <h3>Total de Puntos Obtenidos en partidos visibles: ${totalPuntos}</h3>
                ${partidosOcultos > 0 && !mostrarTodos
                    ? html`<p>Hay ${partidosOcultos} partido(s) que aún no han cerrado.</p>`
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

    /*
     * ⭐ Antes era un setInterval de 30 s que recargaba TODO. Marco: «se me
     * reinicia todo cada 20 o 30 segundos». Ahora pregunta una vez por minuto
     * y sólo recarga si de verdad cambió algo. Ver `refresco-vivo.js`.
     */
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
     * jornada del user actual»*. Es lo que ya hace llenar quiniela, así que las
     * dos pantallas dejan de comportarse distinto.
     *
     * ⚠️ Y SÓLO si estás en la lista. Un administrador que no juega esta
     * quiniela no aparece entre los jugadores; en ese caso no se toca nada y la
     * pantalla queda como siempre, esperando a que elijas. Marco lo pidió así:
     * «si un administrador entra y no está jugando, queda como está ahora».
     */
    async function seleccionarmeSiJuego() {
        try {
            const datos = await (await fetch('/api/auth/me')).json();
            yoSoy = datos?.usuario?.username || null;
        } catch (error) {
            return false;     // Sin sesión legible, la pantalla sigue como hoy.
        }

        const yo = yoSoy;
        if (!yo) return false;

        /*
         * ⚠️ Se comprueba que la opción EXISTE antes de asignarla. A un
         * `<select>` se le puede poner un valor que no está entre sus opciones y
         * no da error: se queda vacío, y la pantalla parecería rota sin motivo.
         */
        const estoy = [...jugadorSelect.options].some(o => o.value === yo);
        if (!estoy) return false;

        jugadorSelect.value = yo;
        return true;
    }

    async function iniciar() {
        await loadJugadores();
        await loadJornadas();

        /*
         * El `change` es lo que dispara la búsqueda, y ya estaba enganchado. Se
         * lanza a mano porque asignar `.value` desde código NO lo emite solo.
         */
        if (await seleccionarmeSiJuego()) {
            jugadorSelect.dispatchEvent(new Event('change'));
        }
    }

    iniciar();
});

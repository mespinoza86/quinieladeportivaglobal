/*
 * Administración de jornadas — la única pantalla (Fase D, petición 3).
 *
 * Antes esto eran dos pantallas que hacían lo mismo por caminos distintos:
 * jornadas.html daba de alta partidos a mano, con autocompletado de equipos, e
 * importar_partidos.html los traía del API. Cada una llevaba su propia copia de
 * la lista de torneos, de la tabla de traducciones de equipos y del filtro de
 * competiciones bloqueadas — y las copias ya habían empezado a divergir en la
 * Fase C, que solo arregló una de las dos.
 *
 * Decisión de producto del 19-ago-2026: **los partidos salen solo del API**. Se
 * acepta a sabiendas que un partido que el proveedor no cubra no puede entrar en
 * una quiniela. A cambio desaparece el alta manual, el autocompletado de equipos
 * y la pantalla de importar.
 *
 * La pantalla tiene tres partes, en el orden en que se usan:
 *
 *   1. Qué jornada —una existente, o una nueva—.
 *   2. Buscar partidos en el API y agregarlos.
 *   3. Revisar lo que va a quedar guardado, y guardar o eliminar.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const jornadaSelect = document.getElementById('jornadaSelect');
    const nombreNuevaBox = document.getElementById('nombreNuevaBox');
    const nombreJornadaInput = document.getElementById('nombreJornadaInput');

    const fechaInput = document.getElementById('fechaInput');
    const torneoSelect = document.getElementById('torneoSelect');
    const customLeagueBox = document.getElementById('customLeagueBox');
    const customLeagueNameInput = document.getElementById('customLeagueNameInput');
    const buscarPartidosButton = document.getElementById('buscarPartidosButton');
    const rangoTexto = document.getElementById('rangoTexto');
    const estadoBusqueda = document.getElementById('estadoBusqueda');
    const partidosApiContainer = document.getElementById('partidosApiContainer');

    const partidosJornadaContainer = document.getElementById('partidosJornadaContainer');
    const mensajeJornada = document.getElementById('mensajeJornada');
    const guardarJornadaButton = document.getElementById('guardarJornadaButton');
    const eliminarJornadaButton = document.getElementById('eliminarJornadaButton');

    /*
     * Siete días contando el de hoy, igual que en la Fase C. El servidor tiene
     * el mismo valor por defecto y su propio tope.
     */
    const DIAS_BUSQUEDA = 7;

    /* Cuántos partidos se pintan como mucho. Ver el tope en la búsqueda. */
    const MAXIMO_PARTIDOS = 300;

    const NUEVA = '__nueva__';

    let partidosEncontrados = [];
    let partidosDeLaJornada = [];
    let rangoDeLaBusqueda = { desde: '', hasta: '' };

    /* ================= Utilidades ================= */

    function normalizarTexto(texto) {
        return String(texto || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    /** El día de hoy en `YYYY-MM-DD`, que es lo que espera un `input[type=date]`. */
    function hoyISO() {
        const ahora = new Date();
        const desfase = ahora.getTimezoneOffset() * 60000;
        return new Date(ahora.getTime() - desfase).toISOString().slice(0, 10);
    }

    function fechaLegible(valor) {
        if (!valor) return 'Sin fecha';
        const fecha = new Date(String(valor).replace(' ', 'T'));
        if (Number.isNaN(fecha.getTime())) return String(valor);
        return fecha.toLocaleString('es-CR', {
            timeZone: 'America/Costa_Rica',
            dateStyle: 'short',
            timeStyle: 'short'
        });
    }

    function avisar(texto, esError = false) {
        mensajeJornada.textContent = texto;
        mensajeJornada.classList.toggle('error', Boolean(esError));
    }

    function mostrarEstado(mensaje) {
        estadoBusqueda.style.display = mensaje ? 'block' : 'none';
        estadoBusqueda.textContent = mensaje || '';
    }

    /**
     * La identidad de un partido dentro de la jornada.
     *
     * El `apiFixtureId` cuando lo hay; si no, los dos equipos. Es lo que evita
     * agregar dos veces el mismo partido, y lo que hace que una jornada ya
     * guardada —cuyos partidos vienen de la base, no del buscador— se compare
     * bien con lo que se acaba de encontrar.
     */
    function claveDePartido(partido) {
        if (partido.apiFixtureId) return 'api:' + partido.apiFixtureId;
        return 'eq:' + normalizarTexto(partido.equipo1) + '|' + normalizarTexto(partido.equipo2);
    }

    function yaEstaEnLaJornada(partido) {
        const clave = claveDePartido(partido);
        return partidosDeLaJornada.some(p => claveDePartido(p) === clave);
    }

    /* ================= Qué jornada ================= */

    function esJornadaNueva() {
        return jornadaSelect.value === NUEVA;
    }

    function nombreElegido() {
        return esJornadaNueva()
            ? nombreJornadaInput.value.trim()
            : jornadaSelect.value;
    }

    async function cargarJornadas(seleccionar) {
        try {
            const respuesta = await fetch('/api/jornadas');
            const datos = await respuesta.json();

            /*
             * La ruta devuelve pares [nombre, partidos]. Se acepta también la
             * forma de objeto por si algún día cambia: la pantalla no debería
             * quedarse en blanco por eso.
             */
            const nombres = (Array.isArray(datos) ? datos : [])
                .map(item => (Array.isArray(item) ? item[0] : item?.nombre))
                .filter(Boolean);

            jornadaSelect.innerHTML = '';

            const nueva = document.createElement('option');
            nueva.value = NUEVA;
            nueva.textContent = '➕ Nueva jornada';
            jornadaSelect.appendChild(nueva);

            nombres.forEach(nombre => {
                const opcion = document.createElement('option');
                opcion.value = nombre;
                opcion.textContent = nombre;
                jornadaSelect.appendChild(opcion);
            });

            jornadaSelect.value = seleccionar && nombres.includes(seleccionar)
                ? seleccionar
                : NUEVA;

            await alCambiarDeJornada();
        } catch (error) {
            console.error('Error cargando jornadas:', error);
            avisar('No se pudieron cargar las jornadas.', true);
        }
    }

    async function alCambiarDeJornada() {
        const nueva = esJornadaNueva();

        nombreNuevaBox.style.display = nueva ? 'block' : 'none';
        eliminarJornadaButton.style.display = nueva ? 'none' : 'block';

        /*
         * OJO: aquí NO se limpia el aviso. Esta función también se llama al
         * recargar la lista después de guardar o eliminar, y borrar el mensaje
         * ahí se llevaba por delante el «jornada guardada» un instante después
         * de escribirlo. Limpiar es respuesta a que el usuario cambie de
         * jornada, así que se hace en el manejador del `change`.
         */

        if (nueva) {
            partidosDeLaJornada = [];
            nombreJornadaInput.value = '';
            renderizarJornada();
            renderizarEncontrados();
            return;
        }

        try {
            const respuesta = await fetch('/api/jornadas/' + encodeURIComponent(jornadaSelect.value));
            const datos = await respuesta.json();
            partidosDeLaJornada = Array.isArray(datos?.partidos) ? datos.partidos : [];
        } catch (error) {
            console.error('Error cargando la jornada:', error);
            partidosDeLaJornada = [];
            avisar('No se pudieron cargar los partidos de la jornada.', true);
        }

        renderizarJornada();
        renderizarEncontrados();
    }

    /* ================= Buscar partidos ================= */

    /** La opción de buscar por texto, que sobrevive a la lista dinámica. */
    function anadirOpcionesFijas() {
        if (!torneoSelect.querySelector('option[value=""]')) {
            const todos = document.createElement('option');
            todos.value = '';
            todos.textContent = 'Todos los torneos';
            torneoSelect.insertBefore(todos, torneoSelect.firstChild);
        }

        const custom = document.createElement('option');
        custom.value = 'custom';
        custom.textContent = 'Buscar por texto';
        torneoSelect.appendChild(custom);
    }

    /**
     * Llena el desplegable con las ligas que tienen partidos en el rango.
     *
     * Si falla, el desplegable NO se queda vacío: se deja la opción de buscar
     * por texto y se dice qué pasó. Un desplegable vacío y mudo es lo peor que
     * puede encontrarse quien viene a armar una jornada.
     */
    async function cargarTorneosDisponibles() {
        const desde = fechaInput.value || hoyISO();

        torneoSelect.disabled = true;
        torneoSelect.innerHTML = '<option value="">Cargando torneos…</option>';

        try {
            const respuesta = await fetch(
                '/api/football/ligas-disponibles?dias=' + DIAS_BUSQUEDA +
                '&desde=' + encodeURIComponent(desde)
            );
            const datos = await respuesta.json();

            if (!respuesta.ok) {
                torneoSelect.innerHTML = '';
                anadirOpcionesFijas();
                rangoTexto.textContent = datos.error || 'No se pudieron cargar los torneos.';
                return;
            }

            rangoDeLaBusqueda = { desde: datos.desde, hasta: datos.hasta };

            torneoSelect.innerHTML = '';
            const todos = document.createElement('option');
            todos.value = '';
            todos.textContent = 'Todos los torneos';
            torneoSelect.appendChild(todos);

            /*
             * Las favoritas de la quiniela, arriba del todo. El servidor ya las
             * sacó de su país, así que no se repiten más abajo: verlas dos veces
             * confunde más de lo que ayuda.
             */
            if ((datos.favoritas || []).length) {
                const grupoFavoritas = document.createElement('optgroup');
                grupoFavoritas.label = '⭐ Favoritas';

                datos.favoritas.forEach(liga => {
                    const opcion = document.createElement('option');
                    opcion.value = liga.id ? 'liga:' + liga.id : '';

                    /*
                     * `partidos: 0` es una favorita que esta semana no juega. Se
                     * deja a la vista pero no se puede elegir: esconderla haría
                     * pensar que la configuración se perdió, y dejarla elegible
                     * daría una búsqueda vacía sin explicar por qué.
                     */
                    if (liga.partidos) {
                        opcion.textContent = liga.nombre + ' (' + liga.partidos + ')';
                    } else {
                        opcion.textContent = liga.nombre + ' — sin partidos esta semana';
                        opcion.disabled = true;
                    }

                    grupoFavoritas.appendChild(opcion);
                });

                torneoSelect.appendChild(grupoFavoritas);
            }

            (datos.paises || []).forEach(grupo => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = grupo.pais;

                (grupo.ligas || []).forEach(liga => {
                    const opcion = document.createElement('option');
                    opcion.value = liga.id ? 'liga:' + liga.id : '';
                    /*
                     * El número de partidos no es adorno: dice de un vistazo si
                     * vale la pena entrar en esa liga esta semana.
                     */
                    opcion.textContent = liga.nombre + ' (' + liga.partidos + ')';
                    optgroup.appendChild(opcion);
                });

                torneoSelect.appendChild(optgroup);
            });

            anadirOpcionesFijas();

            /*
             * Las favoritas cuentan, pero sólo las que juegan: el total dice
             * cuántos torneos se pueden elegir, y las de «sin partidos» no.
             */
            const cuantasLigas = (datos.paises || [])
                .reduce((suma, grupo) => suma + (grupo.ligas || []).length, 0)
                + (datos.favoritas || []).filter(liga => liga.partidos).length;

            rangoTexto.textContent = cuantasLigas
                ? cuantasLigas + ' torneos con partidos entre el ' + datos.desde + ' y el ' + datos.hasta + '.'
                : 'No hay partidos entre el ' + datos.desde + ' y el ' + datos.hasta + '.';

        } catch (error) {
            console.error('Error cargando torneos:', error);
            torneoSelect.innerHTML = '';
            anadirOpcionesFijas();
            rangoTexto.textContent = 'No se pudieron cargar los torneos.';
        } finally {
            torneoSelect.disabled = false;
        }
    }

    /*
     * Se compara por ID de liga, no por nombre. El nombre lo puede cambiar el
     * proveedor cuando quiera, y entonces la opción deja de encontrar nada sin
     * decir por qué. Ver la Fase C.
     */
    function partidoCoincideConSeleccion(partido, seleccion) {
        if (!seleccion) return true;

        if (seleccion.ligaId) {
            return String(partido.apiLeagueId) === String(seleccion.ligaId);
        }

        if (seleccion.texto) {
            const texto = normalizarTexto(seleccion.texto);
            const donde = normalizarTexto(partido.liga) + ' ' + normalizarTexto(partido.pais);
            return donde.includes(texto);
        }

        return true;
    }

    async function buscarPartidos() {
        const desde = fechaInput.value || hoyISO();

        let seleccion = null;

        if (torneoSelect.value === 'custom') {
            const texto = customLeagueNameInput.value.trim();

            if (!texto) {
                mostrarEstado('Escribe el texto del torneo que quieres buscar.');
                return;
            }

            seleccion = { texto };
        } else if (torneoSelect.value.startsWith('liga:')) {
            seleccion = { ligaId: torneoSelect.value.slice('liga:'.length) };
        }

        partidosEncontrados = [];
        partidosApiContainer.innerHTML = '';
        mostrarEstado('Buscando partidos...');

        try {
            let url = '/api/football/fixtures'
                + '?from=' + encodeURIComponent(rangoDeLaBusqueda.desde || desde)
                + '&to=' + encodeURIComponent(rangoDeLaBusqueda.hasta || desde);

            /*
             * Con la liga elegida se le pide filtrada al proveedor: viaja menos
             * y se gasta menos cuota. El filtro de abajo se queda igualmente,
             * porque el proveedor no siempre respeta el parámetro.
             */
            if (seleccion && seleccion.ligaId) {
                url += '&league=' + encodeURIComponent(seleccion.ligaId);
            }

            const respuesta = await fetch(url);
            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarEstado(datos.error || 'Error buscando partidos');
                return;
            }

            const partidos = (Array.isArray(datos) ? datos : [])
                .filter(partido => partidoCoincideConSeleccion(partido, seleccion));

            /*
             * Tope de seguridad. Sin torneo elegido, una semana entera son miles
             * de partidos, y pintarlos todos deja el navegador inservible. Se
             * corta y se dice, que es mejor que colgarse en silencio.
             */
            const recortado = partidos.length > MAXIMO_PARTIDOS;
            partidosEncontrados = recortado ? partidos.slice(0, MAXIMO_PARTIDOS) : partidos;

            if (!partidosEncontrados.length) {
                mostrarEstado('No se encontraron partidos para ese torneo en esas fechas.');
                renderizarEncontrados();
                return;
            }

            mostrarEstado(recortado
                ? 'Se encontraron ' + partidos.length + ' partidos; se muestran los primeros '
                  + MAXIMO_PARTIDOS + '. Elige un torneo para acotar la búsqueda.'
                : 'Se encontraron ' + partidosEncontrados.length + ' partidos.');

            renderizarEncontrados();

        } catch (error) {
            console.error('Error buscando partidos:', error);
            mostrarEstado('Error obteniendo partidos.');
        }
    }

    function renderizarEncontrados() {
        partidosApiContainer.innerHTML = '';

        if (!partidosEncontrados.length) return;

        const acciones = document.createElement('div');
        acciones.className = 'button-stack';

        const agregar = document.createElement('button');
        agregar.type = 'button';
        agregar.id = 'agregarSeleccionadosButton';
        agregar.textContent = 'Agregar seleccionados a la jornada';
        agregar.addEventListener('click', agregarSeleccionados);

        acciones.appendChild(agregar);
        partidosApiContainer.appendChild(acciones);

        partidosEncontrados.forEach((partido, indice) => {
            const yaEsta = yaEstaEnLaJornada(partido);

            const tarjeta = document.createElement('div');
            tarjeta.className = 'match-card';
            tarjeta.innerHTML = html`
                <div class="match-header">
                    <label class="checkbox-card">
                        <input
                            type="checkbox"
                            class="partidoCheckbox"
                            data-indice="${indice}"
                            ${yaEsta ? 'disabled' : ''}
                        />
                        <span>${yaEsta ? 'Ya está en la jornada' : 'Seleccionar'}</span>
                    </label>
                </div>

                <div class="match-teams">
                    <div class="team-side">
                        ${partido.logoEquipo1 ? html`<img src="${partido.logoEquipo1}" class="team-logo" alt="${traducirEquipo(partido.equipo1)}">` : ''}
                        <strong>${traducirEquipo(partido.equipo1)}</strong>
                    </div>

                    <span class="vs">vs</span>

                    <div class="team-side">
                        ${partido.logoEquipo2 ? html`<img src="${partido.logoEquipo2}" class="team-logo" alt="${traducirEquipo(partido.equipo2)}">` : ''}
                        <strong>${traducirEquipo(partido.equipo2)}</strong>
                    </div>
                </div>

                <div class="match-meta">
                    <span>${partido.liga || 'Liga'}</span>
                    <span>${partido.pais || ''}</span>
                    <span>${fechaLegible(partido.fecha)}</span>
                </div>

                <label class="checkbox-card">
                    <input
                        type="checkbox"
                        class="comodinCheckbox"
                        data-indice="${indice}"
                        ${yaEsta ? 'disabled' : ''}
                    />
                    <span>Comodín</span>
                </label>
            `;

            partidosApiContainer.appendChild(tarjeta);
        });
    }

    function agregarSeleccionados() {
        let agregados = 0;

        partidosApiContainer.querySelectorAll('.partidoCheckbox').forEach(casilla => {
            if (!casilla.checked) return;

            const indice = Number(casilla.dataset.indice);
            const partido = partidosEncontrados[indice];
            if (!partido || yaEstaEnLaJornada(partido)) return;

            const comodin = partidosApiContainer.querySelector(
                '.comodinCheckbox[data-indice="' + indice + '"]'
            );

            /*
             * Se guarda ya con la forma de partido de jornada —`apiDate` y
             * `apiStatus`, no `fecha` y `estado`—. El servidor acepta las dos,
             * pero mandarle la buena evita que la pantalla y la base hablen
             * idiomas distintos.
             */
            partidosDeLaJornada.push({
                equipo1: traducirEquipo(partido.equipo1),
                equipo2: traducirEquipo(partido.equipo2),
                logoEquipo1: partido.logoEquipo1 || '',
                logoEquipo2: partido.logoEquipo2 || '',
                comodin: Boolean(comodin && comodin.checked),
                apiFixtureId: partido.apiFixtureId || '',
                apiLeagueId: partido.apiLeagueId || '',
                apiDate: partido.fecha || '',
                apiStatus: partido.estado || ''
            });

            agregados += 1;
        });

        if (!agregados) {
            avisar('No seleccionaste partidos nuevos.', true);
            return;
        }

        avisar(agregados + ' partido(s) agregado(s). Recuerda guardar la jornada.');
        renderizarJornada();
        renderizarEncontrados();
    }

    /* ================= Partidos de la jornada ================= */

    function renderizarJornada() {
        partidosJornadaContainer.innerHTML = '';

        if (!partidosDeLaJornada.length) {
            const vacio = document.createElement('div');
            vacio.className = 'info-card';
            vacio.textContent = 'No hay partidos en esta jornada todavía. Búscalos arriba.';
            partidosJornadaContainer.appendChild(vacio);
            return;
        }

        const titulo = document.createElement('h3');
        titulo.textContent = partidosDeLaJornada.length + ' partido(s)';
        partidosJornadaContainer.appendChild(titulo);

        partidosDeLaJornada.forEach((partido, indice) => {
            const tarjeta = document.createElement('div');
            tarjeta.className = 'match-card';
            tarjeta.innerHTML = html`
                <div class="match-teams">
                    <div class="team-side"><strong>${partido.equipo1}</strong></div>
                    <span class="vs">vs</span>
                    <div class="team-side"><strong>${partido.equipo2}</strong></div>
                </div>

                <div class="match-meta">
                    <span>${fechaLegible(partido.apiDate)}</span>
                </div>

                <label class="checkbox-card">
                    <input
                        type="checkbox"
                        class="comodinJornadaCheckbox"
                        data-indice="${indice}"
                        ${partido.comodin ? 'checked' : ''}
                    />
                    <span>Comodín</span>
                </label>

                <button type="button" class="danger-button" data-quitar="${indice}">
                    Quitar
                </button>
            `;

            partidosJornadaContainer.appendChild(tarjeta);
        });

        partidosJornadaContainer.querySelectorAll('.comodinJornadaCheckbox').forEach(casilla => {
            casilla.addEventListener('change', () => {
                partidosDeLaJornada[Number(casilla.dataset.indice)].comodin = casilla.checked;
            });
        });

        partidosJornadaContainer.querySelectorAll('[data-quitar]').forEach(boton => {
            boton.addEventListener('click', () => {
                partidosDeLaJornada.splice(Number(boton.dataset.quitar), 1);
                renderizarJornada();
                renderizarEncontrados();
            });
        });
    }

    /* ================= Guardar y eliminar ================= */

    async function guardarJornada() {
        const nombre = nombreElegido();

        if (!nombre) {
            avisar('Escribe el nombre de la jornada.', true);
            return;
        }

        if (!partidosDeLaJornada.length) {
            avisar('La jornada necesita al menos un partido.', true);
            return;
        }

        guardarJornadaButton.disabled = true;

        try {
            const respuesta = await fetch('/api/jornadas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, partidos: partidosDeLaJornada })
            });

            if (!respuesta.ok) {
                const datos = await respuesta.json().catch(() => ({}));
                avisar(datos.error || 'No se pudo guardar la jornada.', true);
                return;
            }

            avisar('Jornada «' + nombre + '» guardada.');
            await cargarJornadas(nombre);
        } catch (error) {
            console.error('Error guardando la jornada:', error);
            avisar('No se pudo guardar la jornada.', true);
        } finally {
            guardarJornadaButton.disabled = false;
        }
    }

    async function eliminarJornada() {
        if (esJornadaNueva()) return;

        const nombre = jornadaSelect.value;

        /*
         * Borrar una jornada se lleva por delante los pronósticos y los puntos
         * de todo el mundo. Se pregunta, y con el nombre dentro para que no se
         * confirme a ciegas.
         */
        if (!confirm('¿Eliminar la jornada «' + nombre + '» y todos sus pronósticos?')) return;

        try {
            const respuesta = await fetch('/api/jornadas/' + encodeURIComponent(nombre), {
                method: 'DELETE'
            });

            if (!respuesta.ok) {
                const datos = await respuesta.json().catch(() => ({}));
                avisar(datos.error || 'No se pudo eliminar la jornada.', true);
                return;
            }

            avisar('Jornada «' + nombre + '» eliminada.');
            await cargarJornadas(null);
        } catch (error) {
            console.error('Error eliminando la jornada:', error);
            avisar('No se pudo eliminar la jornada.', true);
        }
    }

    /* ================= Arranque ================= */

    jornadaSelect.addEventListener('change', () => {
        avisar('');
        alCambiarDeJornada();
    });
    buscarPartidosButton.addEventListener('click', buscarPartidos);
    guardarJornadaButton.addEventListener('click', guardarJornada);
    eliminarJornadaButton.addEventListener('click', eliminarJornada);

    torneoSelect.addEventListener('change', () => {
        customLeagueBox.style.display = torneoSelect.value === 'custom' ? 'block' : 'none';
    });

    /*
     * Cambiar la fecha cambia qué ligas juegan, así que la lista se rehace.
     * Ofrecer torneos sin partidos es justo lo que la Fase C vino a quitar.
     */
    fechaInput.addEventListener('change', cargarTorneosDisponibles);

    if (!fechaInput.value) fechaInput.value = hoyISO();

    cargarJornadas(null);
    cargarTorneosDisponibles();
});

document.addEventListener('DOMContentLoaded', () => {
    let jornadaSeleccionada = null;
    let jugadorValidado = null;

    /*
     * El selector puede no estar: este mismo script lo cargan dos pantallas
     * —llenar_jornada_user.html y llenar_jornada.html, gemelas desde antes de
     * la Fase 6— y solo una lo tiene. Sin esta comprobación el script moría en
     * la primera línea y la otra pantalla se quedaba en blanco, que es
     * exactamente lo que destapó la prueba de CSP.
     *
     * Sin selector la pantalla sigue funcionando: abre en la jornada sugerida y
     * ya no se puede cambiar, que es lo que hacía antes de la Fase B.
     */
    const selectorJornada = document.getElementById('jornadaSelect');

    /*
     * Fase B. Antes esto era `data[data.length - 1].nombre`: el último elemento
     * del arreglo que devolviera Mongo, sin orden garantizado, y con dos jornadas
     * jugándose a la vez no había manera de llegar a la otra. Ahora por cuál se
     * abre lo decide el servidor con la regla de las fechas, la misma que usan la
     * tabla por jornada y los resultados oficiales.
     *
     * La respuesta trae también la lista, así que llenar el desplegable no cuesta
     * una segunda petición.
     */
    fetch('/api/jornada-actual')
        .then(response => response.json())
        .then(data => {
            const jornadas = data.jornadas || [];

            if (!jornadas.length) {
                console.error('No hay jornadas disponibles');
                return;
            }

            jornadaSeleccionada = data.sugerida || jornadas[0].nombre;

            if (selectorJornada) {
                selectorJornada.innerHTML = jornadas
                    .map(j => html`<option value="${j.nombre}">${j.nombre}</option>`)
                    .join('');
                selectorJornada.value = jornadaSeleccionada;
            }

            loadPartidos(jornadaSeleccionada);
        })
        .catch(error => console.error('Error al cargar las jornadas:', error));

    /*
     * Cambiar de jornada obliga a revalidar lo que hay en pantalla: los
     * marcadores son de la jornada anterior y guardarlos en otra escribiría
     * pronósticos que nadie escribió. Se limpia y se vuelven a cargar los que
     * el jugador ya tuviera guardados en la jornada nueva.
     */
    if (selectorJornada) {
        selectorJornada.addEventListener('change', async () => {
            jornadaSeleccionada = selectorJornada.value;
            limpiarMarcadores();
            loadPartidos(jornadaSeleccionada);

            if (jugadorValidado) {
                await cargarResultadosGuardados(jugadorValidado, jornadaSeleccionada);
            }
        });
    }

    // Cargar jugadores en combo
    fetch('/api/auth/me')
        .then(res => res.json())
        .then(data => {
            const jugadores = [data.usuario.username];
            const combo = document.getElementById('comboJugadores');
            combo.innerHTML = '<option value="">Seleccione un jugador</option>';
            jugadores.forEach(j => {
                const opt = document.createElement('option');
                opt.value = j;
                opt.textContent = j;
                combo.appendChild(opt);
            });
            combo.value = data.usuario.username;
            combo.dispatchEvent(new Event('change'));
        });

    // Botones
    document.getElementById('copiarTextoButton').addEventListener('click', copiarResultados);
    document.getElementById('enviarWhatsappButton').addEventListener('click', enviarPorWhatsapp);

    document.getElementById('guardarResultadosButton').addEventListener('click', () => {
         guardarResultados(jornadaSeleccionada, jugadorValidado);
    });

    document.getElementById('comboJugadores').addEventListener('change', async () => {
        const combo = document.getElementById('comboJugadores');
        const jugador = combo.value;

        jugadorValidado = null;
        limpiarMarcadores();

        if (!jugador) return;

        const jugadorData = await fetch(`/api/jugador/${encodeURIComponent(jugador)}`).then(r => r.json());

        if (!jugadorData.password) {
            alert("Su jugador no tiene contraseña aún, hable con el administrador");
            combo.value = '';
            return;
        }

        let passwordCorrecta = false;

        while (!passwordCorrecta) {
            const passwordIngresada = await pedirPasswordModal(jugador);

            if (passwordIngresada === null) {
                combo.value = '';
                limpiarMarcadores();
                return;
            }

            const resp = await fetch(`/api/jugadores/${encodeURIComponent(jugador)}/verificar-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: passwordIngresada })
            });

        const data = await resp.json();

            if (!resp.ok || !data.success) {
                    alert(data.error || "Contraseña incorrecta.");
            } else {
                passwordCorrecta = true;
                jugadorValidado = jugador;
                await cargarResultadosGuardados(jugador, jornadaSeleccionada);
            }
        }
    });




});

function loadPartidos(nombreJornada) {
    /*
     * Se pide la jornada concreta y no la lista entera: esta pantalla solo
     * pinta una. Antes traía todas las jornadas con todos sus partidos y
     * buscaba la suya dentro, dos veces por carga.
     */
    fetch(`/api/jornadas/${encodeURIComponent(nombreJornada)}`)
        .then(response => {
            if (!response.ok) throw new Error('Jornada no encontrada: ' + nombreJornada);
            return response.json();
        })
        .then(jornada => mostrarPartidos(jornada.partidos, jornada.nombre))
        .catch(error => console.error('Error al cargar los partidos:', error));
}

function logoHTML(url, nombre) {
    if (!url) return '';
    return html`<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
}

/**
 * La caja del centro: el marcador de verdad, si ya hay alguno.
 *
 * ⚠️ El dato YA venía en la página y se estaba tirando. Esta pantalla pedía los
 * resultados oficiales sólo para mirar el `estado` y decidir si bloqueaba; el
 * marcador y el minuto llegaban con él y nadie los pintaba.
 *
 * Tres situaciones, y cada una dice algo distinto:
 *
 *   en juego   →  el marcador de ahora, con el minuto
 *   terminado  →  el marcador final, quieto
 *   sin dato   →  un guion: todavía no hay nada que contar
 */
function cajaDeMarcador(oficial, cerrado) {
    const hayMarcador = oficial
        && oficial.marcador1 !== null && oficial.marcador1 !== undefined && oficial.marcador1 !== ''
        && oficial.marcador2 !== null && oficial.marcador2 !== undefined && oficial.marcador2 !== '';

    if (!hayMarcador) {
        /*
         * Un partido cerrado sin marcador NO es lo mismo que uno por jugar: es
         * «ya no puedes cambiarlo y todavía no se sabe». El guion vale para los
         * dos, pero el rótulo de arriba ya los distingue.
         */
        return html`<div class="match-score ${cerrado ? 'match-score-cerrado' : ''}">
            <span class="match-score-vacio">–</span>
        </div>`;
    }

    const enVivo = oficial.estado === 'LIVE' || oficial.estado === 'MT';

    /* El minuto sólo mientras corre: en uno terminado sobra y confunde. */
    const pie = enVivo
        ? html`<span class="match-score-minuto">${
            oficial.estado === 'MT' ? 'Medio tiempo' : (oficial.minuto ? oficial.minuto + "'" : 'En juego')
          }</span>`
        : '';

    return html`<div class="match-score ${enVivo ? 'match-score-vivo' : 'match-score-final'}">
        <span class="match-score-cifras">${oficial.marcador1} - ${oficial.marcador2}</span>
        ${pie}
    </div>`;
}

/*
 * ============================================================================
 * EL MARCADOR EN VIVO, SIN REGALARLE TRÁFICO A NADIE
 * ============================================================================
 *
 * ⛔ CADA PETICIÓN SE PAGA. La cuota de transferencia ya se agotó una vez, y
 * fue por algo que parecía inofensivo: una consulta cada minuto que crecía sola
 * con el calendario. Así que aquí cada viaje a la red tiene que justificarse.
 *
 * Las cinco reglas, y por qué cada una:
 *
 *   1. **Cada 60 segundos, ni uno menos.** No es un número elegido a ojo: el
 *      sincronizador consulta al proveedor cada 60 s mientras un partido está
 *      en vivo (`VENTANAS_MS.enVivo`). Preguntar más seguido devolvería LO
 *      MISMO — sería pagar por una respuesta que ya teníamos.
 *
 *   2. **Sólo si hay algo que mirar.** Un partido que aún no empieza no cambia,
 *      y uno terminado tampoco. Sin nada en marcha no se pregunta: cero.
 *
 *   3. **Pestaña escondida, nada.** Un móvil con la pantalla en el bolsillo no
 *      necesita el minuto 37.
 *
 *   4. **Todo terminado, se para para siempre.** El reloj se apaga y no vuelve.
 *
 *   5. **Sólo esta jornada.** Ya va en `?jornada=`.
 */
const MS_REFRESCO_EN_VIVO = 60 * 1000;

let relojEnVivo = null;
let ultimaConsultaEnVivo = 0;
let refrescoVigente = null;
let oyenteVisibilidadPuesto = false;

/**
 * ¿Merece la pena preguntar?
 *
 * ⚠️ La condición NO es «hay alguno en vivo»: entonces nunca se enteraría de
 * que uno EMPIEZA. Es «ya debería haber empezado y todavía no ha terminado»,
 * que incluye el hueco entre el pitido inicial y el momento en que el proveedor
 * se da por enterado.
 */
function hayAlgoQueMirar(partidos, oficialDe) {
    return partidos.some(partido => {
        if (!fechaPartidoYaPaso(partido.apiDate)) return false;
        return oficialDe(partido)?.estado !== 'TC';
    });
}

/** ¿Se acabó del todo? Entonces el reloj sobra. */
function todoTerminado(partidos, oficialDe) {
    return partidos.every(partido =>
        fechaPartidoYaPaso(partido.apiDate) && oficialDe(partido)?.estado === 'TC');
}

function vigilarMarcadores(nombreJornada, partidos, oficialesIniciales) {
    /* Cambiar de jornada apaga el reloj anterior: si no, se acumularían. */
    if (relojEnVivo) { clearInterval(relojEnVivo); relojEnVivo = null; }

    const emparejar = (lista, partido) => lista.find(o =>
        (o.equipo1 === partido.equipo1 && o.equipo2 === partido.equipo2) ||
        (o.equipo1 === partido.equipo2 && o.equipo2 === partido.equipo1));

    /*
     * ⚠️ Se arranca con lo que YA se trajo al pintar, no con una lista vacía.
     * Vacía, `hayAlgoQueMirar` no sabría que un partido ya terminó y pediría
     * una vuelta de más en la primera pasada.
     */
    let ultimos = oficialesIniciales || [];

    async function refrescar(forzado = false) {
        if (document.hidden) return;                       // Regla 3
        if (!hayAlgoQueMirar(partidos, p => emparejar(ultimos, p))) return;   // Regla 2

        /*
         * ⚠️ El cerrojo de los 60 s vale TAMBIÉN para el refresco al volver a
         * la pestaña. Sin él, entrar y salir diez veces en un minuto serían
         * diez peticiones por diez miradas que ven lo mismo.
         */
        const ahora = Date.now();
        if (!forzado && ahora - ultimaConsultaEnVivo < MS_REFRESCO_EN_VIVO - 1000) return;
        if (forzado && ahora - ultimaConsultaEnVivo < MS_REFRESCO_EN_VIVO) return;
        ultimaConsultaEnVivo = ahora;

        try {
            const res = await fetch(
                '/api/resultados-oficiales?jornada=' + encodeURIComponent(nombreJornada));
            const datos = await res.json();
            ultimos = (datos.find(o => o.nombre === nombreJornada) || {}).partidos || [];
        } catch (e) {
            /* Un fallo de red no apaga el reloj: al minuto se reintenta. */
            return;
        }

        pintarMarcadoresEnVivo(partidos, p => emparejar(ultimos, p));

        if (todoTerminado(partidos, p => emparejar(ultimos, p))) {   // Regla 4
            clearInterval(relojEnVivo);
            relojEnVivo = null;
        }
    }

    /* Lo que ya se pintó al cargar cuenta como la consulta de este minuto. */
    ultimaConsultaEnVivo = Date.now();
    relojEnVivo = setInterval(refrescar, MS_REFRESCO_EN_VIVO);   // Regla 1

    /*
     * ⚠️ El oyente de visibilidad se registra UNA vez en toda la vida de la
     * página, y llama a la vigilancia que esté vigente. Registrado aquí sin más,
     * cada cambio de jornada dejaría otro encima y volver a la pestaña
     * dispararía tantas peticiones como jornadas se hubieran mirado.
     */
    refrescoVigente = refrescar;

    if (!oyenteVisibilidadPuesto) {
        oyenteVisibilidadPuesto = true;
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && refrescoVigente) refrescoVigente(true);
        });
    }
}

/**
 * Repinta SÓLO los marcadores, y cierra lo que se haya cerrado.
 *
 * ⛔ NO SE TOCA NI UN `input.value`. Quien está llenando su quiniela puede tener
 * medio marcador escrito sin guardar; un refresco que reescriba las casillas le
 * borraría lo que estaba haciendo, cada minuto, sin avisar. Aquí se cambia la
 * caja del centro y, como mucho, se deshabilita lo que ya no se puede tocar.
 */
function pintarMarcadoresEnVivo(partidos, oficialDe) {
    const tarjetas = document.querySelectorAll('.partido-container');

    partidos.forEach((partido, i) => {
        const tarjeta = tarjetas[i];
        if (!tarjeta) return;

        const oficial = oficialDe(partido);
        const caja = tarjeta.querySelector('.match-score');
        const cerrado = Boolean(oficial && ['LIVE', 'MT', 'TC'].includes(oficial.estado))
            || fechaPartidoYaPaso(partido.apiDate);

        if (caja) caja.outerHTML = String(cajaDeMarcador(oficial, cerrado));

        if (cerrado) {
            tarjeta.classList.add('partido-cerrado');
            tarjeta.querySelectorAll('input, .stepper-btn')
                .forEach(elemento => { elemento.disabled = true; });
        }
    });
}

/**
 * Los botones de subir y bajar, por delegación.
 *
 * ⚠️ UN solo oyente en el contenedor y no uno por botón: una jornada de diez
 * partidos son cuarenta botones, y cuarenta oyentes que además habría que
 * retirar cada vez que se repinta la lista.
 */
function conectarBotonesDeMarcador(contenedor) {
    /*
     * ⛔ Una sola vez por contenedor.
     *
     * `mostrarPartidos` vacía el contenedor y lo vuelve a llenar, pero el
     * contenedor MISMO sobrevive. Sin esta marca, cada repintado añadiría otro
     * oyente encima del anterior y un toque en «+» sumaría dos, luego tres —un
     * fallo que sólo aparece después de recargar la lista, que es justo cuando
     * nadie está mirando.
     */
    if (contenedor.dataset.botonesConectados === 'si') return;
    contenedor.dataset.botonesConectados = 'si';

    contenedor.addEventListener('click', evento => {
        const boton = evento.target.closest('.stepper-btn');
        if (!boton || boton.disabled) return;

        const campo = boton.parentElement.querySelector('input');
        if (!campo || campo.disabled) return;

        /*
         * ⛔ VACÍO NO ES CERO, Y ESA DIFERENCIA GUARDA PRONÓSTICOS.
         *
         * El campo nace vacío a propósito: «no pronostiqué» y «pronostiqué 0»
         * son cosas distintas para el que guarda —dos vacíos borran, uno solo
         * no se manda—, y confundirlas ya borró marcadores una vez.
         *
         * Así que el primer toque en «+» pone 1, y el primero en «−» pone 0.
         * Bajar desde vacío a −1 no existe; bajar desde 0 tampoco, y ahí se
         * queda en 0 en vez de vaciarse: vaciar es una decisión, no un resbalón.
         */
        const vacio = campo.value.trim() === '';
        const paso = Number(boton.dataset.paso);
        const actual = vacio ? (paso > 0 ? 0 : 1) : Number(campo.value);

        if (Number.isNaN(actual)) { campo.value = paso > 0 ? '1' : '0'; return; }

        campo.value = String(Math.max(0, Math.min(99, actual + paso)));
    });
}

function formatearFechaPartido(apiDate) {
    if (!apiDate) return 'Fecha no disponible';

    const fecha = new Date(String(apiDate).replace(' ', 'T'));

    if (Number.isNaN(fecha.getTime())) {
        return apiDate;
    }

    return fecha.toLocaleString('es-CR', {
        timeZone: 'America/Costa_Rica',
        dateStyle: 'short',
        timeStyle: 'short'
    });
}

function fechaPartidoYaPaso(apiDate) {
    const fecha = parseFechaPartidoCostaRica(apiDate);
    if (!fecha) return false;
    return fecha <= new Date();
}

function obtenerFechaPartido(apiDate) {
    return parseFechaPartidoCostaRica(apiDate);
}



let contadoresEnMarcha = false;

function iniciarContadoresPartidos() {
    /*
     * ⛔ Un solo reloj para toda la página.
     *
     * Esto se llamaba desde `mostrarPartidos`, que corre cada vez que se cambia
     * de jornada: cada repintado dejaba OTRO `setInterval` vivo encima del
     * anterior, y ninguno se detenía nunca. No se veía porque todos escriben lo
     * mismo, pero se acumulaban mientras la pestaña siguiera abierta.
     */
    if (contadoresEnMarcha) { pintarContadores(); return; }
    contadoresEnMarcha = true;

    /* Una pasada YA: si no, el primer segundo se ve «Cierra en:» sin nada. */
    pintarContadores();
    setInterval(pintarContadores, 1000);
}

function pintarContadores() {
    {
        document.querySelectorAll('.contador-partido').forEach(span => {
            const fechaCierre = new Date(span.dataset.fecha);
            const diff = fechaCierre - new Date();

            if (diff <= 0) {
                span.textContent = 'Partido cerrado';
                return;
            }

            const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
            const horas = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const segundos = Math.floor((diff % (1000 * 60)) / 1000);

            span.textContent = dias > 0
                ? `${dias}d ${horas}h ${minutos}m ${segundos}s`
                : `${horas}h ${minutos}m ${segundos}s`;
        });
    }
}

function parseFechaPartidoCostaRica(apiDate) {
    if (!apiDate) return null;

    const raw = String(apiDate).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);

    if (!match) {
        const fallback = new Date(raw);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    }

    const [, year, month, day, hour, minute] = match.map(Number);

    return new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));
}


      
async function mostrarPartidos(partidos, nombreJornada) {
    const partidosContainer = document.getElementById('partidosContainer');
    partidosContainer.innerHTML = '';

    let oficialesJornada = [];

/*
 * ⛔ SE PIDE **UNA** JORNADA, NO TODAS.
 *
 * Esto se traía los resultados oficiales de TODAS las jornadas de la quiniela
 * y se quedaba con una, filtrando en el navegador. Las demás viajaban por la
 * red para ser descartadas nada más llegar.
 *
 * El parámetro `?jornada=` existe en el servidor desde la M-26 y está puesto
 * justamente para esto; esta pantalla nunca llegó a usarlo.
 *
 * ⚠️ Y el tráfico se PAGA: es la misma cuota de Neon que ya se agotó una vez.
 * La respuesta sigue siendo un arreglo —con una sola jornada dentro—, así que
 * el `find` de abajo vale igual y no hay nada más que cambiar.
 */
try {
  const oficialesRes = await fetch(
    '/api/resultados-oficiales?jornada=' + encodeURIComponent(nombreJornada));
  const oficialesData = await oficialesRes.json();
  const oficial = oficialesData.find(o => o.nombre === nombreJornada);
  oficialesJornada = oficial ? oficial.partidos : [];
} catch (e) {
  console.error('Error cargando oficiales:', e);
}

function buscarOficial(partido) {
  return oficialesJornada.find(o =>
    (o.equipo1 === partido.equipo1 && o.equipo2 === partido.equipo2) ||
    (o.equipo1 === partido.equipo2 && o.equipo2 === partido.equipo1)
  );
}

function partidoBloqueado(partido) {
  const oficial = buscarOficial(partido);

  if (oficial && ['LIVE', 'MT', 'TC'].includes(oficial.estado)) return true;

  if (!partido.apiDate) return false;

  const fecha = parseFechaPartidoCostaRica(partido.apiDate)

  
  if (!fecha || Number.isNaN(fecha.getTime())) return false;

  return fecha <= new Date();
}

    
    
    iniciarContadoresPartidos();

    partidos.forEach((partido, i) => {
        const partidoDiv = document.createElement('div');

        partidoDiv.classList.add('partido-container');        

        if (partido.comodin) {
            partidoDiv.classList.add('partido-comodin');
        }

        partidoDiv.dataset.equipo1 = partido.equipo1 || '';
        partidoDiv.dataset.equipo2 = partido.equipo2 || '';
        partidoDiv.dataset.comodin = partido.comodin ? 'true' : 'false';


        const estiloNegrita = partido.comodin
            ? 'font-weight: bold;'
            : '';
        
        const bloqueado = partidoBloqueado(partido);
        const fechaPaso = fechaPartidoYaPaso(partido.apiDate);

        if (bloqueado || fechaPaso) {
    partidoDiv.classList.add('partido-cerrado');
}


const textoBloqueo = bloqueado || fechaPaso
    ? html`<div class="status-pill status-finished">🔒 Partido cerrado</div>`
    : html`<div class="status-pill status-scheduled">Disponible</div>`;

const fechaPartido = obtenerFechaPartido(partido.apiDate);

const contadorHTML = !bloqueado && !fechaPaso && fechaPartido
    ? html`
        <span>
            ⏳ Cierra en:
            <strong class="contador-partido" data-fecha="${fechaPartido.toISOString()}"></strong>
        </span>
      `
    : '';

/*
 * ⚠️ El distintivo de comodín va AQUÍ, en el renglón, y no flotando.
 *
 * Estaba con `position: absolute` en la esquina, y con la tarjeta nueva se
 * montaba encima del rótulo de «Disponible»: dos cosas escritas en el mismo
 * sitio. Dentro del renglón se coloca solo y no puede pisar a nadie.
 */
const fechaPartidoHTML = html`
    <div class="match-meta">
        <span>📅 ${formatearFechaPartido(partido.apiDate)}</span>
        ${textoBloqueo}
        ${partido.comodin ? html`<span class="comodin-badge">⭐ COMODÍN</span>` : ''}
        ${contadorHTML}
    </div>
`;





        /*
         * ====================================================================
         * ⛔ EXACTAMENTE DOS `<input>` POR TARJETA, Y EN ESTE ORDEN
         * ====================================================================
         *
         * Tres sitios del archivo hacen `partidoDiv.querySelectorAll('input')`
         * y cuentan con que `[0]` sea el marcador local y `[1]` el visitante —
         * ahí cuelgan las defensas de la Entrada 068, la que impedía que editar
         * un partido borrara en silencio el pronóstico de otro.
         *
         * Por eso los botones de subir y bajar son `<button>` y NO `<input
         * type="button">`: así la cuenta de inputs no cambia y esas defensas
         * siguen en pie sin tocarlas.
         */
        const marcadorHTML = cajaDeMarcador(buscarOficial(partido), bloqueado || fechaPaso);

        partidoDiv.innerHTML = html`
           ${fechaPartidoHTML}

            <div class="match-row">
                <div class="team-side">
                    ${logoHTML(partido.logoEquipo1, partido.equipo1)}
                    <span class="team-name" style="${estiloNegrita}">${partido.equipo1}</span>
                </div>

                ${marcadorHTML}

                <div class="team-side">
                    ${logoHTML(partido.logoEquipo2, partido.equipo2)}
                    <span class="team-name" style="${estiloNegrita}">${partido.equipo2}</span>
                </div>
            </div>

            <!--
              ⚠️ El rótulo cambia de tiempo verbal, y no es adorno: con la
              tarjeta partida en dos renglones hay DOS marcadores a la vista —el
              del partido y el tuyo— y hay que decir cuál es cuál. Cerrado dice
              «Pusiste», que es lo que Marco pidió ver cuando el partido acaba.
            -->
            <div class="pick-label">${bloqueado || fechaPaso ? 'Pusiste' : 'Tu pronóstico'}</div>

            <div class="pick-row">
                <div class="stepper">
                    <button type="button" class="stepper-btn" data-paso="-1"
                            aria-label="Bajar el marcador de ${partido.equipo1}"
                            ${bloqueado ? 'disabled' : ''}>−</button>
                    <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="2"
                        id="resultadoEquipo1_${i}"
                        aria-label="Tu marcador para ${partido.equipo1}"
                        ${bloqueado ? 'disabled' : ''}>
                    <button type="button" class="stepper-btn" data-paso="1"
                            aria-label="Subir el marcador de ${partido.equipo1}"
                            ${bloqueado ? 'disabled' : ''}>+</button>
                </div>

                <span class="pick-sep" aria-hidden="true"></span>

                <div class="stepper">
                    <button type="button" class="stepper-btn" data-paso="-1"
                            aria-label="Bajar el marcador de ${partido.equipo2}"
                            ${bloqueado ? 'disabled' : ''}>−</button>
                    <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="2"
                        id="resultadoEquipo2_${i}"
                        aria-label="Tu marcador para ${partido.equipo2}"
                        ${bloqueado ? 'disabled' : ''}>
                    <button type="button" class="stepper-btn" data-paso="1"
                            aria-label="Subir el marcador de ${partido.equipo2}"
                            ${bloqueado ? 'disabled' : ''}>+</button>
                </div>
            </div>

            <label style="display:none;">
                Comodín: ${partido.comodin ? 'Sí' : 'No'}
            </label>
        `;

        partidosContainer.appendChild(partidoDiv);
    });

    conectarBotonesDeMarcador(partidosContainer);

    /*
     * ⚠️ DESPUES de pintar, no antes. La primera pasada del contador busca
     * los `.contador-partido` en el DOM; llamada antes del bucle no
     * encontraba ninguno y el renglon se veia vacio el primer segundo.
     */
    iniciarContadoresPartidos();

    vigilarMarcadores(nombreJornada, partidos, oficialesJornada);
}


function copiarResultados() {
    const nombreJugador = document.getElementById('comboJugadores').value;
    const partidosContainer = document.getElementById('partidosContainer');

    let textoResultado = '';
    let contador = 1;

    textoResultado += `-------------------------------\n`;
    textoResultado += `Nombre: ${nombreJugador || '[Sin nombre]'}\n`;
    textoResultado += `-------------------------------\n`;

    Array.from(partidosContainer.children)
        .filter(div => div.classList.contains('partido-container'))
        .forEach((partidoDiv, index) => {
            const equipo1 = partidoDiv.dataset.equipo1 || '';
            const equipo2 = partidoDiv.dataset.equipo2 || '';

            /*
             * ⚠️ `marcadorVisible` y no `|| '0'` (Entrada 068). Este texto se
             * copia y se manda por WhatsApp: un partido sin llenar salía como
             * «0» y quedaba escrito que la persona había pronosticado 0-0.
             */
            const resultado1 = marcadorVisible(document.getElementById(`resultadoEquipo1_${index}`)?.value);
            const resultado2 = marcadorVisible(document.getElementById(`resultadoEquipo2_${index}`)?.value);

            const comodin = partidoDiv.dataset.comodin === 'true';
            const formato = comodin ? '*' : '';

            if (comodin) textoResultado += "\n*(Comodín)*";

            textoResultado += `\n${contador}. ${formato}${equipo1} ${resultado1}${formato}\n  ${formato}${equipo2} ${resultado2}${formato}\n`;

            contador++;
        });

    navigator.clipboard.writeText(textoResultado)
        .then(() => {
            alert('Texto copiado al portapapeles');
        })
        .catch(error => {
            console.error('Error copiando texto:', error);
            alert('No se pudo copiar el texto.');
        });
}


function enviarPorWhatsapp() {
    const nombreJugador = document.getElementById('comboJugadores').value;
    const partidosContainer = document.getElementById('partidosContainer');

    let textoResultado = '';
    let contador = 1;

    textoResultado += `-------------------------------\n`;
    textoResultado += `Nombre: ${nombreJugador || '[Sin nombre]'}\n`;
    textoResultado += `-------------------------------\n`;

    Array.from(partidosContainer.children)
        .filter(div => div.classList.contains('partido-container'))
        .forEach((partidoDiv, index) => {
            const equipo1 = partidoDiv.dataset.equipo1 || '';
            const equipo2 = partidoDiv.dataset.equipo2 || '';

            /*
             * ⚠️ `marcadorVisible` y no `|| '0'` (Entrada 068). Este texto se
             * copia y se manda por WhatsApp: un partido sin llenar salía como
             * «0» y quedaba escrito que la persona había pronosticado 0-0.
             */
            const resultado1 = marcadorVisible(document.getElementById(`resultadoEquipo1_${index}`)?.value);
            const resultado2 = marcadorVisible(document.getElementById(`resultadoEquipo2_${index}`)?.value);

            const comodin = partidoDiv.dataset.comodin === 'true';
            const formato = comodin ? '*' : '';

            if (comodin) textoResultado += "\n*(Comodín)*";

            textoResultado += `\n${contador}. ${formato}${equipo1} ${resultado1}${formato}\n  ${formato}${equipo2} ${resultado2}${formato}\n`;

            contador++;
        });

    const mensajeWhatsapp = encodeURIComponent(textoResultado);
    window.open(`https://wa.me/?text=${mensajeWhatsapp}`, '_blank');
}



function pedirPasswordModal(jugador) {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('modalPassword');
        const input = document.getElementById('inputPassword');
        const btnOk = document.getElementById('btnPasswordOk');
        const btnCancel = document.getElementById('btnPasswordCancel');

        modal.style.display = 'flex';
        input.value = '';
        input.focus();

        function cerrarModal() {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', okHandler);
            btnCancel.removeEventListener('click', cancelHandler);
        }

        function okHandler() {
            const val = input.value;
            cerrarModal();
            resolve(val);
        }

        function cancelHandler() {
            cerrarModal();
            resolve(null);
        }

        btnOk.addEventListener('click', okHandler);
        btnCancel.addEventListener('click', cancelHandler);
    });
}


function limpiarMarcadores() {
    document.querySelectorAll('.partido-container').forEach(partidoDiv => {
        const inputs = partidoDiv.querySelectorAll('input');

        if (inputs[0]) inputs[0].value = '';
        if (inputs[1]) inputs[1].value = '';
    });
}

async function cargarResultadosGuardados(jugador, jornada) {
    if (!jugador || !jornada) return;

    try {
        const res = await fetch(`/api/resultados/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`);
        const pronosticos = await res.json();

        if (!Array.isArray(pronosticos) || pronosticos.length === 0) return;

        pronosticos.forEach((p, index) => {
            const input1 = document.getElementById(`resultadoEquipo1_${index}`);
            const input2 = document.getElementById(`resultadoEquipo2_${index}`);

            if (input1) input1.value = p.marcador1 ?? '';
            if (input2) input2.value = p.marcador2 ?? '';
        });

    } catch (error) {
        console.error('Error cargando resultados guardados:', error);
    }
}




async function guardarResultados(jornada, jugadorValidado) {
    const combo = document.getElementById('comboJugadores');
    const jugador = combo.value;
    if (!jugador) {
        alert("Seleccione un jugador");
        return;
    }


    if (jugador !== jugadorValidado) {
        alert("Debe seleccionar el jugador y validar la contraseña antes de guardar.");
        return;
    }


    /*
     * ============================================================
     * ⛔ LO QUE NO SE PUEDE GUARDAR SE MANDA COMO `null`, NO VACÍO
     * ============================================================
     *
     * Antes, un partido a medias —un marcador escrito y el otro en blanco— se
     * mandaba con LOS DOS en blanco, y el servidor lo tomaba como «déjalo todo
     * a nulo»: **borraba el pronóstico que la persona ya tenía guardado**. Un
     * 2-1 de la semana pasada desaparecía por editar otra cosa, sin error y sin
     * aviso (Entrada 068).
     *
     * Desde el arreglo, la posición que va como `null` significa «no toques
     * este partido», y sólo dos casillas vacías a propósito borran. Así:
     *
     *   - a medias  → `null` → lo guardado sigue intacto, y se avisa;
     *   - cerrado   → `null` → el servidor ya lo ignoraba, pero ahora se dice
     *                 con el mismo lenguaje en vez de mandar vacíos;
     *   - vacío     → `{'',''}` → se quita el pronóstico, que es como se borra.
     */
    const pronosticos = [];
    const partidosAMedias = [];
    let errorDetectado = false;

    Array.from(document.querySelectorAll('.partido-container')).forEach((partidoDiv, index) => {
        const inputs = partidoDiv.querySelectorAll('input');

        // Cerrado: no se manda nada suyo. Ver arriba.
        if (inputs[0].disabled || inputs[1].disabled) {
            pronosticos.push(null);
            return;
        }

        const marcador1 = inputs[0].value.trim();
        const marcador2 = inputs[1].value.trim();

        // Los dos en blanco: es «no quiero pronosticar este partido».
        if (marcador1 === '' && marcador2 === '') {
            pronosticos.push({ marcador1: '', marcador2: '' });
            return;
        }

        // Uno sí y otro no: no es medio pronóstico, es ninguno. No se manda.
        if (marcador1 === '' || marcador2 === '') {

            partidosAMedias.push(index + 1);

            pronosticos.push(null);

            return;
        }

        // Validación de números
        if (isNaN(marcador1) || isNaN(marcador2)) {
            alert(`Error: solo se permiten valores numéricos en el partido ${index + 1}`);
            errorDetectado = true;
            pronosticos.push(null);
            return;
        }

        pronosticos.push({
            marcador1,
            marcador2
        });
    });

    if (errorDetectado) {
        return;
    }

    /*
     * ⚠️ El aviso dice QUÉ partidos y QUÉ les pasa. El de antes —«Faltan
     * resultados por agregar»— callaba lo único importante: que al aceptar se
     * borraba lo que ya estaba guardado.
     */
    if (partidosAMedias.length) {

        const cuales = partidosAMedias.join(', ');
        const plural = partidosAMedias.length > 1;

        const continuar = confirm(
            `${plural ? 'Los partidos' : 'El partido'} ${cuales} ${plural ? 'tienen' : 'tiene'} `
            + `un solo marcador, así que no se ${plural ? 'guardan' : 'guarda'}.\n\n`
            + `Si ya ${plural ? 'tenían' : 'tenía'} algo guardado, se queda como está. `
            + 'El resto sí se guarda.\n\n¿Continuar?'
        );

        if (!continuar) {
            return;
        }
    }



    // 5. Guardar en backend
    const res = await fetch('/api/resultados', {
    method: 'POST',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jugador, jornada, pronosticos })
});

const data = await res.json();

if (!res.ok || !data.success) {
    alert(data.error || "No se pudieron guardar los resultados.");
    return;
}

await cargarResultadosGuardados(jugador, jornada);

alert(resumenDeGuardado(data, partidosAMedias));


}

/**
 * El mensaje de después de guardar, con lo que de verdad pasó.
 *
 * ⚠️ Antes esto era `alert(data.mensaje || "Resultados guardados
 * correctamente.")` — y esa ruta **nunca ha mandado un `mensaje`**, así que
 * siempre salía «correctamente», incluso cuando no se había guardado ni un
 * pronóstico porque todos los partidos ya habían empezado. El servidor mandaba
 * los contadores y el navegador los tiraba: el mismo fallo que la Entrada 063
 * encontró en las jornadas (Entrada 068).
 */
function resumenDeGuardado(data, partidosAMedias = []) {
    const partes = [];

    partes.push(data.guardados
        ? `Se guardaron ${data.guardados} pronóstico(s).`
        : 'No se guardó ningún pronóstico.');

    if (data.borrados) {
        partes.push(`Se quitaron ${data.borrados} que habías dejado en blanco.`);
    }

    if (data.bloqueados) {
        partes.push(`${data.bloqueados} partido(s) ya habían empezado y no se modificaron.`);
    }

    if (partidosAMedias.length) {
        partes.push(`${partidosAMedias.length} quedaron a medias y se dejaron como estaban.`);
    }

    return partes.join('\n');
}

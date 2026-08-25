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



function iniciarContadoresPartidos() {
    setInterval(() => {
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
    }, 1000);
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

try {
  const oficialesRes = await fetch('/api/resultados-oficiales');
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

const fechaPartidoHTML = html`
    <div class="match-meta" style="justify-content:center; margin-bottom:10px;">
        <span>📅 ${formatearFechaPartido(partido.apiDate)}</span>
        ${textoBloqueo}
        ${contadorHTML}
    </div>
`;





        partidoDiv.innerHTML = html`
           ${fechaPartidoHTML}
            <div class="match-teams">
                ${partido.comodin ? html`<div class="comodin-badge">⭐ COMODÍN</div>` : ''}

                <div class="team-side">
                    ${logoHTML(partido.logoEquipo1, partido.equipo1)}

                    <label style="${estiloNegrita}">
                        ${partido.equipo1}
                    </label>
                </div>

                <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="2"
                id="resultadoEquipo1_${i}"
                ${bloqueado ? 'disabled' : ''}
>

                <label style="${estiloNegrita}">
                    vs
                </label>

            <input
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="2"
            id="resultadoEquipo2_${i}"
            ${bloqueado ? 'disabled' : ''}
>

                <div class="team-side">
                    ${logoHTML(partido.logoEquipo2, partido.equipo2)}

                    <label style="${estiloNegrita}">
                        ${partido.equipo2}
                    </label>
                </div>

                <label style="display:none;">
                    Comodín: ${partido.comodin ? 'Sí' : 'No'}
                </label>

            </div>
        `;

        partidosContainer.appendChild(partidoDiv);
    });
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

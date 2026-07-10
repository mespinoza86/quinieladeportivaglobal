document.addEventListener('DOMContentLoaded', () => {
    let ultimaJornada = null;
    let fechaCierreGlobal = null;
    let jugadorValidado = null;


    // Cargar jornadas
    fetch('/api/jornadas')
        .then(response => response.json())
        .then(data => {
            if (!data || data.length === 0) {
                console.error("No hay jornadas disponibles");
                return;
            }

            // Seleccionamos la última jornada
            ultimaJornada = data[data.length - 1].nombre;
            fechaCierreGlobal = data[data.length - 1].fechaCierre;
            loadPartidos(ultimaJornada);
        })
        .catch(error => console.error('Error al cargar las jornadas:', error));

    // Cargar jugadores en combo
    fetch('/api/jugadores')
        .then(res => res.json())
        .then(jugadores => {
            const combo = document.getElementById('comboJugadores');
            combo.innerHTML = '<option value="">Seleccione un jugador</option>';
            jugadores.forEach(j => {
                const opt = document.createElement('option');
                opt.value = j;
                opt.textContent = j;
                combo.appendChild(opt);
            });
        });

    // Botones
    document.getElementById('copiarTextoButton').addEventListener('click', copiarResultados);
    document.getElementById('enviarWhatsappButton').addEventListener('click', enviarPorWhatsapp);    

    document.getElementById('guardarResultadosButton').addEventListener('click', () => {
         guardarResultados(ultimaJornada, fechaCierreGlobal, jugadorValidado);
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
                    alert(data.error || "Contraseña incorrecta");
            } else {
                passwordCorrecta = true;
                jugadorValidado = jugador;
                await cargarResultadosGuardados(jugador, ultimaJornada);
            }
        }
    });




});

function loadPartidos(nombreJornada) {
    fetch('/api/jornadas')
        .then(response => response.json())
        .then(data => {
            const jornada = data.find(j => j.nombre === nombreJornada);
            if (!jornada) {
                console.error("Jornada no encontrada:", nombreJornada);
                return;
            }            
            mostrarPartidos(jornada.partidos, jornada.fechaCierre, jornada.nombre);
        })
        .catch(error => console.error('Error al cargar los partidos:', error));
}

function logoHTML(url, nombre) {
    if (!url) return '';
    return `<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
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


      
async function mostrarPartidos(partidos, fechaCierre, nombreJornada) {
    const partidosContainer = document.getElementById('partidosContainer');
    partidosContainer.innerHTML = '';

    if (fechaCierre) {
        const fecha = new Date(fechaCierre);
        const infoDiv = document.createElement('div');

        infoDiv.id = "infoCierre";
        infoDiv.style.marginBottom = "20px";
        infoDiv.style.textAlign = "center";

        infoDiv.innerHTML = `
            <div>
                <strong>Cierre de jornada:</strong>
                ${fecha.toLocaleDateString()}
                ${fecha.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute:'2-digit'
                })}
            </div>

            <div>
                <strong>Tiempo restante:</strong>
                <span id="contadorCierre"></span>
            </div>
        `;

        partidosContainer.appendChild(infoDiv);

        setInterval(() => {
            const ahora = new Date();
            const diff = fecha - ahora;

            if (diff > 0) {
                const horas = Math.floor(diff / (1000 * 60 * 60));
                const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const segundos = Math.floor((diff % (1000 * 60)) / 1000);

                document.getElementById("contadorCierre").textContent =
                    `${horas}h ${minutos}m ${segundos}s`;
            } else {
                document.getElementById("contadorCierre").textContent =
                    "Jornada cerrada";
            }
        }, 1000);
    }

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
    ? '<div class="status-pill status-finished">🔒 Partido cerrado</div>'
    : '<div class="status-pill status-scheduled">Disponible</div>';

const fechaPartido = obtenerFechaPartido(partido.apiDate);

const contadorHTML = !bloqueado && !fechaPaso && fechaPartido
    ? `
        <span>
            ⏳ Cierra en:
            <strong class="contador-partido" data-fecha="${fechaPartido.toISOString()}"></strong>
        </span>
      `
    : '';

const fechaPartidoHTML = `
    <div class="match-meta" style="justify-content:center; margin-bottom:10px;">
        <span>📅 ${formatearFechaPartido(partido.apiDate)}</span>
        ${textoBloqueo}
        ${contadorHTML}
    </div>
`;





        partidoDiv.innerHTML = `
           ${fechaPartidoHTML}
            <div class="match-teams">
                ${partido.comodin ? '<div class="comodin-badge">⭐ COMODÍN</div>' : ''}

                <div class="team-side">
                    ${logoHTML(partido.logoEquipo1, partido.equipo1)}

                    <label style="${estiloNegrita}">
                        ${partido.equipo1}
                    </label>
                </div>

                <input
                type="text"
                id="resultadoEquipo1_${i}"
                ${bloqueado ? 'disabled' : ''}
>

                <label style="${estiloNegrita}">
                    vs
                </label>

            <input
            type="text"
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

            const resultado1 = document.getElementById(`resultadoEquipo1_${index}`)?.value || '0';
            const resultado2 = document.getElementById(`resultadoEquipo2_${index}`)?.value || '0';

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

            const resultado1 = document.getElementById(`resultadoEquipo1_${index}`)?.value || '0';
            const resultado2 = document.getElementById(`resultadoEquipo2_${index}`)?.value || '0';

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




async function guardarResultados(jornada, fechaCierre, jugadorValidado) {
    const combo = document.getElementById('comboJugadores');
    const jugador = combo.value;
    if (!jugador) {
        alert("Seleccione un jugador");
        return;
    }

    // 1. Verificar fecha cierre
    

    if (jugador !== jugadorValidado) {
        alert("Debe seleccionar el jugador y validar la contraseña antes de guardar.");
        return;
    }


    // 4. Preparar pronósticos
    const partidosContainer = document.getElementById('partidosContainer');
    const pronosticos = [];
    let hayResultadosFaltantes = false;
    let errorDetectado = false;

    Array.from(document.querySelectorAll('.partido-container')).forEach((partidoDiv, index) => {
        const inputs = partidoDiv.querySelectorAll('input');
    
        if (inputs[0].disabled || inputs[1].disabled) {
    pronosticos.push({
        marcador1: '',
        marcador2: ''
    });
    return;
}

const marcador1 = inputs[0].value.trim();
const marcador2 = inputs[1].value.trim();


        // Si uno de los dos está vacío
        if (marcador1 === '' || marcador2 === '') {

            hayResultadosFaltantes = true;

            pronosticos.push({
                marcador1: '',
                marcador2: ''
            });

            return;
        }

        // Validación de números
        if (isNaN(marcador1) || isNaN(marcador2)) {
            alert(`Error: solo se permiten valores numéricos en el partido ${index + 1}`);
            errorDetectado = true;
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

    if (hayResultadosFaltantes) {
    
        const continuar = confirm(
            'Faltan resultados por agregar.\n\n¿Está seguro que desea guardar?'
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

alert(data.mensaje || "Resultados guardados correctamente.");


}

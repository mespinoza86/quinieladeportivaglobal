document.addEventListener('DOMContentLoaded', async () => {
    const equipo1Input = document.getElementById('equipo1Input');
    const equipo2Input = document.getElementById('equipo2Input');
    const comodinCheckbox = document.getElementById('comodinCheckbox');
    const addPartidoButton = document.getElementById('addPartidoButton');
    const finalizarJornadaButton = document.getElementById('finalizarJornadaButton');

    const jornadaSelect = document.getElementById('jornadaSelect');
    const partidosJornadaList = document.getElementById('partidosJornadaList');

    const modificarJornadaSelect = document.getElementById('modificarJornadaSelect');
    const modificarJornadaControls = document.getElementById('modificarJornadaControls');
    const partidosModificarList = document.getElementById('partidosModificarList');

    const modificarEquipo1Input = document.getElementById('modificarEquipo1Input');
    const modificarEquipo2Input = document.getElementById('modificarEquipo2Input');
    const modificarComodinCheckbox = document.getElementById('modificarComodinSelect');
    const agregarPartidoButton = document.getElementById('agregarPartidoButton');

    const eliminarPartidosButton = document.getElementById('eliminarPartidosButton');
    const eliminarJornadaButton = document.getElementById('eliminarJornadaButton');

    const modificarFechaCierreInput = document.getElementById('modificarFechaCierreInput');
    const modificarHoraCierreInput = document.getElementById('modificarHoraCierreInput');
    const actualizarFechaCierreButton = document.getElementById('actualizarFechaCierreButton');

    const fechaInputEl = document.getElementById('fechaCierreInput');
    const buscarApiFechaInput = document.getElementById('buscarApiFechaInput');
const buscarApiTextoInput = document.getElementById('buscarApiTextoInput');
const buscarPartidosApiButton = document.getElementById('buscarPartidosApiButton');
const partidosApiModificarContainer = document.getElementById('partidosApiModificarContainer');
const buscarApiTorneoSelect = document.getElementById('buscarApiTorneoSelect');
const buscarApiCustomBox = document.getElementById('buscarApiCustomBox');

let partidosApiDisponibles = [];


    if (fechaInputEl) {
        const today = new Date().toISOString().split('T')[0];
        fechaInputEl.setAttribute('min', today);
    }

    let currentPartidos = [];
    let jornadas = new Map();
    let jornadaActualParaModificar = '';
    let equipos = [];

    function normalizarListadoJornadas(data) {
        const map = new Map();

        if (!Array.isArray(data)) return map;

        if (data.length > 0 && Array.isArray(data[0])) {
            data.forEach(([nombre, partidos]) => {
                map.set(nombre, { partidos: partidos || [], fechaCierre: null });
            });
        } else {
            data.forEach(j => {
                if (!j?.nombre) return;
                map.set(j.nombre, {
                    partidos: j.partidos || [],
                    fechaCierre: j.fechaCierre || null
                });
            });
        }

        return map;
    }


function normalizarTexto(texto) {
    return (texto || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

    function traducirEquipo(nombre) {
        const traducciones = {
    // CONCACAF
    "Costa Rica": "Costa Rica",
    "Mexico": "México",
    "Canada": "Canadá",
    "United States": "Estados Unidos",
    "USA": "Estados Unidos",
    "Panama": "Panamá",
    "Jamaica": "Jamaica",
    "Honduras": "Honduras",
    "El Salvador": "El Salvador",
    "Guatemala": "Guatemala",
    "Nicaragua": "Nicaragua",
    "Belize": "Belice",
    "Cuba": "Cuba",
    "Haiti": "Haití",
    "Trinidad & Tobago": "Trinidad y Tobago",
    "Dominican Republic": "República Dominicana",
    "Puerto Rico": "Puerto Rico",
    "Curacao": "Curazao",
    "Aruba": "Aruba",
    "Suriname": "Surinam",
    "Guyana": "Guyana",

    // CONMEBOL
    "Argentina": "Argentina",
    "Brazil": "Brasil",
    "Uruguay": "Uruguay",
    "Paraguay": "Paraguay",
    "Chile": "Chile",
    "Bolivia": "Bolivia",
    "Peru": "Perú",
    "Colombia": "Colombia",
    "Ecuador": "Ecuador",
    "Venezuela": "Venezuela",

    // UEFA
    "Spain": "España",
    "Portugal": "Portugal",
    "France": "Francia",
    "Germany": "Alemania",
    "Italy": "Italia",
    "England": "Inglaterra",
    "Scotland": "Escocia",
    "Wales": "Gales",
    "Northern Ireland": "Irlanda del Norte",
    "Ireland": "Irlanda",
    "Netherlands": "Países Bajos",
    "Belgium": "Bélgica",
    "Switzerland": "Suiza",
    "Austria": "Austria",
    "Poland": "Polonia",
    "Ukraine": "Ucrania",
    "Czech Republic": "República Checa",
    "Slovakia": "Eslovaquia",
    "Slovenia": "Eslovenia",
    "Croatia": "Croacia",
    "Bosnia and Herzegovina": "Bosnia y Herzegovina",
    "Serbia": "Serbia",
    "Montenegro": "Montenegro",
    "North Macedonia": "Macedonia del Norte",
    "Albania": "Albania",
    "Kosovo": "Kosovo",
    "Romania": "Rumanía",
    "Bulgaria": "Bulgaria",
    "Hungary": "Hungría",
    "Turkey": "Turquía",
    "Iceland": "Islandia",
    "Norway": "Noruega",
    "Sweden": "Suecia",
    "Finland": "Finlandia",
    "Denmark": "Dinamarca",
    "Estonia": "Estonia",
    "Latvia": "Letonia",
    "Lithuania": "Lituania",
    "Luxembourg": "Luxemburgo",
    "Georgia": "Georgia",
    "Armenia": "Armenia",
    "Azerbaijan": "Azerbaiyán",
    "Belarus": "Bielorrusia",
    "Moldova": "Moldavia",

            // AFC
            "Japan": "Japón",
            "South Korea": "Corea del Sur",
            "North Korea": "Corea del Norte",
            "China": "China",
            "Chinese Taipei": "Taipéi Chino",
            "Hong Kong": "Hong Kong",
            "Mongolia": "Mongolia",
            "Australia": "Australia",
            "New Zealand": "Nueva Zelanda",
            "Saudi Arabia": "Arabia Saudita",
            "Qatar": "Catar",
            "United Arab Emirates": "Emiratos Árabes Unidos",
            "Bahrain": "Baréin",
            "Kuwait": "Kuwait",
            "Oman": "Omán",
            "Yemen": "Yemen",
            "Jordan": "Jordania",
            "Iraq": "Irak",
            "Iran": "Irán",
            "Syria": "Siria",
            "Lebanon": "Líbano",
            "Palestine": "Palestina",
            "India": "India",
            "Pakistan": "Pakistán",
            "Bangladesh": "Bangladés",
            "Thailand": "Tailandia",
            "Vietnam": "Vietnam",
            "Indonesia": "Indonesia",
            "Malaysia": "Malasia",
            "Singapore": "Singapur",
            "Philippines": "Filipinas",        
            "Uzbekistan": "Uzbekistán",
            "Kazakhstan": "Kazajistán",
            "Kyrgyzstan": "Kirguistán",
            "Tajikistan": "Tayikistán",
            "Turkmenistan": "Turkmenistán",
            "Afghanistan": "Afganistán",

            // CAF
            "Morocco": "Marruecos",
            "Algeria": "Argelia",
            "Tunisia": "Túnez",
            "Egypt": "Egipto",
            "Libya": "Libia",
            "Sudan": "Sudán",
            "Nigeria": "Nigeria",
            "Ghana": "Ghana",
            "Cameroon": "Camerún",
            "Senegal": "Senegal",
            "Ivory Coast": "Costa de Marfil",
            "Mali": "Malí",
            "Burkina Faso": "Burkina Faso",
            "Guinea": "Guinea",
            "Benin": "Benín",
            "Togo": "Togo",
            "Uganda": "Uganda",
            "Kenya": "Kenia",
            "Tanzania": "Tanzania",
            "South Africa": "Sudáfrica",
            "Zimbabwe": "Zimbabue",
            "Zambia": "Zambia",
            "Mozambique": "Mozambique",
            "Angola": "Angola",
            "Cape Verde": "Cabo Verde",
            "Mauritania": "Mauritania",

    // OFC
            "Fiji": "Fiyi",
            "Samoa": "Samoa",
            "Tahiti": "Tahití",
            "Vanuatu": "Vanuatu",
            "Solomon Islands": "Islas Salomón",
            "Papua New Guinea": "Papúa Nueva Guinea",
            "New Caledonia": "Nueva Caledonia",

                    
            "South Korea": "Corea del Sur",
            "North Korea": "Corea del Norte",
            "Saudi Arabia": "Arabia Saudita",
            "Japan": "Japón",
            "Iceland": "Islandia",
            "Norway": "Noruega",
            "Sweden": "Suecia",
            "Germany": "Alemania",
            "Finland": "Finlandia",
            "Canada": "Canadá",
            "Uzbekistan": "Uzbekistán",
            "United States": "Estados Unidos",
            "USA": "Estados Unidos",
            "Mexico": "México",
            "Brazil": "Brasil",
            "Panama": "Panamá",
            "Cape Verde": "Cabo Verde",
            "Czech Republic": "República Checa",
            "Switzerland": "Suiza",
            "Ivory Coast": "Costa de Marfil",
            "North Macedonia": "Macedonia del Norte",
            "Bosnia and Herzegovina": "Bosnia y Herzegovina",
            "Trinidad & Tobago": "Trinidad y Tobago",
            "Dominican Republic": "República Dominicana",
            "Netherlands": "Países Bajos",
            "England": "Inglaterra",
            "Wales": "Gales",
            "Scotland": "Escocia",
            "Northern Ireland": "Irlanda del Norte",
            "Ireland": "Irlanda",
            "Turkey": "Turquía",
            "Morocco": "Marruecos",
            "Egypt": "Egipto",
            "Poland": "Polonia",
            "Ukraine": "Ucrania",
            "Jordan": "Jordania",
            "Australia": "Australia",
            "Slovakia": "Eslovaquia",
            "Bulgaria": "Bulgaria",
            "Montenegro": "Montenegro",
            "Serbia": "Serbia",
            "Kosovo": "Kosovo",
            "Senegal": "Senegal",
            "Nigeria": "Nigeria",
            "Jamaica": "Jamaica",
            "Colombia": "Colombia",
            "Costa Rica": "Costa Rica",
            "Ecuador": "Ecuador",
            "Brazil": "Brasil",
            "Saudi Arabia": "Arabia Saudita",
            "South Korea": "Corea del Sur",
            "Trinidad & Tobago": "Trinidad y Tobago",
            "Switzerland": "Suiza",
            "Cape Verde": "Cabo Verde",
            "North Macedonia": "Macedonia del Norte",
            "Hungary": "Hungría",
            "Bangladesh": "Bangladés",
            "Moldova": "Moldavia",
            "Georgia": "Georgia",
            "Angola": "Angola",
            "Botswana": "Botsuana",
            "Belarus": "Bielorrusia",
            "Syria": "Siria",
            "Indonesia": "Indonesia",
            "Oman": "Omán",
            "Bahrain": "Baréin",
            "San Marino": "San Marino"
        };

        return traducciones[nombre] || nombre;
    }



function partidoCoincideBusqueda(partido, texto) {
    if (!texto) return true;

    const q = normalizarTexto(texto);

    const base = normalizarTexto(`
        ${partido.equipo1}
        ${partido.equipo2}
        ${partido.liga}
        ${partido.pais}
    `);

    return base.includes(q);
}

async function buscarPartidosApiParaModificar() {
    const fecha = buscarApiFechaInput.value;

    let filtroTexto = '';
let filtroTorneo = {};

if (buscarApiTorneoSelect.value === 'custom') {
    filtroTexto = buscarApiTextoInput.value.trim();
} else {
    filtroTorneo = parseFiltroTorneo(buscarApiTorneoSelect.value);
}


    if (!jornadaActualParaModificar) {
        alert('Seleccione una jornada para modificar.');
        return;
    }

    if (!fecha) {
        alert('Seleccione una fecha.');
        return;
    }

    partidosApiModificarContainer.innerHTML = '<div class="resultados-mensaje">Buscando partidos...</div>';

    try {
        const response = await fetch(`/api/football/fixtures?date=${encodeURIComponent(fecha)}`);
        const data = await response.json();

        if (!response.ok) {
            partidosApiModificarContainer.innerHTML = `<div class="resultados-mensaje">${data.error || 'Error buscando partidos.'}</div>`;
            return;
        }

        partidosApiDisponibles = Array.isArray(data)
    ? data
        .filter(p => partidoCoincideConFiltro(p, filtroTorneo))
        .filter(p => partidoCoincideBusqueda(p, filtroTexto))
    : [];


        renderizarPartidosApiModificar();

    } catch (error) {
        console.error('Error buscando partidos API:', error);
        partidosApiModificarContainer.innerHTML = '<div class="resultados-mensaje">Error buscando partidos.</div>';
    }
}

function renderizarPartidosApiModificar() {
    if (!partidosApiDisponibles.length) {
        partidosApiModificarContainer.innerHTML = '<div class="resultados-mensaje">No se encontraron partidos.</div>';
        return;
    }

    partidosApiModificarContainer.innerHTML = partidosApiDisponibles.map((partido, index) => {
        const fechaLocal = partido.fecha
            ? new Date(partido.fecha).toLocaleString('es-CR', {
                timeZone: 'America/Costa_Rica',
                dateStyle: 'short',
                timeStyle: 'short'
            })
            : 'Sin fecha';

        return `
            <div class="match-card">
                <div class="match-teams">
                    <div class="team-side">
                        ${partido.logoEquipo1 ? `<img src="${partido.logoEquipo1}" class="team-logo" alt="${traducirEquipo(partido.equipo1)}">` : ''}
                        <strong>${traducirEquipo(partido.equipo1)}</strong>
                    </div>

                    <span class="vs">vs</span>

                    <div class="team-side">
                        ${partido.logoEquipo2 ? `<img src="${partido.logoEquipo2}" class="team-logo" alt="${traducirEquipo(partido.equipo2)}">` : ''}
                        <strong>${traducirEquipo(partido.equipo2)}</strong>
                    </div>
                </div>

                <div class="match-meta">
                    <span>${partido.liga || 'Liga'}</span>
                    <span>${partido.pais || ''}</span>
                    <span>${fechaLocal}</span>
                </div>

                <label class="checkbox-card">
                    <input type="checkbox" class="apiModificarComodin" data-index="${index}">
                    <span>Comodín</span>
                </label>

                <button type="button" class="secondary-button agregarApiAJornadaBtn" data-index="${index}">
                    Agregar a esta jornada
                </button>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.agregarApiAJornadaBtn').forEach(btn => {
        btn.addEventListener('click', agregarPartidoApiAJornadaExistente);
    });
}


    function extraerPartidosDeDetalle(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.partidos)) return data.partidos;
        return [];
    }

    function formatearFechaHoraCostaRica(fechaISO) {
        if (!fechaISO) return 'Sin fecha de cierre';

        const fecha = new Date(fechaISO);

        const fechaTxt = fecha.toLocaleDateString('es-CR', {
            timeZone: 'America/Costa_Rica',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const horaTxt = fecha.toLocaleTimeString('es-CR', {
            timeZone: 'America/Costa_Rica',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `${fechaTxt} ${horaTxt}`;
    }

    function convertirFechaHoraCostaRicaAISO(fecha, hora) {
        if (!fecha || !hora) return null;
        return new Date(`${fecha}T${hora}:00-06:00`).toISOString();
    }

    function cargarFechaCierreEnInputs(fechaISO) {
        if (!modificarFechaCierreInput || !modificarHoraCierreInput) return;

        if (!fechaISO) {
            modificarFechaCierreInput.value = '';
            modificarHoraCierreInput.value = '';
            return;
        }

        const fecha = new Date(fechaISO);

        modificarFechaCierreInput.value = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Costa_Rica',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(fecha);

        modificarHoraCierreInput.value = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Costa_Rica',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(fecha);
    }

    async function cargarEquipos() {
        try {
            const response = await fetch('/api/equipos');
            equipos = await response.json();
        } catch (error) {
            console.error('Error al cargar equipos:', error);
        }
    }

    function autocompleteEquipo(inputElement, suggestionsId) {
        const suggestionsContainer = document.getElementById(suggestionsId);
        if (!suggestionsContainer) return;

        const query = inputElement.value.toLowerCase();

        const filteredEquipos = equipos.filter(equipo =>
            equipo.toLowerCase().includes(query)
        );

        suggestionsContainer.innerHTML = '';

        if (query && filteredEquipos.length > 0) {
            suggestionsContainer.style.display = 'block';

            filteredEquipos.forEach(equipo => {
                const suggestion = document.createElement('div');
                suggestion.classList.add('autocomplete-suggestion');
                suggestion.textContent = equipo;

                suggestion.onclick = () => {
                    inputElement.value = equipo;
                    suggestionsContainer.style.display = 'none';
                };

                suggestionsContainer.appendChild(suggestion);
            });
        } else {
            suggestionsContainer.style.display = 'none';
        }
    }

    async function agregarNuevoEquipo(nuevoEquipo) {
        if (nuevoEquipo && !equipos.includes(nuevoEquipo)) {
            equipos.push(nuevoEquipo);

            try {
                await fetch('/actualizar-equipos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ equipos })
                });
            } catch (error) {
                console.error('Error guardando equipo:', error);
            }
        }
    }

    function loadJornadas() {
        fetch('/api/jornadas')
            .then(response => response.json())
            .then(data => {
                jornadas = normalizarListadoJornadas(data);
                updateJornadaSelect();
            })
            .catch(error => {
                console.error('Error cargando jornadas:', error);
                jornadas = new Map();
                updateJornadaSelect();
            });
    }

    function parseFiltroTorneo(valor) {
    const filtro = {};

    if (!valor || valor === 'custom') return filtro;

    valor.split(';').forEach(parte => {
        const [key, value] = parte.split('=');
        if (key && value) {
            filtro[key.trim()] = value.trim();
        }
    });

    return filtro;
}

function esLigaNoPermitida(liga) {
    const texto = normalizarTexto(liga);

    const palabrasBloqueadas = [
        'u20',
        'u21',
        'u23',
        'sub 20',
        'sub 21',
        'sub 23',
        'reserves',
        'reserve',
        'femenil',
        'women',
        'womens',
        'femenina',
        'feminine',
        'juvenil',
        'youth'
    ];

    return palabrasBloqueadas.some(palabra =>
        texto.includes(normalizarTexto(palabra))
    );
}

function partidoCoincideConFiltro(partido, filtro) {
    const liga = normalizarTexto(partido.liga);
    const pais = normalizarTexto(partido.pais);

    if (esLigaNoPermitida(partido.liga)) {
        return false;
    }

    if (filtro.country && pais !== normalizarTexto(filtro.country)) {
        return false;
    }

    if (filtro.league_exact) {
        const ligaEsperada = normalizarTexto(filtro.league_exact);

        if (
            liga !== ligaEsperada &&
            !liga.includes(ligaEsperada)
        ) {
            return false;
        }
    }

    if (filtro.league_contains && !liga.includes(normalizarTexto(filtro.league_contains))) {
        return false;
    }

    if (filtro.league_any) {
        const opciones = filtro.league_any
            .split('|')
            .map(opcion => normalizarTexto(opcion));

        const coincideAlguna = opciones.some(opcion =>
            liga.includes(opcion)
        );

        if (!coincideAlguna) {
            return false;
        }
    }

    if (filtro.text) {
        const texto = normalizarTexto(filtro.text);
        return `${liga} ${pais}`.includes(texto);
    }

    return true;
}


    function updateJornadaSelect() {
        jornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';
        modificarJornadaSelect.innerHTML = '<option value="">Selecciona una jornada</option>';

        jornadas.forEach((info, nombre) => {
            const option = document.createElement('option');
            option.value = nombre;
            option.textContent = nombre;
            jornadaSelect.appendChild(option);

            modificarJornadaSelect.appendChild(option.cloneNode(true));
        });
    }

    function updatePartidosList() {
        const ul = document.getElementById('partidosList');
        ul.innerHTML = '';

        currentPartidos.forEach((partido, index) => {
            const li = document.createElement('li');

            const eq1 = document.createElement('input');
            eq1.type = 'text';
            eq1.value = partido.equipo1;
            eq1.addEventListener('input', () => {
                currentPartidos[index].equipo1 = eq1.value;
            });

            const eq2 = document.createElement('input');
            eq2.type = 'text';
            eq2.value = partido.equipo2;
            eq2.addEventListener('input', () => {
                currentPartidos[index].equipo2 = eq2.value;
            });

            const comodinCB = document.createElement('input');
            comodinCB.type = 'checkbox';
            comodinCB.checked = partido.comodin;
            comodinCB.addEventListener('change', () => {
                currentPartidos[index].comodin = comodinCB.checked;
            });

            li.appendChild(eq1);
            li.appendChild(document.createTextNode(' vs '));
            li.appendChild(eq2);
            li.appendChild(document.createTextNode(' Comodín '));
            li.appendChild(comodinCB);

            ul.appendChild(li);
        });
    }

    async function agregarPartidoApiAJornadaExistente(event) {
    const index = Number(event.target.dataset.index);
    const partidoApi = partidosApiDisponibles[index];

    if (!partidoApi || !jornadaActualParaModificar) return;

    const comodinCheckbox = document.querySelector(`.apiModificarComodin[data-index="${index}"]`);
    const comodin = comodinCheckbox ? comodinCheckbox.checked : false;

    const confirmar = confirm(
  `¿Agregar ${traducirEquipo(partidoApi.equipo1)} vs ${traducirEquipo(partidoApi.equipo2)} a ${jornadaActualParaModificar}?\n\n` +
  `Este partido se agregará AL FINAL de la jornada.\n\n` +
  `No se deben insertar partidos en medio ni eliminar partidos anteriores si ya hay pronósticos guardados.`
);


    if (!confirmar) return;

    try {
        const response = await fetch(`/api/jornadas/${encodeURIComponent(jornadaActualParaModificar)}`);
        const data = await response.json();
        const partidos = extraerPartidosDeDetalle(data);

        partidos.push({
            equipo1: traducirEquipo(partidoApi.equipo1),
            equipo2: traducirEquipo(partidoApi.equipo2),

            logoEquipo1: partidoApi.logoEquipo1 || '',
            logoEquipo2: partidoApi.logoEquipo2 || '',

            comodin,

            apiFixtureId: partidoApi.apiFixtureId,
            apiLeagueId: partidoApi.apiLeagueId,

            apiDate: partidoApi.fecha,
            fecha: partidoApi.fecha,
            estado: partidoApi.estado,
            liga: partidoApi.liga,
            pais: partidoApi.pais
        });

        const guardarResponse = await fetch('/api/jornadas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: jornadaActualParaModificar,
                partidos,
                fechaCierre: data.fechaCierre || jornadas.get(jornadaActualParaModificar)?.fechaCierre || null
            })
        });

        if (!guardarResponse.ok) {
            alert('Error agregando partido a la jornada.');
            return;
        }

        alert('Partido agregado correctamente.');

        loadJornadas();
        updateJornadaPartidos();
        updateModificarJornadaPartidos();

    } catch (error) {
        console.error('Error agregando partido API:', error);
        alert('Error agregando partido API.');
    }
}


    function updateJornadaPartidos() {
        const selectedJornada = jornadaSelect.value;

        if (!selectedJornada) {
            partidosJornadaList.innerHTML = '';
            return;
        }

        fetch(`/api/jornadas/${encodeURIComponent(selectedJornada)}`)
            .then(response => response.json())
            .then(data => {
                const partidos = extraerPartidosDeDetalle(data);
                partidosJornadaList.innerHTML = '';

                const fechaCierre = data.fechaCierre || jornadas.get(selectedJornada)?.fechaCierre;

                if (fechaCierre) {
                    const liFecha = document.createElement('li');
                    liFecha.innerHTML = `<strong>Cierre:</strong> ${formatearFechaHoraCostaRica(fechaCierre)}`;
                    partidosJornadaList.appendChild(liFecha);
                }

                partidos.forEach(partido => {
                    const li = document.createElement('li');
                    li.textContent = `${partido.equipo1} vs ${partido.equipo2}`;
                    if (partido.comodin) li.textContent += ' (Comodín)';
                    partidosJornadaList.appendChild(li);
                });
            })
            .catch(error => {
                console.error('Error mostrando jornada:', error);
                partidosJornadaList.innerHTML = '';
            });
    }

    function updateModificarJornadaPartidos() {
        const selectedJornada = modificarJornadaSelect.value;

        if (!selectedJornada) {
            partidosModificarList.innerHTML = '';
            return;
        }

        fetch(`/api/jornadas/${encodeURIComponent(selectedJornada)}`)
            .then(response => response.json())
            .then(data => {
                const partidos = extraerPartidosDeDetalle(data);
                partidosModificarList.innerHTML = '';

                partidos.forEach((partido, index) => {
                    const li = document.createElement('li');

                    const comodinCB = document.createElement('input');
                    comodinCB.type = 'checkbox';
                    comodinCB.classList.add('comodin-checkbox');                    
                    comodinCB.dataset.index = index;
                    comodinCB.checked = !!partido.comodin;
                    comodinCB.addEventListener('change', handleComodinChange);                    
                    

                    const comodinLabel = document.createElement('label');
                    comodinLabel.textContent = partido.comodin ? 'Quitar de comodín' : 'Agregar como comodín';

                    const comodinLine = document.createElement('div');
                    comodinLine.appendChild(comodinCB);
                    comodinLine.appendChild(comodinLabel);
                    li.appendChild(comodinLine);

                    const equipo1Input = document.createElement('input');
                    equipo1Input.type = 'text';
                    equipo1Input.value = partido.equipo1;

                    const equipo2Input = document.createElement('input');
                    equipo2Input.type = 'text';
                    equipo2Input.value = partido.equipo2;

                    const actualizarBtn = document.createElement('button');
                    actualizarBtn.type = 'button';
                    actualizarBtn.textContent = 'Actualizar equipos';

                    actualizarBtn.addEventListener('click', async () => {
                        const nuevoEq1 = equipo1Input.value.trim();
                        const nuevoEq2 = equipo2Input.value.trim();

                        if (!nuevoEq1 || !nuevoEq2) {
                            alert('Los nombres de equipos no pueden estar vacíos.');
                            return;
                        }

                        const confirmar = confirm(
                            `¿Está seguro que quiere cambiar de "${partido.equipo1} vs ${partido.equipo2}" a "${nuevoEq1} vs ${nuevoEq2}"?`
                        );

                        if (!confirmar) return;

                        try {
                            const response = await fetch(`/api/jornadas/${encodeURIComponent(selectedJornada)}`);
                            const data = await response.json();
                            const partidos = extraerPartidosDeDetalle(data);

                            partidos[index].equipo1 = nuevoEq1;
                            partidos[index].equipo2 = nuevoEq2;

                            await fetch('/api/jornadas', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    nombre: selectedJornada,
                                    partidos,
                                    fechaCierre: jornadas.get(selectedJornada)?.fechaCierre || null
                                })
                            });

                            loadJornadas();
                            updateJornadaPartidos();
                            updateModificarJornadaPartidos();
                        } catch (error) {
                            console.error('Error actualizando equipos:', error);
                        }
                    });

                    const partidoLine = document.createElement('div');
                    partidoLine.appendChild(equipo1Input);
                    partidoLine.appendChild(document.createTextNode(' vs '));
                    partidoLine.appendChild(equipo2Input);
                    partidoLine.appendChild(actualizarBtn);
                    li.appendChild(partidoLine);

                    const eliminarCB = document.createElement('input');
                    eliminarCB.type = 'checkbox';
                    eliminarCB.classList.add('eliminar-checkbox');                    
                    eliminarCB.dataset.index = index;

                    const eliminarLabel = document.createElement('label');
                    eliminarLabel.textContent = 'Selecciona para eliminar';

                    const eliminarLine = document.createElement('div');
                    eliminarLine.appendChild(eliminarCB);
                    eliminarLine.appendChild(eliminarLabel);
                    li.appendChild(eliminarLine);

                    partidosModificarList.appendChild(li);
                });
            })
            .catch(error => {
                console.error('Error mostrando partidos para modificar:', error);
                partidosModificarList.innerHTML = '';
            });
    }

    async function handleComodinChange(event) {
        const checkbox = event.target;
        const index = Number(checkbox.dataset.index);
        const isChecked = checkbox.checked;
        const selectedJornada = modificarJornadaSelect.value;

        const message = isChecked
            ? '¿Está seguro que quiere mover este partido a comodín?'
            : '¿Está seguro que quiere cambiar este partido a que no sea comodín?';

        if (!confirm(message)) {
            checkbox.checked = !isChecked;
            return;
        }

        checkbox.disabled = true;

        try {
            const response = await fetch(`/api/jornadas/${encodeURIComponent(selectedJornada)}`);
            const data = await response.json();
            const partidos = extraerPartidosDeDetalle(data);

            if (!partidos[index]) {
                alert('No se encontró el partido seleccionado.');
                return;
            }

            partidos[index].comodin = isChecked;

            const guardarResponse = await fetch('/api/jornadas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: selectedJornada,
                    partidos,
                    fechaCierre: data.fechaCierre || jornadas.get(selectedJornada)?.fechaCierre || null
                })
            });

            if (!guardarResponse.ok) {
                alert('Error actualizando comodín.');
                checkbox.checked = !isChecked;
                return;
            }

            jornadas.set(selectedJornada, {
                partidos,
                fechaCierre: data.fechaCierre || jornadas.get(selectedJornada)?.fechaCierre || null
            });

            updateJornadaPartidos();
            updateModificarJornadaPartidos();

        } catch (error) {
            console.error('Error actualizando comodín:', error);
            checkbox.checked = !isChecked;
            alert('Error actualizando comodín.');
        } finally {
            checkbox.disabled = false;
        }
    }





    actualizarFechaCierreButton.addEventListener('click', async () => {
        const selectedJornada = modificarJornadaSelect.value;

        if (!selectedJornada) {
            alert('Selecciona una jornada primero.');
            return;
        }

        const nuevaFecha = modificarFechaCierreInput.value;
        const nuevaHora = modificarHoraCierreInput.value;

        if (!nuevaFecha || !nuevaHora) {
            alert('Debes seleccionar fecha y hora de cierre.');
            return;
        }

        const nuevaFechaISO = convertirFechaHoraCostaRicaAISO(nuevaFecha, nuevaHora);
        const fechaActual = jornadas.get(selectedJornada)?.fechaCierre || null;

        const confirmar = confirm(
            `¿Estás seguro que deseas cambiar la fecha y hora de cierre?\n\n` +
            `Actual: ${formatearFechaHoraCostaRica(fechaActual)}\n` +
            `Nueva: ${formatearFechaHoraCostaRica(nuevaFechaISO)}`
        );

        if (!confirmar) return;

        try {
            const response = await fetch(`/api/jornadas/${encodeURIComponent(selectedJornada)}`);
            const data = await response.json();
            const partidos = extraerPartidosDeDetalle(data);

            const guardarResponse = await fetch('/api/jornadas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: selectedJornada,
                    partidos,
                    fechaCierre: nuevaFechaISO
                })
            });

            if (!guardarResponse.ok) {
                alert('Error actualizando fecha de cierre.');
                return;
            }

            alert('Fecha de cierre actualizada correctamente.');

            jornadas.set(selectedJornada, {
                partidos,
                fechaCierre: nuevaFechaISO
            });

            loadJornadas();
            updateJornadaPartidos();
            cargarFechaCierreEnInputs(nuevaFechaISO);
        } catch (error) {
            console.error('Error actualizando fecha de cierre:', error);
            alert('Error actualizando fecha de cierre.');
        }
    });

    addPartidoButton.addEventListener('click', async () => {
        const equipo1 = equipo1Input.value.trim();
        const equipo2 = equipo2Input.value.trim();
        const comodin = comodinCheckbox.checked;

        if (!equipo1 || !equipo2) return;

        await agregarNuevoEquipo(equipo1);
        await agregarNuevoEquipo(equipo2);

        currentPartidos.push({ equipo1, equipo2, comodin });
        updatePartidosList();

        equipo1Input.value = '';
        equipo2Input.value = '';
        comodinCheckbox.checked = false;
    });

    finalizarJornadaButton.addEventListener('click', () => {
        if (currentPartidos.length === 0) {
            alert('No hay partidos para agregar a la jornada.');
            return;
        }

        const nombreJornada = prompt('Ingrese el nombre de la jornada:');
        const fechaInput = document.getElementById('fechaCierreInput')?.value;
        const horaInput = document.getElementById('horaCierreInput')?.value;

        if (!nombreJornada) return alert('Debe ingresar un nombre de jornada');
        if (!fechaInput || !horaInput) return alert('Debe seleccionar fecha y hora de cierre');

        const fechaCierre = convertirFechaHoraCostaRicaAISO(fechaInput, horaInput);

        if (new Date(fechaCierre) <= new Date()) {
            alert('La fecha de cierre debe ser futura');
            return;
        }

        if (jornadas.has(nombreJornada)) {
            alert('Ya existe una jornada con ese nombre.');
            return;
        }

        fetch('/api/jornadas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: nombreJornada,
                partidos: currentPartidos,
                fechaCierre
            })
        })
        .then(() => {
            currentPartidos = [];
            updatePartidosList();
            loadJornadas();
        })
        .catch(error => console.error('Error guardando jornada:', error));
    });

    jornadaSelect.addEventListener('change', updateJornadaPartidos);

    modificarJornadaSelect.addEventListener('change', () => {
        jornadaActualParaModificar = modificarJornadaSelect.value;
        modificarJornadaControls.style.display = jornadaActualParaModificar ? 'block' : 'none';

        const infoJornada = jornadas.get(jornadaActualParaModificar);
        cargarFechaCierreEnInputs(infoJornada?.fechaCierre || null);

        updateModificarJornadaPartidos();
    });

    agregarPartidoButton.addEventListener('click', () => {
        const equipo1 = modificarEquipo1Input.value.trim();
        const equipo2 = modificarEquipo2Input.value.trim();
        const comodin = modificarComodinCheckbox.checked;

        if (!equipo1 || !equipo2 || !jornadaActualParaModificar) return;

        fetch(`/api/jornadas/${encodeURIComponent(jornadaActualParaModificar)}`)
            .then(response => response.json())
            .then(data => {
                const partidos = extraerPartidosDeDetalle(data);

                partidos.push({
                    equipo1,
                    equipo2,
                    comodin
                });

                return fetch('/api/jornadas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre: jornadaActualParaModificar,
                        partidos,
                        fechaCierre: jornadas.get(jornadaActualParaModificar)?.fechaCierre || null
                    })
                });
            })
            .then(() => {
                loadJornadas();
                updateJornadaPartidos();
                updateModificarJornadaPartidos();

                modificarEquipo1Input.value = '';
                modificarEquipo2Input.value = '';
                modificarComodinCheckbox.checked = false;
            })
            .catch(error => console.error('Error agregando partido:', error));
    });

    eliminarPartidosButton.addEventListener('click', () => {

        const selectedIndices = Array.from(            
            document.querySelectorAll('#partidosModificarList .eliminar-checkbox:checked')
        ).map(cb => cb.dataset.index);
    
        if (selectedIndices.length === 0 || !jornadaActualParaModificar) return;

        fetch(`/api/jornadas/${encodeURIComponent(jornadaActualParaModificar)}`)
            .then(response => response.json())
            .then(data => {
                const partidos = extraerPartidosDeDetalle(data);

                const updatedPartidos = partidos.filter((_, index) =>
                    !selectedIndices.includes(index.toString())
                );

                return fetch('/api/jornadas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre: jornadaActualParaModificar,
                        partidos: updatedPartidos,
                        fechaCierre: jornadas.get(jornadaActualParaModificar)?.fechaCierre || null
                    })
                });
            })
            .then(() => {
                loadJornadas();
                updateJornadaPartidos();
                updateModificarJornadaPartidos();
            })
            .catch(error => console.error('Error eliminando partidos:', error));
    });

    eliminarJornadaButton.addEventListener('click', async () => {
        const jornada = modificarJornadaSelect.value;

        if (!jornada) {
            alert('Selecciona una jornada para eliminar.');
            return;
        }

        const confirmar = confirm(
            `¿Seguro que deseas eliminar la jornada "${jornada}"?\n\nEsto también borrará los pronósticos de todos los jugadores y los resultados oficiales.`
        );

        if (!confirmar) return;

        try {
            const response = await fetch(`/api/jornadas/${encodeURIComponent(jornada)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || 'Error eliminando jornada');
                return;
            }

            alert('Jornada eliminada correctamente.');

            jornadaActualParaModificar = '';
            modificarJornadaControls.style.display = 'none';
            partidosModificarList.innerHTML = '';
            partidosJornadaList.innerHTML = '';

            loadJornadas();
        } catch (error) {
            console.error('Error eliminando jornada:', error);
            alert('Error eliminando jornada');
        }
    });

    buscarApiTorneoSelect.addEventListener('change', () => {
    buscarApiCustomBox.style.display =
        buscarApiTorneoSelect.value === 'custom' ? 'block' : 'none';
});

buscarPartidosApiButton.addEventListener('click', buscarPartidosApiParaModificar);

    await cargarEquipos();
    loadJornadas();

    equipo1Input.addEventListener('input', () => autocompleteEquipo(equipo1Input, 'suggestions1'));
    equipo2Input.addEventListener('input', () => autocompleteEquipo(equipo2Input, 'suggestions2'));
});
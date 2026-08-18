document.addEventListener('DOMContentLoaded', () => { 
    // Cargar las jornadas cuando la página se carga
    loadJornadas();

    // Botón de llenar jornada
    const llenarJornadaButton = document.getElementById('llenarJornadaButton');
    llenarJornadaButton.addEventListener('click', () => {
        const jornadaSelect = document.getElementById('jornadaSelect');
        const selectedIndex = jornadaSelect.selectedIndex;
        if (selectedIndex >= 0) {
            // Guardamos el nombre de la jornada
            const jornadaSeleccionada = jornadaSelect.options[selectedIndex].textContent;
            localStorage.setItem('jornadaSeleccionada', jornadaSeleccionada);
            window.location.href = 'llenar_jornada_user.html';
        }
    });
});

function loadJornadas() {
    fetch('/api/jornadas')
        .then(response => response.json())
        .then(data => {
            const jornadaSelect = document.getElementById('jornadaSelect');
            const partidosJornadaList = document.getElementById('partidosJornadaList');

            // Limpiar select y lista de partidos
            jornadaSelect.innerHTML = '';
            partidosJornadaList.innerHTML = '';

            data.forEach((jornada, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = jornada.nombre; // ahora es un objeto
                jornadaSelect.appendChild(option);
            });

            // Mostrar partidos de la primera jornada por defecto
            if (data.length > 0) {
                mostrarPartidosDeJornada(data[0].partidos);
            }

            jornadaSelect.addEventListener('change', () => {
                const selectedIndex = jornadaSelect.selectedIndex;
                if (selectedIndex >= 0) {
                    mostrarPartidosDeJornada(data[selectedIndex].partidos);
                }
            });
        })
        .catch(error => console.error('Error al cargar las jornadas:', error));
}

/*
 * Devuelve HTML ya construido, así que va etiquetado: quien lo interpole lo
 * recibe como HtmlCrudo y no se escapa dos veces. Y el escapado importa
 * incluso aquí: `url` y `nombre` acaban DENTRO de atributos, donde una
 * comilla sin escapar cierra el atributo y permite añadir otro.
 */
function logoHTML(url, nombre) {
    if (!url) return '';
    return html`<img src="${url}" class="team-logo" alt="${nombre || 'Equipo'}">`;
}

function formatearFechaPartido(fecha) {
    if (!fecha) return 'Fecha pendiente';

    const d = new Date(fecha);

    if (Number.isNaN(d.getTime())) {
        return fecha;
    }

    return d.toLocaleString('es-CR', {
        timeZone: 'America/Costa_Rica',
        dateStyle: 'short',
        timeStyle: 'short'
    });
}

function mostrarPartidosDeJornada(partidos) {
    const partidosJornadaList = document.getElementById('partidosJornadaList');
    partidosJornadaList.innerHTML = '';

    partidos.forEach(partido => {
        const li = document.createElement('li');

        li.innerHTML = html`
    <div class="match-card jornada-match-card">
        <div class="match-date-row">
            📅 ${formatearFechaPartido(partido.apiDate)}
            ${partido.comodin ? '<span class="badge">Comodín</span>' : ''}
        </div>

        <div class="match-teams">
            <div class="team-side">
                ${logoHTML(partido.logoEquipo1, partido.equipo1)}
                <strong>${partido.equipo1}</strong>
            </div>

            <span class="vs">vs</span>

            <div class="team-side">
                ${logoHTML(partido.logoEquipo2, partido.equipo2)}
                <strong>${partido.equipo2}</strong>
            </div>
        </div>
    </div>
`;


        partidosJornadaList.appendChild(li);
    });
}

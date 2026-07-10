document.addEventListener('DOMContentLoaded', () => {
    // Recuperar la jornada seleccionada de localStorage

     fetch('/api/jornadas')
        .then(response => response.json())
        .then(data => {
            if (!data || data.length === 0) {
                console.error("No hay jornadas disponibles");
                return;
            }

            // Seleccionamos la última jornada
            const ultimaJornada = data[data.length - 1].nombre; // ahora es un objeto
            loadPartidos(ultimaJornada);
        })
        .catch(error => console.error('Error al cargar las jornadas:', error));

    // Botones
    const copiarTextoButton = document.getElementById('copiarTextoButton');
    copiarTextoButton.addEventListener('click', copiarResultados);
  
    const enviarWhatsappButton = document.getElementById('enviarWhatsappButton');
    enviarWhatsappButton.addEventListener('click', enviarPorWhatsapp);
});

// Cargar los partidos de una jornada

// Cargar los partidos de una jornada
function loadPartidos(nombreJornada) {
    fetch('/api/jornadas')
        .then(response => response.json())
        .then(data => {
            const jornada = data.find(j => j.nombre === nombreJornada); // busca por nombre
            if (!jornada) {
                console.error("Jornada no encontrada:", nombreJornada);
                return;
            }

            // jornada ahora es un objeto { nombre, partidos, fechaCierre }
            mostrarPartidos(jornada.partidos, jornada.fechaCierre);
        })
        .catch(error => console.error('Error al cargar los partidos:', error));
}


    // Mostrar los partidos en pantalla
    // Mostrar los partidos en pantalla
    function mostrarPartidos(partidos, fechaCierre) {
        const partidosContainer = document.getElementById('partidosContainer');
        partidosContainer.innerHTML = ''; 

        // Mostrar fecha de cierre si existe
        if (fechaCierre) {
            const fecha = new Date(fechaCierre);
            const fechaDiv = document.createElement('div');
            fechaDiv.textContent = `Cierra el: ${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            fechaDiv.style.marginBottom = "10px";
            partidosContainer.appendChild(fechaDiv);
        }

        partidos.forEach((partido, i) => {
            const partidoDiv = document.createElement('div');
            partidoDiv.classList.add('partido-container');
            
            const estiloNegrita = partido.comodin ? 'font-weight: bold;' : '';
        
        partidoDiv.innerHTML = `
            <label style="${estiloNegrita}">${partido.equipo1}</label>
            <input type="text" id="resultadoEquipo1_${i}">
            <label style="${estiloNegrita}">vs</label>
            <input type="text" id="resultadoEquipo2_${i}">
            <label style="${estiloNegrita}">${partido.equipo2}</label>
            <label style="display: none;">Comodín: ${partido.comodin ? 'Sí' : 'No'}</label>
        `;
        partidosContainer.appendChild(partidoDiv);
    });
}




// Copiar resultados al portapapeles
function copiarResultados() {
    const nombreJugador = document.getElementById('nombreJugador').value.trim();
    const partidosContainer = document.getElementById('partidosContainer');
    let textoResultado = '';
    let contador = 1;

    textoResultado += `-------------------------------\n`;
    textoResultado += `Nombre: ${nombreJugador || '[Sin nombre]'}\n`;
    textoResultado += `-------------------------------\n`;

    Array.from(partidosContainer.children).forEach((partidoDiv, index) => {
        const equipo1 = partidoDiv.children[0].textContent;
        const resultado1 = document.getElementById(`resultadoEquipo1_${index}`).value || '0';
        const equipo2 = partidoDiv.children[4].textContent;
        const resultado2 = document.getElementById(`resultadoEquipo2_${index}`).value || '0';

        const comodin = partidoDiv.querySelector('label:last-child').textContent.includes('Sí');
        const formato = comodin ? '*' : '';

        if (comodin) {
            textoResultado += "\n*(Comodin)*";
        }

        textoResultado += `\n${contador}. ${formato}${equipo1} ${resultado1}${formato}\n  ${formato}${equipo2} ${resultado2}${formato}\n`;
        contador++;
    });
    
    navigator.clipboard.writeText(textoResultado).then(() => {
        alert('Texto copiado al portapapeles');
    }).catch(err => {
        console.error('Error al copiar el texto:', err);
    });
}




// Enviar resultados por WhatsApp
function enviarPorWhatsapp() {
    const nombreJugador = document.getElementById('nombreJugador').value.trim();
    const partidosContainer = document.getElementById('partidosContainer');
    let textoResultado = '';
    let contador = 1;

    textoResultado += `-------------------------------\n`;
    textoResultado += `Nombre: ${nombreJugador || '[Sin nombre]'}\n`;
    textoResultado += `-------------------------------\n`;

    Array.from(partidosContainer.children).forEach((partidoDiv, index) => {
        const equipo1 = partidoDiv.children[0].textContent;
        const resultado1 = document.getElementById(`resultadoEquipo1_${index}`).value || '0';
        const equipo2 = partidoDiv.children[4].textContent;
        const resultado2 = document.getElementById(`resultadoEquipo2_${index}`).value || '0';

        const comodin = partidoDiv.querySelector('label:last-child').textContent.includes('Sí');
        const formato = comodin ? '*' : '';

        textoResultado += `\n${contador}. ${formato}${equipo1} ${resultado1}${formato}\n  ${formato}${equipo2} ${resultado2}${formato}\n`;
        contador++;
    });
    
    const mensajeWhatsapp = encodeURIComponent(textoResultado);
    const whatsappURL = `https://wa.me/?text=${mensajeWhatsapp}`;
    window.open(whatsappURL, '_blank');
}



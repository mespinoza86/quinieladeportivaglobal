document.addEventListener('DOMContentLoaded', async () => {
    const jornadaSelect = document.getElementById('jornadaSelect');
    const jugadorSelect = document.getElementById('jugadorSelect');
    const copiarButton = document.getElementById('copiarResultadosButton');
    const whatsappButton = document.getElementById('enviarWhatsappButton');
    const resultadoTexto = document.getElementById('resultadoTexto');

    let textoResultado = '';

    try {
        const jornadasResp = await fetch('/api/jornadas');
        const jornadas = await jornadasResp.json();

        jornadaSelect.innerHTML = '<option value="">-- Selecciona jornada --</option>';

        jornadas.forEach(j => {
            const option = document.createElement('option');
            option.value = j.nombre;
            option.textContent = j.nombre;
            jornadaSelect.appendChild(option);
        });

        const jugadoresResp = await fetch('/api/jugadores');
        const jugadores = await jugadoresResp.json();

        jugadorSelect.innerHTML = '<option value="">-- Selecciona jugador --</option>';

        jugadores.forEach(j => {
            const option = document.createElement('option');
            option.value = j;
            option.textContent = j;
            jugadorSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error cargando datos:', error);
        alert('Error cargando jornadas o jugadores');
    }

    copiarButton.addEventListener('click', async () => {
        const jornada = jornadaSelect.value;
        const jugador = jugadorSelect.value;

        if (!jornada || !jugador) {
            alert('Selecciona jornada y jugador');
            return;
        }

        try {
            const resp = await fetch(
                `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
            );

            if (!resp.ok) {
                alert('No hay resultados para este jugador en esta jornada');
                return;
            }

            const resultados = await resp.json();

            if (!Array.isArray(resultados) || resultados.length === 0) {
                alert('El jugador no tiene resultados en esta jornada');
                return;
            }

            textoResultado = `-------------------------------\n`;
            textoResultado += `Nombre: ${jugador}\n`;
            textoResultado += `Jornada: ${jornada}\n`;
            textoResultado += `-------------------------------\n`;

            resultados.forEach((r, i) => {
                textoResultado += `${i + 1}. ${r.equipo1} ${r.marcador1 || 0}\n`;
                textoResultado += `   ${r.equipo2} ${r.marcador2 || 0}\n`;
            });

            resultadoTexto.value = textoResultado;

            await navigator.clipboard.writeText(textoResultado);

            alert('Texto copiado al portapapeles');

        } catch (error) {
            console.error('Error copiando resultados:', error);
            alert('Error al copiar resultados');
        }
    });

    whatsappButton.addEventListener('click', () => {
        if (!textoResultado) {
            alert('Primero genera el texto copiando los resultados');
            return;
        }

        const url = `https://wa.me/?text=${encodeURIComponent(textoResultado)}`;
        window.open(url, '_blank');
    });
});

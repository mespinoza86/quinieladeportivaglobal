let textoResultado = '';

document.addEventListener('DOMContentLoaded', () => {
    const jornadaSelect = document.getElementById('jornadaSelect');
    const copiarButton = document.getElementById('copiarResultadosButton');
    const whatsappButton = document.getElementById('enviarWhatsappButton');
    const resultadoTexto = document.getElementById('resultadoTexto');

    async function cargarJornadas() {
        try {
            const res = await fetch('/api/jornadas?resumen=1');
            const jornadas = await res.json();

            jornadaSelect.innerHTML = '<option value="">-- Selecciona --</option>';

            jornadas.forEach(j => {
                const option = document.createElement('option');
                option.value = j.nombre;
                option.textContent = j.nombre;
                jornadaSelect.appendChild(option);
            });

        } catch (err) {
            console.error('Error cargando jornadas:', err);
            alert('Error cargando jornadas');
        }
    }

    async function copiarResultados() {
        const jornadaSeleccionada = jornadaSelect.value;

        if (!jornadaSeleccionada) {
            alert('Selecciona una jornada');
            return;
        }

        try {
            const jugadoresRes = await fetch('/api/jugadores');
            const jugadores = await jugadoresRes.json();

            textoResultado = '';

            for (const jugador of jugadores) {
                const resJugador = await fetch(
                    `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornadaSeleccionada)}`
                );

                if (resJugador.status === 404) continue;

                const pronosticos = await resJugador.json();

                if (!Array.isArray(pronosticos) || pronosticos.length === 0) continue;

                textoResultado += `-------------------------------\n`;
                textoResultado += `Nombre: ${jugador}\n`;
                textoResultado += `-------------------------------\n`;

                /*
                 * ⚠️ `marcadorVisible` y no `|| '0'` (Entrada 068): un partido
                 * sin pronosticar salía como 0, y este texto se manda al grupo.
                 * `p.oculto` viene del servidor para los pronósticos que aún no
                 * son públicos —el partido no ha empezado— y nadie lo miraba,
                 * así que copiar la jornada antes de que arrancara daba un
                 * texto donde todo el mundo había puesto 0-0.
                 */
                pronosticos.forEach((p, i) => {
                    textoResultado += `${i + 1}. ${p.equipo1} ${marcadorVisible(p.marcador1, p.oculto)}\n`;
                    textoResultado += `   ${p.equipo2} ${marcadorVisible(p.marcador2, p.oculto)}\n`;
                });

                textoResultado += `\n`;
            }

            if (!textoResultado) {
                textoResultado = 'No hay resultados disponibles para esta jornada.';
            }

            resultadoTexto.value = textoResultado;

            await navigator.clipboard.writeText(textoResultado);

            alert('Resultados copiados al portapapeles');

        } catch (err) {
            console.error('Error copiando resultados:', err);
            alert('Error al copiar resultados');
        }
    }

    function enviarWhatsApp() {
        if (!textoResultado) {
            alert('Primero genera los resultados copiándolos');
            return;
        }

        const url = `https://wa.me/?text=${encodeURIComponent(textoResultado)}`;
        window.open(url, '_blank');
    }

    copiarButton.addEventListener('click', copiarResultados);
    whatsappButton.addEventListener('click', enviarWhatsApp);

    cargarJornadas();
});

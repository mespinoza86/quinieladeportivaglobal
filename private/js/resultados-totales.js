document.addEventListener('DOMContentLoaded', () => {
    const calcularButton = document.querySelector('#calcularResultados');
    const paginacion = document.querySelector('#paginacionResultados');
    const LIMITE = 25;
    let paginaActual = 1;

    async function cargarResultados(pagina = 1) {
        calcularButton.disabled = true;

        try {
            const response = await fetch(`/api/resultados-totales?pagina=${pagina}&limite=${LIMITE}`);
            const datos = await response.json();
            if (!response.ok) throw new Error(datos.error || 'No se pudo obtener la clasificación.');

            const tableBody = document.querySelector('#resultadosTotalesTable tbody');
            const tableHead = document.querySelector('#resultadosTotalesTable thead tr');
            const jugadores = datos.jugadores || [];

            tableBody.innerHTML = '';
            tableHead.innerHTML = '<th>Jugador</th>';

            if (jugadores.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="2">No hay resultados disponibles.</td></tr>';
                paginacion.innerHTML = '';
                return;
            }

            paginaActual = datos.pagina;
            const jornadas = Object.keys(jugadores[0])
                .filter(key => !['jugador', 'total'].includes(key));
            const ordenEspecial = ['Trivias'];
            const columnas = [
                ...ordenEspecial.filter(col => jornadas.includes(col)),
                ...jornadas.filter(col => !ordenEspecial.includes(col))
            ];

            columnas.forEach(jornadaId => {
                const th = document.createElement('th');
                th.textContent = jornadaId;
                tableHead.appendChild(th);
            });

            const thTotal = document.createElement('th');
            thTotal.textContent = 'Total';
            tableHead.appendChild(thTotal);

            jugadores.forEach(jugadorData => {
                const row = document.createElement('tr');
                const nombreCell = document.createElement('td');
                nombreCell.textContent = jugadorData.jugador;
                row.appendChild(nombreCell);

                columnas.forEach(jornadaId => {
                    const cell = document.createElement('td');
                    cell.textContent = jugadorData[jornadaId] ?? 0;
                    row.appendChild(cell);
                });

                const cellTotal = document.createElement('td');
                cellTotal.textContent = jugadorData.total ?? 0;
                row.appendChild(cellTotal);
                tableBody.appendChild(row);
            });

            paginacion.innerHTML = '';
            if (datos.totalPaginas > 1) {
                const anterior = document.createElement('button');
                anterior.type = 'button';
                anterior.textContent = 'Anterior';
                anterior.disabled = datos.pagina <= 1;
                anterior.addEventListener('click', () => cargarResultados(datos.pagina - 1));

                const estado = document.createElement('span');
                estado.textContent = `Página ${datos.pagina} de ${datos.totalPaginas} · ${datos.totalJugadores} jugadores`;

                const siguiente = document.createElement('button');
                siguiente.type = 'button';
                siguiente.textContent = 'Siguiente';
                siguiente.disabled = datos.pagina >= datos.totalPaginas;
                siguiente.addEventListener('click', () => cargarResultados(datos.pagina + 1));

                paginacion.append(anterior, estado, siguiente);
            }

            window.crearVistaMovilResultados?.();
        } catch (error) {
            console.error('Error al obtener resultados:', error);
            paginacion.textContent = 'No se pudo cargar la clasificación.';
        } finally {
            calcularButton.disabled = false;
        }
    }

    calcularButton.addEventListener('click', () => cargarResultados(1));
    window.cargarResultadosTotales = () => cargarResultados(paginaActual);
});

document.addEventListener('DOMContentLoaded', () => {
    const calcularButton = document.querySelector('#calcularResultados');

    calcularButton.addEventListener('click', () => {
        console.log("Calculando resultados...");

        fetch('/api/resultados-totales')
            .then(response => response.json())
            .then(resultados => {
                const tableBody = document.querySelector('#resultadosTotalesTable tbody');
                const tableHead = document.querySelector('#resultadosTotalesTable thead tr');

                tableBody.innerHTML = '';
                tableHead.innerHTML = '<th>Jugador</th>';

                const jugadores = Object.keys(resultados);

                if (jugadores.length === 0) {
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="2">No hay resultados disponibles.</td>
                        </tr>
                    `;
                    return;
                }

                const ejemploJugador = jugadores[0];

                let jornadas = Object.keys(resultados[ejemploJugador]).filter(key => key !== 'total');

                const ordenEspecial = ['Campeón Mundial', 'Trivias'];

                jornadas = [
                    ...ordenEspecial.filter(col => jornadas.includes(col)),
                    ...jornadas.filter(col => !ordenEspecial.includes(col))
                ];

                jornadas.forEach(jornadaId => {
                    const th = document.createElement('th');
                    th.textContent = jornadaId;
                    tableHead.appendChild(th);
                });

                const thTotal = document.createElement('th');
                thTotal.textContent = 'Total';
                tableHead.appendChild(thTotal);

                const jugadoresArray = jugadores.map(jugador => ({
                    nombre: jugador,
                    resultados: resultados[jugador]
                }));

                jugadoresArray.sort((a, b) => b.resultados.total - a.resultados.total);

                jugadoresArray.forEach(jugadorData => {
                    const jugador = jugadorData.nombre;

                    const row = document.createElement('tr');

                    const nombreCell = document.createElement('td');
                    nombreCell.textContent = jugador;
                    row.appendChild(nombreCell);

                    jornadas.forEach(jornadaId => {
                        const cell = document.createElement('td');
                        cell.textContent = resultados[jugador][jornadaId] ?? 0;
                        row.appendChild(cell);
                    });

                    const cellTotal = document.createElement('td');
                    cellTotal.textContent = resultados[jugador].total ?? 0;
                    row.appendChild(cellTotal);

                    tableBody.appendChild(row);
                });
            })
            .catch(error => console.error('Error al obtener resultados:', error));
    });
});

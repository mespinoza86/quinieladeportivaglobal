document.addEventListener('DOMContentLoaded', () => {
  const selector = document.getElementById('jornadaSelect');
  const estado = document.getElementById('estadoJornada');
  const cuerpo = document.querySelector('#clasificacionJornadaTable tbody');

  async function cargar(jornada) {
    const url = jornada
      ? `/api/clasificacion-jornada?jornada=${encodeURIComponent(jornada)}`
      : '/api/clasificacion-jornada';
    const respuesta = await fetch(url);
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar la jornada.');

    if (!selector.options.length) {
      datos.jornadas.forEach(item => {
        const opcion = document.createElement('option');
        opcion.value = item.nombre;
        opcion.textContent = item.nombre;
        selector.appendChild(opcion);
      });
    }
    selector.value = datos.jornada || '';
    estado.textContent = datos.jornada
      ? `Resultado ${datos.estado === 'confirmada' ? 'confirmado' : 'provisional'} de ${datos.jornada}.`
      : 'No hay jornadas creadas todavía.';

    cuerpo.innerHTML = '';
    datos.clasificacion.forEach(fila => {
      const tr = document.createElement('tr');
      const puesto = fila.empate ? `${fila.puesto}.º (empate)` : `${fila.puesto}.º`;
      [puesto, fila.jugador, fila.puntos, fila.marcadoresExactos,
        fila.resultadosCorrectos, fila.diferenciaTotalGoles].forEach(valor => {
        const td = document.createElement('td');
        td.textContent = valor;
        tr.appendChild(td);
      });
      cuerpo.appendChild(tr);
    });
  }

  selector.addEventListener('change', () => cargar(selector.value).catch(mostrarError));
  document.getElementById('volverButton').addEventListener('click', () => { window.location.href = 'index.html'; });

  function mostrarError(error) {
    console.error('Error cargando clasificación por jornada:', error);
    estado.textContent = error.message;
  }

  cargar().catch(mostrarError);
});

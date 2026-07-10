document.addEventListener('DOMContentLoaded', async () => {
  const tablaPronosticos = document.getElementById('tablaPronosticos');

  async function cargarPronosticos() {
    try {
      const res = await fetch('/api/pronosticos-campeon-publicos');
      const data = await res.json();

      tablaPronosticos.innerHTML = '';

      data.forEach(item => {
        const tr = document.createElement('tr');

        const campeonTexto = item.campeon
          ? item.campeon
          : 'Aún no ha definido el campeón';

        tr.innerHTML = `
          <td>${item.jugador}</td>
          <td>${campeonTexto}</td>
        `;

        tablaPronosticos.appendChild(tr);
      });

    } catch (error) {
      console.error('Error cargando pronósticos:', error);
      tablaPronosticos.innerHTML = `
        <tr>
          <td colspan="2">Error cargando pronósticos.</td>
        </tr>
      `;
    }
  }

  await cargarPronosticos();
});
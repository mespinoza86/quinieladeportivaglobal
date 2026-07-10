document.addEventListener('DOMContentLoaded', async () => {
  const campeonSelect = document.getElementById('campeonSelect');
  const guardarBtn = document.getElementById('guardarBtn');
  const mensaje = document.getElementById('mensaje');
  const tablaPronosticos = document.getElementById('tablaPronosticos');

  async function cargarEquipos() {
    const res = await fetch('/api/equipos-mundial');
    const equipos = await res.json();

    campeonSelect.innerHTML = '<option value="">Seleccione campeón oficial</option>';

    equipos.forEach(equipo => {
      const option = document.createElement('option');
      option.value = equipo;
      option.textContent = equipo;
      campeonSelect.appendChild(option);
    });
  }

  async function cargarCampeonOficial() {
    const res = await fetch('/api/campeon-oficial');
    const data = await res.json();

    if (data && data.campeon) {
      campeonSelect.value = data.campeon;
    }
  }

  async function cargarPronosticos() {
    const res = await fetch('/api/pronosticos-campeon');
    const pronosticos = await res.json();

    tablaPronosticos.innerHTML = '';

    pronosticos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.jugador}</td>
        <td>${p.campeon}</td>
      `;
      tablaPronosticos.appendChild(tr);
    });
  }

  guardarBtn.addEventListener('click', async () => {
    const campeon = campeonSelect.value;

    if (!campeon) {
      mensaje.textContent = 'Debe seleccionar el campeón oficial.';
      return;
    }

    const res = await fetch('/api/campeon-oficial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campeon })
    });

    const data = await res.json();

    if (res.ok) {
      mensaje.textContent = 'Campeón oficial guardado. Los 20 puntos se sumarán en resultados totales.';
      await cargarPronosticos();
    } else {
      mensaje.textContent = data.error || 'Error guardando campeón oficial.';
    }
  });

  await cargarEquipos();
  await cargarCampeonOficial();
  await cargarPronosticos();
});
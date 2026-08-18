document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('topRankingContainer');
  if (!container) return;

  try {
    /*
     * Paginado. La portada solo pinta el podio, pero pedía la tabla entera y
     * descartaba todo menos tres filas: con quinientos jugadores se transferían
     * quinientas filas para mostrar tres. El servidor ya devuelve la página
     * ordenada por total descendente, así que aquí no hay nada que ordenar.
     */
    const res = await fetch('/api/resultados-totales?pagina=1&limite=3');
    const data = await res.json();

    const ranking = (data.jugadores || []).map(item => ({
      jugador: item.jugador,
      total: item.total || 0
    }));

    const medallas = ['🥇', '🥈', '🥉'];

    container.innerHTML = ranking.map((item, index) => `
      <div class="ranking-row ranking-${index + 1}">
        <div class="ranking-position">${medallas[index]}</div>
        <div class="ranking-player">
          <strong>${item.jugador}</strong>
          <span>${item.total} puntos</span>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error cargando ranking:', error);
    container.innerHTML = 'No se pudo cargar el ranking.';
  }
});


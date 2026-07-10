document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('topRankingContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/resultados-totales');
    const data = await res.json();

    const ranking = Object.entries(data)
      .map(([jugador, puntos]) => ({
        jugador,
        total: puntos.total || 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

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


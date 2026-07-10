document.addEventListener('DOMContentLoaded', () => {
    // Cambiar aquí el ID de jugadoresList a listaJugadores
    const jugadoresList = document.getElementById('listaJugadores');

    function loadJugadores() {
        fetch('/api/jugadores')
            .then(response => response.json())
            .then(jugadores => {
                jugadoresList.innerHTML = '';
                jugadores.forEach(jugador => {
                    const li = document.createElement('li');
                    li.textContent = jugador;
                    jugadoresList.appendChild(li);
                });
            });
    }

    // Cargar la lista de jugadores al cargar la página
    loadJugadores();
});

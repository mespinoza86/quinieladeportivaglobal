document.addEventListener('DOMContentLoaded', () => {
    const jugadoresList = document.getElementById('jugadoresList');
    const nombreInput = document.getElementById('nombreInput');
    const passwordInput = document.getElementById('passwordInput');
    const confirmPasswordInput = document.getElementById('confirmPasswordInput');
    const addButton = document.getElementById('addJugadorButton');

    // Cargar lista de jugadores

function loadJugadores() {
    fetch('/api/jugadores')
        .then(res => res.json())
        .then(jugadores => {
            jugadoresList.innerHTML = '';
            eliminarJugadorSelect.innerHTML = '';

            jugadores.forEach(jugador => {
                // Lista de jugadores
                const li = document.createElement('li');
                const nombreSpan = document.createElement('span');
                nombreSpan.textContent = jugador; // <-- cambio importante
                li.appendChild(nombreSpan);

                const changeBtn = document.createElement('button');
                changeBtn.textContent = 'Cambiar contraseña';
                changeBtn.style.marginLeft = '10px';
                changeBtn.addEventListener('click', () => cambiarPassword(jugador));
                li.appendChild(changeBtn);
                jugadoresList.appendChild(li);

                // Combobox para eliminar
                const option = document.createElement('option');
                option.value = jugador; // <-- cambio importante
                option.textContent = jugador; // <-- cambio importante
                eliminarJugadorSelect.appendChild(option);
            });
        });
}
    

    // Agregar nuevo jugador
    addButton.addEventListener('click', async () => {
        const nombre = nombreInput.value.trim();
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (!nombre || !password || !confirmPassword) {
            alert('Todos los campos son obligatorios');
            return;
        }
        if (password !== confirmPassword) {
            alert('Las contraseñas no coinciden');
            return;
        }

        try {
            const res = await fetch('/api/jugadores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, password })
            });

            const data = await res.json();
            if (res.ok) {
                loadJugadores();
                nombreInput.value = '';
                passwordInput.value = '';
                confirmPasswordInput.value = '';
            } else {
                alert(data.error || 'Error al agregar jugador');
            }
        } catch (err) {
            console.error(err);
            alert('Error al agregar jugador');
        }
    });

    // Eliminar jugador
    const deleteButton = document.getElementById('deleteJugadorButton');
    deleteButton.addEventListener('click', async () => {
        const jugador = eliminarJugadorSelect.value;
        if (!jugador) {
            alert('Selecciona un jugador para eliminar');
            return;
        }

        const confirmDelete = confirm(`¿Estás seguro de que quieres eliminar al jugador "${jugador}"?`);
        if (!confirmDelete) return;

        try {
            const res = await fetch(`/api/jugadores/${encodeURIComponent(jugador)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok) {
                alert(data.message);
                loadJugadores(); // recargar lista
            } else {
                alert(data.error || 'Error al eliminar jugador');
            }
        } catch (err) {
            console.error(err);
            alert('Error al eliminar jugador');
        }
    });


    // Función para cambiar contraseña de un jugador
    async function cambiarPassword(nombre) {
        try {
            // Pedir la contraseña actual (si existe)
            const currentPassword = prompt('Ingresa la contraseña actual (dejar vacío si no tiene):');

            const newPassword = prompt('Ingresa la nueva contraseña:');
            const confirmNewPassword = prompt('Confirma la nueva contraseña:');

            if (!newPassword || newPassword !== confirmNewPassword) {
                alert('Las nuevas contraseñas no coinciden o están vacías');
                return;
            }

            const res = await fetch(`/api/jugadores/${encodeURIComponent(nombre)}/cambiar-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await res.json();
            alert(data.message || 'Operación completada');
        } catch (err) {
            console.error(err);
            alert('Error al cambiar la contraseña');
        }
    }

    loadJugadores();
});


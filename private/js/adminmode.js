document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    const guestContent = document.getElementById('guest-content');
    const logoutForm = document.getElementById('logoutForm');

    // Verificar el estado de la sesión
    fetch('/check-auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                // Mostrar contenido para administradores
                adminContent.style.display = 'block';
                guestContent.style.display = 'none';
            } else {
                // Mostrar contenido para usuarios no autenticados
                adminContent.style.display = 'none';
                guestContent.style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Error al verificar autenticación:', error);
        });

    // Manejar el cierre de sesión
    logoutForm.addEventListener('submit', (event) => {
        event.preventDefault();

        fetch('/logout', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = '/login.html';
            }
        })
        .catch(error => {
            console.error('Error al cerrar sesión:', error);
        });
    });
});

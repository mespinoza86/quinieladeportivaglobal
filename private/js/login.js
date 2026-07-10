document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');

    loginForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const password = document.getElementById('password').value;

        fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        })
        .then(response => {
            if (response.ok) {
                window.location.href = '/adminmode.html';
            } else {
                return response.json().then(data => {
                    errorMessage.textContent = data.error;
                });
            }
        })
        .catch(error => {
            errorMessage.textContent = 'Error de red';
        });
    });
});

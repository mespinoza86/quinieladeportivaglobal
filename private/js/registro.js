document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registroForm');
  const mensaje = document.getElementById('registroMensaje');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';
    const password = document.getElementById('password').value;
    const confirmarPassword = document.getElementById('confirmarPassword').value;
    if (password !== confirmarPassword) {
      mensaje.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const response = await fetch('/api/auth/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          email: document.getElementById('email').value,
          password,
          confirmarPassword
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear la cuenta.');
      window.location.href = '/quinielas.html';
    } catch (error) {
      mensaje.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });
});

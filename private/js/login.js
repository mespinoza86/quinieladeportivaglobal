document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const mensaje = document.getElementById('errorMessage');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identificador: document.getElementById('identificador').value,
          password: document.getElementById('password').value
        })
      });
      const data = await response.json();

      /*
       * Una cuenta sin confirmar no es un error de credenciales: se le lleva a
       * la pantalla que sabe reenviar el enlace, en vez de dejarle releyendo un
       * mensaje sin nada que hacer.
       */
      if (!response.ok && data.requiereVerificacion) {
        window.location.href = '/verificar-correo.html';
        return;
      }

      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
      window.location.href = '/quinielas.html';
    } catch (error) {
      mensaje.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });

  document.getElementById('registroButton').addEventListener('click', () => {
    window.location.href = '/registro.html';
  });
});

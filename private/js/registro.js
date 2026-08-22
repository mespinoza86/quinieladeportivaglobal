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

      /*
       * Ya no se entra al registrarse: la cuenta nace sin confirmar y sin
       * confirmar no se entra (Fase E). Lo que toca es decir que mire el
       * correo, y el formulario se retira para que nadie lo mande dos veces.
       */
      form.hidden = true;
      mensaje.textContent = data.mensaje
        || 'Te enviamos un correo para confirmar tu dirección.';
    } catch (error) {
      mensaje.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });
});

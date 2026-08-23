/*
 * Pedir el enlace para elegir una contraseña nueva.
 *
 * ⚠️ El servidor responde lo MISMO exista o no la cuenta, y esta pantalla
 * repite ese mensaje tal cual. Si dijera «esa dirección no está registrada»,
 * cualquiera podría averiguar qué correos tienen cuenta probándolos uno a uno.
 *
 * Por eso el formulario se retira aunque no exista: desde fuera, las dos cosas
 * tienen que verse iguales.
 */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('olvideForm');
  const mensaje = document.getElementById('mensaje');
  const irLogin = document.getElementById('irLogin');

  irLogin.addEventListener('click', () => { window.location.href = '/login.html'; });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';

    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;

    try {
      const respuesta = await fetch('/api/auth/olvide-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('email').value.trim() })
      });
      const datos = await respuesta.json();

      // Mirar el ESTADO, no sólo el cuerpo: un 429 trae `error`, no `mensaje`.
      if (!respuesta.ok) {
        mensaje.textContent = datos.error || 'No se pudo enviar el enlace. Inténtalo en unos minutos.';
        return;
      }

      form.hidden = true;
      mensaje.textContent = datos.mensaje
        || 'Si esa dirección tiene una cuenta, le enviamos un enlace para cambiar la contraseña.';
    } catch {
      mensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo en un momento.';
    } finally {
      boton.disabled = false;
    }
  });
});

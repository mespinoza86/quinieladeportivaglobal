/*
 * Elegir la contraseña nueva desde el enlace del correo.
 *
 * El token viaja en la URL porque es lo que puede hacer un enlace, y de ahí
 * pasa a un POST: así no acaba en el registro del servidor como parte de la
 * ruta.
 *
 * ⚠️ Y se limpia de la barra de direcciones nada más leerlo. Aquí importa más
 * que en la confirmación: **este enlace abre la cuenta a quien lo tenga**, así
 * que dejarlo a la vista invita a copiarlo o a que lo vea quien pase por detrás.
 */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('restablecerForm');
  const estado = document.getElementById('estado');
  const mensaje = document.getElementById('mensaje');
  const irLogin = document.getElementById('irLogin');
  const pedirOtro = document.getElementById('pedirOtro');

  irLogin.addEventListener('click', () => { window.location.href = '/login.html'; });
  pedirOtro.addEventListener('click', () => { window.location.href = '/olvide-password.html'; });

  const token = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState({}, '', '/restablecer-password.html');

  if (!token) {
    form.hidden = true;
    estado.textContent = 'Este enlace no trae ningún código.';
    mensaje.textContent = 'Ábrelo desde el correo que te enviamos, o pide otro.';
    pedirOtro.hidden = false;
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';

    const password = document.getElementById('password').value;

    /*
     * Las dos comprobaciones se hacen aquí para avisar sin ir al servidor, pero
     * el servidor las repite: una pantalla no es una defensa.
     */
    if (password !== document.getElementById('confirmar').value) {
      mensaje.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    if (password.length < 8) {
      mensaje.textContent = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;

    try {
      const respuesta = await fetch('/api/auth/restablecer-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const datos = await respuesta.json();

      if (!respuesta.ok) {
        mensaje.textContent = datos.error || 'No se pudo cambiar la contraseña.';
        // Si el enlace ya no vale, lo único útil que puede hacer es pedir otro.
        pedirOtro.hidden = false;
        return;
      }

      form.hidden = true;
      estado.textContent = 'Listo, ya tienes contraseña nueva.';
      mensaje.textContent = `Entra como ${datos.username} con la contraseña que acabas de elegir.`;
      irLogin.hidden = false;
    } catch {
      mensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo en un momento.';
    } finally {
      boton.disabled = false;
    }
  });
});

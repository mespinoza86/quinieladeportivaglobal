/*
 * La pantalla que abre el enlace del correo de confirmación.
 *
 * El token viaja en la URL porque es lo que puede hacer un enlace, y de ahí
 * pasa a un POST: así no queda en el registro del servidor ni en el historial
 * de peticiones como parte de la ruta.
 *
 * ⚠️ Y se limpia de la barra de direcciones en cuanto se usa. Un enlace de un
 * solo uso ya gastado no hace daño, pero dejarlo a la vista invita a copiarlo y
 * a pegarlo en sitios donde no debería estar.
 */
document.addEventListener('DOMContentLoaded', () => {
  const estado = document.getElementById('estado');
  const mensaje = document.getElementById('mensaje');
  const irLogin = document.getElementById('irLogin');
  const bloqueReenvio = document.getElementById('bloqueReenvio');
  const reenviar = document.getElementById('reenviar');
  const email = document.getElementById('email');

  irLogin.addEventListener('click', () => { window.location.href = '/login.html'; });

  function fallo(texto) {
    estado.textContent = 'No pudimos confirmar tu correo.';
    mensaje.textContent = texto;
    bloqueReenvio.hidden = false;
  }

  async function confirmar(token) {
    try {
      const respuesta = await fetch('/api/auth/verificar-correo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const datos = await respuesta.json();

      if (!respuesta.ok) return fallo(datos.error || 'El enlace no es válido.');

      estado.textContent = '¡Listo! Tu correo está confirmado.';
      mensaje.textContent = `Ya puedes iniciar sesión como ${datos.username}.`;
      irLogin.hidden = false;
    } catch {
      fallo('No se pudo contactar con el servidor. Inténtalo de nuevo en un momento.');
    }
  }

  reenviar.addEventListener('click', async () => {
    const direccion = email.value.trim();
    if (!direccion) {
      mensaje.textContent = 'Escribe el correo con el que creaste la cuenta.';
      return;
    }

    reenviar.disabled = true;
    try {
      const respuesta = await fetch('/api/auth/reenviar-verificacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: direccion })
      });
      const datos = await respuesta.json();
      /*
       * El servidor responde lo mismo exista o no la cuenta, para no decir qué
       * direcciones están registradas. La pantalla repite ese mensaje tal cual.
       */
      mensaje.textContent = datos.mensaje || 'Si esa dirección tiene una cuenta sin confirmar, le enviamos el enlace.';
    } catch {
      mensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo en un momento.';
    } finally {
      reenviar.disabled = false;
    }
  });

  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    estado.textContent = 'Este enlace no trae ningún código.';
    mensaje.textContent = 'Ábrelo desde el correo que te enviamos, o pide que te lo reenviemos.';
    bloqueReenvio.hidden = false;
    return;
  }

  window.history.replaceState({}, '', '/verificar-correo.html');
  confirmar(token);
});

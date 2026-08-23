/*
 * Modo Administrador: decidir qué se enseña.
 *
 * ============================================================================
 * ⚠️ NINGUNA SECCIÓN SE ENSEÑA SIN HABERLO DECIDIDO
 * ============================================================================
 *
 * La página tiene cuatro secciones y **las cuatro arrancan ocultas**. Hasta la
 * Entrada 062, `guest-content` venía visible de fábrica, y ése era el fallo de
 * raíz: si la comprobación de permisos se torcía, el `catch` sólo escribía en
 * la consola y esa sección se quedaba puesta **por accidente**.
 *
 * El resultado era una pantalla que parecía correcta y no lo era: un
 * administrador veía el menú público, sin sus opciones y sin ninguna
 * explicación. Había que salir a Inicio y volver a entrar para que funcionara.
 *
 * Por eso ahora, si la comprobación falla, se dice.
 */
document.addEventListener('DOMContentLoaded', () => {
  const adminContent = document.getElementById('admin-content');
  const adminLogin = document.getElementById('admin-login');
  const adminError = document.getElementById('admin-error');
  const adminErrorDetalle = document.getElementById('adminErrorDetalle');
  const guestContent = document.getElementById('guest-content');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminLoginMessage = document.getElementById('adminLoginMessage');
  const logoutForm = document.getElementById('logoutForm');
  const exitAdminMode = document.getElementById('exitAdminMode');

  let esAdmin = false;

  /** Enseña una sección y esconde las otras tres. Nunca hay dos a la vez. */
  function mostrarSolo(seccion) {
    for (const s of [adminContent, adminLogin, adminError, guestContent]) {
      if (s) s.style.display = s === seccion ? 'block' : 'none';
    }
  }

  /*
   * ⚠️ `guest-content` NO SE ENSEÑA NUNCA, y no es un olvido.
   *
   * Quien no es administrador no llega a ver esta página: se le manda a
   * `/index.html` unas líneas más abajo. Así que ese menú público llevaba
   * siendo marcado inalcanzable desde siempre, y lo ÚNICO que lo mostraba era
   * el fallo que esta entrada arregla: venía visible de fábrica y se quedaba
   * puesto cuando la comprobación se torcía.
   *
   * Se conserva oculto en vez de borrarlo porque son ~100 líneas de marcado y
   * quitarlo es una decisión aparte. Mientras siga aquí, `mostrarSolo` lo
   * esconde en todos los casos, así que ya no puede aparecer por accidente.
   */
  function mostrarEstado(activo) {
    mostrarSolo(activo ? adminContent : adminLogin);
  }

  const esperar = ms => new Promise(listo => setTimeout(listo, ms));

  /**
   * Pide algo al servidor y **exige que la respuesta sea JSON**.
   *
   * ⚠️ Esto es lo que hacía saltar el fallo: cuando el servicio está
   * despertando, la respuesta puede ser una página de error en HTML, y
   * `response.json()` revienta con un error de sintaxis que no dice nada útil.
   * Aquí se convierte en un mensaje que se puede enseñar.
   */
  async function pedirJson(url) {
    const respuesta = await fetch(url);
    const tipo = respuesta.headers.get('content-type') || '';

    if (!tipo.includes('application/json')) {
      throw new Error(`El servidor respondió ${respuesta.status} sin datos. `
        + 'Puede estar arrancando.');
    }

    return { respuesta, datos: await respuesta.json() };
  }

  /**
   * Comprueba quién eres y si el modo administrador está activo.
   *
   * Devuelve `true` si dejó la pantalla decidida, `false` si no pudo.
   */
  async function comprobarPermisos() {
    const { respuesta, datos } = await pedirJson('/api/quiniela-actual');

    if (respuesta.status === 401) { window.location.href = '/login.html'; return true; }
    if (respuesta.status === 409) { window.location.href = '/quinielas.html'; return true; }
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo leer la quiniela.');

    esAdmin = ['propietario', 'admin'].includes(datos.rol);
    if (!esAdmin) { window.location.replace('/index.html'); return true; }

    const estado = await pedirJson('/api/admin-mode');
    mostrarEstado(Boolean(estado.datos.activo));
    return true;
  }

  /**
   * Comprueba, y si falla **lo intenta una segunda vez** antes de rendirse.
   *
   * El reintento existe porque la causa más probable es pasajera —el servicio
   * despertando— y es exactamente lo que se conseguía a mano yendo a Inicio y
   * volviendo a entrar. Haciéndolo aquí, quien usa la aplicación ni se entera.
   *
   * Sólo un reintento: si a la segunda tampoco, insistir no lo va a arreglar y
   * lo que toca es decirlo.
   */
  async function arrancar({ conEspera = true } = {}) {
    try {
      return await comprobarPermisos();
    } catch (primerError) {
      console.warn('Primer intento fallido, reintentando:', primerError);

      if (conEspera) await esperar(2000);

      try {
        return await comprobarPermisos();
      } catch (segundoError) {
        console.error('Error al verificar permisos:', segundoError);
        adminErrorDetalle.textContent = segundoError.message;
        mostrarSolo(adminError);
        return false;
      }
    }
  }

  document.getElementById('reintentarAdmin')?.addEventListener('click', () => {
    adminErrorDetalle.textContent = 'Comprobando…';
    arrancar({ conEspera: false });
  });

  adminLoginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    adminLoginMessage.textContent = '';

    try {
      const respuesta = await fetch('/api/admin-mode/activar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('adminPassword').value })
      });

      const datos = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        adminLoginMessage.textContent = datos.error
          || 'No se pudo activar el modo administrador.';
        return;
      }

      adminLoginForm.reset();
      mostrarEstado(true);
    } catch (error) {
      /*
       * Antes esto quedaba en una promesa rechazada y sin recoger: se pulsaba
       * el botón y no pasaba NADA. Un formulario que no responde parece roto.
       */
      console.error('No se pudo activar el modo administrador:', error);
      adminLoginMessage.textContent = 'No se pudo contactar con el servidor. Inténtalo otra vez.';
    }
  });

  exitAdminMode?.addEventListener('click', async () => {
    await fetch('/api/admin-mode/desactivar', { method: 'POST' });
    mostrarEstado(false);
  });

  logoutForm?.addEventListener('submit', async event => {
    event.preventDefault();
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  arrancar();
});

/*
 * Activar y apagar las notificaciones del teléfono.
 *
 * ============================================================================
 * ⛔ AQUÍ NO SE ADIVINA QUÉ TELÉFONO TIENE NADIE
 * ============================================================================
 *
 * En iPhone las notificaciones web sólo existen si la persona ha añadido el
 * sitio a la pantalla de inicio; en una pestaña de Safari, no.
 *
 * La tentación era mirar el `User-Agent` para saber si es un iPhone. ⛔ Y está
 * mal por dos motivos: el iPad miente —se declara escritorio desde iPadOS 13— y
 * sobre todo, la pregunta que importa no es «¿qué teléfono es?» sino **«¿se
 * puede aquí?»**.
 *
 * Así que se detecta la CAPACIDAD: si `PushManager` no existe en este
 * navegador, no se puede y punto. En iPhone eso ocurre exactamente mientras el
 * sitio esté en una pestaña, y en cuanto lo añaden a la pantalla de inicio
 * `PushManager` aparece y el botón funciona solo.
 *
 * ⭐ El día que Apple lo cambie, esto se entera sin que nadie toque nada.
 */
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('panelNotificaciones');
  if (!panel) return;

  const estado = document.getElementById('estadoNotificaciones');
  const boton = document.getElementById('botonNotificaciones');
  const ayuda = document.getElementById('ayudaNotificaciones');

  const sePuedeAqui = 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;

  /**
   * La clave pública viene en base64url y `subscribe()` quiere bytes.
   *
   * ⚠️ No es base64 normal: cambia `+` por `-` y `/` por `_`, y se le quita el
   * relleno. Pasársela tal cual a `atob()` da un error de caracteres inválidos
   * en unas claves sí y en otras no, según qué letras le tocaran — que es la
   * peor clase de fallo, el que parece intermitente.
   */
  function comoBytes(base64url) {
    const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
    const crudo = window.atob(base64);

    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
    return bytes;
  }

  async function pedirJson(url, opciones) {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
    return datos;
  }

  /** La suscripción de ESTE navegador, si la hay. */
  async function suscripcionActual() {
    const registro = await navigator.serviceWorker.getRegistration('/');
    return registro ? registro.pushManager.getSubscription() : null;
  }

  function pintar({ activadas, disponible, antelacionMinutos }) {
    panel.hidden = false;

    if (!disponible) {
      estado.textContent = 'Las notificaciones no están configuradas en el servidor.';
      boton.hidden = true;
      ayuda.hidden = true;
      return;
    }

    if (!sePuedeAqui) {
      /*
       * El caso del iPhone en pestaña. Se le dice QUÉ hacer, no que su
       * navegador no vale: añadir a la pantalla de inicio y volver a entrar.
       */
      estado.textContent = 'Este navegador no puede recibir avisos todavía.';
      boton.hidden = true;
      ayuda.hidden = false;
      return;
    }

    ayuda.hidden = true;
    boton.hidden = false;
    estado.textContent = activadas
      ? `Avisos activados en este teléfono: te avisamos ${antelacionMinutos} minutos antes de cada partido.`
      : 'Recibe un aviso antes de que empiecen tus partidos, para revisar tus pronósticos.';
    boton.textContent = activadas ? 'Desactivar en este teléfono' : 'Activar en este teléfono';
    boton.dataset.activadas = activadas ? 'si' : 'no';
  }

  async function activar(clavePublica) {
    /*
     * ⚠️ El permiso se pide AQUÍ, dentro del clic, y no al cargar la página.
     * Un navegador que recibe la petición sin que nadie haya pulsado nada la
     * bloquea para siempre en algunos casos — y además pedirlo de golpe al
     * entrar es la forma más rápida de que digan que no.
     */
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      estado.textContent = permiso === 'denied'
        ? 'Los avisos están bloqueados en los ajustes del navegador para este sitio.'
        : 'No se activaron los avisos.';
      return false;
    }

    const registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const suscripcion = await registro.pushManager.subscribe({
      /*
       * Obligatorio en Chrome: sin esto sólo se pueden mandar notificaciones
       * silenciosas, que es justo lo contrario de lo que se quiere.
       */
      userVisibleOnly: true,
      applicationServerKey: comoBytes(clavePublica)
    });

    const { endpoint, keys } = suscripcion.toJSON();
    await pedirJson('/api/notificaciones/suscribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, keys })
    });

    return true;
  }

  async function desactivar() {
    const suscripcion = await suscripcionActual();
    if (!suscripcion) return true;

    const { endpoint } = suscripcion.toJSON();

    /*
     * ⚠️ Primero el servidor y DESPUÉS el navegador. Al revés, si la petición
     * falla, el navegador ya no tiene la suscripción para volver a intentarlo y
     * el servidor sigue mandando avisos a un sitio que ya nadie escucha.
     */
    await pedirJson('/api/notificaciones/desuscribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });

    await suscripcion.unsubscribe();
    return true;
  }

  async function arrancar() {
    let config;
    try {
      config = await pedirJson('/api/notificaciones');
    } catch (error) {
      panel.hidden = true;      // Sin sesión o sin servidor: no se enseña nada.
      return;
    }

    /*
     * ⭐ Lo que decide si están activadas es la suscripción DE ESTE NAVEGADOR,
     * no el contador del servidor. Tener el móvil activado no significa que
     * este portátil lo esté, y enseñar «desactivar» en un aparato que nunca se
     * activó es mentir.
     */
    const activadas = sePuedeAqui ? Boolean(await suscripcionActual()) : false;
    pintar({ ...config, activadas });

    boton.addEventListener('click', async () => {
      boton.disabled = true;
      const estabanPuestas = boton.dataset.activadas === 'si';

      try {
        const bien = estabanPuestas ? await desactivar() : await activar(config.clavePublica);
        if (bien) pintar({ ...config, activadas: !estabanPuestas });
      } catch (error) {
        estado.textContent = error.message;
      } finally {
        boton.disabled = false;
      }
    });
  }

  arrancar();
});

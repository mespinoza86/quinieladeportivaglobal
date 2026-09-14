/*
 * El transporte de las notificaciones: hablar con el servicio de push.
 *
 * Es la frontera con el exterior, y vive aparte de `notificaciones.js` por lo
 * mismo que `correo.js` vive aparte de `compartir.js`: la regla de A QUIÉN y
 * CUÁNDO se avisa se puede probar sin red, y aquí queda sólo el cómo.
 *
 * ============================================================================
 * ⛔ LAS CLAVES VAPID SON OBLIGATORIAS, Y SI FALTAN SE DICE
 * ============================================================================
 *
 * Sin ellas no se puede firmar nada y el servicio rechaza todo. Callarlo haría
 * que las notificaciones «no funcionaran» sin ninguna pista: por eso
 * `hayClaves()` existe y la pantalla lo pregunta antes de ofrecer el botón.
 *
 * La pública NO es secreta —viaja al navegador, es su identificador—. La
 * privada sí, y va sólo en las variables de entorno.
 */
'use strict';

const webpush = require('web-push');

let configurado = false;

/** ¿Están puestas las tres variables? */
function hayClaves() {
  return Boolean(process.env.VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
    && process.env.VAPID_SUBJECT);
}

/** La pública, que es la que necesita el navegador para suscribirse. */
function clavePublica() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

/**
 * Configura la librería una sola vez.
 *
 * ⚠️ Perezoso a propósito: `web-push` revienta si se le dan claves vacías, y en
 * las pruebas no hay ninguna. Configurar al cargar el módulo haría que importar
 * este archivo tumbara la suite entera.
 */
function preparar() {
  if (configurado) return true;
  if (!hayClaves()) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY);

  configurado = true;
  return true;
}

/**
 * Manda una notificación a un navegador.
 *
 * ⭐ Devuelve `{ muerta: true }` cuando el servicio contesta **404 o 410**. Esos
 * dos códigos significan «esa suscripción ya no existe» —el navegador se
 * desinstaló, se limpiaron los datos, caducó— y son los únicos en los que hay
 * que BORRAR la fila. Tratarlos como un error de red cualquiera llenaría la
 * tabla de teléfonos muertos a los que se escribe en cada partido para siempre.
 *
 * Cualquier otro fallo —un 500 del servicio, un corte— se devuelve como un no
 * rotundo pero SIN borrar: puede funcionar la próxima vez.
 */
async function enviar({ destinatario, mensaje }) {
  if (!preparar()) return { ok: false, motivo: 'sin_claves' };

  const carga = JSON.stringify({
    titulo: mensaje.titulo,
    cuerpo: mensaje.cuerpo,
    url: mensaje.url || '/index.html'
  });

  try {
    await webpush.sendNotification({
      endpoint: destinatario.endpoint,
      keys: destinatario.keys
    }, carga);

    return { ok: true };
  } catch (error) {
    const codigo = error?.statusCode;
    if (codigo === 404 || codigo === 410) return { ok: false, muerta: true };

    return { ok: false, motivo: `push_${codigo || 'error'}`, detalle: error.message };
  }
}

module.exports = { hayClaves, clavePublica, enviar };

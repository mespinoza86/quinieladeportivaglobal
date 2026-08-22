/*
 * Envío de correo.
 *
 * ============================================================================
 * TODO EL CONTACTO CON EL PROVEEDOR VIVE AQUÍ
 * ============================================================================
 *
 * El resto de la aplicación sólo llama a `enviarVerificacion`. Cambiar de Brevo
 * a otro proveedor es reescribir un transporte de este archivo y no tocar nada
 * más — que es exactamente lo mismo que hace `src/proveedor.js` con APIFootball,
 * y por la misma razón.
 *
 * ============================================================================
 * TRES TRANSPORTES, Y EL DE CONSOLA NO ES UN JUGUETE
 * ============================================================================
 *
 *   `consola` — escribe el correo en el registro en vez de enviarlo, y lo deja
 *               en `bandeja`. Es el predeterminado en desarrollo y en pruebas:
 *               ⚠️ **del token sólo se guarda el hash**, así que sin esta
 *               bandeja ni las pruebas ni quien desarrolla podrían recuperar el
 *               enlace que se habría enviado.
 *
 *   `brevo`    — envía de verdad. Se eligió porque **permite verificar una sola
 *               dirección de remitente sin poseer un dominio**, que es la
 *               situación de este proyecto: `quinieladeportivaglobal.onrender.com`
 *               no es un dominio propio donde poner registros DNS.
 *
 *   `resend`   — escrito por adelantado para el día que haya dominio propio.
 *               Resend exige verificarlo con DNS; a cambio, la entregabilidad
 *               es muy superior a la de un remitente sin autenticar. Migrar es
 *               cambiar `MAIL_TRANSPORT`, la clave y el remitente.
 */
'use strict';

const TRANSPORTE = process.env.MAIL_TRANSPORT || 'consola';
const CLAVE = process.env.MAIL_API_KEY || '';
const REMITENTE = process.env.MAIL_FROM || '';
const NOMBRE_REMITENTE = process.env.MAIL_FROM_NAME || 'Quiniela Deportiva Global';

/*
 * ⚠️ En producción con el transporte de consola, NADIE recibe su correo de
 * confirmación y —como sin confirmar no se entra— nadie puede usar la
 * aplicación. Se avisa fuerte al arrancar en vez de descubrirlo por los
 * usuarios.
 */
if (process.env.NODE_ENV === 'production' && TRANSPORTE === 'consola') {
  console.warn(
    '\n⚠️  [correo] MAIL_TRANSPORT no está configurado: NO se enviará ningún correo.\n' +
    '    Como sin confirmar no se entra, nadie podrá usar la aplicación.\n');
}

/** El nombre viaja dentro del HTML del correo: se escapa igual que en el DOM. */
function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==================== Los transportes ==================== */

async function porBrevo({ para, asunto, texto, html }) {
  if (!CLAVE || !REMITENTE) throw new Error('Faltan MAIL_API_KEY o MAIL_FROM para enviar con Brevo');

  const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': CLAVE },
    body: JSON.stringify({
      sender: { email: REMITENTE, name: NOMBRE_REMITENTE },
      to: [{ email: para }],
      subject: asunto,
      textContent: texto,
      htmlContent: html
    })
  });

  if (!respuesta.ok) {
    /*
     * El cuerpo del error explica si falta verificar el remitente o si se agotó
     * la cuota del día, que son los dos fallos habituales del plan gratuito.
     */
    throw new Error(`Brevo respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
}

async function porResend({ para, asunto, texto, html }) {
  if (!CLAVE || !REMITENTE) throw new Error('Faltan MAIL_API_KEY o MAIL_FROM para enviar con Resend');

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${CLAVE}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: `${NOMBRE_REMITENTE} <${REMITENTE}>`,
      to: [para], subject: asunto, text: texto, html
    })
  });

  if (!respuesta.ok) {
    // Suele decir que el dominio no está verificado: es el fallo tras migrar.
    throw new Error(`Resend respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
}

/**
 * Buzón en memoria del transporte de consola.
 *
 * Se acota a 20 para no crecer sin fin en una sesión larga de desarrollo.
 */
const bandeja = [];

function porConsola(mensaje) {
  bandeja.push(mensaje);
  if (bandeja.length > 20) bandeja.shift();

  console.info([
    '', '─── CORREO (transporte de consola, NO se envió) ───',
    `Para: ${mensaje.para}`,
    `Asunto: ${mensaje.asunto}`,
    '', mensaje.texto,
    '──────────────────────────────────────────────────', ''
  ].join('\n'));
}

function enviar(mensaje) {
  if (TRANSPORTE === 'brevo') return porBrevo(mensaje);
  if (TRANSPORTE === 'resend') return porResend(mensaje);
  return porConsola(mensaje);
}

/* ==================== La plantilla ==================== */

/*
 * Un texto plano legible y un HTML mínimo. Sin imágenes ni hojas de estilo
 * externas: muchos clientes de correo las bloquean, y no aportan nada a un
 * mensaje de dos frases.
 */
function plantilla({ titulo, saludo, parrafo, boton, url, pie }) {
  const texto = [saludo, '', parrafo, '', url, '', pie].join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 16px">${escapar(titulo)}</h1>
      <p style="margin:0 0 12px">${escapar(saludo)}</p>
      <p style="margin:0 0 20px">${escapar(parrafo)}</p>
      <p style="margin:0 0 20px">
        <a href="${escapar(url)}"
           style="background:#1b5e3f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
          ${escapar(boton)}
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#5a6b63">
        Si el botón no funciona, copia esta dirección en tu navegador:
      </p>
      <p style="margin:0 0 20px;font-size:13px;word-break:break-all">${escapar(url)}</p>
      <p style="margin:0;font-size:13px;color:#5a6b63">${escapar(pie)}</p>
    </div>`;

  return { texto, html };
}

/** El correo de confirmación. Es el único que se manda hoy. */
async function enviarVerificacion({ para, nombre, url, horas }) {
  const { texto, html } = plantilla({
    titulo: 'Confirma tu correo',
    saludo: `Hola ${nombre}:`,
    parrafo: `Gracias por crear tu cuenta en Quiniela Deportiva Global. Confirma que esta dirección es tuya para poder entrar. El enlace vence en ${horas} hora(s) y sólo se puede usar una vez.`,
    boton: 'Confirmar mi correo',
    url,
    pie: 'Si no creaste esta cuenta, puedes ignorar este mensaje.'
  });

  await enviar({ para, asunto: 'Confirma tu correo de Quiniela Deportiva Global', texto, html });
}

/**
 * Intenta enviar sin dejar que un fallo tumbe lo que lo pidió.
 *
 * Devuelve si salió, para que la pantalla pueda ofrecer un reenvío. Que el
 * proveedor esté caído no debe impedir que la cuenta se cree: se crea, y la
 * persona pide el correo otra vez.
 */
async function intentar(envio, descripcion) {
  try {
    await envio();
    return true;
  } catch (error) {
    console.error(`[correo] no se pudo enviar ${descripcion}:`, error.message);
    return false;
  }
}

module.exports = {
  TRANSPORTE, bandeja,
  escapar, plantilla, enviarVerificacion, intentar
};

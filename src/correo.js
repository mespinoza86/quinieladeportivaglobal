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

/** El correo para elegir una contraseña nueva. */
async function enviarRestablecer({ para, nombre, url, horas }) {
  const { texto, html } = plantilla({
    titulo: 'Restablece tu contraseña',
    saludo: `Hola ${nombre}:`,
    parrafo: `Recibimos una solicitud para cambiar la contraseña de tu cuenta. Abre el enlace para elegir una nueva. Vence en ${horas} hora(s) y sólo se puede usar una vez.`,
    boton: 'Elegir una contraseña nueva',
    url,
    /*
     * ⚠️ Este pie importa. Quien recibe esto sin haberlo pedido tiene que saber
     * que NO tiene que hacer nada: su contraseña sigue siendo la misma mientras
     * no abra el enlace. Sin esa frase, un correo así asusta.
     */
    pie: 'Si no pediste este cambio, puedes ignorar este mensaje: tu contraseña seguirá siendo la misma.'
  });

  await enviar({ para, asunto: 'Restablece tu contraseña de Quiniela Deportiva Global', texto, html });
}

/**
 * El aviso de que hay pronósticos listos para mandar al grupo (Entrada 086).
 *
 * ============================================================================
 * ⛔ EL CORREO NO LLEVA LOS PRONÓSTICOS DENTRO
 * ============================================================================
 *
 * Lleva CUÁNTOS y de qué partido, y un enlace. Podría llevarlos —a esa hora ya
 * son públicos, así que no habría filtración— y aun así no debe:
 *
 *   - Un correo se reenvía, se queda en bandejas ajenas y no se puede corregir.
 *     El mensaje bueno es el de la pantalla, que se arma con lo que hay AHORA.
 *   - Si el proveedor se adelantó y el partido no había arrancado, este correo
 *     llevaría marcadores que todavía no tocaba enseñar. El enlace no: la
 *     pantalla vuelve a mirar y enseña la verdad del momento.
 *
 * La regla corta: **el correo avisa, la pantalla informa.**
 */
async function enviarAvisoDeCompartir({ para, nombre, quiniela, resumen, cuantos, url }) {
  const plural = cuantos === 1 ? 'un partido' : `${cuantos} partidos`;

  const { texto, html } = plantilla({
    titulo: 'Hay pronósticos listos para el grupo',
    saludo: `Hola ${nombre}:`,
    parrafo: `Acaba de arrancar ${plural} en «${quiniela}», así que los pronósticos `
      + `de todos ya son públicos y están listos para mandar: ${resumen}. `
      + 'Abre la pantalla y el mensaje ya está escrito.',
    boton: 'Ver lo que hay que mandar',
    url,
    /*
     * ⚠️ Quien reciba esto tiene que saber cómo hacer que deje de llegar sin
     * tener que preguntarle a nadie. Un aviso recurrente sin salida visible
     * acaba en la carpeta de correo no deseado, y ahí se lleva por delante
     * también los de confirmar la cuenta.
     */
    pie: 'Puedes apagar estos avisos en Configurar quiniela, en el Admin Mode.'
  });

  await enviar({
    para,
    asunto: `Pronósticos listos para el grupo — ${quiniela}`,
    texto,
    html
  });
}

module.exports = {
  TRANSPORTE, bandeja,
  escapar, plantilla, intentar,
  enviarVerificacion, enviarRestablecer, enviarAvisoDeCompartir
};

/*
 * Tokens de un solo uso.
 *
 * ============================================================================
 * ⚠️ DEL TOKEN SÓLO SE GUARDA EL HASH
 * ============================================================================
 *
 * El valor en claro existe únicamente dentro de `emitir()` y del enlace que
 * viaja por correo. En la base hay un SHA-256, así que **una filtración no
 * entrega la capacidad de entrar en cuentas ajenas**.
 *
 * Es la diferencia con lo que había: `usuarios.token_verificacion` era `text`
 * en claro. Se retiró esa columna al escribir esto (Fase E).
 *
 * ============================================================================
 * UNA SOLA TABLA PARA DOS FLUJOS
 * ============================================================================
 *
 * Hoy sólo se usa `verificar_email`. `restablecer_password` está en el `CHECK`
 * de la tabla desde ya porque la mecánica es idéntica —un valor aleatorio, que
 * vence, que se usa una vez y que pertenece a alguien— y separarlas obligaría a
 * escribir dos veces lo mismo.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

const HORAS_VERIFICACION = Number(process.env.VERIFY_TOKEN_HOURS || 24);

/*
 * ⚠️ Mucho más corto que el de confirmación, y a propósito: este enlace **abre
 * la cuenta a quien lo tenga**. Un correo viejo olvidado en una bandeja es una
 * llave, así que cuanto menos viva, mejor. Confirmar una dirección no tiene ese
 * riesgo, y por eso aquél dura un día.
 */
const HORAS_RESTABLECER = Number(process.env.RESET_TOKEN_HOURS || 1);

const VERIFICAR_EMAIL = 'verificar_email';
const RESTABLECER_PASSWORD = 'restablecer_password';

const hashDe = crudo => crypto.createHash('sha256').update(crudo).digest('hex');

/**
 * Emite un token y devuelve el valor **en claro**, que es lo único que hay que
 * poner en el enlace.
 *
 * ⚠️ Emitir uno nuevo anula los pendientes del mismo propósito. Si alguien pide
 * el enlace tres veces, sólo el último debe servir: de lo contrario un correo
 * viejo reenviado seguiría abriendo la cuenta.
 */
async function emitir(usuarioId, proposito, horas = HORAS_VERIFICACION) {
  const crudo = crypto.randomBytes(32).toString('hex');

  await db.enTransaccion(async cliente => {
    await cliente.query(
      `UPDATE auth_tokens SET usado_en = now()
        WHERE usuario_id = $1 AND proposito = $2 AND usado_en IS NULL`,
      [usuarioId, proposito]);

    await cliente.query(
      `INSERT INTO auth_tokens (usuario_id, proposito, token_hash, expira_en)
       VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
      [usuarioId, proposito, hashDe(crudo), String(horas)]);
  });

  return crudo;
}

/**
 * Busca un token utilizable: existe, es de ese propósito, no se ha usado, no ha
 * vencido, y su cuenta sigue activa. `null` si falla cualquiera de las cinco.
 *
 * Devolver `null` para las cinco es deliberado: distinguirlas le diría a quien
 * prueba al azar si un token existió alguna vez.
 */
async function usable(crudo, proposito) {
  const { rows: [t] } = await db.consulta(
    `SELECT t.id, t.usuario_id, u.username, u.email, u.email_verificado
       FROM auth_tokens t
       JOIN usuarios u ON u.id = t.usuario_id AND u.activo
      WHERE t.token_hash = $1
        AND t.proposito = $2
        AND t.usado_en IS NULL
        AND t.expira_en > now()`,
    [hashDe(crudo), proposito]);

  return t || null;
}

/** Marca el token como gastado. Es lo que hace que sea de un solo uso. */
async function marcarUsado(id) {
  const { rowCount } = await db.consulta(
    'UPDATE auth_tokens SET usado_en = now() WHERE id = $1 AND usado_en IS NULL', [id]);
  return rowCount === 1;
}

module.exports = {
  HORAS_VERIFICACION, HORAS_RESTABLECER, VERIFICAR_EMAIL, RESTABLECER_PASSWORD,
  hashDe, emitir, usable, marcarUsado
};

/*
 * Cuentas de usuario. Tabla de plataforma: no lleva `quiniela_id` ni RLS,
 * porque una cuenta existe antes de pertenecer a ninguna quiniela y puede
 * pertenecer a varias.
 *
 * Las reglas de validación son las mismas que tenía `POST /api/auth/registro`
 * en `server.js`, palabra por palabra. Están aquí y no en la ruta para que la
 * ruta quede fina y para poder probarlas sin levantar Express.
 */
'use strict';

const bcrypt = require('bcrypt');
const db = require('./db');

const SALT_ROUNDS = 10;

/*
 * Dos cuentas no pueden diferenciarse sólo por mayúsculas o por espacios al
 * borde: "Marco" y " marco " son la misma persona intentando registrarse dos
 * veces. Se guarda la forma normalizada aparte, con su índice único, y la
 * original se conserva para mostrarla tal como se escribió.
 */
function normalizarIdentidad(valor) {
  return String(valor || '').trim().toLowerCase();
}

/** Lo que se puede enseñar de un usuario. Nunca incluye la contraseña. */
function publico(usuario) {
  if (!usuario) return null;
  return {
    id: usuario.id,
    username: usuario.username,
    email: usuario.email,
    emailVerificado: usuario.email_verificado
  };
}

/**
 * Valida los datos de registro.
 *
 * Devuelve `null` si están bien, o el mensaje de error si no. Separado de la
 * escritura a propósito: son reglas puras y se prueban sueltas.
 */
function validarRegistro({ username, email, password, confirmarPassword }) {
  if (!username || !email || !password || !confirmarPassword) {
    return 'Todos los campos son obligatorios.';
  }
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return 'El usuario debe tener entre 3 y 30 caracteres y usar solamente letras, números, punto, guion o guion bajo.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'El correo electrónico no es válido.';
  }
  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (password !== confirmarPassword) {
    return 'Las contraseñas no coinciden.';
  }
  return null;
}

/** ¿Están ya cogidos el nombre o el correo? Devuelve cuál de los dos. */
async function enUso(usernameNormalizado, emailNormalizado) {
  const { rows } = await db.consulta(
    `SELECT
       bool_or(username_normalizado = $1) AS username,
       bool_or(email_normalizado    = $2) AS email
     FROM usuarios
     WHERE username_normalizado = $1 OR email_normalizado = $2`,
    [usernameNormalizado, emailNormalizado]);

  return {
    username: Boolean(rows[0]?.username),
    email: Boolean(rows[0]?.email)
  };
}

/**
 * Crea la cuenta.
 *
 * ⚠️ La comprobación de `enUso` no basta por sí sola: entre mirar y escribir
 * cabe otro registro con el mismo nombre. Quien decide de verdad son los
 * índices únicos de la tabla, y por eso el error 23505 se traduce aquí en vez
 * de dejarlo subir como un 500.
 */
async function crear({ username, email, password }) {
  try {
    const { rows: [usuario] } = await db.consulta(
      `INSERT INTO usuarios (username, username_normalizado, email, email_normalizado, password)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, email_verificado`,
      [username, normalizarIdentidad(username), email, normalizarIdentidad(email),
       await bcrypt.hash(password, SALT_ROUNDS)]);
    return usuario;
  } catch (error) {
    if (error?.code === '23505') {
      const e = new Error('El usuario o el correo electrónico ya están registrados.');
      e.duplicado = true;
      throw e;
    }
    throw error;
  }
}

/**
 * Busca una cuenta activa por nombre de usuario O por correo, y comprueba la
 * contraseña. Devuelve el usuario, o `null` si algo no cuadra.
 *
 * ⚠️ Un solo `null` para las tres formas de fallar —no existe, está inactiva,
 * o la contraseña no es— es deliberado: distinguirlas le diría a quien prueba
 * al azar qué cuentas existen.
 */
async function autenticar(identificador, password) {
  const id = normalizarIdentidad(identificador);
  if (!id || !password) return null;

  const { rows: [usuario] } = await db.consulta(
    `SELECT id, username, email, email_verificado, password
       FROM usuarios
      WHERE activo AND (username_normalizado = $1 OR email_normalizado = $1)`,
    [id]);

  if (!usuario) return null;
  if (!(await bcrypt.compare(password, usuario.password))) return null;

  delete usuario.password;
  return usuario;
}

/** Busca por correo normalizado. Lo usa el reenvío de la confirmación. */
async function porEmail(email) {
  const { rows: [usuario] } = await db.consulta(
    'SELECT id, username, email, email_verificado, activo FROM usuarios WHERE email_normalizado = $1',
    [normalizarIdentidad(email)]);
  return usuario || null;
}

/**
 * Da la dirección por confirmada. Idempotente a propósito: abrir dos veces el
 * mismo enlace no debe dar error, sólo no hacer nada la segunda.
 */
async function marcarVerificado(id) {
  const { rows: [usuario] } = await db.consulta(
    `UPDATE usuarios SET email_verificado = true, updated_at = now()
      WHERE id = $1 AND activo
      RETURNING id, username, email, email_verificado`,
    [id]);
  return usuario || null;
}

/**
 * Cambia la contraseña. Devuelve el usuario, o `null` si la cuenta no existe.
 *
 * No comprueba nada: quien llama decide si tenía derecho —conociendo la
 * anterior, o presentando un token de un solo uso—.
 */
async function cambiarPassword(id, nueva) {
  const { rows: [usuario] } = await db.consulta(
    `UPDATE usuarios SET password = $2, updated_at = now()
      WHERE id = $1 AND activo
      RETURNING id, username, email, email_verificado`,
    [id, await bcrypt.hash(nueva, SALT_ROUNDS)]);
  return usuario || null;
}

/**
 * Cierra TODAS las sesiones abiertas de alguien.
 *
 * ⚠️ Se llama al restablecer la contraseña, y no es opcional: si el motivo del
 * cambio fue que otra persona entró a la cuenta, **su sesión no puede
 * sobrevivir al cambio**. Cambiar la clave sin esto deja al intruso dentro.
 *
 * El identificador vive dentro del JSON que guarda `express-session`, así que
 * se busca por ahí.
 */
async function cerrarSesiones(usuarioId) {
  const { rowCount } = await db.consulta(
    "DELETE FROM sesiones WHERE sess->>'usuarioId' = $1", [String(usuarioId)]);
  return rowCount;
}

async function porId(id) {
  const { rows: [usuario] } = await db.consulta(
    'SELECT id, username, email, email_verificado, activo FROM usuarios WHERE id = $1', [id]);
  return usuario || null;
}

module.exports = {
  normalizarIdentidad, publico, validarRegistro,
  enUso, crear, autenticar, porId, porEmail, marcarVerificado,
  cambiarPassword, cerrarSesiones,
  SALT_ROUNDS
};

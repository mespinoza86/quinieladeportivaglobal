/*
 * Quién pertenece a qué quiniela, con qué rol y en qué estado.
 *
 * Es la tabla que decide los permisos de todo el sistema, así que cada función
 * de aquí devuelve un motivo cuando dice que no. Las rutas se limitan a
 * traducir ese motivo a un código HTTP.
 *
 * ⚠️ Unirse a una quiniela NO da acceso: deja la membresía en
 * `pendiente_ingreso` y hace falta que un administrador la apruebe. Es la
 * trampa que ya mordió en las pruebas de la Fase C.
 */
'use strict';

const db = require('./db');

/** Los estados en los que se considera que alguien está dentro. */
const DENTRO = ['activo', 'pendiente_retiro'];

/** Un fallo con motivo, para que la ruta sepa qué código devolver. */
function no(motivo, mensaje) {
  return { ok: false, motivo, mensaje };
}

async function de(quinielaId, usuarioId) {
  const { rows: [m] } = await db.consulta(
    `SELECT id, quiniela_id, usuario_id, rol, estado, solicitado_en, aprobado_en, retirado_en
       FROM membresias WHERE quiniela_id = $1 AND usuario_id = $2`,
    [quinielaId, usuarioId]);
  return m || null;
}

async function porId(membresiaId, quinielaId) {
  const { rows: [m] } = await db.consulta(
    `SELECT id, quiniela_id, usuario_id, rol, estado
       FROM membresias WHERE id = $1 AND quiniela_id = $2`,
    [membresiaId, quinielaId]);
  return m || null;
}

/** Los miembros de una quiniela, con los datos de su cuenta. */
async function listar(quinielaId) {
  const { rows } = await db.consulta(
    `SELECT m.id, m.usuario_id, u.username, u.email, m.rol, m.estado, m.solicitado_en
       FROM membresias m
       JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.quiniela_id = $1
      ORDER BY m.estado, m.rol, m.created_at`,
    [quinielaId]);
  return rows;
}

/**
 * Pide entrar. Queda pendiente de aprobación.
 *
 * Se usa `ON CONFLICT` en vez de mirar-y-escribir porque quien ya fue
 * rechazado o expulsado puede volver a pedirlo, y su fila ya existe.
 */
async function solicitarIngreso(quinielaId, usuarioId) {
  const existente = await de(quinielaId, usuarioId);
  if (existente && DENTRO.includes(existente.estado)) {
    return no('ya_dentro', 'Ya perteneces a esta quiniela.');
  }
  if (existente?.estado === 'pendiente_ingreso') {
    return no('ya_pendiente', 'Tu solicitud ya está pendiente de aprobación.');
  }

  await db.consulta(
    `INSERT INTO membresias (quiniela_id, usuario_id, rol, estado, solicitado_en)
     VALUES ($1, $2, 'user', 'pendiente_ingreso', now())
     ON CONFLICT (quiniela_id, usuario_id) DO UPDATE
       SET rol = 'user', estado = 'pendiente_ingreso',
           solicitado_en = now(), retirado_en = NULL, updated_at = now()`,
    [quinielaId, usuarioId]);

  return { ok: true };
}

/**
 * Aprueba una solicitud de ingreso, y da de alta al jugador.
 *
 * ⚠️ Son dos escrituras en dos mundos distintos: `membresias` es de plataforma
 * y `jugadores` lleva RLS, así que el alta del jugador va dentro del contexto
 * de la quiniela. Las dos tienen que ir juntas: aprobar a alguien y no crearle
 * el jugador lo deja dentro pero invisible en la tabla de posiciones.
 *
 * `enQuiniela` es reentrante y esto ya corre dentro de la transacción de
 * `enTransaccion`, así que no se abre una segunda: es la misma.
 */
async function aprobarIngreso(quinielaId, membresiaId) {
  return db.enTransaccion(async cliente => {
    const { rows: [m] } = await cliente.query(
      `UPDATE membresias
          SET estado = 'activo', rol = 'user', aprobado_en = now(), updated_at = now()
        WHERE id = $1 AND quiniela_id = $2 AND estado = 'pendiente_ingreso'
        RETURNING id, usuario_id`,
      [membresiaId, quinielaId]);

    if (!m) return no('no_encontrada', 'Solicitud pendiente no encontrada.');

    const { rows: [u] } = await cliente.query(
      'SELECT username FROM usuarios WHERE id = $1', [m.usuario_id]);

    await db.enQuiniela(quinielaId, c => c.query(
      `INSERT INTO jugadores (quiniela_id, nombre, usuario_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (quiniela_id, usuario_id) WHERE usuario_id IS NOT NULL
       DO UPDATE SET nombre = EXCLUDED.nombre`,
      [quinielaId, u.username, m.usuario_id]));

    return { ok: true, membresia: m };
  });
}

/**
 * Rechaza una solicitud pendiente.
 *
 * Una de ingreso pasa a `rechazado`; una de retiro vuelve a `activo`, porque
 * rechazar que alguien se vaya es dejarlo dentro.
 */
async function rechazar(quinielaId, membresiaId) {
  const { rows: [m] } = await db.consulta(
    `UPDATE membresias
        SET estado = CASE WHEN estado = 'pendiente_ingreso' THEN 'rechazado' ELSE 'activo' END,
            updated_at = now()
      WHERE id = $1 AND quiniela_id = $2
        AND estado IN ('pendiente_ingreso', 'pendiente_retiro')
      RETURNING id, estado`,
    [membresiaId, quinielaId]);

  return m ? { ok: true, membresia: m } : no('no_encontrada', 'Solicitud pendiente no encontrada.');
}

/**
 * Cambia el rol de un miembro activo.
 *
 * ⚠️ La quiniela no puede quedarse sin nadie que la administre. La cuenta de
 * administradores y el cambio van en la MISMA transacción: si se hacen en dos
 * pasos, dos degradaciones a la vez pueden ver cada una "quedan dos" y dejarla
 * sin ninguno.
 */
async function cambiarRol(quinielaId, membresiaId, nuevoRol) {
  if (!['admin', 'user'].includes(nuevoRol)) return no('rol_invalido', 'Rol inválido.');

  return db.enTransaccion(async cliente => {
    const { rows: [m] } = await cliente.query(
      `SELECT id, rol FROM membresias
        WHERE id = $1 AND quiniela_id = $2 AND estado = 'activo'
        FOR UPDATE`,
      [membresiaId, quinielaId]);

    if (!m) return no('no_encontrada', 'Miembro activo no encontrado.');
    if (m.rol === 'propietario') {
      return no('es_propietario', 'El rol del propietario solo cambia mediante una transferencia.');
    }

    if (m.rol === 'admin' && nuevoRol === 'user') {
      const { rows: [{ n }] } = await cliente.query(
        `SELECT count(*)::int AS n FROM membresias
          WHERE quiniela_id = $1 AND estado = 'activo' AND rol IN ('propietario','admin')`,
        [quinielaId]);
      if (n <= 1) return no('sin_admin', 'La quiniela no puede quedar sin administrador.');
    }

    await cliente.query(
      'UPDATE membresias SET rol = $2, updated_at = now() WHERE id = $1', [membresiaId, nuevoRol]);
    return { ok: true };
  });
}

/** Alguien pide irse. El propietario no puede sin transferir antes. */
async function solicitarRetiro(quinielaId, usuarioId) {
  const m = await de(quinielaId, usuarioId);
  if (!m) return no('no_encontrada', 'No perteneces a esta quiniela.');
  if (m.rol === 'propietario') {
    return no('es_propietario', 'El propietario debe transferir la propiedad antes de solicitar retirarse.');
  }

  await db.consulta(
    `UPDATE membresias SET estado = 'pendiente_retiro', updated_at = now() WHERE id = $1`, [m.id]);
  return { ok: true };
}

/** Saca a alguien: por retiro aprobado o por expulsión. Es el mismo final. */
async function sacar(quinielaId, membresiaId, { desdeEstados, quienLoPide }) {
  const m = await porId(membresiaId, quinielaId);
  if (!m || !desdeEstados.includes(m.estado)) {
    return no('no_encontrada', desdeEstados.includes('pendiente_retiro') && desdeEstados.length === 1
      ? 'Solicitud de retiro no encontrada.'
      : 'Miembro no encontrado.');
  }
  if (m.rol === 'propietario') {
    return no('es_propietario', desdeEstados.length === 1
      ? 'No se puede retirar al propietario.'
      : 'No se puede expulsar al propietario.');
  }
  if (quienLoPide && m.usuario_id === quienLoPide) {
    return no('uno_mismo', 'No puedes expulsarte a ti mismo.');
  }

  await db.consulta(
    `UPDATE membresias SET estado = 'expulsado', retirado_en = now(), updated_at = now()
      WHERE id = $1`, [membresiaId]);
  return { ok: true };
}

const aprobarRetiro = (quinielaId, membresiaId) =>
  sacar(quinielaId, membresiaId, { desdeEstados: ['pendiente_retiro'] });

const expulsar = (quinielaId, membresiaId, quienLoPide) =>
  sacar(quinielaId, membresiaId, { desdeEstados: DENTRO, quienLoPide });

/**
 * Pasa la propiedad a un administrador activo.
 *
 * ⚠️ Son tres escrituras y a medias dejan la quiniela con dos propietarios o
 * con ninguno. Por eso van en una transacción, y en secuencia.
 */
async function transferirPropiedad(quinielaId, propietarioActualId, nuevoUsuarioId) {
  return db.enTransaccion(async cliente => {
    const { rows: [destino] } = await cliente.query(
      `SELECT id, usuario_id, rol FROM membresias
        WHERE quiniela_id = $1 AND usuario_id = $2 AND estado = 'activo' FOR UPDATE`,
      [quinielaId, nuevoUsuarioId]);

    if (!destino || destino.rol !== 'admin') {
      return no('destino_invalido', 'El nuevo propietario debe ser un administrador activo.');
    }

    await cliente.query(
      `UPDATE membresias SET rol = 'propietario', updated_at = now() WHERE id = $1`, [destino.id]);
    await cliente.query(
      `UPDATE membresias SET rol = 'admin', updated_at = now()
        WHERE quiniela_id = $1 AND usuario_id = $2`,
      [quinielaId, propietarioActualId]);
    await cliente.query(
      `UPDATE quinielas SET propietario_id = $2, updated_at = now() WHERE id = $1`,
      [quinielaId, nuevoUsuarioId]);

    return { ok: true };
  });
}

module.exports = {
  DENTRO,
  de, porId, listar,
  solicitarIngreso, aprobarIngreso, rechazar, cambiarRol,
  solicitarRetiro, aprobarRetiro, expulsar, transferirPropiedad
};

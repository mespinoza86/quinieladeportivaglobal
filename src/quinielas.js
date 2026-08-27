/*
 * Quinielas: crearlas, encontrarlas y cambiarles la configuración.
 *
 * Tabla de plataforma, sin RLS: una quiniela no vive dentro de otra. Lo que sí
 * lleva RLS es todo lo que cuelga de ella, y el aislamiento de eso se pide con
 * `db.enQuiniela(id, ...)`.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

/*
 * La puntuación por defecto de una quiniela nueva. Es la misma tabla de
 * siempre; vive aquí porque `quinielas.configuracion` es un bloque `jsonb` que
 * se lee y se escribe entero.
 */
const PUNTUACION_POR_DEFECTO = {
  marcadorExacto: 5,
  resultadoCorrecto: 3,
  comodinExacto: 7,
  comodinResultado: 4,
  triviasHabilitadas: true,
  puntosTriviaDefault: 1
};

const CONFIGURACION_POR_DEFECTO = {
  puntuacion: PUNTUACION_POR_DEFECTO,
  incluirExpulsadosEnRanking: true
};

function generarCodigoIngreso() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

/**
 * Crea la quiniela y deja a quien la crea dentro como propietario.
 *
 * ⚠️ Las dos escrituras van juntas o no van. Sin la membresía, el propietario
 * no es miembro de su propia quiniela: no aparece en su lista y no puede
 * entrar. En Mongo esto exigía una sesión y un conjunto de réplicas; aquí es
 * una transacción normal.
 *
 * El código de ingreso se genera dentro del reintento porque puede chocar: son
 * cinco bytes al azar, y aunque el choque sea improbable, cuando pase el
 * índice único lo rechaza y hay que probar otro. Reintentar es más simple —y
 * más correcto— que mirar antes si existe, porque entre mirar y escribir cabe
 * otra creación.
 */
async function crear({ nombre, propietarioId, intentos = 5 }) {
  for (let intento = 0; intento < intentos; intento++) {
    try {
      return await db.enTransaccion(async cliente => {
        const { rows: [quiniela] } = await cliente.query(
          `INSERT INTO quinielas (nombre, codigo_ingreso, propietario_id, configuracion)
           VALUES ($1, $2, $3, $4)
           RETURNING id, nombre, codigo_ingreso, propietario_id, estado, configuracion`,
          [nombre, generarCodigoIngreso(), propietarioId, CONFIGURACION_POR_DEFECTO]);

        await cliente.query(
          `INSERT INTO membresias (quiniela_id, usuario_id, rol, estado, aprobado_en)
           VALUES ($1, $2, 'propietario', 'activo', now())`,
          [quiniela.id, propietarioId]);

        /*
         * ⚠️ Y SU FICHA DE JUGADOR, que faltaba.
         *
         * Quien se une con el código la recibe al aprobarse su ingreso
         * (`membresias.aprobarIngreso`), pero quien CREA la quiniela no pasaba
         * por ahí: se insertaban la quiniela y la membresía, y nada más. El
         * propietario no existía como jugador hasta que hacía su primer
         * pronóstico, así que **no aparecía en la tabla de posiciones ni en los
         * cobros** — que fue como se descubrió: administrando los pagos faltaba
         * justo quien administra.
         *
         * `cobrar_desde` queda a NULL —«desde siempre»— y es lo correcto: la
         * quiniela acaba de nacer y no hay jornadas anteriores de las que
         * eximirle. A quien se une después sí se le cobra desde la próxima.
         *
         * Va dentro del contexto de la quiniela porque `jugadores` lleva RLS.
         * `enQuiniela` es reentrante y esto ya corre dentro de la transacción
         * de `enTransaccion`, así que es la misma: la quiniela, la membresía y
         * el jugador van juntos o no van.
         */
        const { rows: [u] } = await cliente.query(
          'SELECT username FROM usuarios WHERE id = $1', [propietarioId]);

        await db.enQuiniela(quiniela.id, async c => {
          await c.query(
            `INSERT INTO jugadores (quiniela_id, nombre, usuario_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (quiniela_id, usuario_id) WHERE usuario_id IS NOT NULL
             DO NOTHING`,
            [quiniela.id, u.username, propietarioId]);
        });

        return quiniela;
      });
    } catch (error) {
      // 23505 sobre el código: choque de azar, se reintenta con otro.
      const esChoqueDeCodigo = error?.code === '23505' && /codigo_ingreso/.test(error?.constraint || '');
      if (!esChoqueDeCodigo || intento === intentos - 1) throw error;
    }
  }
}

/** Valida el nombre. Devuelve el mensaje de error, o `null` si está bien. */
function validarNombre(nombre) {
  const limpio = String(nombre || '').trim();
  if (limpio.length < 3 || limpio.length > 80) {
    return 'El nombre debe tener entre 3 y 80 caracteres.';
  }
  return null;
}

async function porId(id) {
  const { rows: [q] } = await db.consulta(
    `SELECT id, nombre, codigo_ingreso, propietario_id, estado, configuracion
       FROM quinielas WHERE id = $1`, [id]);
  return q || null;
}

/** Busca una quiniela ACTIVA por su código de ingreso. */
async function porCodigo(codigo) {
  const { rows: [q] } = await db.consulta(
    `SELECT id, nombre, codigo_ingreso, propietario_id, estado, configuracion
       FROM quinielas WHERE codigo_ingreso = $1 AND estado = 'activa'`,
    [String(codigo || '').trim().toUpperCase()]);
  return q || null;
}

/**
 * Las quinielas de un usuario, con su rol y el estado de su membresía.
 *
 * El código de ingreso sólo va para quien puede repartirlo: propietario y
 * administradores. Un miembro normal no debe poder invitar a nadie.
 *
 * Las eliminadas no salen. Se ordenan por lo último que se tocó de la
 * membresía, que es lo que hacía `sort({ updatedAt: -1 })`.
 */
async function deUsuario(usuarioId) {
  const { rows } = await db.consulta(
    `SELECT q.id,
            q.nombre,
            CASE WHEN m.rol IN ('propietario','admin') THEN q.codigo_ingreso END AS codigo_ingreso,
            q.estado AS estado_quiniela,
            m.rol,
            m.estado AS estado_membresia
       FROM membresias m
       JOIN quinielas  q ON q.id = m.quiniela_id
      WHERE m.usuario_id = $1 AND q.estado <> 'eliminada'
      ORDER BY m.updated_at DESC`,
    [usuarioId]);
  return rows;
}

/**
 * Cambia la configuración.
 *
 * ⚠️ Se funde sobre la que había en vez de sustituirla. Escribir el bloque
 * entero desde el navegador dejaría fuera cualquier ajuste que el cliente no
 * conociera —los de una versión más nueva, por ejemplo— y los borraría sin que
 * nadie lo pidiera.
 */
async function actualizarConfiguracion(id, parcial) {
  const { rows: [q] } = await db.consulta(
    `UPDATE quinielas
        SET configuracion = configuracion || $2::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING id, nombre, estado, configuracion`,
    [id, JSON.stringify(parcial)]);
  return q || null;
}

async function cambiarEstado(id, estado) {
  const { rows: [q] } = await db.consulta(
    `UPDATE quinielas
        SET estado = $2,
            eliminada_en = CASE WHEN $2 = 'eliminada' THEN now() ELSE eliminada_en END,
            updated_at = now()
      WHERE id = $1
      RETURNING id, nombre, estado`,
    [id, estado]);
  return q || null;
}

module.exports = {
  PUNTUACION_POR_DEFECTO, CONFIGURACION_POR_DEFECTO,
  generarCodigoIngreso, validarNombre,
  crear, porId, porCodigo, deUsuario,
  actualizarConfiguracion, cambiarEstado
};

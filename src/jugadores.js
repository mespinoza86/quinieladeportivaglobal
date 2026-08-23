/*
 * Jugadores y equipos de una quiniela. Las dos tablas llevan RLS.
 *
 * "Jugador" y "usuario" no son lo mismo, y la diferencia importa: un usuario es
 * una cuenta y existe una sola vez; un jugador es esa cuenta DENTRO de una
 * quiniela concreta. Por eso `jugadores` lleva `quiniela_id` y `usuarios` no.
 *
 * Y hay jugadores sin cuenta: los que trajo `scripts/migrate-legacy.js` de la
 * base anterior quedaron como nombres sueltos, con `usuario_id` nulo. Aparecen
 * en la tabla de posiciones aunque nadie pueda entrar con ellos.
 */
'use strict';

const db = require('./db');

/**
 * Los nombres que juegan en esta quiniela.
 *
 * Son dos orígenes que se juntan: los miembros que están dentro —con el nombre
 * de su cuenta— y los jugadores históricos sin cuenta. Se devuelven ordenados
 * con `localeCompare` para que los acentos queden donde una persona los busca.
 *
 * ⚠️ `membresias` es de plataforma y `jugadores` lleva RLS, así que son dos
 * consultas y no un `JOIN`: la primera va sin contexto y la segunda dentro de
 * él. Mezclarlas en una sola dejaría fuera a los miembros o a los históricos,
 * según por dónde se mirara.
 *
 * `incluirExpulsados` es la opción `configuracion.incluirExpulsadosEnRanking`:
 * decide si quien fue expulsado sigue apareciendo en la tabla de posiciones.
 * Quitarlo del ranking no borra sus puntos, sólo su fila.
 */
async function nombres(quinielaId, { incluirExpulsados = false } = {}) {
  const estados = incluirExpulsados
    ? ['activo', 'pendiente_retiro', 'expulsado']
    : ['activo', 'pendiente_retiro'];

  const { rows: miembros } = await db.consulta(
    `SELECT u.username
       FROM membresias m
       JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.quiniela_id = $1 AND m.estado = ANY($2::text[])
      ORDER BY m.created_at`,
    [quinielaId, estados]);

  const historicos = await db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query('SELECT nombre FROM jugadores');
    return rows;
  });

  const todos = new Set([
    ...miembros.map(m => m.username).filter(Boolean),
    ...historicos.map(j => j.nombre).filter(Boolean)
  ]);

  return Array.from(todos).sort((a, b) => a.localeCompare(b));
}

/** Los jugadores tal como están en la tabla, con su id. */
async function listar(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      'SELECT id, nombre, usuario_id FROM jugadores ORDER BY nombre');
    return rows;
  });
}

/**
 * El jugador que es una persona dentro de esta quiniela.
 *
 * Devuelve `null` si todavía no lo es: el dueño de una quiniela no tiene fila
 * en `jugadores` hasta que actúa —hasta entonces administra, no juega—, y
 * quien tiene cuenta pero nunca mandó nada, tampoco.
 */
async function deUsuario(quinielaId, usuarioId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      'SELECT id, nombre FROM jugadores WHERE usuario_id = $1', [usuarioId]);
    return j || null;
  });
}

/**
 * El id del jugador de esta quiniela que se llama así. `null` si no hay.
 *
 * Es la pieza que permite que el API siga hablando por nombre mientras la base
 * usa claves ajenas: la ruta recibe «ana», esto lo convierte en un id una vez, y
 * de ahí en adelante todo va por identidad estable.
 */
async function idPorNombre(cliente, nombre) {
  const { rows: [j] } = await cliente.query(
    'SELECT id FROM jugadores WHERE nombre = $1', [nombre]);
  return j?.id ?? null;
}

/**
 * Se asegura de que exista el jugador con ese nombre, y devuelve su id.
 *
 * Hace falta para los pronósticos: alguien puede ser miembro aprobado antes de
 * que existiera el alta automática, o venir de la migración. Crear al vuelo
 * evita que un pronóstico se caiga por un jugador que "debería" estar.
 */
async function asegurar(cliente, quinielaId, nombre, usuarioId = null) {
  /*
   * ⚠️ A quien entra ahora se le cobra de la PRÓXIMA jornada en adelante, no
   * de las que ya se jugaron: no estaba. Se calcula al darlo de alta porque
   * después no hay forma de saber cuándo llegó —`jugadores` no guarda fecha—.
   *
   * El `DO UPDATE` no lo toca: si el jugador ya existía, su punto de partida
   * es el que tenía, y volver a nombrarlo no puede moverlo.
   */
  const { rows: [fila] } = await cliente.query(
    'SELECT COALESCE(MAX(secuencia), 0) + 1 AS siguiente FROM jornadas');

  const { rows: [j] } = await cliente.query(
    `INSERT INTO jugadores (quiniela_id, nombre, usuario_id, cobrar_desde)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (quiniela_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [quinielaId, nombre, usuarioId, Number(fila.siguiente)]);
  return j.id;
}

/* ==================== Equipos ==================== */

async function equipos(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query('SELECT nombre FROM equipos ORDER BY nombre');
    return rows.map(e => e.nombre);
  });
}

/** Añade un equipo. Si ya estaba, no pasa nada: es idempotente a propósito. */
async function agregarEquipo(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [e] } = await c.query(
      `INSERT INTO equipos (quiniela_id, nombre) VALUES ($1, $2)
       ON CONFLICT (quiniela_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre`,
      [quinielaId, nombre]);
    return e;
  });
}

async function eliminarEquipo(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query('DELETE FROM equipos WHERE nombre = $1', [nombre]);
    return { ok: rowCount > 0 };
  });
}

module.exports = {
  nombres, listar, deUsuario, idPorNombre, asegurar,
  equipos, agregarEquipo, eliminarEquipo
};

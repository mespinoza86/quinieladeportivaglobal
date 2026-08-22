/*
 * Las respuestas de los jugadores a las trivias.
 *
 * ============================================================================
 * S-10: EL DOBLE ENVÍO QUE DABA PUNTOS DOBLES
 * ============================================================================
 *
 * En Mongo esto era un `findOneAndUpdate` con `upsert` y **sin índice único**.
 * Dos envíos simultáneos de la misma respuesta —el botón pulsado dos veces, o
 * una pestaña duplicada— no encontraban nada ninguno de los dos y **ambos
 * insertaban**. La jugadora acababa con dos filas para la misma pregunta, y al
 * resolverse la trivia las dos cobraban.
 *
 * `UNIQUE (quiniela_id, jugador_id, trivia_id)` lo cierra en la base. El
 * `ON CONFLICT` de aquí abajo no es una optimización: es lo que convierte el
 * choque en una actualización en vez de en un error.
 *
 * ============================================================================
 * EL VÍNCULO CON EL JUGADOR ES UNA CLAVE AJENA
 * ============================================================================
 *
 * `jugador_id` en vez de un nombre suelto. Es M-01: en Mongo, renombrar a
 * alguien dejaba sus respuestas apuntando a un nombre que ya no existía y sus
 * puntos desaparecían de la tabla sin que nada fallara.
 */
'use strict';

const db = require('./db');
const jugadoresMod = require('./jugadores');
const triviasMod = require('./trivias');

/* ==================== Lectura ==================== */

/**
 * Las respuestas de un jugador a las trivias de una jornada.
 *
 * ⚠️ La privacidad se decide **trivia a trivia**, no de golpe para la jornada.
 * En Mongo era todo o nada: hasta que la ÚLTIMA trivia cerraba, ninguna
 * respuesta ajena se veía. Aquí cada pregunta se abre cuando le toca, que es la
 * misma regla que ya siguen los pronósticos desde la Entrada 019.
 *
 * `puedeVerTodo` es para administradores y para quien pide sus propias
 * respuestas: ahí no hay nada que ocultar.
 */
async function deJugador(quinielaId, jugadorNombre, jornadaNombre, { puedeVerTodo = false, ahora = new Date() } = {}) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: trivias } = await c.query(
      `SELECT t.*, p.orden, p.equipo1, p.equipo2, p.api_date,
              rop.estado AS oficial_estado
         FROM trivias t
         JOIN jornadas j ON j.id = t.jornada_id
         LEFT JOIN partidos p ON p.id = t.partido_id
         LEFT JOIN resultados_oficiales_partidos rop ON rop.partido_id = p.id
        WHERE j.nombre = $1 AND t.activa`,
      [jornadaNombre]);

    if (!trivias.length) return [];

    const jugadorId = await jugadoresMod.idPorNombre(c, jugadorNombre);
    if (!jugadorId) return [];

    const { rows: respuestas } = await c.query(
      `SELECT trivia_id, respuesta, puntos, fecha_respuesta
         FROM respuestas_trivia
        WHERE jugador_id = $1 AND trivia_id = ANY($2::uuid[])`,
      [jugadorId, trivias.map(t => t.id)]);

    const porTrivia = new Map(respuestas.map(r => [r.trivia_id, r]));

    return trivias.map(trivia => {
      const partido = trivia.orden === null ? null : { api_date: trivia.api_date };
      const oficial = trivia.oficial_estado ? { estado: trivia.oficial_estado } : null;
      const cerrada = triviasMod.estaCerrada(trivia, partido, oficial, ahora);
      const mia = porTrivia.get(trivia.id) || null;

      return {
        triviaId: trivia.id,
        jugador: jugadorNombre,
        cerrada,
        // Mientras la trivia siga abierta, lo ajeno no se enseña.
        respuesta: puedeVerTodo || cerrada ? (mia?.respuesta ?? null) : null,
        puntos: mia?.puntos ?? 0,
        fechaRespuesta: mia?.fecha_respuesta ?? null
      };
    });
  });
}

/** Los puntos de trivias de cada jugador. Es la columna «Trivias» del ranking. */
async function puntosPorJugador(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `SELECT j.nombre, COALESCE(sum(rt.puntos), 0)::int AS puntos
         FROM respuestas_trivia rt
         JOIN jugadores j ON j.id = rt.jugador_id
        GROUP BY j.nombre`);
    return new Map(rows.map(f => [f.nombre, f.puntos]));
  });
}

/* ==================== Escritura ==================== */

/**
 * Guarda las respuestas de un jugador.
 *
 * Una trivia cerrada **no rechaza el envío entero**: se salta y se cuenta. Es
 * la misma decisión que en los pronósticos —el cierre es por pregunta, no por
 * formulario— y evita que un partido que ya empezó impida guardar las respuestas
 * de los otros nueve.
 *
 * ⚠️ Mongo hacía lo contrario: devolvía 403 y **no guardaba ninguna**, así que
 * quien llegaba tarde a una sola pregunta perdía las diez.
 */
async function guardar(quinielaId, { jugador, usuarioId = null, respuestas, ahora = new Date() }) {
  return db.enQuiniela(quinielaId, async c => {
    const jugadorId = await jugadoresMod.asegurar(c, quinielaId, jugador, usuarioId);

    let guardadas = 0;
    let cerradas = 0;
    let desconocidas = 0;

    for (const item of respuestas || []) {
      const trivia = await triviasMod.porId(c, item.triviaId);

      if (!trivia || !trivia.activa) { desconocidas += 1; continue; }

      const { rows: [oficial] } = await c.query(
        'SELECT estado FROM resultados_oficiales_partidos WHERE partido_id = $1',
        [trivia.partido_id]);

      const partido = trivia.partido_id ? { api_date: trivia.api_date } : null;

      if (triviasMod.estaCerrada(trivia, partido, oficial || null, ahora)) {
        cerradas += 1;
        continue;
      }

      await c.query(
        `INSERT INTO respuestas_trivia (quiniela_id, trivia_id, jugador_id, respuesta, fecha_respuesta)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (quiniela_id, jugador_id, trivia_id) DO UPDATE SET
           respuesta = EXCLUDED.respuesta,
           fecha_respuesta = now()`,
        [quinielaId, trivia.id, jugadorId, item.respuesta ?? null]);

      guardadas += 1;
    }

    return { ok: true, guardadas, cerradas, desconocidas };
  });
}

module.exports = { deJugador, puntosPorJugador, guardar };

/*
 * Los pronósticos de los jugadores.
 *
 * ============================================================================
 * EL CIERRE ES POR PARTIDO, NO POR JORNADA (Entrada 019)
 * ============================================================================
 *
 * Un partido se cierra a su hora de inicio. Desde ese momento su pronóstico
 * deja de poder editarse y pasa a ser visible para los demás. Los partidos de
 * la misma jornada que aún no han empezado siguen abiertos.
 *
 * Por eso `guardar` no acepta ni rechaza la jornada entera: recorre partido a
 * partido, escribe los que están abiertos y **deja intactos** los cerrados. Y
 * devuelve cuántos de cada, porque quien envía el formulario tiene derecho a
 * saber que dos de sus diez cambios no se guardaron.
 *
 * ============================================================================
 * EL VÍNCULO ES `partido_id`. ESO ES M-02, Y AQUÍ DEJA DE PODER OCURRIR
 * ============================================================================
 *
 * En Mongo el pronóstico se guardaba en un arreglo y valía por su POSICIÓN.
 * Borrar el partido 2 de una jornada corría todos los demás una casilla en la
 * jornada, pero no en los pronósticos de los jugadores, así que a partir de ahí
 * cada uno puntuaba contra el partido de al lado. Sin fallar y sin avisar.
 *
 * Aquí cada pronóstico apunta a un `partido_id`. Borrar un partido se lleva sus
 * pronósticos en cascada y los demás no se enteran.
 */
'use strict';

const db = require('./db');
const jugadoresMod = require('./jugadores');
const { partidoYaInicio } = require('./fechas');
const { normalizarMarcador } = require('./validacion');

/* La regla del cierre vive en src/fechas.js: la usan los dos mundos. */

/** Los partidos de una jornada, con su id. Orden de la jornada. */
async function partidosDe(cliente, jornadaId) {
  const { rows } = await cliente.query(
    `SELECT id, orden, equipo1, equipo2, logo_equipo1, logo_equipo2,
            comodin, api_fixture_id, api_date, api_status
       FROM partidos WHERE jornada_id = $1 ORDER BY orden`,
    [jornadaId]);
  return rows;
}

/** Los resultados oficiales de una jornada, indexados por `partido_id`. */
async function oficialesDe(cliente, jornadaId) {
  const { rows } = await cliente.query(
    `SELECT rop.partido_id, rop.marcador1, rop.marcador2, rop.estado,
            rop.bloqueado_final
       FROM resultados_oficiales_partidos rop
       JOIN resultados_oficiales ro ON ro.id = rop.resultado_oficial_id
      WHERE ro.jornada_id = $1`,
    [jornadaId]);

  return new Map(rows.map(f => [f.partido_id, {
    marcador1: f.marcador1,
    marcador2: f.marcador2,
    estado: f.estado,
    bloqueadoFinal: f.bloqueado_final
  }]));
}

async function jornadaIdDe(cliente, nombre) {
  const { rows: [j] } = await cliente.query(
    'SELECT id FROM jornadas WHERE nombre = $1', [nombre]);
  return j?.id ?? null;
}

/* ==================== Lectura ==================== */

/**
 * Los pronósticos de un jugador en una jornada, en el orden de los partidos.
 *
 * Siempre devuelve una entrada por partido, aunque no haya pronóstico: la
 * pantalla necesita pintar la casilla vacía igual que la llena. `bloqueado`
 * dice cuáles ya no se pueden tocar, para que el navegador no tenga que volver
 * a calcular la regla del cierre —y no pueda equivocarse al hacerlo—.
 */
async function deJugador(quinielaId, jugadorNombre, jornadaNombre, ahora = new Date()) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return null;

    const partidos = await partidosDe(c, jornadaId);
    const oficiales = await oficialesDe(c, jornadaId);

    const jugadorId = await jugadoresMod.idPorNombre(c, jugadorNombre);

    const mios = new Map();
    if (jugadorId) {
      const { rows } = await c.query(
        `SELECT p.partido_id, p.marcador1, p.marcador2
           FROM pronosticos p
           JOIN resultados r ON r.id = p.resultado_id
          WHERE r.jornada_id = $1 AND r.jugador_id = $2`,
        [jornadaId, jugadorId]);
      rows.forEach(f => mios.set(f.partido_id, f));
    }

    return partidos.map(partido => {
      const mio = mios.get(partido.id);
      return {
        equipo1: partido.equipo1,
        equipo2: partido.equipo2,
        logoEquipo1: partido.logo_equipo1,
        logoEquipo2: partido.logo_equipo2,
        comodin: partido.comodin,
        marcador1: mio?.marcador1 ?? null,
        marcador2: mio?.marcador2 ?? null,
        bloqueado: partidoYaInicio(partido, oficiales.get(partido.id), ahora)
      };
    });
  });
}

/**
 * Todos los pronósticos de una jornada, agrupados por nombre de jugador.
 *
 * Devuelve `Map(jugador_id → { nombre, pronosticos: Map(partido_id → fila) })`.
 * Van los dos, id y nombre, porque los dos consumidores piden cosas distintas:
 * el congelado escribe `jugador_id` en la tabla, y la clasificación se muestra
 * por nombre.
 *
 * Va en UNA consulta con su `JOIN`, no una por jugador — con veinte jugadores
 * eso eran veinte viajes a la base para armar una sola tabla.
 */
async function porJugadorDeJornada(cliente, jornadaId) {
  const { rows } = await cliente.query(
    `SELECT r.jugador_id, j.nombre, p.partido_id, p.marcador1, p.marcador2
       FROM pronosticos p
       JOIN resultados r ON r.id = p.resultado_id
       JOIN jugadores  j ON j.id = r.jugador_id
      WHERE r.jornada_id = $1`,
    [jornadaId]);

  const porJugador = new Map();
  for (const f of rows) {
    if (!porJugador.has(f.jugador_id)) {
      porJugador.set(f.jugador_id, { nombre: f.nombre, pronosticos: new Map() });
    }
    porJugador.get(f.jugador_id).pronosticos.set(f.partido_id, {
      marcador1: f.marcador1,
      marcador2: f.marcador2
    });
  }
  return porJugador;
}

/**
 * TODOS los pronósticos de la quiniela, o los de una jornada, en UNA consulta.
 *
 * Es la tabla de todos contra todos. Hacerlo con una consulta por jugador y
 * jornada —lo natural al escribirlo— serían, con veinte jugadores y cuarenta
 * jornadas, **ochocientos viajes a la base para pintar una pantalla**. Es el
 * mismo N+1 que la Fase 5 quitó de la tabla general.
 *
 * Devuelve `[{ jugador, jornada, filas }]`, con `filas` en orden de partido y
 * `bloqueado` ya resuelto, para que la privacidad se decida igual que en el
 * resto: partido a partido.
 */
async function tabla(quinielaId, jornadaNombre = null, ahora = new Date()) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(`
      SELECT jug.nombre AS jugador, jor.nombre AS jornada,
             p.orden, p.equipo1, p.equipo2, p.logo_equipo1, p.logo_equipo2,
             p.comodin, p.api_date,
             pr.marcador1, pr.marcador2,
             rop.estado AS oficial_estado
        FROM pronosticos pr
        JOIN resultados r   ON r.id  = pr.resultado_id
        JOIN jugadores  jug ON jug.id = r.jugador_id
        JOIN jornadas   jor ON jor.id = r.jornada_id
        JOIN partidos   p   ON p.id  = pr.partido_id
        LEFT JOIN resultados_oficiales_partidos rop ON rop.partido_id = p.id
       WHERE ($1::text IS NULL OR jor.nombre = $1)
       ORDER BY jor.secuencia, jug.nombre, p.orden`,
      [jornadaNombre]);

    const porClave = new Map();

    for (const f of rows) {
      const clave = `${f.jugador}_${f.jornada}`;
      if (!porClave.has(clave)) {
        porClave.set(clave, { jugador: f.jugador, jornada: f.jornada, filas: [] });
      }
      porClave.get(clave).filas.push({
        equipo1: f.equipo1,
        equipo2: f.equipo2,
        logoEquipo1: f.logo_equipo1,
        logoEquipo2: f.logo_equipo2,
        comodin: f.comodin,
        marcador1: f.marcador1,
        marcador2: f.marcador2,
        bloqueado: partidoYaInicio(
          f, f.oficial_estado ? { estado: f.oficial_estado } : null, ahora)
      });
    }

    return [...porClave.values()];
  });
}

/* ==================== Escritura ==================== */

/**
 * Guarda los pronósticos de un jugador para una jornada.
 *
 * `pronosticos` llega como arreglo posicional, igual que lo manda el navegador
 * hoy: la posición `i` es el partido `i` de la jornada. Esa posición se traduce
 * a `partido_id` **aquí, una sola vez**, y de ahí en adelante ya no vuelve a
 * usarse. Es la decisión de alcance de §21.1 —claves ajenas dentro, posiciones
 * y nombres en el API— y lo que permite que el frontend no se toque.
 *
 * Todo va en una transacción: si el marcador del partido 7 es inválido, no se
 * guarda ninguno. Guardar seis y fallar en el séptimo dejaría al jugador con
 * media apuesta y sin forma de saber cuál mitad.
 */
async function guardar(quinielaId, { jugador, usuarioId = null, jornada, pronosticos, ahora = new Date() }) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await jornadaIdDe(c, jornada);
    if (!jornadaId) return { ok: false, motivo: 'jornada_no_encontrada' };

    const partidos = await partidosDe(c, jornadaId);
    const oficiales = await oficialesDe(c, jornadaId);

    const jugadorId = await jugadoresMod.asegurar(c, quinielaId, jugador, usuarioId);

    const { rows: [resultado] } = await c.query(
      `INSERT INTO resultados (quiniela_id, jornada_id, jugador_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (quiniela_id, jugador_id, jornada_id)
         DO UPDATE SET jornada_id = EXCLUDED.jornada_id
       RETURNING id`,
      [quinielaId, jornadaId, jugadorId]);

    let guardados = 0;
    let bloqueados = 0;

    for (let i = 0; i < partidos.length; i++) {
      const partido = partidos[i];

      if (partidoYaInicio(partido, oficiales.get(partido.id), ahora)) {
        // Cerrado: lo que hubiera se queda como estaba. Ni se toca ni se crea.
        bloqueados += 1;
        continue;
      }

      const enviado = pronosticos?.[i] || {};
      const marcador1 = normalizarMarcador(enviado.marcador1, `El marcador local del partido ${i + 1}`);
      const marcador2 = normalizarMarcador(enviado.marcador2, `El marcador visitante del partido ${i + 1}`);

      await c.query(
        `INSERT INTO pronosticos (quiniela_id, resultado_id, partido_id, marcador1, marcador2)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (resultado_id, partido_id)
           DO UPDATE SET marcador1 = EXCLUDED.marcador1, marcador2 = EXCLUDED.marcador2`,
        [quinielaId, resultado.id, partido.id, marcador1, marcador2]);

      guardados += 1;
    }

    return { ok: true, guardados, bloqueados };
  });
}

/**
 * Borra los pronósticos de unos partidos concretos.
 *
 * Lo usa `jornadas.guardar` cuando el partido de una posición pasa a ser OTRO
 * partido. Ver la cabecera de `src/jornadas.js`.
 */
async function borrarDePartidos(cliente, partidoIds) {
  if (!partidoIds?.length) return 0;
  const { rowCount } = await cliente.query(
    'DELETE FROM pronosticos WHERE partido_id = ANY($1::uuid[])', [partidoIds]);
  return rowCount;
}

module.exports = {
  partidoYaInicio,
  partidosDe, oficialesDe, jornadaIdDe,
  deJugador, porJugadorDeJornada, tabla,
  guardar, borrarDePartidos
};

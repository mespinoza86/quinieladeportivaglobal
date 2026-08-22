/*
 * Las trivias: ocho preguntas por partido, su reconciliación y su resolución.
 *
 * ============================================================================
 * LA TRIVIA CUELGA DEL PARTIDO, NO DE SU POSICIÓN
 * ============================================================================
 *
 * En Mongo la trivia guardaba `partidoIndex` —un número— más una copia de los
 * dos equipos. Es la misma forma que tenía M-02 y con el mismo agujero: borrar
 * el partido 2 de una jornada corría los demás una casilla, y las trivias
 * seguían apuntando al número viejo. La pregunta sobre un partido pasaba a
 * resolverse con el partido de al lado, sin fallar.
 *
 * Aquí es `partido_id`, con clave ajena y borrado en cascada. Y los equipos ya
 * no se copian: se leen del partido, igual que el comodín (Entrada 044).
 *
 * ============================================================================
 * DOS RELOJES CIERRAN UNA TRIVIA, Y HAY QUE CONTAR LOS DOS
 * ============================================================================
 *
 * ⚠️ En Mongo, guardar una respuesta se bloqueaba con `partidoYaInicio` —el
 * cierre por partido, Entrada 019— pero la privacidad de las respuestas ajenas
 * se decidía con `fechaCierre`. Dos relojes distintos para la misma pregunta,
 * así que había un hueco: con el partido ya empezado y la fecha de cierre por
 * llegar, nadie podía responder **y aun así las respuestas seguían ocultas**.
 *
 * `estaCerrada` los une: una trivia está cerrada cuando **pasó su fecha de
 * cierre O su partido ya empezó**, lo que ocurra antes. Nunca deja responder
 * más tiempo que antes, y la privacidad pasa a seguir la misma regla que los
 * pronósticos, que es lo que decía la Entrada 019.
 *
 * ============================================================================
 * LO QUE NO VIVE AQUÍ
 * ============================================================================
 *
 * Interpretar el JSON del proveedor —quién anotó primero, cuántas amarillas—
 * es la frontera con APIFootball y es la tajada 6. `resolverPendientes` recibe
 * esa interpretación como argumento: así la resolución se prueba entera sin red
 * y sin proveedor falso.
 */
'use strict';

const db = require('./db');
const { partidoYaInicio } = require('./fechas');

/** Las ocho preguntas. El tipo es la identidad; el texto es sólo lo que se lee. */
const TIPOS_TRIVIA = {
  primer_gol:         { pregunta: '¿Qué equipo anota primero?' },
  mas_amarillas:      { pregunta: '¿Qué equipo tendrá más tarjetas amarillas?' },
  mas_rojas:          { pregunta: '¿Qué equipo tendrá más tarjetas rojas?' },
  ambos_anotan:       { pregunta: '¿Ambos equipos anotan?' },
  gol_primer_tiempo:  { pregunta: '¿Habrá gol en el primer tiempo?' },
  gol_segundo_tiempo: { pregunta: '¿Habrá gol en el segundo tiempo?' },
  hubo_tiempo_extra:  { pregunta: '¿Habrá tiempo extra?' },
  hubo_penales:       { pregunta: '¿Habrá penales?' }
};

const SI_O_NO = ['Sí', 'No'];

/**
 * Las opciones de una trivia.
 *
 * Los nombres de los equipos entran como texto porque es lo que el jugador ve y
 * lo que se compara al resolver. Se guardan en la trivia —no se resuelven al
 * leer— a propósito: si un administrador corrige el nombre de un equipo después
 * de que alguien respondiera, la respuesta guardada seguiría siendo la que esa
 * persona eligió.
 */
function opcionesTrivia(tipo, equipo1, equipo2) {
  switch (tipo) {
    case 'primer_gol':    return [equipo1, equipo2, 'Nadie anotará'];
    case 'mas_amarillas': return [equipo1, equipo2, 'Empate', 'No habrá tarjetas amarillas'];
    case 'mas_rojas':     return [equipo1, equipo2, 'Empate', 'No habrá tarjetas rojas'];
    case 'ambos_anotan':
    case 'gol_primer_tiempo':
    case 'gol_segundo_tiempo':
    case 'hubo_tiempo_extra':
    case 'hubo_penales':  return [...SI_O_NO];
    default:              return [];
  }
}

/**
 * ¿Está cerrada esta trivia? Ver la cabecera: cuentan los dos relojes.
 *
 * `partido` y `oficial` pueden faltar —una trivia sin partido enlazado— y
 * entonces manda sólo la fecha de cierre, que es lo que hacía Mongo.
 */
function estaCerrada(trivia, partido = null, oficial = null, ahora = new Date()) {
  const fecha = trivia.fecha_cierre ?? trivia.fechaCierre;
  if (fecha && new Date(fecha) <= ahora) return true;
  if (partido && partidoYaInicio(partido, oficial, ahora)) return true;
  return false;
}

/** De fila de la base a la forma que espera el frontend. */
function triviaPublica(fila) {
  return {
    id: fila.id,
    jornadaNombre: fila.jornada_nombre,
    partidoIndex: fila.orden,
    apiFixtureId: fila.api_fixture_id,
    equipo1: fila.equipo1,
    equipo2: fila.equipo2,
    tipo: fila.tipo,
    pregunta: fila.pregunta,
    opciones: fila.opciones || [],
    puntos: fila.puntos,
    fechaCierre: fila.fecha_cierre,
    respuestaCorrecta: fila.respuesta_correcta,
    resuelta: fila.resuelta,
    activa: fila.activa
  };
}

/*
 * La consulta base. Trae de una vez la trivia, el partido del que cuelga y el
 * nombre de la jornada, porque el frontend habla por nombre y por posición: es
 * la decisión de alcance de §21.1 y lo que permite no tocarlo.
 */
const SELECT_TRIVIA = `
  SELECT t.*, j.nombre AS jornada_nombre,
         p.orden, p.equipo1, p.equipo2, p.api_date, p.api_fixture_id AS partido_fixture_id
    FROM trivias t
    JOIN jornadas j ON j.id = t.jornada_id
    LEFT JOIN partidos p ON p.id = t.partido_id`;

/* ==================== Lectura ==================== */

/** Las trivias activas de una jornada, ordenadas como se pintan. */
async function deJornada(quinielaId, jornadaNombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `${SELECT_TRIVIA} WHERE j.nombre = $1 AND t.activa ORDER BY p.orden, t.tipo`,
      [jornadaNombre]);
    return rows.map(triviaPublica);
  });
}

/** Todas las trivias activas de la quiniela. */
async function activas(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `${SELECT_TRIVIA} WHERE t.activa ORDER BY j.secuencia, p.orden, t.tipo`);
    return rows.map(triviaPublica);
  });
}

/** Los nombres de las jornadas que tienen alguna trivia activa. */
async function jornadasConTrivias(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `SELECT DISTINCT j.nombre, j.secuencia
         FROM trivias t JOIN jornadas j ON j.id = t.jornada_id
        WHERE t.activa ORDER BY j.secuencia`);
    return rows.map(f => f.nombre);
  });
}

/** Una trivia por su id, con su partido. `null` si no existe o es de otra. */
async function porId(cliente, triviaId) {
  const { rows: [t] } = await cliente.query(
    `${SELECT_TRIVIA} WHERE t.id = $1`, [triviaId]);
  return t || null;
}

/* ==================== Escritura ==================== */

/**
 * Crea una trivia si no existe, y si existe sólo le mueve la fecha de cierre.
 *
 * Es un `ON CONFLICT` en vez de mirar y luego escribir. Entre mirar y escribir
 * cabe otra petición, y ahí salían dos preguntas idénticas sobre el mismo
 * partido, cada una con sus respuestas y sus puntos.
 */
async function asegurar(cliente, quinielaId, { jornadaId, partido, tipo, fechaCierre, puntos }) {
  const { rows: [t] } = await cliente.query(
    `INSERT INTO trivias (quiniela_id, jornada_id, partido_id, api_fixture_id, tipo,
                          pregunta, opciones, puntos, fecha_cierre,
                          respuesta_correcta, resuelta, activa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',false,true)
     ON CONFLICT (quiniela_id, partido_id, tipo) WHERE activa AND partido_id IS NOT NULL
       DO UPDATE SET fecha_cierre = EXCLUDED.fecha_cierre, updated_at = now()
     RETURNING id, (xmax = 0) AS es_nueva`,
    [quinielaId, jornadaId, partido.id, partido.api_fixture_id || '', tipo,
      TIPOS_TRIVIA[tipo].pregunta,
      opcionesTrivia(tipo, partido.equipo1, partido.equipo2),
      puntos, fechaCierre]);
  return t;
}

/**
 * Crea las trivias de un partido. Es el POST de administración.
 *
 * `tipos` que no existan se ignoran en silencio, como hacía Mongo: la pantalla
 * manda una lista de casillas marcadas y una desconocida no es motivo para
 * rechazar las demás.
 */
async function crear(quinielaId, { jornadaNombre, partidoIndex, tipos, fechaCierre, puntos }) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      'SELECT id FROM jornadas WHERE nombre = $1', [jornadaNombre]);
    if (!j) return { ok: false, motivo: 'jornada_no_encontrada' };

    const { rows: [partido] } = await c.query(
      'SELECT * FROM partidos WHERE jornada_id = $1 AND orden = $2',
      [j.id, Number(partidoIndex)]);
    if (!partido) return { ok: false, motivo: 'partido_no_encontrado' };

    let creadas = 0;
    for (const tipo of tipos) {
      if (!TIPOS_TRIVIA[tipo]) continue;
      const t = await asegurar(c, quinielaId, {
        jornadaId: j.id, partido, tipo, fechaCierre, puntos
      });
      if (t.es_nueva) creadas += 1;
    }

    return { ok: true, creadas };
  });
}

/**
 * Deja las trivias de una jornada exactamente como dice `configuracion`.
 *
 * ⚠️ Todo va en UNA transacción. Un fallo a mitad dejaba lo peor de los dos
 * mundos: respuestas de jugadores huérfanas de trivias ya borradas, que seguían
 * sumando puntos en el ranking sin pregunta a la que corresponder, y trivias
 * reabiertas a medias.
 *
 * Mover la fecha de cierre **descongela** la trivia: se marca sin resolver y
 * las respuestas vuelven a cero puntos. Es deliberado —si la pregunta se
 * reabre, lo que se puntuó con el resultado anterior ya no vale— y por eso la
 * fecha se compara antes de escribirla.
 */
async function reconciliar(quinielaId, { jornadaNombre, configuracion, fechaCierre, puntos }) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      'SELECT id FROM jornadas WHERE nombre = $1', [jornadaNombre]);
    if (!j) return { ok: false, motivo: 'jornada_no_encontrada' };

    const { rows: partidos } = await c.query(
      'SELECT * FROM partidos WHERE jornada_id = $1 ORDER BY orden', [j.id]);
    const porOrden = new Map(partidos.map(p => [p.orden, p]));

    const seleccionadas = new Set();
    for (const item of configuracion || []) {
      if (!Array.isArray(item.tipos)) continue;
      for (const tipo of item.tipos) seleccionadas.add(`${Number(item.partidoIndex)}_${tipo}`);
    }

    const fecha = new Date(fechaCierre);
    let creadas = 0;
    let actualizadas = 0;
    let eliminadas = 0;

    /* --- Las que ya estaban: se quedan, se reabren o se van --- */

    const { rows: existentes } = await c.query(
      `SELECT t.id, t.tipo, t.fecha_cierre, p.orden
         FROM trivias t LEFT JOIN partidos p ON p.id = t.partido_id
        WHERE t.jornada_id = $1 AND t.activa`,
      [j.id]);

    for (const trivia of existentes) {
      if (!seleccionadas.has(`${trivia.orden}_${trivia.tipo}`)) {
        // Las respuestas se van con ella por la clave ajena en cascada.
        await c.query('DELETE FROM trivias WHERE id = $1', [trivia.id]);
        eliminadas += 1;
        continue;
      }

      const anterior = trivia.fecha_cierre ? new Date(trivia.fecha_cierre).getTime() : null;

      if (anterior !== fecha.getTime()) {
        await c.query(
          `UPDATE trivias SET fecha_cierre = $2, resuelta = false, respuesta_correcta = '',
                              updated_at = now()
            WHERE id = $1`, [trivia.id, fecha]);
        await c.query('UPDATE respuestas_trivia SET puntos = 0 WHERE trivia_id = $1', [trivia.id]);
      } else {
        await c.query('UPDATE trivias SET updated_at = now() WHERE id = $1', [trivia.id]);
      }

      actualizadas += 1;
    }

    /* --- Las que faltan --- */

    for (const item of configuracion || []) {
      const partido = porOrden.get(Number(item.partidoIndex));
      if (!partido || !Array.isArray(item.tipos)) continue;

      for (const tipo of item.tipos) {
        if (!TIPOS_TRIVIA[tipo]) continue;
        const t = await asegurar(c, quinielaId, {
          jornadaId: j.id, partido, tipo, fechaCierre: fecha, puntos
        });
        if (t.es_nueva) creadas += 1;
      }
    }

    return { ok: true, creadas, actualizadas, eliminadas };
  });
}

/** Borra una trivia. Sus respuestas se van con ella por la clave ajena. */
async function eliminar(quinielaId, triviaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query('DELETE FROM trivias WHERE id = $1', [triviaId]);
    return { ok: rowCount > 0 };
  });
}

/* ==================== Resolución ==================== */

/**
 * Resuelve las trivias vencidas de una quiniela y reparte sus puntos.
 *
 * Sólo se resuelve una trivia cuyo partido esté **terminado** (`TC`): antes de
 * eso el proveedor todavía puede cambiar de opinión sobre quién anotó y cuándo.
 *
 * `obtenerEvento` e `interpretar` llegan de fuera —son la frontera con
 * APIFootball, que es la tajada 6—. Que sean argumentos es lo que permite
 * probar la resolución entera sin red.
 *
 * ⚠️ El partido se busca por `partido_id`. En Mongo se emparejaba comparando
 * los nombres de los dos equipos en los dos órdenes posibles, porque la trivia
 * llevaba una copia de ellos. Con identidad estable no hay nada que emparejar,
 * y por tanto nada que se pueda emparejar mal.
 */
async function resolverPendientes(quinielaId, { obtenerEvento, interpretar, jornadaNombre = null, ahora = new Date() }) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: pendientes } = await c.query(
      `${SELECT_TRIVIA}
        WHERE t.activa AND NOT t.resuelta
          AND t.fecha_cierre IS NOT NULL AND t.fecha_cierre <= $1
          AND ($2::text IS NULL OR j.nombre = $2)`,
      [ahora, jornadaNombre]);

    let resueltas = 0;
    let puntosActualizados = false;

    for (const trivia of pendientes) {
      try {
        if (!trivia.api_fixture_id) continue;

        const { rows: [oficial] } = await c.query(
          `SELECT estado FROM resultados_oficiales_partidos WHERE partido_id = $1`,
          [trivia.partido_id]);

        if (oficial?.estado !== 'TC') continue;

        const evento = await obtenerEvento(trivia.api_fixture_id);
        const respuestaCorrecta = interpretar(triviaPublica(trivia), evento);

        // Sin respuesta no se marca resuelta: se reintentará en el próximo pase.
        if (!respuestaCorrecta) continue;

        await c.query(
          `UPDATE trivias SET respuesta_correcta = $2, resuelta = true, updated_at = now()
            WHERE id = $1`, [trivia.id, respuestaCorrecta]);

        /*
         * Los puntos se reparten con un solo UPDATE, no leyendo cada respuesta
         * y volviéndola a escribir. Con cuarenta jugadores eran ochenta viajes
         * a la base por pregunta.
         */
        const { rowCount } = await c.query(
          `UPDATE respuestas_trivia
              SET puntos = CASE WHEN respuesta = $2 THEN $3 ELSE 0 END
            WHERE trivia_id = $1`,
          [trivia.id, respuestaCorrecta, trivia.puntos]);

        if (rowCount > 0) puntosActualizados = true;
        resueltas += 1;
      } catch (error) {
        console.error(`Error resolviendo trivia ${trivia.id}:`, error.message);
      }
    }

    return { resueltas, puntosActualizados };
  });
}

module.exports = {
  TIPOS_TRIVIA, opcionesTrivia, estaCerrada, triviaPublica,
  deJornada, activas, jornadasConTrivias, porId,
  crear, reconciliar, eliminar, asegurar,
  resolverPendientes
};

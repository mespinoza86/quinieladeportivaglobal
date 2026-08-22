/*
 * Jornadas y sus partidos.
 *
 * ============================================================================
 * LO QUE CAMBIA RESPECTO A MONGO, Y NO ES COSMÉTICO
 * ============================================================================
 *
 * En Mongo, los partidos eran un arreglo dentro de la jornada y el vínculo con
 * un pronóstico era **la posición en ese arreglo** — el hallazgo M-02. Guardar
 * la jornada reemplazaba el arreglo entero, así que si alguien cambiaba el
 * orden de los partidos, los pronósticos que ya existían pasaban a apuntar a
 * otro partido **sin que nada avisara**.
 *
 * Aquí cada partido tiene identidad propia, y por eso `guardar` **reconcilia
 * por posición en vez de borrar y volver a insertar**: el partido de la
 * posición 0 conserva su `id`, así que los pronósticos que colgaban de él
 * siguen colgando de él. Borrar y reinsertar sería más corto de escribir y se
 * llevaría por delante los pronósticos en cascada.
 *
 * ============================================================================
 * DE CARA AFUERA SE SIGUE HABLANDO POR NOMBRE
 * ============================================================================
 *
 * Es la decisión de alcance de §21.1: claves ajenas dentro, nombres en el API.
 * Estas funciones reciben el nombre de la jornada y lo resuelven una vez; el
 * frontend no se entera de que existen los identificadores.
 */
'use strict';

const db = require('./db');
const pronosticos = require('./pronosticos');

/** De columnas de la base a la forma que espera el frontend. Sin tocar nada. */
function partidoPublico(fila) {
  return {
    equipo1: fila.equipo1,
    equipo2: fila.equipo2,
    logoEquipo1: fila.logo_equipo1,
    logoEquipo2: fila.logo_equipo2,
    comodin: fila.comodin,
    apiFixtureId: fila.api_fixture_id,
    apiLeagueId: fila.api_league_id,
    apiDate: fila.api_date,
    apiStatus: fila.api_status
  };
}

/** Los valores de un partido en el orden en que los esperan las consultas. */
function valoresDePartido(p) {
  return [
    p.equipo1 ?? null, p.equipo2 ?? null,
    p.logoEquipo1 ?? null, p.logoEquipo2 ?? null,
    Boolean(p.comodin),
    p.apiFixtureId ?? null, p.apiLeagueId ?? null,
    p.apiDate ?? null, p.apiStatus ?? null
  ];
}

/* ==================== Lectura ==================== */

/**
 * La jornada actual y la lista de todas.
 *
 * ⚠️ **La actual es la ÚLTIMA QUE SE CREÓ** (Fase B, Entrada 028), y se ordena
 * por `secuencia`, no por `id`. En Mongo bastaba `sort({_id: -1})` porque un
 * ObjectId lleva la fecha dentro; un uuid es aleatorio y ordenar por él daría
 * un orden arbitrario **sin fallar**: seguiría devolviendo una jornada, sólo
 * que la que no es.
 *
 * Devuelve también la lista completa para que una pantalla llene su desplegable
 * y elija el valor por defecto con UNA sola petición.
 */
async function actual(quinielaId) {
  const filas = await db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      'SELECT nombre FROM jornadas ORDER BY secuencia DESC');
    return rows;
  });

  return {
    sugerida: filas[0]?.nombre ?? null,
    jornadas: filas.map(f => ({ nombre: f.nombre }))
  };
}

/** Sólo los nombres, en orden de creación. Es el `?resumen=1` de la ruta. */
async function resumen(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query('SELECT nombre FROM jornadas ORDER BY secuencia');
    return rows.map(f => ({ nombre: f.nombre }));
  });
}

/**
 * Todas las jornadas con sus partidos.
 *
 * Va en UNA consulta con `json_agg` en vez de una por jornada: es el N+1 que
 * arrastraban varias rutas, y aquí no cuesta nada evitarlo.
 */
async function listar(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(`
      SELECT j.nombre,
             COALESCE(
               json_agg(
                 json_build_object(
                   'equipo1', p.equipo1, 'equipo2', p.equipo2,
                   'logoEquipo1', p.logo_equipo1, 'logoEquipo2', p.logo_equipo2,
                   'comodin', p.comodin,
                   'apiFixtureId', p.api_fixture_id, 'apiLeagueId', p.api_league_id,
                   'apiDate', p.api_date, 'apiStatus', p.api_status
                 ) ORDER BY p.orden
               ) FILTER (WHERE p.id IS NOT NULL),
               '[]'
             ) AS partidos
        FROM jornadas j
        LEFT JOIN partidos p ON p.jornada_id = j.id
       GROUP BY j.id, j.nombre, j.secuencia
       ORDER BY j.secuencia`);
    return rows.map(f => ({ nombre: f.nombre, partidos: f.partidos }));
  });
}

/** Una jornada con sus partidos, o `null`. */
async function porNombre(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      'SELECT id, nombre FROM jornadas WHERE nombre = $1', [nombre]);
    if (!j) return null;

    const { rows } = await c.query(
      'SELECT * FROM partidos WHERE jornada_id = $1 ORDER BY orden', [j.id]);
    return { nombre: j.nombre, partidos: rows.map(partidoPublico) };
  });
}

/** El identificador interno, para lo que sí lo necesita. `null` si no existe. */
async function idDe(cliente, nombre) {
  const { rows: [j] } = await cliente.query(
    'SELECT id FROM jornadas WHERE nombre = $1', [nombre]);
  return j?.id ?? null;
}

/* ==================== Escritura ==================== */

/**
 * Crea la jornada si no existe y deja sus partidos como los que llegan.
 *
 * ⚠️ **Reconcilia por posición**, no borra y reinserta. Ver la cabecera del
 * módulo: reinsertar se llevaría los pronósticos por delante en cascada.
 */
async function guardar(quinielaId, nombre, partidos) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      `INSERT INTO jornadas (quiniela_id, nombre) VALUES ($1, $2)
       ON CONFLICT (quiniela_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
      [quinielaId, nombre]);

    const { rows: existentes } = await c.query(
      'SELECT id, orden, api_fixture_id FROM partidos WHERE jornada_id = $1 ORDER BY orden',
      [j.id]);

    /*
     * ⚠️ Conservar el id es lo correcto cuando la posición sigue siendo EL MISMO
     * partido. Cuando pasa a ser OTRO —el administrador cambia el tercer partido
     * de la jornada por uno distinto— los pronósticos que colgaban del viejo se
     * quedarían pegados al nuevo y puntuarían contra un partido que nadie
     * pronosticó.
     *
     * Desde la Fase D los partidos salen sólo del API, así que hay una señal
     * limpia para distinguir los dos casos: el `api_fixture_id`. Si cambia por
     * otro distinto, es otro partido y lo que colgaba de él ya no vale.
     *
     * Sólo cuando los dos identificadores existen. Si el viejo venía sin él, no
     * hay forma de saberlo y no se toca nada: borrar pronósticos por si acaso
     * sería peor que dejarlos.
     */
    const cambiaronDePartido = [];

    // Los que ya estaban en esa posición se actualizan y conservan su id.
    for (let i = 0; i < partidos.length; i++) {
      const valores = valoresDePartido(partidos[i]);
      if (i < existentes.length) {
        const antes = existentes[i].api_fixture_id;
        const ahora = partidos[i].apiFixtureId;
        if (antes && ahora && String(antes) !== String(ahora)) {
          cambiaronDePartido.push(existentes[i].id);
        }

        await c.query(
          `UPDATE partidos SET equipo1=$2, equipo2=$3, logo_equipo1=$4, logo_equipo2=$5,
                  comodin=$6, api_fixture_id=$7, api_league_id=$8, api_date=$9, api_status=$10
            WHERE id = $1`,
          [existentes[i].id, ...valores]);
      } else {
        await c.query(
          `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2,
                                 logo_equipo1, logo_equipo2, comodin,
                                 api_fixture_id, api_league_id, api_date, api_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [quinielaId, j.id, i, ...valores]);
      }
    }

    // Y los que sobran se van.
    if (existentes.length > partidos.length) {
      await c.query('DELETE FROM partidos WHERE jornada_id = $1 AND orden >= $2',
        [j.id, partidos.length]);
    }

    const pronosticosBorrados = await pronosticos.borrarDePartidos(c, cambiaronDePartido);

    return { nombre, partidosReemplazados: cambiaronDePartido.length, pronosticosBorrados };
  });
}

/** Añade un partido al final. Devuelve un motivo si la jornada no existe. */
async function agregarPartido(quinielaId, nombre, partido, maximo) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    const { rows: [{ n }] } = await c.query(
      'SELECT count(*)::int AS n FROM partidos WHERE jornada_id = $1', [jornadaId]);
    if (n >= maximo) return { ok: false, motivo: 'demasiados', total: n };

    await c.query(
      `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2,
                             logo_equipo1, logo_equipo2, comodin,
                             api_fixture_id, api_league_id, api_date, api_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [quinielaId, jornadaId, n, ...valoresDePartido(partido)]);

    return { ok: true };
  });
}

/**
 * Quita los partidos de esas posiciones y renumera los que quedan.
 *
 * Los que sobreviven **conservan su `id`**, así que sus pronósticos siguen
 * apuntando a ellos. En Mongo esto era un `splice` sobre el arreglo y los
 * pronósticos posteriores pasaban a apuntar al partido de al lado en silencio:
 * es M-02, y aquí deja de poder pasar.
 */
async function eliminarPartidos(quinielaId, nombre, indices) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    // Diferir la unicidad: la renumeración pasa por estados intermedios en los
    // que dos partidos comparten posición.
    await c.query('SET CONSTRAINTS ALL DEFERRED');
    await c.query('DELETE FROM partidos WHERE jornada_id = $1 AND orden = ANY($2::int[])',
      [jornadaId, indices]);
    await c.query(`
      UPDATE partidos p
         SET orden = nuevo.fila - 1
        FROM (SELECT id, row_number() OVER (ORDER BY orden) AS fila
                FROM partidos WHERE jornada_id = $1) AS nuevo
       WHERE p.id = nuevo.id AND p.orden <> nuevo.fila - 1`,
      [jornadaId]);

    return { ok: true };
  });
}

/**
 * Cambia sólo la casilla de comodín de cada partido.
 *
 * ⚠️ La ruta manda la lista entera para cambiar una casilla. Si el número de
 * partidos no coincide, lo que llega no es «la misma jornada con otro comodín»
 * sino otra cosa, y aplicarla borraría partidos sin querer.
 */
async function fijarComodines(quinielaId, nombre, partidos) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    const { rows: existentes } = await c.query(
      'SELECT id, orden FROM partidos WHERE jornada_id = $1 ORDER BY orden', [jornadaId]);

    if (existentes.length !== partidos.length) {
      return { ok: false, motivo: 'no_coincide' };
    }

    for (let i = 0; i < existentes.length; i++) {
      await c.query('UPDATE partidos SET comodin = $2 WHERE id = $1',
        [existentes[i].id, Boolean(partidos[i].comodin)]);
    }
    return { ok: true };
  });
}

async function eliminar(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query('DELETE FROM jornadas WHERE nombre = $1', [nombre]);
    return { ok: rowCount > 0 };
  });
}

module.exports = {
  partidoPublico,
  actual, resumen, listar, porNombre, idDe,
  guardar, agregarPartido, eliminarPartidos, fijarComodines, eliminar
};

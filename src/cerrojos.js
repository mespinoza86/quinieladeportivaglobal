/*
 * El cerrojo distribuido. Impide que dos instancias en Render hagan el mismo
 * trabajo periódico a la vez.
 *
 * ============================================================================
 * EN POSTGRESQL ES UNA SENTENCIA, Y ESO ES TODO
 * ============================================================================
 *
 * En Mongo esto era un `findOneAndUpdate` con `upsert` y un filtro por caducado,
 * más un `catch` del código 11000, porque el choque contra el índice único ERA
 * la respuesta «lo tiene otro» y había que traducirla. Funcionaba, pero para
 * leerlo había que saber que un error concreto no era un error.
 *
 * Aquí es un `INSERT … ON CONFLICT DO UPDATE … WHERE expira_en <= now()`. Si
 * otra instancia lo tiene vivo, el `WHERE` no deja actualizar, no se devuelve
 * ninguna fila, y eso significa exactamente «no es tuyo». Sin excepciones que
 * interpretar. Se comprobó en el sondeo (Entrada 032) antes de decidirlo.
 *
 * ============================================================================
 * `job_locks` NO LLEVA `quiniela_id`, Y ES A PROPÓSITO
 * ============================================================================
 *
 * El ciclo de sincronización es UNO para todas las quinielas: ése fue el
 * arreglo de C-01 y C-05. Un cerrojo por quiniela dejaría a cada una llamando
 * al proveedor por su cuenta, que es justo lo que se quitó.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

/**
 * Quién es este proceso. El azar del final importa: en Render dos instancias
 * pueden arrancar con el mismo pid dentro de contenedores distintos, y dos
 * titulares con el mismo nombre se soltarían el cerrojo el uno al otro.
 */
const ID_INSTANCIA = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * Toma el cerrojo si está libre o caducado. Devuelve `true` sólo si es nuestro.
 *
 * ⚠️ La caducidad no es un adorno: si el proceso que lo tiene se muere de
 * repente —Render reinicia la instancia—, nadie llega a soltarlo. Sin `expira_en`
 * el trabajo periódico se apagaría para siempre y nada lo diría.
 */
async function tomar(nombre, ttlMs, ahora = new Date(), titular = ID_INSTANCIA) {
  const { rows } = await db.consulta(
    `INSERT INTO job_locks (nombre, instancia, tomado_en, expira_en)
     VALUES ($1, $2, $3, $3::timestamptz + ($4 || ' milliseconds')::interval)
     ON CONFLICT (nombre) DO UPDATE SET
       instancia = EXCLUDED.instancia,
       tomado_en = EXCLUDED.tomado_en,
       expira_en = EXCLUDED.expira_en
     WHERE job_locks.expira_en <= $3
     RETURNING nombre`,
    [nombre, titular, ahora, String(Math.max(0, Math.trunc(ttlMs)))]);

  return rows.length > 0;
}

/**
 * Suelta el cerrojo, pero **sólo si sigue siendo nuestro**.
 *
 * ⚠️ «Nuestro» es el testigo del ciclo concreto, no el del proceso. La
 * diferencia importa cuando el vigilante abandona un ciclo lento: ese ciclo
 * puede terminar más tarde y llegar aquí cuando el cerrojo ya lo tiene un ciclo
 * posterior del MISMO proceso. Con el identificador de proceso lo soltaría y
 * dejaría a dos ciclos sincronizando a la vez; con el testigo del ciclo, el
 * `WHERE` no encuentra nada y la llamada no hace daño.
 */
async function soltar(nombre, titular = ID_INSTANCIA) {
  const { rowCount } = await db.consulta(
    `UPDATE job_locks SET expira_en = to_timestamp(0)
      WHERE nombre = $1 AND instancia = $2`,
    [nombre, titular]);
  return rowCount > 0;
}

/** El estado de un cerrojo, para las sondas y para las pruebas. */
async function estado(nombre) {
  const { rows: [c] } = await db.consulta(
    'SELECT nombre, instancia, tomado_en, expira_en FROM job_locks WHERE nombre = $1',
    [nombre]);
  return c || null;
}

module.exports = { ID_INSTANCIA, tomar, soltar, estado };

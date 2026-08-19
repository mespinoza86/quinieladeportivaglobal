/*
 * Atomicidad de las secuencias de varias escrituras.
 *
 * Primera tajada de la Fase 6: esto no toca Express ni los modelos, solo
 * mongoose, así que se puede vivir aparte sin arrastrar nada.
 */
'use strict';

const mongoose = require('mongoose');

/*
 * Varias operaciones del sistema son secuencias de escrituras que solo tienen
 * sentido completas. Si falla la de en medio, lo que queda no es "menos datos":
 * es un estado que el resto del código no sabe interpretar.
 *
 *   - Crear quiniela son dos escrituras. Sin la segunda queda una quiniela
 *     cuyo propietario no es miembro de ella: nadie puede entrar, ni siquiera
 *     quien la creó, y la pantalla de quinielas ni la lista.
 *   - Transferir la propiedad son tres. A medias deja la quiniela con dos
 *     propietarios o con ninguno.
 *   - Borrar una jornada son cuatro. A medias deja pronósticos y puntos
 *     congelados de una jornada que ya no existe, que luego aparecen sumados
 *     en la tabla general sin columna a la que pertenecer.
 *   - Reconciliar las trivias de una jornada son muchas. A medias deja
 *     respuestas huérfanas de trivias borradas, que siguen contando puntos.
 */

let avisoSinTransaccionesDado = false;

/**
 * ¿Este error es "el servidor no sabe hacer transacciones"?
 *
 * MongoDB solo las admite sobre un conjunto de réplicas. Atlas lo es —también
 * el plan gratuito—, así que en producción no se da; un `mongod` suelto de
 * desarrollo, sí.
 */
function esFaltaDeSoporteDeTransacciones(error) {
  const mensaje = String(error?.message || '');

  return error?.code === 20 ||
    error?.codeName === 'IllegalOperation' ||
    /Transaction numbers are only allowed on a replica set/i.test(mensaje) ||
    /transactions are not supported/i.test(mensaje);
}

/**
 * Ejecuta una secuencia de escrituras como una sola operación atómica.
 *
 * La función recibe la sesión y DEBE pasarla a cada escritura: una consulta que
 * se olvide de `{ session }` queda fuera de la transacción y no se revierte,
 * que es el fallo silencioso típico de esto.
 *
 * OJO con `Promise.all`: una sesión no admite operaciones en paralelo. Las
 * escrituras de dentro van en secuencia aunque sean independientes.
 *
 * Si el servidor no admite transacciones se ejecuta igualmente, sin
 * atomicidad, avisando una vez. Es preferible a dejar la aplicación inservible
 * contra un mongod suelto, pero conviene saber que ahí la garantía no está.
 */
async function enTransaccion(operacion) {
  const sesion = await mongoose.startSession();

  try {
    let resultado;

    await sesion.withTransaction(async () => {
      resultado = await operacion(sesion);
    });

    return resultado;
  } catch (error) {
    if (!esFaltaDeSoporteDeTransacciones(error)) throw error;

    if (!avisoSinTransaccionesDado) {
      avisoSinTransaccionesDado = true;
      console.warn(
        '⚠️  Esta base de datos no admite transacciones (no es un conjunto de réplicas). ' +
        'Las operaciones de varias escrituras se ejecutarán SIN atomicidad: un fallo a ' +
        'mitad puede dejar datos inconsistentes. En Atlas esto no ocurre.'
      );
    }

    return await operacion(undefined);
  } finally {
    await sesion.endSession();
  }
}

module.exports = { enTransaccion, esFaltaDeSoporteDeTransacciones };

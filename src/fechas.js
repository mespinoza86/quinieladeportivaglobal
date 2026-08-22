/*
 * Fechas de partido.
 *
 * El API entrega la hora del partido como texto y en hora de Costa Rica. Estas
 * dos funciones son lo único que sabe traducirlo, y son puras: no consultan la
 * base, no conocen Express y no dependen del reloj salvo por lo que se les
 * pase. Viven en src/ desde la Fase 6, y aquí las necesita además la regla de
 * "jornada actual" de la Fase B, que no podría importarlas de server.js sin
 * crear un ciclo.
 */
'use strict';

/**
 * La parte de día de un `apiDate`, sin la hora.
 *
 * Acepta los dos separadores que manda el API —espacio y `T`— porque los usa
 * indistintamente según el endpoint.
 */
function extraerFechaApi(apiDate) {
  if (!apiDate) return '';
  return String(apiDate).split(' ')[0].split('T')[0];
}

/**
 * Convierte un `apiDate` en un `Date` real, interpretándolo en hora de Costa
 * Rica.
 *
 * Interpretarlo en la zona del servidor fue un error de verdad: en Render el
 * servidor va en UTC, así que un partido de las 13:00 se leía seis horas antes
 * de lo que era y los pronósticos se cerraban a destiempo. Costa Rica no tiene
 * horario de verano, así que el desfase es siempre el mismo y no hace falta
 * una biblioteca de zonas horarias.
 *
 * Devuelve `null` si no hay fecha o si no se puede interpretar: quien llama
 * debe decidir qué hacer con eso, porque «sin fecha» no significa lo mismo en
 * todas partes.
 */
function parseFechaPartidoCostaRica(apiDate) {
  if (!apiDate) return null;

  const raw = String(apiDate).trim();

  // Formatos esperados:
  // "2026-07-04 13:00"
  // "2026-07-04T13:00"
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);

  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, year, month, day, hour, minute] = match.map(Number);

  // Costa Rica es UTC-6 todo el año
  return new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));
}

/**
 * ¿Este partido ya empezó, y por tanto su pronóstico está cerrado?
 *
 * Es la regla del cierre POR PARTIDO (Entrada 019): un partido se cierra a su
 * hora de inicio, y ahí su pronóstico deja de poder editarse y pasa a ser
 * visible. Los demás partidos de la misma jornada siguen abiertos.
 *
 * Manda el resultado oficial si lo hay: si el proveedor dice que está en juego,
 * en el descanso o terminado, da igual lo que dijera el calendario. Sólo cuando
 * no hay resultado se mira la hora prevista.
 *
 * ⚠️ Vive aquí, y no en quien la usa, porque la usan los DOS mundos: las rutas
 * de `server.js` y `src/pronosticos.js`. Tener dos copias de esta regla sería
 * tener dos respuestas distintas a "¿puedo cambiar mi pronóstico?", y hay un
 * guardián en `architecture.test.js` que lo impide a propósito.
 *
 * Acepta el nombre del campo en las dos formas —`apiDate` de Mongo y del API,
 * `api_date` de PostgreSQL— para que sirva a los dos sin traductor por medio.
 */
function partidoYaInicio(partido, oficial = null, ahora = new Date()) {
  if (oficial && ['LIVE', 'MT', 'TC'].includes(oficial.estado)) return true;

  const fecha = parseFechaPartidoCostaRica(partido?.apiDate ?? partido?.api_date);
  if (!fecha) return false;

  return fecha <= ahora;
}

module.exports = { extraerFechaApi, parseFechaPartidoCostaRica, partidoYaInicio };

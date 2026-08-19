/*
 * Cuál es "la jornada actual".
 *
 * Hasta la Fase B esto se decidía de tres maneras distintas y ninguna buena:
 * la tabla por jornada ordenaba por `createdAt`, llenar jornada tomaba el
 * último elemento del arreglo —sin orden garantizado— y resultados oficiales
 * ni lo intentaba. `createdAt` es CUÁNDO SE CREÓ EL REGISTRO, no cuándo se
 * juega: una jornada importada tarde se convertía en "la última" aunque sus
 * partidos fueran de la semana pasada.
 *
 * La regla acordada deriva la respuesta de las FECHAS DE LOS PARTIDOS: la
 * jornada actual es la que contiene el partido más próximo —hacia adelante o
 * hacia atrás— que todavía no tiene resultado definitivo. Nada que mantener a
 * mano, y una jornada importada tarde ya no se cuela.
 *
 * Como puede haber dos jornadas jugándose a la vez, esto es una SUGERENCIA:
 * las pantallas se abren en ella y siempre llevan selector para cambiar. La
 * función no decide por el usuario, decide por dónde empezar.
 *
 * Es pura: recibe los datos y el reloj, no consulta la base y no conoce
 * Express. Por eso se puede probar sin levantar nada.
 */
'use strict';

const { parseFechaPartidoCostaRica } = require('./fechas');

/*
 * Los tres grupos, en orden de preferencia. Un grupo entero gana siempre al
 * siguiente, pase lo que pase con las distancias: una jornada con partidos por
 * jugar es más "actual" que una temporada cerrada hace meses, aunque la cerrada
 * tenga fechas más cercanas por accidente.
 */
const CON_PENDIENTES_Y_FECHA = 0;
const CON_PENDIENTES_SIN_FECHA = 1;
const TODO_DEFINITIVO = 2;

/**
 * ¿El resultado oficial de este partido es definitivo?
 *
 * Mismo criterio que `jornadaEstaFinalizada`: lo dio por terminado el
 * sincronizador (`TC`) o lo bloqueó un administrador al cargarlo a mano. Se
 * repite aquí en vez de importarse porque aquella mira la jornada entera y
 * esta un solo partido, y unificarlas ataría este módulo a server.js.
 */
function esDefinitivo(oficial) {
  if (!oficial) return false;
  return oficial.bloqueadoFinal === true || oficial.estado === 'TC';
}

/**
 * Cómo de "actual" es una jornada: su grupo y su distancia al momento dado.
 *
 * La distancia es en valor absoluto a propósito. Recién terminada una jornada
 * sus partidos quedan unas horas atrás, y durante ese rato sigue siendo la que
 * la gente quiere ver; deja de serlo sola, en cuanto los partidos de la
 * siguiente se acercan más de lo que la anterior se aleja.
 */
function medirJornada(jornada, ahora) {
  const partidos = jornada?.partidos || [];
  const oficiales = jornada?.oficiales || [];

  let distanciaPendiente = Infinity;
  let hayPendientes = false;
  let ultimaFecha = null;

  partidos.forEach((partido, indice) => {
    const definitivo = esDefinitivo(oficiales[indice]);
    const fecha = parseFechaPartidoCostaRica(partido?.apiDate);

    if (!definitivo) hayPendientes = true;

    if (!fecha) return;

    if (!ultimaFecha || fecha > ultimaFecha) ultimaFecha = fecha;

    if (!definitivo) {
      distanciaPendiente = Math.min(distanciaPendiente, Math.abs(fecha - ahora));
    }
  });

  if (hayPendientes && distanciaPendiente !== Infinity) {
    return { grupo: CON_PENDIENTES_Y_FECHA, distancia: distanciaPendiente };
  }

  /*
   * Pendientes pero sin una sola fecha utilizable: son los partidos cargados a
   * mano, que no tienen `apiDate`. No se pueden ordenar por cercanía, pero
   * siguen siendo más actuales que una jornada ya cerrada.
   */
  if (hayPendientes) {
    return { grupo: CON_PENDIENTES_SIN_FECHA, distancia: Infinity };
  }

  return {
    grupo: TODO_DEFINITIVO,
    distancia: ultimaFecha ? Math.abs(ultimaFecha - ahora) : Infinity
  };
}

/**
 * El nombre de la jornada por la que conviene abrir, o `null` si no hay
 * ninguna.
 *
 * `jornadas` es `[{ nombre, partidos, oficiales }]`, donde `oficiales` va en el
 * mismo orden que `partidos` —es como los guarda `ResultadoOficial`— y puede
 * faltar entero si la jornada aún no tiene resultados.
 *
 * Los empates se rompen por el ORDEN EN QUE LLEGAN, no por nombre: dos jornadas
 * pueden llamarse "Jornada 10" y "J10" y el alfabeto no dice nada útil sobre
 * cuál es más reciente. Quien llama ordena la lista como quiera que se
 * desempate; el servidor la manda con la más nueva primero, que es lo que hacía
 * la regla vieja y sigue siendo un desempate razonable.
 */
function jornadaSugerida(jornadas, ahora = new Date()) {
  const lista = Array.isArray(jornadas) ? jornadas.filter(Boolean) : [];
  if (!lista.length) return null;

  const momento = ahora instanceof Date ? ahora.getTime() : new Date(ahora).getTime();

  let mejor = null;
  let medidaMejor = null;

  lista.forEach(jornada => {
    const medida = medirJornada(jornada, momento);

    const gana = !medidaMejor
      || medida.grupo < medidaMejor.grupo
      || (medida.grupo === medidaMejor.grupo && medida.distancia < medidaMejor.distancia);

    if (gana) {
      mejor = jornada;
      medidaMejor = medida;
    }
  });

  return mejor?.nombre ?? null;
}

module.exports = { jornadaSugerida, esDefinitivo };

/*
 * El motor de puntos. Funciones puras: no consultan la base, no conocen Express
 * y no dependen del reloj. Todo lo que necesitan llega por argumentos.
 *
 * ============================================================================
 * LO QUE CAMBIA RESPECTO A MONGO, Y POR QUÉ
 * ============================================================================
 *
 * 1. SE EMPAREJA POR `partido_id`, NO POR POSICIÓN EN UN ARREGLO.
 *
 *    En Mongo, `puntosDeJornada` recorría los partidos por índice y buscaba el
 *    pronóstico y el resultado oficial en la MISMA posición. Eso es M-02, y no
 *    era teórico: la ruta de borrar partidos hacía `splice` sobre el arreglo de
 *    la jornada y **nunca tocaba los pronósticos de los jugadores**, así que a
 *    partir de esa posición cada pronóstico pasaba a puntuarse contra el
 *    partido de al lado. En silencio, sin fallar, con un número creíble.
 *
 *    Aquí cada partido tiene identidad y el emparejamiento va por ella. Borrar
 *    un partido se lleva sus pronósticos por clave ajena, y los que sobreviven
 *    siguen pegados a quien les corresponde.
 *
 * 2. EL COMODÍN SE LEE DEL PARTIDO, NO DEL RESULTADO OFICIAL.
 *
 *    En Mongo el comodín se COPIABA dentro del resultado oficial en cada ciclo
 *    del sincronizador, y el motor lo leía de esa copia. Tenía una fuga fea:
 *    un partido terminado ya no se vuelve a consultar, así que marcar un
 *    comodín DESPUÉS de que acabara no llegaba nunca a la copia, y los puntos
 *    se recalculaban con el comodín viejo.
 *
 *    El comodín es una decisión sobre el partido —cuánto vale—, no un hecho del
 *    juego —qué pasó—. Son dos cosas distintas y no deben viajar juntas: aquí
 *    vive sólo en `partidos.comodin`, y `resultados_oficiales_partidos` ni
 *    siquiera tiene columna donde copiarlo.
 *
 * 3. PERO UNA JORNADA CONGELADA CONSERVA LOS COMODINES QUE TENÍA.
 *
 *    Si el comodín se leyera siempre del partido, tocar una casilla en una
 *    jornada de enero reescribiría su clasificación en marzo: sería M-03
 *    entrando por otra puerta. Por eso la foto que se guarda al congelar lleva,
 *    además de las reglas de puntuación, **qué partidos eran comodín**.
 *
 *    Queda coherente con la regla del 17 de agosto: la configuración no
 *    reescribe el pasado, un hecho corregido sí.
 */
'use strict';

/**
 * Puntos de un solo partido. Es la regla de puntuación, en un único sitio.
 *
 * La aritmética es **idéntica** a la de Mongo, a propósito: ningún puntaje ya
 * emitido puede cambiar de valor por la migración. Lo único que cambia es de
 * dónde llega `esComodin`, que ahora es un argumento explícito en vez de un
 * campo escondido dentro del resultado oficial.
 */
function puntosDePartido(pronostico, oficial, esComodin, puntuacion) {
  if (!pronostico || !oficial) return 0;

  const valores = [oficial.marcador1, oficial.marcador2, pronostico.marcador1, pronostico.marcador2];
  const sonNumerosValidos = valores.every(valor => typeof valor === 'number' && !Number.isNaN(valor));

  if (!sonNumerosValidos) return 0;

  if (oficial.marcador1 === pronostico.marcador1 && oficial.marcador2 === pronostico.marcador2) {
    return esComodin ? puntuacion.comodinExacto : puntuacion.marcadorExacto;
  }

  const signo = (uno, dos) => (uno > dos ? 'gano' : uno < dos ? 'perdio' : 'empato');

  if (signo(oficial.marcador1, oficial.marcador2) === signo(pronostico.marcador1, pronostico.marcador2)) {
    return esComodin ? puntuacion.comodinResultado : puntuacion.resultadoCorrecto;
  }

  return 0;
}

/**
 * Puntos de un jugador en una jornada.
 *
 * `pronosticos` y `oficiales` son mapas de `partido_id` a fila. Un partido sin
 * pronóstico o sin resultado suma cero, que es lo mismo que hacía Mongo cuando
 * el arreglo era más corto.
 */
function puntosDeJornada(partidos, pronosticos, oficiales, puntuacion) {
  let total = 0;

  for (const partido of partidos || []) {
    total += puntosDePartido(
      pronosticos?.get(partido.id),
      oficiales?.get(partido.id),
      Boolean(partido.comodin),
      puntuacion);
  }

  return total;
}

/**
 * Estadísticas para ordenar una clasificación por jornada.
 *
 * No cambian los puntos: sólo desempatan visualmente a quienes quedaron con el
 * mismo marcador total.
 */
function estadisticasDeJornada(partidos, pronosticos, oficiales, puntuacion) {
  let puntos = 0;
  let marcadoresExactos = 0;
  let resultadosCorrectos = 0;
  let diferenciaTotalGoles = 0;

  for (const partido of partidos || []) {
    const pronostico = pronosticos?.get(partido.id);
    const oficial = oficiales?.get(partido.id);

    puntos += puntosDePartido(pronostico, oficial, Boolean(partido.comodin), puntuacion);

    if (!pronostico || !oficial) continue;

    const valores = [oficial.marcador1, oficial.marcador2, pronostico.marcador1, pronostico.marcador2];
    if (!valores.every(valor => typeof valor === 'number' && !Number.isNaN(valor))) continue;

    if (oficial.marcador1 === pronostico.marcador1 && oficial.marcador2 === pronostico.marcador2) {
      marcadoresExactos += 1;
    }

    const signo = (uno, dos) => (uno > dos ? 1 : uno < dos ? -1 : 0);
    if (signo(oficial.marcador1, oficial.marcador2) === signo(pronostico.marcador1, pronostico.marcador2)) {
      resultadosCorrectos += 1;
    }

    diferenciaTotalGoles +=
      Math.abs(oficial.marcador1 - pronostico.marcador1) +
      Math.abs(oficial.marcador2 - pronostico.marcador2);
  }

  return { puntos, marcadoresExactos, resultadosCorrectos, diferenciaTotalGoles };
}

/**
 * Una jornada está terminada cuando **todos** sus partidos tienen un resultado
 * oficial definitivo: el sincronizador lo dio por terminado (`TC`) o un
 * administrador lo bloqueó al cargarlo a mano.
 *
 * Si falta el resultado de un solo partido, la jornada sigue viva y sus puntos
 * se calculan al vuelo. Eso es lo que hace que la tabla siga moviéndose durante
 * la jornada en curso.
 *
 * Una jornada sin partidos NO está terminada. Parece un detalle y no lo es: sin
 * esa línea, una jornada recién creada y vacía se congelaría con todo el mundo
 * a cero y ya no volvería a calcularse.
 */
function jornadaEstaFinalizada(partidos, oficiales) {
  if (!partidos?.length) return false;

  return partidos.every(partido => {
    const oficial = oficiales?.get(partido.id);
    if (!oficial) return false;
    return oficial.bloqueadoFinal === true || oficial.estado === 'TC';
  });
}

/** El orden de una clasificación por jornada, con sus desempates. */
function ordenarClasificacion(filas) {
  return filas.sort((a, b) =>
    b.puntos - a.puntos ||
    b.marcadoresExactos - a.marcadoresExactos ||
    b.resultadosCorrectos - a.resultadosCorrectos ||
    a.diferenciaTotalGoles - b.diferenciaTotalGoles ||
    a.jugador.localeCompare(b.jugador));
}

/**
 * Reparte puestos sobre una clasificación ya ordenada, y marca los empates.
 *
 * Quien empata comparte puesto: dos con 12 puntos son los dos segundos, y el
 * siguiente es el cuarto. Se hace aparte del orden porque son dos preguntas
 * distintas —cómo se ordena y cómo se numera— y mezclarlas es lo que hace que
 * un empate acabe con dos puestos distintos.
 */
function repartirPuestos(clasificacion) {
  const cuantosConCada = new Map();
  for (const fila of clasificacion) {
    cuantosConCada.set(fila.puntos, (cuantosConCada.get(fila.puntos) || 0) + 1);
  }

  let puesto = 0;
  let anteriores = null;
  clasificacion.forEach((fila, indice) => {
    if (fila.puntos !== anteriores) puesto = indice + 1;
    fila.puesto = puesto;
    fila.empate = cuantosConCada.get(fila.puntos) > 1;
    anteriores = fila.puntos;
  });

  return clasificacion;
}

module.exports = {
  puntosDePartido,
  puntosDeJornada,
  estadisticasDeJornada,
  jornadaEstaFinalizada,
  ordenarClasificacion,
  repartirPuestos
};

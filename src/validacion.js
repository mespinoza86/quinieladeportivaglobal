/*
 * Validadores de dominio.
 *
 * Funciones puras: no consultan la base, no dependen de la petición y no
 * conocen Express. Por eso son la primera tajada de la Fase 6 junto con las
 * transacciones, y por eso se pueden probar sueltas.
 */
'use strict';

/**
 * Error de datos del cliente.
 *
 * El manejador global lo convierte en un 400 conservando el mensaje, en vez del
 * "La petición no es válida." genérico. Quien está cargando una jornada
 * necesita saber QUÉ campo se rechazó; un 400 mudo obliga a adivinar.
 */
function errorDeValidacion(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  error.esValidacion = true;
  return error;
}

const MAX_GOLES = 99;
const MAX_PARTIDOS_POR_JORNADA = 50;
const MAX_LARGO_NOMBRE_JORNADA = 80;

/**
 * Un marcador es un entero de 0 a MAX_GOLES, o `null` si se dejó en blanco.
 *
 * `Number()` a secas no bastaba, y ahí estaba el agujero: acepta '-3', acepta
 * '2.5' y acepta '1e999', que no da NaN sino Infinity. Ninguno de los tres
 * rompe nada de forma visible; los tres corrompen el motor de puntuación en
 * silencio, porque `puntosDePartido` compara números sin volver a mirarlos.
 */
function normalizarMarcador(valor, etiqueta) {
  if (valor === null || valor === undefined) return null;

  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw errorDeValidacion(`${etiqueta} no es un marcador válido.`);
  }

  const bruto = typeof valor === 'string' ? valor.trim() : valor;
  if (bruto === '') return null;

  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero < 0 || numero > MAX_GOLES) {
    throw errorDeValidacion(`${etiqueta} debe ser un número entero entre 0 y ${MAX_GOLES}.`);
  }

  return numero;
}

/** Nombre de jornada: obligatorio, recortado y acotado. */
function normalizarNombreDeJornada(valor) {
  const nombre = typeof valor === 'string' ? valor.trim() : '';

  /*
   * Sin esta comprobación, un POST sin `nombre` no fallaba: Mongoose casteaba
   * el filtro a `nombre: null`, el upsert insertaba una jornada sin nombre y
   * esa jornada fantasma aparecía después como columna en la tabla general y
   * como opción en el desplegable de la tabla por jornada.
   */
  if (!nombre) throw errorDeValidacion('El nombre de la jornada es obligatorio.');
  if (nombre.length > MAX_LARGO_NOMBRE_JORNADA) {
    throw errorDeValidacion(`El nombre de la jornada admite hasta ${MAX_LARGO_NOMBRE_JORNADA} caracteres.`);
  }

  return nombre;
}

/** Un partido necesita dos equipos; el resto de campos se normalizan a texto. */
function normalizarPartido(valor, indice = 0) {
  const posicion = `El partido ${indice + 1}`;

  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw errorDeValidacion(`${posicion} no es válido.`);
  }

  const equipo1 = typeof valor.equipo1 === 'string' ? valor.equipo1.trim() : '';
  const equipo2 = typeof valor.equipo2 === 'string' ? valor.equipo2.trim() : '';
  if (!equipo1 || !equipo2) throw errorDeValidacion(`${posicion} necesita los dos equipos.`);

  const texto = campo => (valor[campo] === null || valor[campo] === undefined ? '' : String(valor[campo]));

  return {
    equipo1,
    equipo2,
    logoEquipo1: texto('logoEquipo1'),
    logoEquipo2: texto('logoEquipo2'),
    comodin: Boolean(valor.comodin),
    apiFixtureId: texto('apiFixtureId'),
    apiLeagueId: texto('apiLeagueId'),
    apiDate: texto('apiDate'),
    apiStatus: texto('apiStatus')
  };
}

/** Una jornada sin partidos no es una jornada. */
function normalizarPartidos(valor) {
  if (!Array.isArray(valor) || !valor.length) {
    throw errorDeValidacion('La jornada debe tener al menos un partido.');
  }
  if (valor.length > MAX_PARTIDOS_POR_JORNADA) {
    throw errorDeValidacion(`Una jornada admite como máximo ${MAX_PARTIDOS_POR_JORNADA} partidos.`);
  }

  return valor.map((partido, indice) => normalizarPartido(partido, indice));
}

/**
 * Índices de partido a borrar: enteros, dentro del rango y sin repetir.
 *
 * El duplicado importaba: la ruta hace `splice` por cada índice, así que un
 * mismo número repetido borraba dos partidos, el señalado y su vecino.
 */
function normalizarIndicesDePartido(valor, total) {
  if (!Array.isArray(valor) || !valor.length) {
    throw errorDeValidacion('Debes indicar qué partidos eliminar.');
  }

  const indices = valor.map(item => {
    const numero = typeof item === 'number' ? item : Number(String(item).trim());
    if (!Number.isInteger(numero) || numero < 0 || numero >= total) {
      throw errorDeValidacion('Alguno de los partidos indicados no existe en la jornada.');
    }
    return numero;
  });

  return [...new Set(indices)];
}

module.exports = {
  errorDeValidacion,
  normalizarMarcador,
  normalizarNombreDeJornada,
  normalizarPartido,
  normalizarPartidos,
  normalizarIndicesDePartido,
  MAX_GOLES,
  MAX_PARTIDOS_POR_JORNADA,
  MAX_LARGO_NOMBRE_JORNADA
};

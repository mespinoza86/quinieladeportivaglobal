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

/**
 * La hora de un partido: «YYYY-MM-DD HH:MM», en hora de Costa Rica.
 *
 * ============================================================================
 * ⛔ POR QUÉ ESTO TIENE QUE SER ESTRICTO, Y NO «LO QUE SE PUEDA INTERPRETAR»
 * ============================================================================
 *
 * Hasta ahora `apiDate` era TEXTO LIBRE: lo que llegara se guardaba. Daba igual
 * mientras sólo escribiera el proveedor, que manda siempre
 * `${match_date} ${match_time}`. Desde que el administrador puede corregir la
 * hora a mano, un dedazo es un fallo de verdad, y de los peores: **silencioso**.
 *
 * Dos razones, las dos comprobables:
 *
 *   1. **Un formato que no se puede interpretar NO CIERRA EL PARTIDO.**
 *      `parseFechaPartidoCostaRica` devuelve `null`, `partidoYaInicio` devuelve
 *      `false`, y ese partido admite pronósticos **para siempre** — también con
 *      el partido ya jugado y el marcador en la pantalla. Nada da error.
 *
 *   2. **Las ventanas de aviso COMPARAN TEXTOS, no fechas.** La consulta de los
 *      quince minutos hace `api_date > $1` contra una cadena, y funciona sólo
 *      porque el formato lleva ceros a la izquierda: ahí el orden alfabético y
 *      el cronológico son el mismo. Un «2026-10-11 3:00» sin el cero ordena
 *      DESPUÉS de «2026-10-11 15:00», y la notificación se manda a destiempo o
 *      no se manda. Tampoco da error.
 *
 * ⚠️ Y NO vale validar con `parseFechaPartidoCostaRica`, que es lo primero que
 * se piensa: esa función tiene un `new Date(raw)` de reserva que acepta
 * «11/10/2026» y lo interpreta a la americana —10 de noviembre—. Pasaría la
 * validación y guardaría un mes equivocado. La validación mira la FORMA.
 *
 * ⚠️ El vacío se acepta a propósito: un partido puesto a mano puede no tener
 * hora, y `''` significa «no se sabe», que es cierto y ya está contemplado en
 * todas las consultas (`api_date <> ''`). Lo que no se acepta es basura.
 *
 * Normaliza a un solo formato —espacio, sin segundos— porque el proveedor usa
 * `T` en algunos endpoints y el selector del navegador también. Dos formas del
 * mismo instante romperían la comparación por texto de arriba.
 */
function normalizarFechaDePartido(valor, etiqueta) {
  if (valor === null || valor === undefined) return '';

  const bruto = String(valor).trim();
  if (bruto === '') return '';

  const match = bruto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);

  if (!match) {
    throw errorDeValidacion(
      `${etiqueta} tiene que ir como «2026-10-11 15:00» (hora de Costa Rica).`);
  }

  const [, anio, mes, dia, hora, minuto] = match.map(Number);

  /*
   * ⛔ Y la forma correcta no basta: «2026-02-31 25:99» la cumple. Se comprueba
   * que sea una fecha que existe, reconstruyéndola y mirando si los números
   * sobrevivieron. `Date` no se queja de un 31 de febrero: lo desborda a marzo
   * en silencio, que es exactamente la clase de fallo que esto evita.
   */
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto));

  const existe = fecha.getUTCFullYear() === anio
    && fecha.getUTCMonth() === mes - 1
    && fecha.getUTCDate() === dia
    && fecha.getUTCHours() === hora
    && fecha.getUTCMinutes() === minuto;

  if (!existe) {
    throw errorDeValidacion(`${etiqueta} no es una fecha que exista.`);
  }

  const dos = n => String(n).padStart(2, '0');
  return `${anio}-${dos(mes)}-${dos(dia)} ${dos(hora)}:${dos(minuto)}`;
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

  /*
   * El buscador del API llama `fecha` y `estado` a lo que la jornada guarda
   * como `apiDate` y `apiStatus`. La traducción vivía en una ruta aparte
   * -/api/jornadas/importar-api-, que existía SOLO para eso y era por lo demás
   * idéntica a POST /api/jornadas. Al unificar las pantallas en la Fase D se
   * retiró esa ruta y el alias bajó aquí, que es donde vive la forma canónica
   * de un partido: quien normaliza es quien debe saber los nombres que acepta.
   */
  const primero = (...campos) => {
    for (const campo of campos) {
      const valorCampo = valor[campo];
      if (valorCampo !== null && valorCampo !== undefined && valorCampo !== '') {
        return String(valorCampo);
      }
    }
    return '';
  };

  return {
    equipo1,
    equipo2,
    logoEquipo1: texto('logoEquipo1'),
    logoEquipo2: texto('logoEquipo2'),
    comodin: Boolean(valor.comodin),
    apiFixtureId: texto('apiFixtureId'),
    apiLeagueId: texto('apiLeagueId'),
    /*
     * ⚠️ Pasa por el validador desde que la hora se puede corregir a mano. La
     * cabecera de `normalizarFechaDePartido` explica por qué un formato raro no
     * da error en ninguna parte y sin embargo rompe el cierre y los avisos.
     */
    apiDate: normalizarFechaDePartido(primero('apiDate', 'fecha'), posicion + ': la hora'),
    apiStatus: primero('apiStatus', 'estado'),
    /*
     * A qué jornada de la liga pertenece (§22). El alias `ronda` es como lo
     * llama `mapearEvento`, igual que `fecha` y `estado` de arriba.
     *
     * ⛔ Faltaba aquí y el dato se perdía ENTERO por el camino HTTP: se leía
     * del proveedor, se mandaba desde el navegador y esta función lo tiraba
     * antes de llegar a la base. Las pruebas de la tajada 1 llamaban a
     * `jornadas.guardar` directamente, así que probaban el módulo y no el
     * camino que usa la aplicación.
     */
    apiRound: primero('apiRound', 'ronda')
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
  normalizarFechaDePartido,
  normalizarPartido,
  normalizarPartidos,
  normalizarIndicesDePartido,
  MAX_GOLES,
  MAX_PARTIDOS_POR_JORNADA,
  MAX_LARGO_NOMBRE_JORNADA
};

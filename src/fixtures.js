/*
 * La caché compartida de partidos.
 *
 * ============================================================================
 * `fixtures` NO LLEVA `quiniela_id`, Y ES LA PIEZA CENTRAL DEL ARREGLO
 * ============================================================================
 *
 * Es justo lo que todas las quinielas comparten. Un partido del mundial es el
 * mismo partido lo sigan tres quinielas o trescientas, así que se consulta UNA
 * vez y todas leen el resultado. Antes cada quiniela llamaba al proveedor por
 * su cuenta: eso era C-01 —la cuota multiplicada por el número de quinielas— y
 * C-05 —cada instancia con su propio reloj—.
 *
 * Por eso esta tabla es de las pocas **sin RLS**: no hay nada que aislar,
 * porque no hay nada de nadie.
 *
 * ============================================================================
 * LA VENTANA: CUÁNDO VOLVER A PREGUNTAR
 * ============================================================================
 *
 * No todos los partidos merecen la misma atención. Uno en vivo cambia cada
 * minuto; uno de dentro de tres días no cambia en seis horas. `proxima_consulta`
 * guarda cuándo toca el siguiente vistazo, y el planificador sólo se lleva lo
 * que ya venció.
 *
 * ⚠️ Y `proxima_consulta` en `NULL` significa **nunca más**: el partido terminó
 * y su resultado ya no puede cambiar. Es lo que hace que una temporada entera
 * jugada no cueste una sola llamada.
 */
'use strict';

const db = require('./db');
const { extraerFechaApi, parseFechaPartidoCostaRica } = require('./fechas');
const { normalizarEquipo, obtenerEstadoPartido } = require('./eventos');

const VENTANAS_MS = {
  enVivo: 60 * 1000,
  inminente: 15 * 60 * 1000,
  lejano: 6 * 60 * 60 * 1000,
  desconocido: 30 * 60 * 1000,
  error: 10 * 60 * 1000
};

const UMBRAL_INMINENTE_MS = 2 * 60 * 60 * 1000;

/*
 * Un partido cuya hora de inicio pasó hace rato y que el proveedor sigue sin
 * dar por empezado casi siempre está aplazado, cancelado o mal enlazado. Sin
 * este umbral se quedaría consultándose cada minuto para siempre.
 */
const UMBRAL_ABANDONO_MS = 4 * 60 * 60 * 1000;

/* ==================== Identidad de un partido ==================== */

/**
 * La clave con la que dos quinielas comparten el mismo partido.
 *
 * Es el `apiFixtureId` cuando existe. Cuando no —un partido cargado a mano—,
 * una clave sintética de fecha y equipos, para que dos quinielas que
 * importaron el mismo partido sin id tampoco lo consulten por separado.
 */
function claveDeFixture(partido) {
  const id = partido?.apiFixtureId ?? partido?.api_fixture_id;
  if (id) return String(id);

  const fecha = extraerFechaApi(partido?.apiDate ?? partido?.api_date);
  const equipo1 = partido?.equipo1;
  const equipo2 = partido?.equipo2;
  if (!fecha || !equipo1 || !equipo2) return null;

  return `sin-id:${fecha}:${normalizarEquipo(equipo1)}|${normalizarEquipo(equipo2)}`;
}

/** Lo mínimo que hace falta para volver a buscar un partido en el proveedor. */
function descriptorDeFixture(clave, partido) {
  const id = partido?.apiFixtureId ?? partido?.api_fixture_id;
  const fecha = partido?.apiDate ?? partido?.api_date;
  const liga = partido?.apiLeagueId ?? partido?.api_league_id;

  return {
    clave,
    apiFixtureId: id ? String(id) : '',
    apiDate: fecha || '',
    busqueda: {
      fecha: extraerFechaApi(fecha),
      ligaId: liga ? String(liga) : '',
      equipo1: partido?.equipo1 || '',
      equipo2: partido?.equipo2 || ''
    }
  };
}

/**
 * Cuándo volver a preguntar por un partido.
 *
 * ⚠️ El detalle que no es obvio: la próxima consulta **nunca se pospone más
 * allá del pitido inicial**. Un partido que empieza en tres horas cae en la
 * ventana «lejano» de seis, y sin este tope se consultaría por primera vez tres
 * horas después de haber empezado.
 */
function calcularProximaConsulta(estado, apiDate, ahora = new Date(), hayError = false) {
  // Terminado: el resultado ya no puede cambiar y no se vuelve a consultar.
  if (estado === 'TC') return null;

  const base = ahora.getTime();
  const inicio = parseFechaPartidoCostaRica(apiDate);
  const faltan = inicio ? inicio.getTime() - base : null;

  let ventana;

  if (hayError) {
    ventana = VENTANAS_MS.error;
  } else if (estado === 'LIVE' || estado === 'MT') {
    ventana = VENTANAS_MS.enVivo;
  } else if (faltan === null) {
    ventana = VENTANAS_MS.desconocido;
  } else if (faltan <= -UMBRAL_ABANDONO_MS) {
    ventana = VENTANAS_MS.lejano;
  } else if (faltan <= 0) {
    // Ya debería haber empezado: el proveedor está a punto de darlo por vivo.
    ventana = VENTANAS_MS.enVivo;
  } else if (faltan <= UMBRAL_INMINENTE_MS) {
    ventana = VENTANAS_MS.inminente;
  } else {
    ventana = VENTANAS_MS.lejano;
  }

  let proxima = base + ventana;
  if (faltan !== null && faltan > 0) proxima = Math.min(proxima, inicio.getTime());

  return new Date(proxima);
}

/* ==================== Lectura ==================== */

/** Traduce una fila a la forma que usa el resto del código. */
function fixturePublico(fila) {
  return {
    clave: fila.clave,
    apiFixtureId: fila.api_fixture_id,
    busqueda: fila.busqueda,
    evento: fila.evento,
    estado: fila.estado,
    apiDate: fila.api_date,
    consultadoEn: fila.consultado_en,
    proximaConsulta: fila.proxima_consulta,
    fallosConsecutivos: fila.fallos_consecutivos,
    ultimoError: fila.ultimo_error
  };
}

/**
 * Los fixtures de esas claves, indexados por clave.
 *
 * ⚠️ Va **sin contexto de quiniela** a propósito: la tabla es compartida y no
 * lleva RLS. Pedirla dentro de un contexto tampoco haría daño, pero conviene
 * que se lea que aquí no hay inquilino que valga.
 */
async function porClaves(claves) {
  if (!claves?.length) return new Map();

  const { rows } = await db.consulta(
    `SELECT * FROM fixtures WHERE clave = ANY($1::text[])`, [claves]);

  return new Map(rows.map(f => [f.clave, fixturePublico(f)]));
}

/** El evento crudo que el proveedor dio de un partido. `null` si no hay. */
async function eventoDe(apiFixtureId) {
  const { rows: [f] } = await db.consulta(
    'SELECT evento FROM fixtures WHERE api_fixture_id = $1 AND evento IS NOT NULL',
    [String(apiFixtureId)]);
  return f?.evento ?? null;
}

/* ==================== Escritura ==================== */

/**
 * Guarda lo que devolvió el proveedor. Devuelve `true` sólo si trajo datos
 * nuevos, que es lo que decide si vale la pena reescribir los resultados
 * oficiales de las quinielas.
 *
 * ⚠️ Ante un fallo, o ante un proveedor que no conoce el partido, **se conserva
 * lo último que sí se supo**. Sobrescribir con vacío borraría un marcador bueno
 * por un error de red, y ese marcador es el que puntúa.
 */
async function guardar(descriptor, { evento = null, error = null, previo = null, ahora = new Date() } = {}) {
  const estadoBase = previo?.estado || 'DESCONOCIDO';
  const estado = evento ? obtenerEstadoPartido(evento, null).estado : estadoBase;

  await db.consulta(
    `INSERT INTO fixtures (clave, api_fixture_id, busqueda, evento, estado, api_date,
                           consultado_en, proxima_consulta, fallos_consecutivos, ultimo_error)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (clave) DO UPDATE SET
       api_fixture_id = EXCLUDED.api_fixture_id,
       busqueda       = EXCLUDED.busqueda,
       -- Sin evento nuevo se deja el que hubiera: es el marcador que puntúa.
       evento         = COALESCE(EXCLUDED.evento, fixtures.evento),
       estado         = EXCLUDED.estado,
       api_date       = EXCLUDED.api_date,
       consultado_en  = EXCLUDED.consultado_en,
       proxima_consulta    = EXCLUDED.proxima_consulta,
       fallos_consecutivos = EXCLUDED.fallos_consecutivos,
       ultimo_error        = EXCLUDED.ultimo_error,
       updated_at          = now()`,
    [descriptor.clave,
      descriptor.apiFixtureId || '',
      JSON.stringify(descriptor.busqueda || {}),
      evento ? JSON.stringify(evento) : null,
      estado,
      descriptor.apiDate || null,
      ahora,
      calcularProximaConsulta(estado, descriptor.apiDate, ahora, Boolean(error)),
      error ? (previo?.fallosConsecutivos || 0) + 1 : 0,
      error || '']);

  return Boolean(evento);
}

/**
 * ¿A este partido le toca ya que le pregunten?
 *
 * Separada de quien la usa porque es la regla de la cuota, y conviene poder
 * mirarla sola: un `false` de más significa un resultado que no llega, y uno de
 * menos, cuota gastada por nada.
 */
function tocaConsultar(previo, ahora = new Date(), forzar = false) {
  if (!previo) return true;
  if (forzar) return true;
  // Terminado y bloqueado: no se vuelve a gastar una llamada en él jamás.
  if (previo.estado === 'TC') return false;
  if (previo.proximaConsulta && new Date(previo.proximaConsulta) > ahora) return false;
  return true;
}

module.exports = {
  VENTANAS_MS, UMBRAL_INMINENTE_MS, UMBRAL_ABANDONO_MS,
  claveDeFixture, descriptorDeFixture, calcularProximaConsulta,
  fixturePublico, porClaves, eventoDe, guardar, tocaConsultar
};

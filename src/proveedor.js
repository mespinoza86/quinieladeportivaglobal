/*
 * Ir a pedirle datos a APIFootball.
 *
 * ============================================================================
 * PEDIR Y LEER SON DOS COSAS DISTINTAS
 * ============================================================================
 *
 * `src/eventos.js` sabe **leer** la respuesta del proveedor —quién anotó
 * primero, cuántas amarillas, si el minuto es "45+"—. Este módulo sabe **ir a
 * buscarla**: la URL, la clave, el plazo de espera y la cuota.
 *
 * La separación no es estética. Es lo que permite que las 229 pruebas de
 * PostgreSQL no salgan a la red **ni una vez**: quien interpreta se prueba con
 * un JSON escrito a mano, y quien pide se sustituye por `usarFuente()`.
 *
 * ============================================================================
 * ⚠️ EL PLAZO DE ESPERA NO ES DECORATIVO
 * ============================================================================
 *
 * El valor por defecto de axios es 0 —esperar para siempre—, y una petición
 * colgada deja sin resolver la promesa del ciclo de sincronización. Como
 * `cicloEnCurso` sólo se libera en el `finally` de ese ciclo, **el sincronizador
 * del proceso se apaga en silencio hasta el siguiente reinicio**: nadie ve un
 * error, simplemente `ultimoCiclo` deja de moverse en las métricas.
 */
'use strict';

const axios = require('axios');
const { extraerFechaApi } = require('./fechas');
const { normalizarEquipo } = require('./eventos');

const TIMEOUT_MS = Number(process.env.APIFOOTBALL_TIMEOUT_MS || 15_000);

const cliente = axios.create({
  baseURL: 'https://apiv3.apifootball.com/',
  timeout: TIMEOUT_MS
});

/*
 * La única puerta al exterior de todo el proyecto, y la costura por la que las
 * pruebas la cierran. Sin ella, ejercitar el ciclo completo exigiría red y
 * cuota real, así que en la práctica no se probaría.
 */
let fuente = async params => {
  const clave = process.env.APIFOOTBALL_COM_KEY;
  if (!clave) {
    const error = new Error('Falta configurar APIFOOTBALL_COM_KEY en el .env');
    error.status = 500;
    throw error;
  }

  const respuesta = await cliente.get('', { params: { ...params, APIkey: clave } });
  return respuesta.data;
};

/** Sustituye la puerta al exterior. Devuelve la anterior, para poder restaurarla. */
function usarFuente(nueva) {
  const anterior = fuente;
  fuente = nueva;
  return anterior;
}

/** ¿Está configurada la clave? Lo miran las rutas antes de intentarlo. */
function hayClave() {
  return Boolean(process.env.APIFOOTBALL_COM_KEY);
}

/**
 * Traduce un evento crudo a la forma que usa la aplicación.
 *
 * Vive aquí y no en la ruta porque desde la Fase C hay DOS cosas que leen la
 * misma respuesta —la lista de partidos y la de ligas disponibles— y dos
 * traducciones del mismo JSON acabarían discrepando en algún campo sin que
 * nadie lo note.
 */
function mapearEvento(item) {
  return {
    apiFixtureId: Number(item.match_id),
    fecha: `${item.match_date} ${item.match_time}`,
    estado: item.match_status || 'NS',
    minuto: null,
    liga: item.league_name || '',
    pais: item.country_name || '',
    temporada: '',
    apiLeagueId: Number(item.league_id),
    equipo1: item.match_hometeam_name,
    equipo2: item.match_awayteam_name,
    logoEquipo1: item.team_home_badge || '',
    logoEquipo2: item.team_away_badge || '',
    marcador1: item.match_hometeam_score !== '' ? Number(item.match_hometeam_score) : null,
    marcador2: item.match_awayteam_score !== '' ? Number(item.match_awayteam_score) : null
  };
}

/* ==================== Las cuatro consultas ==================== */

/** Los partidos de un rango de fechas, ya traducidos. */
async function porRango({ desde, hasta, ligaId } = {}) {
  const params = {
    action: 'get_events',
    from: desde,
    to: hasta,
    timezone: 'America/Costa_Rica'
  };
  if (ligaId) params.league_id = ligaId;

  const datos = await fuente(params);

  if (!Array.isArray(datos)) {
    console.log('Respuesta de APIFootball que no es una lista:', datos);
    return [];
  }

  return datos.map(mapearEvento);
}

/** El evento CRUDO de un partido por su id. Sin traducir: lo lee `eventos.js`. */
async function porId(matchId) {
  if (!matchId) return null;

  const datos = await fuente({
    action: 'get_events',
    match_id: String(matchId),
    timezone: 'America/Costa_Rica'
  });

  return Array.isArray(datos) ? (datos[0] ?? null) : null;
}

/**
 * El evento crudo de un partido buscándolo por su fecha y sus equipos.
 *
 * Es el plan B de `porId`: un partido cargado a mano no tiene identificador del
 * proveedor, y uno importado puede tener uno que el proveedor ya no reconozca.
 */
async function porFecha(partido) {
  const fecha = extraerFechaApi(partido.apiDate);
  if (!fecha) return null;

  const params = { action: 'get_events', from: fecha, to: fecha };
  if (partido.apiLeagueId) params.league_id = partido.apiLeagueId;

  const datos = await fuente(params);
  const eventos = Array.isArray(datos) ? datos : [];

  const equipo1 = normalizarEquipo(partido.equipo1);
  const equipo2 = normalizarEquipo(partido.equipo2);

  return eventos.find(evento =>
    normalizarEquipo(evento.match_hometeam_name) === equipo1 &&
    normalizarEquipo(evento.match_awayteam_name) === equipo2) || null;
}

/** El catálogo de ligas del proveedor, tal cual lo devuelve. */
async function ligas() {
  return fuente({ action: 'get_leagues' });
}

/**
 * Lo que usa el sincronizador: primero por id, y si no da, por fecha.
 *
 * Cuenta las llamadas para las métricas, porque el ahorro de la caché
 * compartida sólo se puede comprobar si se sabe cuántas se hicieron de verdad.
 */
async function buscarEvento(descriptor, metricas = null) {
  if (descriptor.apiFixtureId) {
    if (metricas) metricas.llamadasApi += 1;
    const evento = await porId(descriptor.apiFixtureId);
    if (evento) return evento;
  }

  const busqueda = descriptor.busqueda || {};
  if (!busqueda.fecha) return null;

  if (metricas) metricas.llamadasApi += 1;

  return porFecha({
    apiDate: busqueda.fecha,
    apiLeagueId: busqueda.ligaId,
    equipo1: busqueda.equipo1,
    equipo2: busqueda.equipo2
  });
}

/* ==================== La caché de ligas disponibles ==================== */

/*
 * Quien arma una jornada abre esa pantalla varias veces seguidas, y cada
 * apertura consultaría el rango entero otra vez. La respuesta cambia poco —una
 * liga no aparece ni desaparece en cuestión de minutos— así que se guarda un
 * rato.
 *
 * ⚠️ Vive en memoria del proceso a propósito, y NO en la base como la caché de
 * partidos: aquélla se comparte entre quinielas porque el ahorro crecía con el
 * número de quinielas, y ésta la usan sólo los administradores al crear una
 * jornada. Con dos instancias en Render, cada una tendrá la suya y el coste es
 * una consulta más cada diez minutos.
 */
const CACHE_LIGAS_MS = 10 * 60 * 1000;
const cacheLigas = new Map();

function leerCacheLigas(clave, ahora = Date.now()) {
  const guardado = cacheLigas.get(clave);
  if (!guardado || guardado.expiraEn <= ahora) return null;
  return guardado.valor;
}

function guardarCacheLigas(clave, valor, ahora = Date.now()) {
  cacheLigas.set(clave, { valor, expiraEn: ahora + CACHE_LIGAS_MS });
}

function vaciarCacheLigas() {
  cacheLigas.clear();
}

module.exports = {
  TIMEOUT_MS, CACHE_LIGAS_MS,
  usarFuente, hayClave, mapearEvento,
  porRango, porId, porFecha, ligas, buscarEvento,
  leerCacheLigas, guardarCacheLigas, vaciarCacheLigas
};

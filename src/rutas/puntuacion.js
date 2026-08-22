/*
 * Rutas de puntuación: pronósticos, resultados oficiales y las dos tablas.
 *
 * ============================================================================
 * LA PRIVACIDAD SE DECIDE PARTIDO A PARTIDO (Entrada 019)
 * ============================================================================
 *
 * Cuatro de estas rutas entregan pronósticos ajenos, y las cuatro aplican la
 * misma regla: **de otro participante sólo se ve lo de los partidos que ya
 * empezaron**. Es una función compartida y no una expresión copiada en cada
 * sitio, y eso tiene una historia: `/api/resultados-con-equipos` se quedó fuera
 * del repaso de privacidad porque llamaba `jornadaAcceso` a lo que las otras
 * llamaban `jornadaDoc`, y la prueba que buscaba el patrón viejo no la vio.
 * Una regla en un solo lugar no se puede quedar a medio cambiar.
 *
 * ⚠️ Y no es un 403: lo que no se puede ver llega con los marcadores en `null`
 * o en `''`, con la fila puesta. Así la pantalla muestra la jornada a medias en
 * vez de quedarse en blanco, que es justo lo que se quería arreglar.
 *
 * ============================================================================
 * LA CACHÉ DE LA TABLA GENERAL
 * ============================================================================
 *
 * Es una optimización de lectura por instancia, **no una fuente de verdad**:
 * toda escritura que pueda mover el ranking la invalida, y el TTL cubre el caso
 * de que una vía futura se olvidara de hacerlo.
 *
 * ⚠️ Va por quiniela. Una caché global sería la fuga C-02 otra vez, y esta vez
 * en memoria, donde RLS no llega.
 */
'use strict';

const db = require('../db');
const jornadasMod = require('../jornadas');
const pronosticosMod = require('../pronosticos');
const oficialesMod = require('../oficiales');
const rankingMod = require('../ranking');
const usuariosMod = require('../usuarios');
const { normalizarMarcador } = require('../validacion');
const { partidoYaInicio } = require('../fechas');

/* ==================== La caché del ranking ==================== */

const TTL_CACHE_RANKING_MS = Number(process.env.RANKING_CACHE_TTL_MS || 60_000);
const cacheRanking = new Map();

function invalidarCacheRanking(quinielaId) {
  if (quinielaId) cacheRanking.delete(String(quinielaId));
}

function leerCacheRanking(quinielaId) {
  const entrada = cacheRanking.get(String(quinielaId));
  if (!entrada) return null;
  if (Date.now() - entrada.creadoEn > TTL_CACHE_RANKING_MS) {
    cacheRanking.delete(String(quinielaId));
    return null;
  }
  return entrada.datos;
}

function guardarCacheRanking(quinielaId, datos) {
  cacheRanking.set(String(quinielaId), { creadoEn: Date.now(), datos });
}

/**
 * Devuelve la tabla entera, o una página si la piden.
 *
 * Sin `?pagina` ni `?limite` responde igual que siempre: hay pantallas que
 * esperan el objeto completo y romperlas por paginar no compensa.
 */
function responderRanking(res, req, tabla) {
  if (req.query.pagina === undefined && req.query.limite === undefined) {
    return res.json(tabla);
  }

  const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const limite = Math.min(100, Math.max(1, Number.parseInt(req.query.limite, 10) || 25));

  const jugadores = Object.entries(tabla)
    .map(([jugador, puntos]) => ({ jugador, ...puntos }))
    .sort((a, b) => b.total - a.total || a.jugador.localeCompare(b.jugador));

  const totalPaginas = Math.max(1, Math.ceil(jugadores.length / limite));
  const paginaFinal = Math.min(pagina, totalPaginas);
  const inicio = (paginaFinal - 1) * limite;

  return res.json({
    jugadores: jugadores.slice(inicio, inicio + limite),
    pagina: paginaFinal,
    limite,
    totalJugadores: jugadores.length,
    totalPaginas
  });
}

/* ==================== Las rutas ==================== */

module.exports = function rutasDePuntuacion(app, { requireAdmin, enQuiniela }) {

  const esAdmin = req => ['propietario', 'admin'].includes(req.membresia.rol);

  /** El nombre de quien pide. Hace falta para saber qué es «lo propio». */
  async function miNombre(req) {
    const usuario = await usuariosMod.porId(req.session.usuarioId);
    return usuario?.username ?? null;
  }

  /**
   * Los pronósticos de un jugador en una jornada, ya tapados si toca.
   *
   * `deJugador` devuelve una entrada por partido con `bloqueado` puesto, que es
   * exactamente «este partido ya empezó». Reutilizarlo es lo que mantiene la
   * regla de privacidad en un solo sitio.
   */
  function taparAjenos(filas, puedeVerloTodo) {
    return filas.map(fila => (puedeVerloTodo || fila.bloqueado)
      ? fila
      : { ...fila, marcador1: null, marcador2: null, oculto: true });
  }

  /* ---------- Pronósticos ---------- */

  /*
   * La tabla de todos contra todos. Antes se omitía la fila entera de las
   * jornadas no cerradas; ahora la fila viaja siempre y lo que se tapa son los
   * partidos que aún no han empezado. De otro modo, en una jornada a medias no
   * se podría ver NADA, ni siquiera los partidos ya jugados.
   */
  app.get('/api/resultados', async (req, res) => {
    const yo = await miNombre(req);
    const todo = esAdmin(req);
    const soloJornada = req.query.jornada ? String(req.query.jornada) : null;

    const filas = await pronosticosMod.tabla(req.quiniela.id, soloJornada);

    res.json(filas.map(({ jugador, jornada, filas: pronosticos }) => [
      `${jugador}_${jornada}`,
      taparAjenos(pronosticos, todo || jugador === yo)
    ]));
  });

  app.post('/api/resultados', async (req, res) => {
    const { jugador, jornada, pronosticos } = req.body;

    const yo = await miNombre(req);
    if (!yo || jugador !== yo) {
      return res.status(403).json({ success: false, error: 'Solo puedes guardar tus propios pronósticos.' });
    }
    if (req.quiniela.estado !== 'activa' || req.membresia.estado !== 'activo') {
      return res.status(409).json({
        success: false,
        error: 'La quiniela o tu membresía no permiten nuevos pronósticos.'
      });
    }
    if (!jornada || !Array.isArray(pronosticos)) {
      return res.status(400).json({ success: false, error: 'Datos inválidos.' });
    }

    const r = await enQuiniela(req, async () => {
      const guardado = await pronosticosMod.guardar(req.quiniela.id, {
        jugador, usuarioId: req.session.usuarioId, jornada, pronosticos
      });
      /*
       * Un pronóstico nuevo en una jornada ya congelada la obliga a
       * recalcularse: si no, el jugador vería su marcador acertado y sus
       * puntos sin moverse.
       */
      if (guardado.ok) await rankingMod.actualizar(req.quiniela.id, jornada, req.puntuacion);
      return guardado;
    });

    if (r.ok === false) return res.status(404).json({ success: false, error: 'Jornada no encontrada.' });

    invalidarCacheRanking(req.quiniela.id);
    res.json({ success: true, guardados: r.guardados, bloqueados: r.bloqueados });
  });

  app.get('/api/resultados/:jugador/:jornada', async (req, res) => {
    const { jugador, jornada } = req.params;
    const yo = await miNombre(req);

    const filas = await pronosticosMod.deJugador(req.quiniela.id, jugador, jornada);
    if (!filas) return res.json([]);

    res.json(taparAjenos(filas, esAdmin(req) || yo === jugador));
  });

  /*
   * La misma información con los equipos delante, para las pantallas que
   * pintan la jornada entera. Lo que no se puede ver llega en `''` y no en
   * `null` porque estas pantallas lo escriben directo en una casilla.
   */
  app.get('/api/resultados-con-equipos/:jugador/:jornada', async (req, res) => {
    const { jugador, jornada } = req.params;
    const yo = await miNombre(req);

    const filas = await pronosticosMod.deJugador(req.quiniela.id, jugador, jornada);
    if (!filas || !filas.length) return res.status(404).json({ error: 'Datos no encontrados' });

    const todo = esAdmin(req) || yo === jugador;

    res.json(filas.map(fila => {
      const visible = todo || fila.bloqueado;
      return {
        equipo1: fila.equipo1,
        equipo2: fila.equipo2,
        marcador1: visible ? (fila.marcador1 ?? '') : '',
        marcador2: visible ? (fila.marcador2 ?? '') : '',
        oculto: !visible
      };
    }));
  });

  /*
   * La pantalla que se usa en el móvil de uno delante de los demás.
   *
   * ⚠️ Aquí vivía una puerta abierta: una rama «jornada sin fecha» saltaba a la
   * vez la comprobación de identidad Y la de contraseña, así que una jornada a
   * la que se le olvidó la fecha dejaba a cualquiera leer lo de cualquiera. El
   * permiso ya no depende de un campo que se puede olvidar poner, sino de si el
   * partido empezó.
   *
   * La contraseña sigue protegiendo lo PROPIO, que es para lo que estaba. Para
   * lo ajeno no hace falta pedir nada, porque sólo se entrega lo visible.
   */
  app.post('/api/resultados-seguros/:jugador/:jornada', async (req, res) => {
    const { jugador, jornada } = req.params;
    const { password } = req.body || {};

    const filas = await pronosticosMod.deJugador(req.quiniela.id, jugador, jornada);
    if (!filas) return res.status(404).json({ error: 'Jornada no encontrada' });
    if (!filas.length) return res.status(404).json({ error: 'Resultados no encontrados' });

    const yo = await miNombre(req);
    const esElPropio = yo === jugador;

    if (esElPropio) {
      if (!password) return res.json({ success: false, error: 'Contraseña requerida' });
      if (!(await usuariosMod.autenticar(jugador, String(password)))) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta.' });
      }
    }

    res.json({
      success: true,
      partidos: filas.map(fila => {
        const visible = esElPropio || fila.bloqueado;
        return {
          equipo1: fila.equipo1,
          equipo2: fila.equipo2,
          logoEquipo1: fila.logoEquipo1 || '',
          logoEquipo2: fila.logoEquipo2 || '',
          marcador1: visible ? (fila.marcador1 ?? '') : '',
          marcador2: visible ? (fila.marcador2 ?? '') : '',
          oculto: !visible
        };
      })
    });
  });

  /* ---------- Resultados oficiales ---------- */

  /*
   * M-26: `?jornada=…` acota a una. Quien pide esto casi siempre está mirando
   * una jornada concreta y luego filtraba en el navegador, después de haberse
   * traído todas las demás por la red.
   */
  app.get('/api/resultados-oficiales', async (req, res) => {
    const jornadas = req.query.jornada
      ? [{ nombre: String(req.query.jornada) }]
      : await jornadasMod.resumen(req.quiniela.id);

    const salida = [];
    for (const jornada of jornadas) {
      const doc = await oficialesMod.deJornada(req.quiniela.id, jornada.nombre);
      if (doc) salida.push({ nombre: doc.nombre, partidos: doc.partidos });
    }

    res.json(salida);
  });

  app.get('/api/resultados-oficiales/:jornada', async (req, res) => {
    const doc = await oficialesMod.deJornada(req.quiniela.id, req.params.jornada);
    if (!doc) return res.status(404).json({ error: 'Jornada no encontrada' });

    res.json({
      nombre: doc.nombre,
      partidos: doc.partidos.map(p => ({
        equipo1: p.equipo1,
        equipo2: p.equipo2,
        marcador1: p.marcador1 ?? '',
        marcador2: p.marcador2 ?? '',
        // ⚠️ El comodín sale del PARTIDO, no de una copia (Entrada 044).
        comodin: p.comodin
      }))
    });
  });

  app.post('/api/resultados-oficiales', requireAdmin, async (req, res) => {
    const jornada = String(req.body?.jornada || '').trim();
    const resultados = req.body?.resultados;

    if (!Array.isArray(resultados) || !resultados.length) {
      return res.status(400).json({ error: 'Debes enviar los resultados de la jornada.' });
    }

    const r = await enQuiniela(req, async () => {
      const guardado = await oficialesMod.guardarManual(
        req.quiniela.id, jornada, resultados, normalizarMarcador);
      // Carga manual: bloquea los partidos, así que suele cerrar la jornada.
      if (guardado.ok) await rankingMod.actualizar(req.quiniela.id, jornada, req.puntuacion);
      return guardado;
    });

    if (r.ok === false) return res.status(404).json({ error: 'Jornada no encontrada.' });

    invalidarCacheRanking(req.quiniela.id);

    const todas = await jornadasMod.resumen(req.quiniela.id);
    const salida = [];
    for (const j of todas) {
      const doc = await oficialesMod.deJornada(req.quiniela.id, j.nombre);
      if (doc) salida.push({ nombre: doc.nombre, partidos: doc.partidos });
    }
    res.json(salida);
  });

  /* ---------- Las dos tablas ---------- */

  app.get('/api/clasificacion-jornada', async (req, res) => {
    const { sugerida, jornadas } = await jornadasMod.actual(req.quiniela.id);
    if (!jornadas.length) {
      return res.json({ jornadas: [], jornada: null, estado: null, clasificacion: [] });
    }

    const nombre = String(req.query.jornada || sugerida || jornadas[0].nombre);
    if (!jornadas.some(j => j.nombre === nombre)) {
      return res.status(404).json({ error: 'Jornada no encontrada.' });
    }

    const tabla = await rankingMod.clasificacionDeJornada(req.quiniela.id, nombre, {
      puntuacionActual: req.puntuacion,
      incluirExpulsados: req.quiniela.configuracion?.incluirExpulsadosEnRanking !== false
    });

    res.json({
      jornadas: jornadas.map(j => ({ nombre: j.nombre })),
      jornada: tabla.jornada,
      estado: tabla.estado,
      clasificacion: tabla.clasificacion
    });
  });

  /*
   * La tabla de posiciones. Las jornadas terminadas aportan un número ya
   * guardado; sólo las que siguen vivas se calculan. Es lo que quitó C-03:
   * antes se leían seis colecciones enteras y se recalculaba el histórico en
   * CADA petición, así que veinte personas abriendo la tabla al terminar una
   * jornada eran veinte recálculos completos simultáneos.
   */
  app.get('/api/resultados-totales', async (req, res) => {
    const cacheado = leerCacheRanking(req.quiniela.id);
    if (cacheado) return responderRanking(res, req, cacheado);

    const { tabla } = await rankingMod.tablaGeneral(req.quiniela.id, {
      puntuacionActual: req.puntuacion,
      incluirExpulsados: req.quiniela.configuracion?.incluirExpulsadosEnRanking !== false
    });

    guardarCacheRanking(req.quiniela.id, tabla);
    return responderRanking(res, req, tabla);
  });
};

module.exports.invalidarCacheRanking = invalidarCacheRanking;
module.exports.leerCacheRanking = leerCacheRanking;
module.exports.TTL_CACHE_RANKING_MS = TTL_CACHE_RANKING_MS;

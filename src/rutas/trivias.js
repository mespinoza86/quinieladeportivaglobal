/*
 * Rutas de trivias: las ocho preguntas por partido, sus respuestas y su
 * resolución.
 *
 * ============================================================================
 * LAS TRIVIAS SE PUEDEN APAGAR, Y HAY QUE MIRARLO EN LOS DOS EXTREMOS
 * ============================================================================
 *
 * `configuracion.puntuacion.triviasHabilitadas` decide si esta quiniela juega
 * con trivias. Se comprueba al **crearlas** y al **responderlas**, no sólo en
 * uno de los dos sitios: apagarlas con preguntas ya publicadas dejaría a la
 * gente respondiendo a algo que nadie va a puntuar.
 *
 * ============================================================================
 * DE DÓNDE SALE EL EVENTO PARA RESOLVER
 * ============================================================================
 *
 * ⚠️ De la **caché compartida de partidos**, no del proveedor. Resolver diez
 * trivias del mismo partido no puede costar diez llamadas al API: el ciclo de
 * sincronización ya guardó el evento crudo en `fixtures.evento`, y de ahí se
 * lee. Es la misma razón por la que existe esa caché (C-01).
 *
 * Si el partido nunca se sincronizó no hay evento, y la trivia se queda
 * pendiente para el pase siguiente en vez de resolverse en falso.
 */
'use strict';

const triviasMod = require('../trivias');
const respuestasMod = require('../respuestas-trivia');
const fixturesMod = require('../fixtures');
const eventosMod = require('../eventos');
const usuariosMod = require('../usuarios');
const { invalidarCacheRanking } = require('./puntuacion');

module.exports = function rutasDeTrivias(app, { requireAdmin, enQuiniela }) {

  const esAdmin = req => ['propietario', 'admin'].includes(req.membresia.rol);
  const triviasActivadas = req => req.puntuacion?.triviasHabilitadas !== false;

  async function miNombre(req) {
    const usuario = await usuariosMod.porId(req.session.usuarioId);
    return usuario?.username ?? null;
  }

  /* ---------- El catálogo de preguntas ---------- */

  app.get('/api/tipos-trivia', (req, res) => {
    res.json(Object.entries(triviasMod.TIPOS_TRIVIA)
      .map(([tipo, { pregunta }]) => ({ tipo, pregunta })));
  });

  /* ---------- Administración ---------- */

  app.post('/api/admin/trivias', requireAdmin, async (req, res) => {
    if (!triviasActivadas(req)) {
      return res.status(409).json({ error: 'Habilita las trivias en la configuración de la quiniela.' });
    }

    const { jornadaNombre, partidoIndex, tipos, fechaCierre } = req.body;
    if (!jornadaNombre || partidoIndex === undefined || !Array.isArray(tipos) || !tipos.length || !fechaCierre) {
      return res.status(400).json({ error: 'Faltan datos para crear las trivias.' });
    }

    const r = await triviasMod.crear(req.quiniela.id, {
      jornadaNombre,
      partidoIndex,
      tipos,
      fechaCierre: new Date(fechaCierre),
      puntos: req.puntuacion.puntosTriviaDefault ?? 1
    });

    if (r.motivo === 'jornada_no_encontrada') return res.status(404).json({ error: 'Jornada no encontrada.' });
    if (r.motivo === 'partido_no_encontrado') return res.status(404).json({ error: 'Partido no encontrado.' });

    res.json({ mensaje: 'Trivias creadas correctamente.', creadas: r.creadas });
  });

  app.get('/api/admin/trivias/:jornadaNombre', requireAdmin, async (req, res) => {
    res.json(await triviasMod.deJornada(req.quiniela.id, req.params.jornadaNombre));
  });

  /*
   * Deja las trivias de una jornada exactamente como dice la configuración que
   * llega: crea las que faltan, borra las que sobran y mueve la fecha.
   *
   * ⚠️ Todo va en una transacción. A medias quedaban respuestas de jugadores
   * huérfanas de trivias ya borradas, que seguían sumando puntos en el ranking
   * sin pregunta a la que corresponder.
   */
  app.put('/api/admin/trivias/:jornadaNombre', requireAdmin, async (req, res) => {
    const { fechaCierre, configuracion } = req.body;
    if (!fechaCierre || !Array.isArray(configuracion)) {
      return res.status(400).json({ error: 'Datos inválidos para actualizar trivias.' });
    }

    const r = await triviasMod.reconciliar(req.quiniela.id, {
      jornadaNombre: req.params.jornadaNombre,
      configuracion,
      fechaCierre: new Date(fechaCierre),
      puntos: req.puntuacion.puntosTriviaDefault ?? 1
    });

    if (r.motivo === 'jornada_no_encontrada') return res.status(404).json({ error: 'Jornada no encontrada.' });

    // Esta ruta acaba de borrar puntos o de ponerlos a cero.
    invalidarCacheRanking(req.quiniela.id);

    res.json({
      mensaje: `Cambios guardados. Creadas: ${r.creadas}, actualizadas: ${r.actualizadas}, eliminadas: ${r.eliminadas}.`,
      creadas: r.creadas,
      actualizadas: r.actualizadas,
      eliminadas: r.eliminadas
    });
  });

  app.delete('/api/admin/trivias/:triviaId', requireAdmin, async (req, res) => {
    const r = await triviasMod.eliminar(req.quiniela.id, req.params.triviaId);
    if (!r.ok) return res.status(404).json({ error: 'Trivia no encontrada.' });

    invalidarCacheRanking(req.quiniela.id);
    res.json({ mensaje: 'Trivia eliminada correctamente. También se eliminaron sus respuestas y puntos.' });
  });

  app.post('/api/admin/trivias/resolver', requireAdmin, async (req, res) => {
    const r = await triviasMod.resolverPendientes(req.quiniela.id, {
      obtenerEvento: apiFixtureId => fixturesMod.eventoDe(apiFixtureId),
      interpretar: eventosMod.resolverRespuestaTrivia
    });

    if (r.puntosActualizados) invalidarCacheRanking(req.quiniela.id);

    res.json({ mensaje: 'Trivias resueltas correctamente.', resueltas: r.resueltas });
  });

  /* ---------- Consulta ---------- */

  app.get('/api/trivias', async (req, res) => {
    res.json(await triviasMod.activas(req.quiniela.id));
  });

  /*
   * Las que todavía admiten respuesta. ⚠️ Va antes que `/:jornadaNombre` porque
   * si no, Express tomaría «activas» por el nombre de una jornada.
   */
  app.get('/api/trivias/activas', async (req, res) => {
    res.json(await triviasMod.abiertas(req.quiniela.id));
  });

  app.get('/api/trivias/latest', async (req, res) => {
    res.json(await triviasMod.ultima(req.quiniela.id));
  });

  app.get('/api/trivias/:jornadaNombre', async (req, res) => {
    res.json(await triviasMod.deJornada(req.quiniela.id, req.params.jornadaNombre));
  });

  app.get('/api/trivias-jornadas', async (req, res) => {
    const nombres = await triviasMod.jornadasConTrivias(req.quiniela.id);

    const salida = [];
    for (const nombre of nombres) {
      const [primera] = await triviasMod.deJornada(req.quiniela.id, nombre);
      if (!primera) continue;
      salida.push({
        jornadaNombre: nombre,
        fechaCierre: primera.fechaCierre,
        cerrada: primera.fechaCierre ? new Date(primera.fechaCierre) <= new Date() : false
      });
    }

    res.json(salida);
  });

  /* ---------- Respuestas ---------- */

  app.get('/api/respuestas-trivia/:jugador/:jornadaNombre', async (req, res) => {
    const { jugador, jornadaNombre } = req.params;
    const yo = await miNombre(req);

    res.json(await respuestasMod.deJugador(req.quiniela.id, jugador, jornadaNombre, {
      puedeVerTodo: esAdmin(req) || yo === jugador
    }));
  });

  app.post('/api/respuestas-trivia', async (req, res) => {
    const { jugador, respuestas } = req.body;

    const yo = await miNombre(req);
    if (!yo || jugador !== yo) {
      return res.status(403).json({ error: 'Solo puedes guardar tus propias respuestas.' });
    }
    if (!triviasActivadas(req)) {
      return res.status(409).json({ error: 'Las trivias están deshabilitadas en esta quiniela.' });
    }
    if (!Array.isArray(respuestas)) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const r = await respuestasMod.guardar(req.quiniela.id, {
      jugador, usuarioId: req.session.usuarioId, respuestas
    });

    invalidarCacheRanking(req.quiniela.id);

    res.json({
      mensaje: 'Respuestas de trivia guardadas correctamente.',
      guardadas: r.guardadas,
      cerradas: r.cerradas,
      desconocidas: r.desconocidas
    });
  });

  /*
   * Los resultados de todos, que es lo que se enseña al terminar la jornada.
   *
   * ⚠️ Antes del cierre sólo lo ve un administrador: es la tabla que dice qué
   * respondió cada quien, y publicarla con la jornada abierta sería regalar las
   * respuestas.
   */
  app.get('/api/resultados-trivias/:jornadaNombre', async (req, res) => {
    const datos = await respuestasMod.deJornada(req.quiniela.id, req.params.jornadaNombre);

    if (!datos.trivias.length) {
      return res.json({ jornadaNombre: req.params.jornadaNombre, cerrada: false, trivias: [] });
    }

    if (!datos.cerrada && !esAdmin(req)) {
      return res.status(403).json({
        error: 'Los resultados de trivias estarán disponibles después del cierre.'
      });
    }

    res.json(datos);
  });
};

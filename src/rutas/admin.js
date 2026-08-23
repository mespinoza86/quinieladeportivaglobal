/*
 * Rutas de administración, sincronizador, proveedor y depuración.
 *
 * ============================================================================
 * LAS DE `/api/football/*` SON LAS ÚNICAS QUE SALEN A LA RED
 * ============================================================================
 *
 * Todo lo demás del sistema lee de la base o de la caché de partidos. Estas tres
 * hablan con APIFootball en directo, y por eso son las únicas que pueden fallar
 * por cuota, por red o por una clave mal puesta. Cuando falta la clave responden
 * un 500 con el motivo, no un error críptico.
 *
 * ============================================================================
 * ⚠️ `/api/debug/*` NO EXISTE SIN SU BANDERA
 * ============================================================================
 *
 * Estos endpoints exponen respuestas crudas del proveedor y volcados de
 * jornadas. Con `DEBUG_ENDPOINTS` apagado responden **404, no 403**: así ni
 * siquiera revelan que la ruta existe.
 */
'use strict';

const proveedor = require('../proveedor');
const eventos = require('../eventos');
const fixtures = require('../fixtures');
const sincronizador = require('../sincronizador');
const planificador = require('../planificador');
const jornadasMod = require('../jornadas');
const triviasMod = require('../trivias');
const respuestasMod = require('../respuestas-trivia');
const pronosticosMod = require('../pronosticos');
const rankingMod = require('../ranking');
const cerrojos = require('../cerrojos');
const { normalizarMarcador } = require('../validacion');
const ligas = require('../ligas');
const { invalidarCacheRanking } = require('./puntuacion');

/*
 * Los endpoints de depuración se apagan con una variable de entorno. Se lee al
 * arrancar y no en cada petición: encenderlos en caliente no es algo que se
 * quiera poder hacer.
 */
const DEPURACION_HABILITADA = process.env.DEBUG_ENDPOINTS === 'true';

function requireDebug(req, res, next) {
  if (!DEPURACION_HABILITADA) return res.status(404).json({ error: 'No encontrado.' });
  return next();
}

function sinClave(res) {
  return res.status(500).json({ error: 'Falta configurar APIFOOTBALL_COM_KEY en el .env' });
}

module.exports = function rutasDeAdmin(app, { requireAdmin, enQuiniela }) {

  /* ==================== El proveedor, en directo ==================== */

  /**
   * Los partidos de un rango de fechas, para armar una jornada.
   *
   * ⚠️ Las competiciones bloqueadas —sub-20, reservas, femenil— se descartan
   * AQUÍ y no en el navegador, donde vivía la lista hasta la Fase C. Antes el
   * filtro sólo se aplicaba si había un torneo elegido: con «todos los torneos»
   * se colaban igual.
   */
  app.get('/api/football/fixtures', async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);

    const { date, from, to, league } = req.query;
    const desde = from || date;
    const hasta = to || date;

    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Debe enviar date=YYYY-MM-DD o from/to' });
    }

    const partidos = await proveedor.porRango({ desde, hasta, ligaId: league });
    res.json(partidos.filter(p => !ligas.esLigaNoPermitida(p.liga)));
  });

  /*
   * El buscador de ligas de la Fase C. Se apoya en una caché en memoria porque
   * quien arma una jornada abre esta pantalla varias veces seguidas, y cada
   * apertura consultaría el rango entero otra vez.
   */
  app.get('/api/football/ligas-disponibles', requireAdmin, async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);

    const rango = ligas.rangoDeBusqueda({ desde: req.query.desde, dias: req.query.dias });
    const clave = `${rango.desde}|${rango.hasta}`;

    /*
     * ⚠️ Las favoritas se aplican DESPUÉS de la caché, nunca antes de guardarla.
     *
     * La caché tiene por clave el rango de fechas y nada más, a propósito: dos
     * quinielas que sigan los mismos días comparten la consulta al proveedor, y
     * ahí está el ahorro de cuota. Guardar la versión ya ordenada le serviría a
     * la quiniela siguiente los favoritos de la anterior. Lo que se guarda es
     * lo que el proveedor dijo; el orden es de cada quiniela.
     */
    const favoritas = req.quiniela?.configuracion?.ligasFavoritas;

    const enCache = proveedor.leerCacheLigas(clave);
    if (enCache) return res.json({ ...ligas.aplicarFavoritas(enCache, favoritas), deCache: true });

    const partidos = await proveedor.porRango({ desde: rango.desde, hasta: rango.hasta });

    const respuesta = {
      desde: rango.desde,
      hasta: rango.hasta,
      dias: rango.dias,
      partidos: partidos.length,
      paises: ligas.agruparLigasPorPais(partidos)
    };

    proveedor.guardarCacheLigas(clave, respuesta);
    res.json({ ...ligas.aplicarFavoritas(respuesta, favoritas), deCache: false });
  });

  app.get('/api/football/leagues', async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);
    res.json(await proveedor.ligas());
  });

  /* ==================== Sincronización a mano ==================== */

  /**
   * Sincroniza UNA jornada ahora mismo.
   *
   * ⚠️ Se salta las ventanas de consulta a propósito (`forzar`): es una petición
   * explícita de un administrador que está mirando la pantalla, no el reloj.
   */
  app.post('/api/sync-resultados-oficiales/:jornada', requireAdmin, async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);

    const jornada = req.params.jornada;

    const existe = await jornadasMod.porNombre(req.quiniela.id, jornada);
    if (!existe) return res.status(404).json({ error: 'Jornada no encontrada' });

    const catalogo = new Map();
    for (const partido of existe.partidos) {
      const clave = fixtures.claveDeFixture(partido);
      if (clave && !catalogo.has(clave)) {
        catalogo.set(clave, fixtures.descriptorDeFixture(clave, partido));
      }
    }

    await sincronizador.refrescarPendientes(catalogo, {
      consultar: d => proveedor.buscarEvento(d, sincronizador.metricas),
      forzar: true
    });

    await sincronizador.reescribirJornadaDesdeCache(req.quiniela.id, jornada);
    invalidarCacheRanking(req.quiniela.id);

    const oficiales = await require('../oficiales').deJornada(req.quiniela.id, jornada);
    res.json({ success: true, jornada, resultados: oficiales.partidos });
  });

  /* ==================== Administración ==================== */

  /**
   * Carga los pronósticos de otra persona. Es el «modo admin» de las pantallas
   * de captura, para cuando alguien manda su quiniela por otro medio.
   *
   * ⚠️ A diferencia de `POST /api/resultados`, **no aplica el cierre por
   * partido**: un administrador está transcribiendo lo que ya recibió, y a
   * menudo lo hace con la jornada empezada. Por eso exige `requireAdmin`.
   */
  app.post('/api/admin/resultados', requireAdmin, async (req, res) => {
    const { jugador, jornada, pronosticos } = req.body;

    if (!jugador || !jornada || !Array.isArray(pronosticos)) {
      return res.status(400).json({ success: false, error: 'Datos inválidos.' });
    }

    const r = await enQuiniela(req, async cliente => {
      const jornadaId = await pronosticosMod.jornadaIdDe(cliente, jornada);
      if (!jornadaId) return { ok: false };

      const partidos = await pronosticosMod.partidosDe(cliente, jornadaId);
      const jugadorId = await require('../jugadores').asegurar(cliente, req.quiniela.id, jugador);

      const { rows: [resultado] } = await cliente.query(
        `INSERT INTO resultados (quiniela_id, jornada_id, jugador_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (quiniela_id, jugador_id, jornada_id)
           DO UPDATE SET jornada_id = EXCLUDED.jornada_id
         RETURNING id`,
        [req.quiniela.id, jornadaId, jugadorId]);

      for (let i = 0; i < partidos.length; i++) {
        const enviado = pronosticos[i] || {};
        await cliente.query(
          `INSERT INTO pronosticos (quiniela_id, resultado_id, partido_id, marcador1, marcador2)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (resultado_id, partido_id)
             DO UPDATE SET marcador1 = EXCLUDED.marcador1, marcador2 = EXCLUDED.marcador2`,
          [req.quiniela.id, resultado.id, partidos[i].id,
            normalizarMarcador(enviado.marcador1, `El marcador local del partido ${i + 1}`),
            normalizarMarcador(enviado.marcador2, `El marcador visitante del partido ${i + 1}`)]);
      }

      // Si la jornada ya estaba congelada, esto la obliga a recalcular.
      await rankingMod.actualizar(req.quiniela.id, jornada, req.puntuacion);
      return { ok: true };
    });

    if (!r.ok) return res.status(404).json({ success: false, error: 'Jornada no encontrada.' });

    invalidarCacheRanking(req.quiniela.id);
    res.json({ success: true, mensaje: 'Resultados guardados correctamente desde modo admin.' });
  });

  /** Las trivias de una jornada con TODAS las respuestas, para revisarlas. */
  app.get('/api/admin/respuestas-trivias-jornada/:jornadaNombre', requireAdmin, async (req, res) => {
    const { jornadaNombre } = req.params;
    const datos = await respuestasMod.deJornada(req.quiniela.id, jornadaNombre);

    res.json({
      jornadaNombre,
      trivias: await triviasMod.deJornada(req.quiniela.id, jornadaNombre),
      respuestas: datos.trivias.flatMap(t =>
        t.respuestas.map(r => ({ triviaId: t.id, ...r })))
    });
  });

  /**
   * Consumo del proveedor y salud del planificador.
   *
   * ⚠️ `consultasAhorradasPorDeduplicacion` es LA métrica que hay que vigilar
   * cuando haya tráfico: debe crecer en cuanto haya dos quinielas siguiendo los
   * mismos partidos. Si se queda en cero, la deduplicación no está funcionando y
   * la cuota se está gastando de más sin que nada falle.
   */
  app.get('/api/admin/sync-metricas', requireAdmin, async (req, res) => {
    res.json({
      ...sincronizador.metricas,
      cerrojo: await cerrojos.estado(sincronizador.CERROJO_SYNC),
      configuracion: {
        intervaloCicloMs: planificador.INTERVALO_CICLO_SYNC_MS,
        concurrenciaMaxima: sincronizador.CONCURRENCIA_MAXIMA_API,
        ttlCerrojoMs: sincronizador.TTL_CERROJO_SYNC_MS,
        timeoutCicloMs: sincronizador.TIMEOUT_CICLO_SYNC_MS,
        timeoutProveedorMs: proveedor.TIMEOUT_MS,
        ventanasMs: fixtures.VENTANAS_MS,
        trabajosHabilitados: planificador.JOBS_HABILITADOS
      },
      instancia: cerrojos.ID_INSTANCIA
    });
  });

  /* ==================== Depuración ==================== */

  /** Qué estado deduce el sistema de un `match_status` cualquiera. */
  app.get('/api/debug/estado-partido/:status', requireDebug, requireAdmin, (req, res) => {
    const fixture = { match_status: req.params.status, match_live: req.query.live || '' };
    res.json({ fixture, resultado: eventos.obtenerEstadoPartido(fixture, {}) });
  });

  app.get('/api/debug/api-football-match/:matchId', requireDebug, requireAdmin, async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);

    const evento = await proveedor.porId(req.params.matchId);
    res.json({
      matchId: req.params.matchId,
      encontrado: Boolean(evento),
      data: evento
    });
  });

  app.get('/api/debug/jornadas', requireDebug, requireAdmin, async (req, res) => {
    res.json(await jornadasMod.listar(req.quiniela.id));
  });

  /** Los goles tal como los ve el resolutor de trivias, para entender un fallo. */
  app.get('/debug/trivia-goles/:matchId', requireDebug, requireAdmin, async (req, res) => {
    const evento = await fixtures.eventoDe(req.params.matchId)
      || (proveedor.hayClave() ? await proveedor.porId(req.params.matchId) : null);

    if (!evento) return res.json({ mensaje: 'No se encontró el partido.' });

    res.json({
      goles: evento.goalscorer || [],
      estado: evento.match_status,
      home: evento.match_hometeam_name,
      away: evento.match_awayteam_name
    });
  });

  app.get('/api/admin/debug-partido-api/:matchId', requireDebug, requireAdmin, async (req, res) => {
    if (!proveedor.hayClave()) return sinClave(res);

    const evento = await proveedor.porId(req.params.matchId);
    if (!evento) {
      return res.status(404).json({
        error: 'APIFootball no devolvió evento para ese matchId.',
        matchId: req.params.matchId
      });
    }

    const estado = eventos.obtenerEstadoPartido(evento, {});

    res.json({
      matchId: req.params.matchId,
      estadoCalculado: estado,
      marcador: eventos.obtenerMarcador90Minutos(evento, estado),
      crudo: {
        match_status: evento.match_status,
        match_live: evento.match_live,
        hometeam: evento.match_hometeam_name,
        awayteam: evento.match_awayteam_name,
        score: `${evento.match_hometeam_score}-${evento.match_awayteam_score}`
      }
    });
  });
};

module.exports.DEPURACION_HABILITADA = DEPURACION_HABILITADA;

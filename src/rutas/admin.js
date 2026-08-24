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
const pagosMod = require('../pagos');
const cobros = require('../cobros');
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
   *
   * ⛔ EXIGE `requireAdmin`, y no es por los datos: **la cuota del proveedor es
   * una sola para todas las quinielas**. Sin la guardia, cualquier miembro de
   * cualquier quiniela podía pedir rangos de fechas en bucle y dejar al resto
   * sin poder armar jornadas. La ruta hermana —`ligas-disponibles`— sí la
   * llevaba desde el principio; ésta se quedó sin ella (Entrada 064).
   */
  app.get('/api/football/fixtures', requireAdmin, async (req, res) => {
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

  // Misma razón que la de arriba: sale a la red y gasta cuota compartida.
  app.get('/api/football/leagues', requireAdmin, async (req, res) => {
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

  /* ==================== Cobros ==================== */

  /*
   * ⚠️ TODO ESTO SÓLO INFORMA. Deber dinero no impide jugar, ni saca del
   * ranking, ni cierra ninguna pantalla. Bloquear es un cambio mucho mayor y
   * el día que se equivoque deja a alguien fuera a mitad de temporada por un
   * error de dedo. Si algún día se quiere, se añade encima de esto.
   */

  /** La cuenta de cada jugador: lo que debe del torneo y lo de las jornadas. */
  app.get('/api/cobros/cuentas', requireAdmin, async (req, res) => {
    res.json({
      cobros: cobros.normalizarCobros(req.quiniela.configuracion),
      cuentas: await pagosMod.cuentas(req.quiniela.id, req.quiniela.configuracion)
    });
  });

  /** El historial completo de abonos, para cuando hay que revisar una cuenta. */
  app.get('/api/cobros/abonos', requireAdmin, async (req, res) => {
    if (req.query.jugador && !cobros.esUuid(req.query.jugador)) {
      return res.status(400).json({ error: 'Ese jugador no es válido.' });
    }

    res.json(req.query.jugador
      ? await pagosMod.deJugador(req.quiniela.id, req.query.jugador)
      : await pagosMod.deQuiniela(req.quiniela.id));
  });

  /** Anota un abono. */
  app.post('/api/cobros/abonos', requireAdmin, async (req, res) => {
    const { jugadorId, concepto, monto, nota } = req.body || {};

    /*
     * ⚠️ Se comprueba la FORMA antes de consultar. Un identificador que no es
     * uuid hace que PostgreSQL rechace la consulta, y eso salía como 500
     * «error interno»: ni dice qué pasó ni deja el registro limpio, y cada
     * petición malformada escribe un error que puede tapar los de verdad.
     */
    if (!cobros.esUuid(jugadorId)) {
      return res.status(400).json({ error: 'Falta el jugador o no es válido.' });
    }
    if (!cobros.CONCEPTOS.includes(concepto)) {
      return res.status(400).json({ error: 'El concepto debe ser "torneo" o "jornada".' });
    }

    const cantidad = cobros.aMonto(monto);

    /*
     * ⚠️ Por aquí sólo entran abonos POSITIVOS. Un monto negativo es una
     * corrección, y las correcciones tienen su propia ruta para que queden
     * atadas al asiento que anulan. Dejar colar un negativo suelto daría un
     * historial en el que no se sabe qué corrige a qué.
     */
    if (!(cantidad > 0)) {
      return res.status(400).json({ error: 'El monto tiene que ser mayor que cero.' });
    }

    /*
     * Y un tope: `numeric(12,2)` se desborda con cifras absurdas y la consulta
     * revienta. Mejor un mensaje que un 500.
     */
    if (cantidad > cobros.MONTO_MAXIMO) {
      return res.status(400).json({
        error: `El monto no puede pasar de ${cobros.MONTO_MAXIMO.toLocaleString('es-CR')}.`
      });
    }

    const jugador = await pagosMod.cuentaDetallada(
      req.quiniela.id, jugadorId, req.quiniela.configuracion);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado.' });

    const pago = await pagosMod.registrar(req.quiniela.id, {
      jugadorId, concepto, monto: cantidad, nota,
      registradoPor: req.session.usuarioId
    });

    res.json({ success: true, pago });
  });

  /**
   * Corrige un abono mal anotado, con un asiento inverso.
   *
   * ⚠️ No se borra ni se edita. El día que alguien diga «yo sí pagué», la
   * discusión se resuelve mirando el historial, no la palabra de quien pudo
   * reescribirlo.
   */
  app.post('/api/cobros/abonos/:pagoId/anular', requireAdmin, async (req, res) => {
    if (!cobros.esUuid(req.params.pagoId)) {
      return res.status(400).json({ error: 'Ese abono no es válido.' });
    }

    const r = await pagosMod.anular(req.quiniela.id, req.params.pagoId, {
      registradoPor: req.session.usuarioId,
      nota: req.body?.nota
    });

    if (r.motivo === 'no-existe') return res.status(404).json({ error: 'Abono no encontrado.' });
    if (r.motivo === 'ya-anulado') {
      return res.status(409).json({ error: 'Ese abono ya estaba anulado.' });
    }
    if (r.motivo === 'es-una-anulacion') {
      return res.status(400).json({ error: 'Una corrección no se corrige: anota otro abono.' });
    }

    res.json({ success: true, inverso: r.inverso });
  });

  /** Si un jugador entra al torneo completo, y desde qué jornada se le cobra. */
  app.patch('/api/cobros/jugadores/:jugadorId', requireAdmin, async (req, res) => {
    if (!cobros.esUuid(req.params.jugadorId)) {
      return res.status(400).json({ error: 'Ese jugador no es válido.' });
    }

    const { juegaTorneo, cobrarDesde } = req.body || {};

    if (cobrarDesde !== undefined && cobrarDesde !== null && !(Number(cobrarDesde) >= 1)) {
      return res.status(400).json({ error: 'La jornada desde la que se cobra no es válida.' });
    }

    const j = await pagosMod.ajustarJugador(req.quiniela.id, req.params.jugadorId,
      { juegaTorneo, cobrarDesde });

    if (!j) return res.status(404).json({ error: 'Jugador no encontrado.' });
    res.json({ success: true, jugador: j });
  });

  /** Cambia lo que cuesta UNA jornada: la de finales vale más. */
  app.patch('/api/cobros/jornadas/:nombre/precio', requireAdmin, async (req, res) => {
    const precio = cobros.aMonto(req.body?.precio);
    if (!(precio >= 0)) return res.status(400).json({ error: 'El precio no puede ser negativo.' });
    if (precio > cobros.MONTO_MAXIMO) {
      return res.status(400).json({ error: 'El precio es demasiado alto.' });
    }

    const j = await require('../jornadas').cambiarPrecio(
      req.quiniela.id, req.params.nombre, precio);

    if (!j) return res.status(404).json({ error: 'Jornada no encontrada.' });
    res.json({ success: true, jornada: j });
  });
};

module.exports.DEPURACION_HABILITADA = DEPURACION_HABILITADA;

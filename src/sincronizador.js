/*
 * El ciclo de sincronización: UNO para todas las quinielas.
 *
 * ============================================================================
 * POR QUÉ UNO SOLO (C-01 y C-05)
 * ============================================================================
 *
 * Antes cada quiniela llamaba al proveedor por su cuenta, y el disparador era
 * el tráfico de los usuarios. Dos consecuencias, las dos malas:
 *
 *   - La cuota se multiplicaba por el número de quinielas, aunque siguieran los
 *     mismos partidos.
 *   - El ritmo dependía de quién estuviera mirando la pantalla, así que el
 *     domingo por la tarde —cuando más importa— era cuando más se repetía.
 *
 * Ahora hay un planificador propio, un cerrojo distribuido que impide que dos
 * instancias coincidan, y un catálogo que **colapsa los partidos repetidos
 * entre quinielas antes de preguntar**. Ésa es la métrica que hay que vigilar
 * cuando haya tráfico: `consultasAhorradasPorDeduplicacion`.
 *
 * ============================================================================
 * EL CENSO SE HACE QUINIELA POR QUINIELA, Y NO ES POR GUSTO
 * ============================================================================
 *
 * ⚠️ Podría leerse todo de una vez —sería más corto— pero ésa es justo la forma
 * del hallazgo C-02: una consulta global sobre una tabla de dominio que parece
 * inocente hasta que dos quinielas coinciden en el nombre de una jornada. Aquí
 * cada quiniela se recorre dentro de su propio `enQuiniela`, y es la base la
 * que impone el aislamiento.
 */
'use strict';

const db = require('./db');
const cerrojos = require('./cerrojos');
const fixturesMod = require('./fixtures');
const eventos = require('./eventos');
const oficialesMod = require('./oficiales');
const pronosticosMod = require('./pronosticos');
const rankingMod = require('./ranking');

const CERROJO_SYNC = 'sincronizacion-global';
const TTL_CERROJO_SYNC_MS = 5 * 60 * 1000;

/*
 * Menor que el TTL del cerrojo a propósito: cuando el siguiente ciclo llegue a
 * pedirlo, el del ciclo abandonado ya estará caducado o a punto.
 */
const TIMEOUT_CICLO_SYNC_MS = Number(process.env.SYNC_TIMEOUT_CICLO_MS || 4 * 60 * 1000);
const CONCURRENCIA_MAXIMA_API = Number(process.env.SYNC_CONCURRENCIA || 4);

const metricas = {
  ciclos: 0,
  ciclosOmitidosPorCerrojo: 0,
  ciclosAbandonadosPorTiempo: 0,
  llamadasApi: 0,
  erroresApi: 0,
  partidosSeguidos: 0,
  fixturesUnicos: 0,
  consultasEvitadasPorVentana: 0,
  consultasAhorradasPorDeduplicacion: 0,
  jornadasReescritas: 0,
  syncsSinCambioDePuntos: 0,
  ultimoCiclo: null,
  duracionUltimoCicloMs: null,
  ultimoError: ''
};

function reiniciarMetricas() {
  Object.assign(metricas, {
    ciclos: 0, ciclosOmitidosPorCerrojo: 0, ciclosAbandonadosPorTiempo: 0,
    llamadasApi: 0, erroresApi: 0, partidosSeguidos: 0, fixturesUnicos: 0,
    consultasEvitadasPorVentana: 0, consultasAhorradasPorDeduplicacion: 0,
    jornadasReescritas: 0, syncsSinCambioDePuntos: 0,
    ultimoCiclo: null, duracionUltimoCicloMs: null, ultimoError: ''
  });
}

/* ==================== Dos ayudantes que no dependen de nada ==================== */

/**
 * Deja de esperar una promesa pasado un plazo.
 *
 * No la cancela —en JavaScript no se puede— y no hace falta: lo que importa es
 * que quien esperaba recupere el control. La promesa original sigue teniendo un
 * manejador puesto por `Promise.race`, así que un fallo tardío no se convierte
 * en un rechazo sin gestionar.
 */
function conVigilante(promesa, ms, mensaje) {
  let temporizador;

  const vigilante = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => {
      const error = new Error(mensaje);
      error.esTiempoAgotado = true;
      rechazar(error);
    }, ms);

    // Un temporizador pendiente no debe impedir que el proceso termine.
    temporizador.unref?.();
  });

  return Promise.race([promesa, vigilante]).finally(() => clearTimeout(temporizador));
}

/**
 * Recorre `items` con un tope de tareas simultáneas.
 *
 * Es un limitador mínimo para no añadir una dependencia por diez líneas: sin
 * él, un ciclo con doscientos partidos abriría doscientas peticiones a la vez
 * contra el proveedor, que responde con limitación de tasa.
 */
async function conLimiteDeConcurrencia(items, limite, tarea) {
  const pendientes = [...items];
  const trabajadores = [];

  for (let i = 0; i < Math.max(1, limite); i += 1) {
    trabajadores.push((async () => {
      while (pendientes.length) await tarea(pendientes.shift());
    })());
  }

  await Promise.all(trabajadores);
}

/* ==================== El censo ==================== */

/**
 * Recorre las quinielas activas y devuelve el catálogo deduplicado de partidos
 * más la lista de qué jornada de qué quiniela usa qué claves.
 *
 * `consultasAhorradasPorDeduplicacion` es la diferencia entre los partidos
 * seguidos y las claves únicas: cada unidad es una llamada al proveedor que no
 * hizo falta hacer.
 */
async function censar() {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre FROM quinielas WHERE estado = 'activa'`);

  const catalogo = new Map();
  const trabajo = [];
  let partidosSeguidos = 0;

  for (const quiniela of quinielas) {
    await db.enQuiniela(quiniela.id, async c => {
      const { rows: partidos } = await c.query(
        `SELECT j.nombre AS jornada, p.equipo1, p.equipo2,
                p.api_fixture_id, p.api_league_id, p.api_date
           FROM partidos p JOIN jornadas j ON j.id = p.jornada_id
          ORDER BY j.secuencia, p.orden`);

      const porJornada = new Map();

      for (const partido of partidos) {
        const clave = fixturesMod.claveDeFixture(partido);
        if (!clave) continue;

        partidosSeguidos += 1;
        if (!porJornada.has(partido.jornada)) porJornada.set(partido.jornada, []);
        porJornada.get(partido.jornada).push(clave);

        if (!catalogo.has(clave)) {
          catalogo.set(clave, fixturesMod.descriptorDeFixture(clave, partido));
        }
      }

      for (const [jornada, claves] of porJornada) {
        trabajo.push({ quinielaId: quiniela.id, nombreQuiniela: quiniela.nombre, jornada, claves });
      }
    });
  }

  return { quinielas, catalogo, trabajo, partidosSeguidos };
}

/* ==================== El refresco ==================== */

/**
 * Refresca sólo los partidos a los que ya les toca, **una vez cada uno**.
 *
 * Devuelve el conjunto de claves que trajeron datos nuevos: sin datos nuevos no
 * hay nada que reescribir, porque el resultado sería idéntico.
 */
async function refrescarPendientes(catalogo, { consultar, ahora = new Date(), forzar = false } = {}) {
  const claves = [...catalogo.keys()];
  if (!claves.length) return new Set();

  const previos = await fixturesMod.porClaves(claves);
  const pendientes = [];

  for (const clave of claves) {
    const previo = previos.get(clave) || null;

    if (!fixturesMod.tocaConsultar(previo, ahora, forzar)) {
      metricas.consultasEvitadasPorVentana += 1;
      continue;
    }

    pendientes.push({ ...catalogo.get(clave), previo });
  }

  const refrescadas = new Set();

  await conLimiteDeConcurrencia(pendientes, CONCURRENCIA_MAXIMA_API, async descriptor => {
    let evento = null;
    let error = null;

    try {
      metricas.llamadasApi += 1;
      evento = await consultar(descriptor);
    } catch (err) {
      error = err?.message || String(err);
      metricas.erroresApi += 1;
    }

    try {
      const huboDatos = await fixturesMod.guardar(descriptor, {
        evento, error, previo: descriptor.previo, ahora
      });
      if (huboDatos) refrescadas.add(descriptor.clave);
    } catch (err) {
      console.error(`Error guardando el partido ${descriptor.clave}:`, err.message);
    }
  });

  return refrescadas;
}

/* ==================== El ciclo ==================== */

let contadorDeCiclos = 0;
let cicloEnCurso = false;

/**
 * Un ciclo completo.
 *
 * `consultar` habla con el proveedor y `reescribirJornada` vuelca la caché en
 * los resultados oficiales de una quiniela. Los dos llegan de fuera: es la
 * costura por la que las pruebas ejercitan el ciclo entero **sin red y sin
 * cuota**. Sin ella, en la práctica no se probaría.
 */
async function ejecutarCiclo({ consultar, reescribirJornada, ahora = new Date() }) {
  const arranque = Date.now();

  /*
   * Testigo propio de este ciclo. Ver `cerrojos.soltar()`: sin él, un ciclo que
   * el vigilante dio por perdido podría soltar, al terminar tarde, el cerrojo
   * que ya tiene el ciclo siguiente.
   */
  const titular = `${cerrojos.ID_INSTANCIA}#${++contadorDeCiclos}`;

  if (!(await cerrojos.tomar(CERROJO_SYNC, TTL_CERROJO_SYNC_MS, ahora, titular))) {
    metricas.ciclosOmitidosPorCerrojo += 1;
    return { omitido: true, motivo: 'cerrojo en poder de otra instancia' };
  }

  try {
    const { quinielas, catalogo, trabajo, partidosSeguidos } = await censar();

    metricas.consultasAhorradasPorDeduplicacion += Math.max(0, partidosSeguidos - catalogo.size);

    const refrescadas = await refrescarPendientes(catalogo, { consultar, ahora });

    let jornadasReescritas = 0;

    for (const item of trabajo) {
      // Sin datos nuevos no hay nada que reescribir.
      if (!item.claves.some(clave => refrescadas.has(clave))) continue;

      try {
        await reescribirJornada(item.quinielaId, item.jornada);
        jornadasReescritas += 1;
      } catch (error) {
        console.error(
          `Error sincronizando "${item.jornada}" de "${item.nombreQuiniela}":`, error.message);
      }
    }

    metricas.ciclos += 1;
    metricas.partidosSeguidos = partidosSeguidos;
    metricas.fixturesUnicos = catalogo.size;
    metricas.jornadasReescritas += jornadasReescritas;
    metricas.ultimoCiclo = new Date().toISOString();
    metricas.duracionUltimoCicloMs = Date.now() - arranque;

    return {
      omitido: false,
      quinielas: quinielas.length,
      partidosSeguidos,
      fixturesUnicos: catalogo.size,
      fixturesRefrescados: refrescadas.size,
      jornadasReescritas,
      duracionMs: metricas.duracionUltimoCicloMs
    };
  } finally {
    await cerrojos.soltar(CERROJO_SYNC, titular).catch(error => {
      console.error('Error soltando el cerrojo de sincronización:', error.message);
    });
  }
}

/**
 * Lo que llama el planificador.
 *
 * ⚠️ Guarda local **además** del cerrojo distribuido, y hacen cosas distintas:
 * el cerrojo evita que dos procesos coincidan; `cicloEnCurso` evita que un
 * ciclo lento se solape consigo mismo dentro del mismo proceso.
 */
async function tick(opciones) {
  if (cicloEnCurso) return { omitido: true, motivo: 'ya hay un ciclo en curso' };

  cicloEnCurso = true;

  try {
    return await conVigilante(
      ejecutarCiclo(opciones),
      TIMEOUT_CICLO_SYNC_MS,
      `El ciclo de sincronización superó ${TIMEOUT_CICLO_SYNC_MS} ms y se abandonó.`);
  } catch (error) {
    if (error?.esTiempoAgotado) metricas.ciclosAbandonadosPorTiempo += 1;
    metricas.ultimoError = error.message;
    console.error('Error en el ciclo de sincronización:', error.message);
    return { omitido: true, motivo: error.message };
  } finally {
    cicloEnCurso = false;
  }
}

/* ==================== De la caché a una quiniela ==================== */

/**
 * Vuelca la caché compartida en los resultados oficiales de UNA jornada de UNA
 * quiniela, y de ahí dispara los puntos y las trivias.
 *
 * Es la única pieza del sincronizador que entra en el contexto de una quiniela:
 * todo lo de arriba trabaja sobre datos compartidos.
 *
 * ⚠️ **El comodín ya no se copia aquí.** En Mongo, cada resultado oficial se
 * escribía con una copia del comodín del partido, y como un partido terminado
 * deja de consultarse, esa copia se quedaba vieja para siempre (Entrada 044).
 * Ahora el comodín vive sólo en `partidos` y el motor lo lee de ahí.
 *
 * ⚠️ **Y el marcador se voltea si el proveedor da local y visitante al revés.**
 * Pasa de verdad, y ahí los marcadores sí cambian de significado: un 2-0 a
 * favor se convertiría en un 0-2 en contra.
 */
async function reescribirJornadaDesdeCache(quinielaId, jornadaNombre, { ahora = new Date() } = {}) {
  const resultado = await db.enQuiniela(quinielaId, async c => {
    const jornadaId = await pronosticosMod.jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return { ok: false, motivo: 'jornada_no_encontrada' };

    const partidos = await pronosticosMod.partidosDe(c, jornadaId);
    if (!partidos.length) return { ok: true, escritos: 0, cambiaronPuntos: false };

    const claves = new Map();
    for (const partido of partidos) {
      const clave = fixturesMod.claveDeFixture(partido);
      if (clave) claves.set(partido.id, clave);
    }

    const cache = await fixturesMod.porClaves([...new Set(claves.values())]);
    const anteriores = await oficialesMod.mapaDe(c, jornadaId);
    const contenedor = await oficialesMod.asegurarContenedor(c, quinielaId, jornadaId);

    const filas = [];

    for (const partido of partidos) {
      const evento = cache.get(claves.get(partido.id))?.evento || null;
      const previo = anteriores.get(partido.id);

      if (!evento) {
        // Sin noticias del proveedor: lo que hubiera se queda. Si no había
        // nada, se deja la fila vacía para que la pantalla pinte el partido.
        if (previo) continue;
        filas.push({
          partidoId: partido.id, marcador1: null, marcador2: null,
          estado: 'PROGRAMADO', minuto: null, fecha: partido.api_date || '',
          origen: 'api', bloqueadoFinal: false
        });
        continue;
      }

      /*
       * ============================================================
       * ⛔ UN RESULTADO DEFINITIVO NO SE VUELVE A TOCAR. NUNCA.
       * ============================================================
       *
       * Da igual de dónde viniera: si el partido terminó y su resultado quedó
       * fijado, esa fila es historia de la quiniela y deja de depender del
       * proveedor para siempre.
       *
       * Antes la condición era `bloqueadoFinal && origen === 'manual'`, así que
       * **un partido terminado con resultado del API se seguía reescribiendo en
       * cada ciclo**. No aportaba nada —ya no se consulta a un partido TC— y
       * abría el agujero de verdad: si el proveedor respondía 200 con un evento
       * degradado, el marcador bueno se machacaba con nulos. La caída del API
       * estaba cubierta por la caché; **la respuesta MALA no**.
       *
       * Ahora lo pasado está a salvo, y una caída o un error del proveedor sólo
       * pueden afectar a lo que está por jugarse o jugándose.
       */
      if (previo?.bloqueadoFinal) continue;

      const invertido =
        eventos.normalizarEquipo(evento.match_hometeam_name) === eventos.normalizarEquipo(partido.equipo2) &&
        eventos.normalizarEquipo(evento.match_awayteam_name) === eventos.normalizarEquipo(partido.equipo1);

      const estadoPartido = eventos.obtenerEstadoPartido(evento, { apiStatus: partido.api_status });
      const marcador = eventos.obtenerMarcador90Minutos(evento, estadoPartido);

      const nuevo1 = invertido ? marcador.marcador2 : marcador.marcador1;
      const nuevo2 = invertido ? marcador.marcador1 : marcador.marcador2;

      /*
       * ⛔ EL SINCRONIZADOR PUEDE MEJORAR UN DATO, NUNCA EMPEORARLO.
       *
       * El proveedor a veces responde 200 con un evento degradado: el partido
       * está ahí pero sin marcador. Escribirlo tal cual **borraba un marcador
       * bueno y lo dejaba en nulo**, y con él los puntos de esa jornada.
       *
       * Si lo que llega no trae marcador y lo que hay sí, se conserva lo que
       * hay. El estado y el minuto sí se actualizan: eso siempre es
       * información nueva.
       */
      const sinMarcadorNuevo = nuevo1 === null || nuevo2 === null;
      const previoTeniaMarcador = previo && previo.marcador1 !== null && previo.marcador2 !== null;
      const conservar = sinMarcadorNuevo && previoTeniaMarcador;

      filas.push({
        partidoId: partido.id,
        marcador1: conservar ? previo.marcador1 : nuevo1,
        marcador2: conservar ? previo.marcador2 : nuevo2,
        estado: estadoPartido.estado,
        minuto: estadoPartido.minuto,
        fecha: partido.api_date || '',
        origen: 'api',
        bloqueadoFinal: estadoPartido.estado === 'TC'
      });
    }

    /*
     * ⚠️ Los fallos por partido se registran aquí, con nombre y motivo, y NO
     * tumban la jornada. Antes un solo valor que la base rechazara dejaba sin
     * actualizar todos los partidos —también los correctos— y el registro sólo
     * decía «Error sincronizando "Jornada1"», sin decir cuál ni por qué.
     */
    const escritura = await oficialesMod.escribir(c, quinielaId, contenedor, filas);

    for (const fallo of escritura.fallos) {
      const partido = partidos.find(p => p.id === fallo.partidoId);
      console.error(
        `  · no se pudo guardar "${partido?.equipo1 ?? '?'} vs ${partido?.equipo2 ?? '?'}" `
        + `de "${jornadaNombre}": ${fallo.motivo}`);
    }

    const nuevos = await oficialesMod.mapaDe(c, jornadaId);
    const cambiaronPuntos = oficialesMod.puntosPuedenHaberCambiado(anteriores, nuevos);

    return { ok: true, escritos: filas.length, cambiaronPuntos };
  });

  if (!resultado.ok || !resultado.cambiaronPuntos) {
    /*
     * El documento se reescribe siempre —el minuto en vivo tiene que llegar a
     * las pantallas— pero recalcular la tabla no. Un 0-0 que sigue 0-0 llamaba
     * noventa veces seguidas a rehacer una clasificación idéntica, y eso pasa
     * en el rato de más tráfico de la semana.
     */
    if (resultado.ok) metricas.syncsSinCambioDePuntos += 1;
    return resultado;
  }

  const { rows: [q] } = await db.consulta(
    'SELECT configuracion FROM quinielas WHERE id = $1', [quinielaId]);

  await rankingMod.actualizar(quinielaId, jornadaNombre, q?.configuracion?.puntuacion);

  return resultado;
}

module.exports = {
  CERROJO_SYNC, TTL_CERROJO_SYNC_MS, TIMEOUT_CICLO_SYNC_MS, CONCURRENCIA_MAXIMA_API,
  metricas, reiniciarMetricas,
  conVigilante, conLimiteDeConcurrencia,
  censar, refrescarPendientes, ejecutarCiclo, tick,
  reescribirJornadaDesdeCache
};

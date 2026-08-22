/*
 * Los puntos por jornada y las dos tablas que se leen de ellos.
 *
 * ============================================================================
 * LA REGLA DEL CONGELADO (decidida el 17 de agosto de 2026)
 * ============================================================================
 *
 * Una jornada se congela cuando **todos sus partidos tienen resultado
 * definitivo**. A partir de ahí sus puntos no vuelven a moverse por un cambio
 * de configuración; sólo se recalculan si un administrador corrige un resultado
 * oficial —porque ahí sí cambió un hecho del juego— y en ese caso se recalculan
 * con la configuración que la jornada tenía guardada, no con la de hoy.
 *
 * Resolvía dos problemas a la vez, y no por casualidad: para poder guardar los
 * puntos calculados hay que decidir cuándo dejan de valer, y esa pregunta ES la
 * del congelamiento.
 *
 *   - C-03: la tabla general recalculaba todo el histórico en CADA petición.
 *   - M-03: ese recálculo usaba la configuración vigente, así que subir el
 *     marcador exacto de 5 a 10 en marzo reescribía la clasificación de enero.
 *
 * ============================================================================
 * LO QUE LA FOTO CONGELA, Y LO QUE NO
 * ============================================================================
 *
 * La foto son las **cuatro reglas de puntuación**, y nada más. El comodín NO
 * entra, y la diferencia está en el alcance de cada cosa:
 *
 *   - `configuracion.puntuacion` es GLOBAL. Subir el marcador exacto de 5 a 10
 *     tocaría todas las jornadas jugadas de golpe, sin que nadie mirara
 *     ninguna. Eso es M-03 y por eso se congela.
 *   - `partidos.comodin` es LOCAL a una jornada. Quien lo marca está editando
 *     esa jornada concreta y tiene delante lo que hace. Es una corrección, no
 *     un barrido.
 *
 * Congelarlo también dejaría a un administrador que se equivocó de casilla
 * **sin ninguna forma de arreglarlo**, que es justo el error que arrastraba la
 * versión de Mongo: allí el comodín se copiaba dentro del resultado oficial, un
 * partido terminado ya no se volvía a consultar, y marcarlo tarde no llegaba
 * nunca a los puntos. La ruta llamaba a recalcular y no servía de nada.
 *
 * ⚠️ La foto se escribe **entera, sustituyendo**. Es una fotografía, no un
 * ajuste: fundirla como se funde `quinielas.configuracion` dejaría sobrevivir
 * una clave del congelado anterior dentro del siguiente. Y la escribe siempre
 * el servidor, nunca el cuerpo de una petición.
 */
'use strict';

const db = require('./db');
const puntuacionMod = require('./puntuacion');
const pronosticosMod = require('./pronosticos');
const oficialesMod = require('./oficiales');
const jugadoresMod = require('./jugadores');
const respuestasTriviaMod = require('./respuestas-trivia');

const CAMPOS_DE_PUNTUACION = ['marcadorExacto', 'resultadoCorrecto', 'comodinExacto', 'comodinResultado'];

/**
 * La foto de las reglas con las que se congela una jornada.
 *
 * Se construye campo a campo desde `CAMPOS_DE_PUNTUACION`, no copiando el
 * objeto que llega. Así `triviasHabilitadas` y `puntosTriviaDefault` —que están
 * en la misma configuración pero no puntúan partidos— se quedan fuera, y una
 * clave que sobrara de un congelado anterior no puede colarse en el nuevo.
 */
function fotoDeLasReglas(puntuacion) {
  const foto = {};
  for (const campo of CAMPOS_DE_PUNTUACION) foto[campo] = puntuacion?.[campo] ?? 0;
  return foto;
}

/* ==================== Congelar ==================== */

/**
 * Calcula y graba los puntos de una jornada terminada.
 *
 * Devuelve `null` si todavía no está terminada, que es la señal de «ésta aún se
 * calcula al vuelo».
 *
 * Sólo se guardan los jugadores que pronosticaron. Quien no pronosticó suma
 * cero, y para eso no hace falta una fila: la lectura ya lo trata como cero.
 */
async function congelar(cliente, quinielaId, jornadaId, puntuacion) {
  const partidos = await pronosticosMod.partidosDe(cliente, jornadaId);
  const oficiales = await oficialesMod.mapaDe(cliente, jornadaId);

  if (!puntuacionMod.jornadaEstaFinalizada(partidos, oficiales)) return null;

  const porJugador = await pronosticosMod.porJugadorDeJornada(cliente, jornadaId);
  const foto = fotoDeLasReglas(puntuacion);

  const { rows: [pj] } = await cliente.query(
    `INSERT INTO puntos_jornada (quiniela_id, jornada_id, puntuacion, congelado_en)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (quiniela_id, jornada_id) DO UPDATE SET
       puntuacion   = EXCLUDED.puntuacion,
       congelado_en = now(),
       updated_at   = now()
     RETURNING id`,
    [quinielaId, jornadaId, JSON.stringify(foto)]);

  const resultado = [];

  for (const [jugadorId, datos] of porJugador) {
    const puntos = puntuacionMod.puntosDeJornada(
      partidos, datos.pronosticos, oficiales, foto);

    await cliente.query(
      `INSERT INTO puntos_jornada_jugador (quiniela_id, puntos_jornada_id, jugador_id, puntos)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (puntos_jornada_id, jugador_id) DO UPDATE SET puntos = EXCLUDED.puntos`,
      [quinielaId, pj.id, jugadorId, puntos]);

    resultado.push({ jugador: datos.nombre, puntos });
  }

  /*
   * Un jugador cuyos pronósticos desaparecieron —le borraron el partido, o se
   * quedó sin ninguno— tenía una fila congelada que ya no se corresponde con
   * nada. Sin esta línea seguiría puntuando para siempre con un número que ya
   * nadie puede reproducir.
   */
  const vivos = Array.from(porJugador.keys());
  await cliente.query(
    `DELETE FROM puntos_jornada_jugador
      WHERE puntos_jornada_id = $1 AND NOT (jugador_id = ANY($2::uuid[]))`,
    [pj.id, vivos]);

  return resultado;
}

/**
 * Punto único de entrada tras cualquier escritura que pueda mover los puntos de
 * una jornada: resultados oficiales, pronósticos, comodines o borrados.
 *
 * Congela si acaba de terminar, recalcula si ya estaba congelada, y **descongela
 * si dejó de estar terminada** —por ejemplo si un administrador reabre un
 * partido—.
 *
 * ⚠️ Si ya estaba congelada se recalcula con SU foto, no con la de hoy. De lo
 * contrario, corregir un marcador equivocado colaría de tapadillo todos los
 * cambios de configuración ocurridos desde que la jornada terminó.
 */
async function actualizar(quinielaId, jornadaNombre, puntuacionActual) {
  if (!jornadaNombre) return null;

  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await pronosticosMod.jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return null;

    const { rows: [existente] } = await c.query(
      'SELECT id, puntuacion FROM puntos_jornada WHERE jornada_id = $1', [jornadaId]);

    const puntuacion = existente?.puntuacion || puntuacionActual;
    const congelado = await congelar(c, quinielaId, jornadaId, puntuacion);

    if (!congelado && existente) {
      // Dejó de estar terminada: la foto ya no vale y se va con sus filas.
      await c.query('DELETE FROM puntos_jornada WHERE id = $1', [existente.id]);
    }

    return congelado;
  });
}

/* ==================== Lectura ==================== */

/** Lo congelado de una jornada: la foto y los puntos por nombre de jugador. */
async function congeladoDe(cliente, jornadaId) {
  const { rows: [pj] } = await cliente.query(
    'SELECT id, puntuacion FROM puntos_jornada WHERE jornada_id = $1', [jornadaId]);
  if (!pj) return null;

  const { rows } = await cliente.query(
    `SELECT j.nombre, pjj.puntos
       FROM puntos_jornada_jugador pjj
       JOIN jugadores j ON j.id = pjj.jugador_id
      WHERE pjj.puntos_jornada_id = $1`,
    [pj.id]);

  return {
    puntuacion: pj.puntuacion,
    puntos: new Map(rows.map(f => [f.nombre, f.puntos]))
  };
}

/**
 * La clasificación de una jornada.
 *
 * Si la jornada está terminada y congelada, los puntos son los guardados. Las
 * estadísticas de desempate se calculan siempre al vuelo: no cambian el número
 * de puntos, sólo el orden entre quienes empataron, y guardarlas sería guardar
 * algo que se puede deducir.
 *
 * Congelar dentro de una lectura es una red de seguridad, no el camino normal
 * —lo habitual es que la jornada se congele en el momento en que termina—, así
 * que un fallo ahí no puede tumbar la consulta.
 */
async function clasificacionDeJornada(quinielaId, jornadaNombre, { puntuacionActual, incluirExpulsados = true } = {}) {
  const nombres = await jugadoresMod.nombres(quinielaId, { incluirExpulsados });

  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await pronosticosMod.jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return null;

    const partidos = await pronosticosMod.partidosDe(c, jornadaId);
    const oficiales = await oficialesMod.mapaDe(c, jornadaId);
    const confirmada = puntuacionMod.jornadaEstaFinalizada(partidos, oficiales);

    let congelado = await congeladoDe(c, jornadaId);

    if (confirmada && !congelado) {
      try {
        await congelar(c, quinielaId, jornadaId, puntuacionActual);
        congelado = await congeladoDe(c, jornadaId);
      } catch (error) {
        console.error(`No se pudo congelar "${jornadaNombre}" al consultarla:`, error.message);
      }
    }

    const puntuacion = congelado?.puntuacion || puntuacionActual;

    const porJugador = await pronosticosMod.porJugadorDeJornada(c, jornadaId);
    const porNombre = new Map();
    for (const datos of porJugador.values()) porNombre.set(datos.nombre, datos.pronosticos);

    const filas = nombres.map(jugador => {
      const estadisticas = puntuacionMod.estadisticasDeJornada(
        partidos, porNombre.get(jugador), oficiales, puntuacion);

      return {
        jugador,
        puntos: congelado ? (congelado.puntos.get(jugador) || 0) : estadisticas.puntos,
        marcadoresExactos: estadisticas.marcadoresExactos,
        resultadosCorrectos: estadisticas.resultadosCorrectos,
        diferenciaTotalGoles: estadisticas.diferenciaTotalGoles
      };
    });

    return {
      jornada: jornadaNombre,
      estado: confirmada ? 'confirmada' : 'provisional',
      clasificacion: puntuacionMod.repartirPuestos(puntuacionMod.ordenarClasificacion(filas))
    };
  });
}

/**
 * La tabla de posiciones: una fila por jugador, una columna por jornada.
 *
 * Las jornadas terminadas aportan un número ya guardado; sólo las que siguen
 * vivas se calculan. Cuando toda la temporada está cerrada, ni `pronosticos` ni
 * `resultados_oficiales_partidos` llegan a leerse: es lo que quitó C-03.
 */
async function tablaGeneral(quinielaId, { puntuacionActual, incluirExpulsados = true } = {}) {
  const nombres = await jugadoresMod.nombres(quinielaId, { incluirExpulsados });

  return db.enQuiniela(quinielaId, async c => {
    const { rows: jornadas } = await c.query(
      'SELECT id, nombre FROM jornadas ORDER BY secuencia');

    /* ---------- Lo ya congelado ---------- */

    const congeladas = new Map();
    for (const jornada of jornadas) {
      const congelado = await congeladoDe(c, jornada.id);
      if (congelado) congeladas.set(jornada.id, congelado);
    }

    /* ---------- Lo que sigue vivo: sólo eso se lee y se calcula ---------- */

    const vivas = [];
    for (const jornada of jornadas) {
      if (congeladas.has(jornada.id)) continue;

      const partidos = await pronosticosMod.partidosDe(c, jornada.id);
      const oficiales = await oficialesMod.mapaDe(c, jornada.id);
      const porJugador = await pronosticosMod.porJugadorDeJornada(c, jornada.id);

      const porNombre = new Map();
      for (const datos of porJugador.values()) porNombre.set(datos.nombre, datos.pronosticos);

      vivas.push({ ...jornada, partidos, oficiales, porNombre });
    }

    /* ---------- Trivias: ya traen sus puntos resueltos (M-04) ---------- */

    const puntosDeTrivias = await respuestasTriviaMod.puntosPorJugador(quinielaId);

    /* ---------- Armado ---------- */

    const tabla = {};

    for (const jugador of nombres) {
      const fila = {};
      let total = 0;

      const deTrivias = puntosDeTrivias.get(jugador) || 0;
      fila.Trivias = deTrivias;
      total += deTrivias;

      for (const jornada of jornadas) {
        const congelado = congeladas.get(jornada.id);
        let puntos;

        if (congelado) {
          puntos = congelado.puntos.get(jugador) || 0;
        } else {
          const viva = vivas.find(v => v.id === jornada.id);
          puntos = puntuacionMod.puntosDeJornada(
            viva.partidos, viva.porNombre.get(jugador), viva.oficiales, puntuacionActual);
        }

        fila[jornada.nombre] = puntos;
        total += puntos;
      }

      fila.total = total;
      tabla[jugador] = fila;
    }

    /*
     * Red de seguridad: una jornada que ya terminó pero que nadie congeló al
     * cerrarse —datos migrados, o resultados escritos antes de la Fase 5— se
     * congela aquí. En condiciones normales no hace nada.
     *
     * Va ANTES de responder a propósito. Hacerlo después dejaba el endpoint sin
     * determinar: quien leyera la tabla y preguntara acto seguido si la jornada
     * estaba congelada podía encontrarse con que todavía no.
     */
    for (const viva of vivas) {
      if (!puntuacionMod.jornadaEstaFinalizada(viva.partidos, viva.oficiales)) continue;
      try {
        await congelar(c, quinielaId, viva.id, puntuacionActual);
      } catch (error) {
        console.error(`Error congelando "${viva.nombre}":`, error.message);
      }
    }

    return { jornadas: jornadas.map(j => j.nombre), tabla };
  });
}

module.exports = {
  CAMPOS_DE_PUNTUACION,
  fotoDeLasReglas,
  congelar, actualizar, congeladoDe,
  clasificacionDeJornada, tablaGeneral
};

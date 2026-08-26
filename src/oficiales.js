/*
 * Los resultados oficiales de una jornada: lo que de verdad pasó en cada
 * partido, venga del proveedor o cargado a mano por un administrador.
 *
 * ============================================================================
 * AQUÍ YA NO SE COPIA EL COMODÍN, Y ES A PROPÓSITO
 * ============================================================================
 *
 * En Mongo, cada resultado oficial llevaba dentro una copia del `comodin` del
 * partido, y el motor de puntos la leía de ahí. Traía dos problemas:
 *
 *   1. Un partido terminado deja de consultarse, así que marcar un comodín
 *      DESPUÉS no llegaba nunca a la copia y los puntos salían con el valor
 *      viejo. Sin fallar.
 *   2. La carga manual tomaba el comodín del cuerpo de la petición: lo que el
 *      navegador devolviera, no lo que decía la jornada.
 *
 * El resultado oficial registra **qué pasó**; el partido registra **cuánto
 * vale**. Aquí se separan: `resultados_oficiales_partidos` no tiene columna de
 * comodín, y el motor lo lee de `partidos`.
 *
 * ============================================================================
 * EL EMPAREJAMIENTO POR EQUIPOS SE QUEDA EN LA FRONTERA
 * ============================================================================
 *
 * `buscarOficialCorrespondiente` existía porque el proveedor a veces devuelve
 * local y visitante al revés, y había que reconocer el partido por sus equipos.
 * Dentro de casa eso ya no hace falta: la identidad es `partido_id`. La
 * heurística de equipos sigue siendo necesaria, pero sólo donde entra el JSON
 * del proveedor, y eso es la tajada 6.
 */
'use strict';

const db = require('./db');
const { partidosDe, jornadaIdDe } = require('./pronosticos');

/**
 * Los campos de un resultado oficial de los que dependen los PUNTOS.
 *
 * ⚠️ `minuto` queda fuera, y es la clave de todo esto: cambia en cada ciclo de
 * un partido en vivo y no mueve la puntuación de nadie. Incluirlo significaba
 * invalidar la caché del ranking cada minuto durante los noventa del partido
 * —el rato de más tráfico de la semana y el peor momento para recalcular—.
 *
 * `estado` sí cuenta: el paso a `TC` es lo que congela la jornada.
 *
 * `comodin` ya no está en la lista porque ya no vive aquí. Un cambio de comodín
 * lo notifica su propia ruta, que es quien lo hace.
 */
const CAMPOS_QUE_MUEVEN_PUNTOS = ['marcador1', 'marcador2', 'estado', 'bloqueadoFinal'];

/**
 * ¿Este sync puede haber movido la tabla de posiciones?
 *
 * Los dos mapas van indexados por `partido_id`, así que comparar es mirar la
 * misma clave en los dos. En Mongo esto tenía que emparejar por equipos, con su
 * normalización de nombres y su caso de local y visitante invertidos; por
 * identidad estable la función se queda en seis líneas y sin heurística que
 * pueda equivocarse.
 */
function puntosPuedenHaberCambiado(anteriores, nuevos) {
  if (!anteriores || anteriores.size !== nuevos.size) return true;

  for (const [partidoId, nuevo] of nuevos) {
    const anterior = anteriores.get(partidoId);
    if (!anterior) return true;
    if (CAMPOS_QUE_MUEVEN_PUNTOS.some(campo => (anterior[campo] ?? null) !== (nuevo[campo] ?? null))) {
      return true;
    }
  }
  return false;
}

/** Traduce una fila de la base a la forma que usan el motor y las pantallas. */
function oficialPublico(fila) {
  return {
    partidoId: fila.partido_id,
    marcador1: fila.marcador1,
    marcador2: fila.marcador2,
    estado: fila.estado,
    minuto: fila.minuto,
    fecha: fila.fecha,
    origen: fila.origen,
    bloqueadoFinal: fila.bloqueado_final,
    actualizadoEn: fila.actualizado_en
  };
}

/* ==================== Lectura ==================== */

/** Los resultados oficiales de una jornada, indexados por `partido_id`. */
async function mapaDe(cliente, jornadaId) {
  const { rows } = await cliente.query(
    `SELECT rop.*
       FROM resultados_oficiales_partidos rop
       JOIN resultados_oficiales ro ON ro.id = rop.resultado_oficial_id
      WHERE ro.jornada_id = $1`,
    [jornadaId]);
  return new Map(rows.map(f => [f.partido_id, oficialPublico(f)]));
}

/**
 * Los resultados oficiales de una jornada, en el orden de los partidos.
 *
 * Devuelve una entrada por partido aunque no haya resultado: la pantalla de
 * carga manual necesita la fila vacía para que el administrador la llene.
 *
 * ⚠️ El `comodin` que sale de aquí viene del PARTIDO, que es donde vive.
 */
async function deJornada(quinielaId, jornadaNombre) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return null;

    const partidos = await partidosDe(c, jornadaId);
    const oficiales = await mapaDe(c, jornadaId);

    return {
      nombre: jornadaNombre,
      partidos: partidos.map(p => {
        const o = oficiales.get(p.id);
        return {
          equipo1: p.equipo1,
          equipo2: p.equipo2,
          logoEquipo1: p.logo_equipo1,
          logoEquipo2: p.logo_equipo2,
          comodin: p.comodin,
          marcador1: o?.marcador1 ?? null,
          marcador2: o?.marcador2 ?? null,
          estado: o?.estado ?? null,
          minuto: o?.minuto ?? null,
          fecha: o?.fecha ?? p.api_date ?? null,
          origen: o?.origen ?? null,
          bloqueadoFinal: o?.bloqueadoFinal ?? false
        };
      })
    };
  });
}

/* ==================== Escritura ==================== */

/**
 * Se asegura de que exista el contenedor de resultados oficiales de la jornada.
 *
 * Es un `INSERT … ON CONFLICT` en vez de mirar si existe y luego insertar: entre
 * mirar y escribir cabe otro ciclo del sincronizador, y ahí el índice único
 * respondería con un 23505 que nadie está esperando.
 */
async function asegurarContenedor(cliente, quinielaId, jornadaId) {
  const { rows: [ro] } = await cliente.query(
    `INSERT INTO resultados_oficiales (quiniela_id, jornada_id)
     VALUES ($1, $2)
     ON CONFLICT (quiniela_id, jornada_id) DO UPDATE SET jornada_id = EXCLUDED.jornada_id
     RETURNING id`,
    [quinielaId, jornadaId]);
  return ro.id;
}

/**
 * Escribe los resultados de unos partidos concretos.
 *
 * `filas` es un arreglo de `{ partidoId, marcador1, marcador2, estado, minuto,
 * fecha, origen, bloqueadoFinal }`. Se escribe partido a partido y **no se
 * borra lo que no venga**: un ciclo del sincronizador que sólo trae dos
 * partidos no puede llevarse por delante los otros ocho.
 */
/**
 * Un marcador listo para una columna `integer`, o `null`.
 *
 * ⛔ `?? null` NO BASTA, y ahí estuvo el fallo que congeló los resultados
 * oficiales el 25 de agosto: `??` sólo convierte `null` y `undefined`, así que
 * una **cadena vacía** pasaba intacta hacia una columna `integer` y PostgreSQL
 * la rechazaba con `invalid input syntax for type integer: ""`.
 *
 * Se arregló también en el origen —`eventos.obtenerNumeroSeguro` ya devuelve
 * `null`— pero esta comprobación se queda: es la última puerta antes de la
 * base, y protege de cualquier otro llamante presente o futuro. Que el dato
 * venga bien es una esperanza; que aquí no pase basura es una garantía.
 *
 * ⚠️ El `0` tiene que sobrevivir: un 0-0 es un marcador de verdad, así que no
 * vale comprobar si el valor es «verdadero».
 */
function comoEntero(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' && valor.trim() === '') return null;

  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : null;
}

/**
 * Escribe los resultados de una jornada.
 *
 * ⚠️ Devuelve cuántas filas se escribieron y cuáles fallaron, y **un partido
 * que falla no impide escribir los demás**.
 *
 * Antes, un solo valor que la base rechazara tumbaba la reescritura de la
 * jornada ENTERA: pasó el 25 de agosto con una cadena vacía en un marcador, y
 * el resultado fue que ningún partido se actualizaba —tampoco los que estaban
 * perfectos— y el registro repetía el mismo error cada minuto. Un fallo de un
 * partido tiene que costar un partido.
 *
 * ⛔ Y los fallos se DEVUELVEN, no se tragan: quien llama los registra con el
 * nombre del partido. Un `catch` que sólo sigue adelante convierte un fallo
 * ruidoso en uno invisible, que es peor.
 */
async function escribir(cliente, quinielaId, resultadoOficialId, filas) {
  const fallos = [];
  let escritas = 0;

  for (const fila of filas) {
    /*
     * ⛔ SAVEPOINT, y NO basta un `try/catch`.
     *
     * Esto corre dentro de la transacción de la petición. En PostgreSQL, una
     * sentencia que falla **aborta la transacción entera**: todas las
     * siguientes responden «current transaction is aborted», y atraparlas con
     * `catch` no cambia nada — es el eco del primer error, no un error nuevo.
     * Está en §C de la bitácora desde la Entrada 035 y cuesta dos vueltas cada
     * vez que se olvida.
     *
     * Con un punto de guardado por fila, deshacer una no toca las demás y la
     * transacción sigue viva.
     */
    await cliente.query('SAVEPOINT fila_oficial');

    try {
      await escribirUna(cliente, quinielaId, resultadoOficialId, fila);
      await cliente.query('RELEASE SAVEPOINT fila_oficial');
      escritas += 1;
    } catch (error) {
      await cliente.query('ROLLBACK TO SAVEPOINT fila_oficial');
      fallos.push({ partidoId: fila.partidoId, motivo: error.message });
    }
  }

  return { escritas, fallos };
}

async function escribirUna(cliente, quinielaId, resultadoOficialId, fila) {
  await cliente.query(
      `INSERT INTO resultados_oficiales_partidos
         (quiniela_id, resultado_oficial_id, partido_id, marcador1, marcador2,
          estado, minuto, fecha, origen, bloqueado_final, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (resultado_oficial_id, partido_id) DO UPDATE SET
         marcador1 = EXCLUDED.marcador1,
         marcador2 = EXCLUDED.marcador2,
         estado    = EXCLUDED.estado,
         minuto    = EXCLUDED.minuto,
         fecha     = EXCLUDED.fecha,
         origen    = EXCLUDED.origen,
         bloqueado_final = EXCLUDED.bloqueado_final,
         actualizado_en  = now()`,
      [quinielaId, resultadoOficialId, fila.partidoId,
        comoEntero(fila.marcador1), comoEntero(fila.marcador2),
        fila.estado ?? null,
        fila.minuto === null || fila.minuto === undefined ? null : String(fila.minuto),
        fila.fecha ?? null,
        fila.origen ?? 'api',
        Boolean(fila.bloqueadoFinal)]);
}

/**
 * Carga manual de un administrador.
 *
 * Llega posicional, como lo manda la pantalla, y la posición se traduce a
 * `partido_id` una sola vez. Todo lo que se carga a mano queda **bloqueado como
 * definitivo**: un administrador escribiendo un marcador es la última palabra,
 * y el sincronizador no debe volver a pisarlo.
 *
 * ⚠️ El comodín que venga en el cuerpo se **ignora**. Quien decide qué partido
 * es comodín es la jornada, no el formulario de resultados.
 */
async function guardarManual(quinielaId, jornadaNombre, resultados, normalizar) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await jornadaIdDe(c, jornadaNombre);
    if (!jornadaId) return { ok: false, motivo: 'jornada_no_encontrada' };

    const partidos = await partidosDe(c, jornadaId);
    const resultadoOficialId = await asegurarContenedor(c, quinielaId, jornadaId);

    const filas = partidos.map((partido, i) => {
      const enviado = resultados?.[i] || {};
      return {
        partidoId: partido.id,
        marcador1: normalizar(enviado.marcador1, `El marcador local del partido ${i + 1}`),
        marcador2: normalizar(enviado.marcador2, `El marcador visitante del partido ${i + 1}`),
        estado: enviado.estado || 'TC',
        minuto: enviado.minuto ?? null,
        fecha: enviado.fecha || partido.api_date || '',
        origen: 'manual',
        bloqueadoFinal: true
      };
    });

    await escribir(c, quinielaId, resultadoOficialId, filas);
    return { ok: true, partidos: filas.length };
  });
}

module.exports = {
  CAMPOS_QUE_MUEVEN_PUNTOS,
  puntosPuedenHaberCambiado,
  oficialPublico,
  mapaDe, deJornada,
  asegurarContenedor, escribir, guardarManual
};

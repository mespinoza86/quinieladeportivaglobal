/*
 * Notificaciones al teléfono: «tu partido arranca en 15 minutos».
 *
 * ============================================================================
 * LO QUE MARCO PIDIÓ, Y LAS TRES DECISIONES QUE LO ACOTAN
 * ============================================================================
 *
 * El 4 de septiembre: *«quiero que salga una notificación 15 minutos antes de
 * que inicie un partido»*, y dijo que era **lo que más quería**. El 14 cerró
 * las tres decisiones que faltaban:
 *
 *   1. **A todos los que se apunten**, no sólo a quien no llenó. Revisar los
 *      pronósticos le sirve igual a quien ya los puso.
 *   2. **15 minutos fijos.** Él mismo nombró la cifra; una casilla configurable
 *      es código que mantener para una pregunta que ya tiene respuesta.
 *   3. **Si la ventana ya pasó, callarse.** «Arranca en 15 minutos» cuando el
 *      partido lleva media hora jugándose es peor que no decir nada: el
 *      pronóstico ya está cerrado y avisar tarde sólo genera desconfianza.
 *
 * ============================================================================
 * ⛔ UN AVISO NO ES IDEMPOTENTE
 * ============================================================================
 *
 * El reloj corre cada minuto y la ventana dura quince: sin memoria, el mismo
 * partido avisaría **quince veces**. La memoria es `partidos.notificado_en`, la
 * tercera marca de esta familia después de `compartido_en` (008) y `avisado_en`
 * (009), y por el mismo motivo exacto.
 *
 * ⚠️ Y se marca DESPUÉS de enviar, nunca antes: marcar primero y fallar el
 * envío deja a todo el mundo sin aviso y sin manera de saberlo.
 */
'use strict';

const db = require('./db');
const { comoApiDate } = require('./fechas');

/** Lo que Marco pidió, y no se configura. Ver la cabecera. */
const ANTELACION_MINUTOS = 15;

/**
 * El segundo aviso, más temprano: «la jornada arranca en dos horas».
 *
 * Marco lo pidió el 14 de septiembre para que dé tiempo a llenarla, no sólo a
 * comprobarla. Va a quien todavía no ha terminado.
 */
const HORAS_AVISO_PREVIO = 2;

/**
 * Cuánto se admite desviarse de las dos horas.
 *
 * ⛔ Sin esta banda, la ventana era «arranca dentro de las próximas dos horas»
 * y un partido que empezaba en diez minutos también entraba — con un mensaje
 * que decía «arranca en 2 horas». Mentía, y por 110 minutos.
 *
 * Es la misma regla de «callarse» aplicada al otro extremo: si el momento de
 * las dos horas ya pasó —una jornada creada con media hora de margen—, este
 * aviso NO sale y del asunto se encarga el de quince minutos.
 *
 * ⚠️ La banda es de quince minutos y no de uno porque el reloj puede perderse
 * algún minuto: un reinicio de Render, un ciclo que tarda. Con un solo minuto
 * de margen, el aviso se perdería entero cada vez que eso pasara.
 */
const TOLERANCIA_AVISO_PREVIO_MINUTOS = 15;

/* ==================== Las suscripciones ==================== */

/**
 * Guarda el navegador que acaba de aceptar recibir avisos.
 *
 * ⛔ `ON CONFLICT (endpoint)` y no un `INSERT` a secas: el navegador **reutiliza
 * el mismo endpoint** si vuelves a suscribirte sin haberte dado de baja, así
 * que pulsar «activar» dos veces dejaría dos filas y llegarían dos
 * notificaciones del mismo partido al mismo teléfono.
 *
 * Y al chocar se **reasigna el usuario**, no se ignora: si otra persona entra en
 * ese mismo móvil, los avisos tienen que pasar a ser suyos.
 */
async function suscribir(usuarioId, { endpoint, keys, userAgent = '' } = {}) {
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return { ok: false, motivo: 'suscripcion_incompleta' };
  }

  const { rows: [fila] } = await db.consulta(
    `INSERT INTO suscripciones_push (usuario_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       usuario_id = EXCLUDED.usuario_id,
       p256dh     = EXCLUDED.p256dh,
       auth       = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent
     RETURNING id`,
    [usuarioId, endpoint, keys.p256dh, keys.auth, String(userAgent).slice(0, 400)]);

  return { ok: true, id: fila.id };
}

/** Apaga los avisos de ESTE navegador. */
async function desuscribir(endpoint) {
  const { rowCount } = await db.consulta(
    'DELETE FROM suscripciones_push WHERE endpoint = $1', [endpoint]);
  return { ok: true, borradas: rowCount };
}

/**
 * Tira la suscripción que el servicio de push da por muerta.
 *
 * ⚠️ Hace falta de verdad: un 404 o un 410 significa que ese navegador ya no
 * existe —se desinstaló, se limpiaron los datos, caducó—. Sin borrarla, la tabla
 * se llena de teléfonos muertos a los que se escribe en cada partido para
 * siempre, y cada intento es una petición de red que se paga.
 */
async function olvidarMuerta(endpoint) {
  return desuscribir(endpoint);
}

/** ¿Tiene esta persona algún teléfono activado? Para que la pantalla lo diga. */
async function cuantasTiene(usuarioId) {
  const { rows: [{ n }] } = await db.consulta(
    'SELECT count(*)::int AS n FROM suscripciones_push WHERE usuario_id = $1', [usuarioId]);
  return n;
}

/* ==================== A quién le sirve el aviso ==================== */

/*
 * ============================================================================
 * ⭐ LA REGLA DE LA QUE SALE TODO LO DE ABAJO
 * ============================================================================
 *
 * **Una notificación sólo se manda si quien la recibe todavía puede cambiar
 * algo.** Marco lo dejó dicho así el 14 de septiembre, y sustituye a la idea
 * anterior —un botón de «no me avises más»— por algo que no necesita botones,
 * ni estado nuevo, ni funciona distinto en iPhone que en Android.
 *
 * De esa frase salen las tres audiencias, sin tener que decidir nada más:
 *
 *   quien ya llenó todo        →  no recibe nada, nunca
 *   quien va a medias          →  recibe, y sólo de lo que le falta
 *   quien no llenó nada        →  recibe los dos avisos de la jornada, y para
 *
 * ⛔ El último caso es el que antes iba a resolverse con un botón: alguien que
 * se sienta una jornada recibiría catorce avisos. Aquí el silencio le llega
 * solo, porque a partir del primer partido la pregunta deja de ser «¿te falta
 * algo?» y pasa a ser «¿estás jugando esto y te falta algo?».
 */

/**
 * Quienes NO han terminado de llenar la jornada: les falta al menos uno.
 *
 * Es la audiencia de los dos avisos de la jornada —el de dos horas y el del
 * primer partido—, e incluye a quien no ha puesto ni uno.
 *
 * ⚠️ Se respetan `juega_jornadas` y `cobrar_desde`, que son la respuesta que ya
 * existe a «¿le toca esta jornada?» y la que decide a quién se le cobra. Avisar
 * a alguien de una jornada que no juega es ruido, y escribir aquí una segunda
 * versión de esa regla sería tener dos verdades que se separan.
 */
async function losQueNoHanTerminado(quinielaId, jornada) {
  const { rows } = await db.enQuiniela(quinielaId, async c => c.query(`
    SELECT j.usuario_id
      FROM jugadores j
     WHERE j.usuario_id IS NOT NULL
       AND j.juega_jornadas
       AND (j.cobrar_desde IS NULL OR $2::int >= j.cobrar_desde)
       AND (SELECT count(*)
              FROM resultados r
              JOIN pronosticos p ON p.resultado_id = r.id
             WHERE r.jugador_id = j.id AND r.jornada_id = $1) < $3::int`,
    [jornada.id, jornada.secuencia, jornada.totalPartidos]));

  return rows.map(r => r.usuario_id);
}

/**
 * Quienes EMPEZARON la jornada y todavía no han pronosticado **este** partido.
 *
 * Es la audiencia de los partidos que no son el primero, y las dos condiciones
 * hacen falta:
 *
 *   · «empezaron» deja fuera a quien se sentó la jornada — ya se le avisó dos
 *     veces y no se le persigue catorce;
 *   · «les falta éste» deja fuera a quien ya lo pronosticó, que es el punto
 *     entero: avisarle no le deja hacer nada.
 */
async function losQueLesFaltaEstePartido(quinielaId, jornadaId, partidoId) {
  const { rows } = await db.enQuiniela(quinielaId, async c => c.query(`
    SELECT j.usuario_id
      FROM jugadores j
      JOIN resultados r ON r.jugador_id = j.id AND r.jornada_id = $1
     WHERE j.usuario_id IS NOT NULL
       AND j.juega_jornadas
       AND EXISTS (SELECT 1 FROM pronosticos p WHERE p.resultado_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM pronosticos p2
                        WHERE p2.resultado_id = r.id AND p2.partido_id = $2)`,
    [jornadaId, partidoId]));

  return rows.map(r => r.usuario_id);
}

/** Los navegadores de unas personas concretas, dentro de una quiniela. */
async function suscripcionesDe(quinielaId, usuarioIds) {
  if (!usuarioIds?.length) return [];

  const { rows } = await db.consulta(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.usuario_id
       FROM suscripciones_push s
       JOIN membresias m ON m.usuario_id = s.usuario_id
      WHERE m.quiniela_id = $1 AND m.estado = 'activo'
        AND s.usuario_id = ANY($2::uuid[])`,
    [quinielaId, usuarioIds]);

  return rows.map(r => ({
    id: r.id,
    usuarioId: r.usuario_id,
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth }
  }));
}

/* ==================== Las dos ventanas ==================== */

/**
 * Jornadas cuyo partido MÁS TEMPRANO arranca dentro de las próximas dos horas.
 *
 * ⛔ «El primero» es el de menor `api_date`, **no el de `orden` 1**. El orden
 * es la posición en la pantalla y se puede reordenar; si se avisara por él, una
 * jornada reordenada avisaría del partido equivocado y nadie lo notaría hasta
 * que alguien se quedara sin pronosticar.
 *
 * La ventana es abierta por abajo igual que la de quince minutos: si la jornada
 * se creó con hora y media de margen, este aviso **no sale**. Es la misma regla
 * de «callarse» — un aviso que dice «en dos horas» cuando falta una miente.
 */
async function jornadasParaAvisoPrevio(quinielaId, { ahora = new Date(), horas = HORAS_AVISO_PREVIO, toleranciaMinutos = TOLERANCIA_AVISO_PREVIO_MINUTOS } = {}) {
  /*
   * Una BANDA alrededor del momento de las dos horas, no «todo lo que quede
   * por debajo». Ver `TOLERANCIA_AVISO_PREVIO_MINUTOS`.
   */
  const hasta = comoApiDate(new Date(ahora.getTime() + horas * 60 * 60 * 1000));
  const desde = comoApiDate(new Date(
    ahora.getTime() + horas * 60 * 60 * 1000 - toleranciaMinutos * 60 * 1000));

  const { rows } = await db.enQuiniela(quinielaId, async c => c.query(`
    SELECT jor.id, jor.nombre, jor.secuencia,
           min(p.api_date) AS arranque,
           count(p.id)::int AS total_partidos
      FROM jornadas jor
      JOIN partidos p ON p.jornada_id = jor.id
     WHERE jor.avisado_2h_en IS NULL
       AND p.api_date <> ''
     GROUP BY jor.id, jor.nombre, jor.secuencia
    HAVING min(p.api_date) > $1 AND min(p.api_date) <= $2
     ORDER BY min(p.api_date)`,
    [desde, hasta]));

  return rows.map(r => ({
    id: r.id, nombre: r.nombre, secuencia: r.secuencia,
    arranque: r.arranque, totalPartidos: r.total_partidos
  }));
}

/**
 * Los partidos que arrancan dentro de los próximos quince minutos.
 *
 * ⛔ LA VENTANA ES ABIERTA POR ABAJO: `api_date > ahora`.
 *
 * Ese `>` estricto ES la decisión de «callarse» de Marco. Un partido que ya
 * arrancó queda fuera por la propia consulta, sin una segunda comprobación que
 * pudiera discrepar. Si el servicio estuvo caído una hora, esos partidos no
 * avisan nunca — y es lo correcto: su pronóstico ya está cerrado.
 *
 * ⚠️ Se comparan TEXTOS, y funciona porque `api_date` es «YYYY-MM-DD HH:MM» con
 * ceros a la izquierda: en ese formato el orden alfabético y el cronológico son
 * el mismo. Un partido sin hora prevista queda fuera, que es lo que toca: sin
 * hora no hay «quince minutos antes».
 *
 * Cada partido viene con `esPrimero`, que decide **a quién** se avisa: el
 * primero de la jornada va a todo el que no haya terminado; los demás, sólo a
 * quien empezó y todavía le falta ése.
 */
async function paraNotificar(quinielaId, { ahora = new Date(), antelacionMinutos = ANTELACION_MINUTOS } = {}) {
  const desde = comoApiDate(ahora);
  const hasta = comoApiDate(new Date(ahora.getTime() + antelacionMinutos * 60 * 1000));

  const { rows } = await db.enQuiniela(quinielaId, async c => c.query(`
    WITH primeros AS (
      SELECT jornada_id, min(api_date) AS primera
        FROM partidos WHERE api_date <> '' GROUP BY jornada_id
    )
    SELECT p.id, p.equipo1, p.equipo2, p.api_date,
           jor.id AS jornada_id, jor.nombre AS jornada, jor.secuencia,
           (p.api_date = pri.primera) AS es_primero,
           (SELECT count(*)::int FROM partidos t WHERE t.jornada_id = jor.id) AS total_partidos
      FROM partidos p
      JOIN jornadas jor ON jor.id = p.jornada_id
      JOIN primeros pri ON pri.jornada_id = jor.id
     WHERE p.notificado_en IS NULL
       AND p.api_date > $1
       AND p.api_date <= $2
     ORDER BY p.api_date, jor.secuencia, p.orden`,
    [desde, hasta]));

  return rows.map(r => ({
    id: r.id, equipo1: r.equipo1, equipo2: r.equipo2, apiDate: r.api_date,
    esPrimero: r.es_primero,
    jornada: { id: r.jornada_id, nombre: r.jornada, secuencia: r.secuencia, totalPartidos: r.total_partidos }
  }));
}

/* ==================== Las marcas ==================== */

/** Deja constancia de que estos partidos ya avisaron. */
async function marcarNotificados(quinielaId, partidoIds, { ahora = new Date() } = {}) {
  if (!partidoIds?.length) return 0;

  const { rowCount } = await db.enQuiniela(quinielaId, async c => c.query(
    `UPDATE partidos SET notificado_en = $2
      WHERE id = ANY($1::uuid[]) AND notificado_en IS NULL`,
    [partidoIds, ahora]));

  return rowCount;
}

/** Y de que la jornada ya dio su aviso previo. */
async function marcarAvisoPrevio(quinielaId, jornadaId, { ahora = new Date() } = {}) {
  const { rowCount } = await db.enQuiniela(quinielaId, async c => c.query(
    `UPDATE jornadas SET avisado_2h_en = $2 WHERE id = $1 AND avisado_2h_en IS NULL`,
    [jornadaId, ahora]));

  return rowCount;
}

/* ==================== El barrido ==================== */

/**
 * Manda un aviso a todos los navegadores de unas personas.
 *
 * Devuelve cuántos salieron. Las suscripciones que el servicio da por muertas
 * se borran aquí mismo: un 404 o un 410 significa que ese navegador ya no
 * existe, y sin borrarlo se le escribe en cada partido para siempre.
 */
async function repartir({ quinielaId, usuarios, mensaje, enviar, quiniela, contador }) {
  const destinatarios = await suscripcionesDe(quinielaId, usuarios);
  let salieron = 0;

  for (const destinatario of destinatarios) {
    try {
      const r = await enviar({ destinatario, quiniela, mensaje });
      if (r?.muerta) { await olvidarMuerta(destinatario.endpoint); contador.muertas += 1; continue; }
      if (r?.ok !== false) { salieron += 1; contador.notificaciones += 1; }
    } catch (error) {
      console.error(`No se pudo notificar a ${destinatario.endpoint.slice(0, 40)}…:`, error.message);
    }
  }

  return salieron;
}

/**
 * Recorre las quinielas activas y manda lo que toque.
 *
 * `enviar` recibe `{ destinatario, quiniela, mensaje }` y devuelve `{ ok }`, o
 * `{ ok: false, muerta: true }` si ese navegador ya no existe. Se inyecta para
 * que las pruebas no salgan a la red.
 */
async function notificarDeTodas({
  ahora = new Date(), enviar,
  antelacionMinutos = ANTELACION_MINUTOS,
  horasAvisoPrevio = HORAS_AVISO_PREVIO,
  toleranciaAvisoPrevio = TOLERANCIA_AVISO_PREVIO_MINUTOS
} = {}) {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre FROM quinielas WHERE estado = 'activa'`);

  const contador = { notificaciones: 0, avisados: 0, previos: 0, muertas: 0 };

  for (const quiniela of quinielas) {
    /* ---------- Dos horas antes: la jornada va a arrancar ---------- */

    for (const jornada of await jornadasParaAvisoPrevio(quiniela.id,
      { ahora, horas: horasAvisoPrevio, toleranciaMinutos: toleranciaAvisoPrevio })) {
      const usuarios = await losQueNoHanTerminado(quiniela.id, jornada);
      if (!usuarios.length) {
        /*
         * ⚠️ Se marca IGUAL aunque no haya nadie a quien avisar. Si no, la
         * jornada se volvería a mirar cada minuto durante las dos horas para
         * volver a no avisar a nadie — y en cuanto alguien borrara un
         * pronóstico, saldría un aviso a destiempo.
         */
        await marcarAvisoPrevio(quiniela.id, jornada.id, { ahora });
        continue;
      }

      const salieron = await repartir({
        quinielaId: quiniela.id, usuarios, quiniela, enviar, contador,
        mensaje: {
          titulo: `${jornada.nombre} arranca en ${horasAvisoPrevio} horas`,
          cuerpo: `Todavía te faltan pronósticos en ${quiniela.nombre}.`,
          url: '/index.html'
        }
      });

      /* Se marca DESPUÉS y sólo si alguno salió: ver la cabecera del archivo. */
      if (salieron) { contador.previos += 1; await marcarAvisoPrevio(quiniela.id, jornada.id, { ahora }); }
    }

    /* ---------- Quince minutos antes: partido a partido ---------- */

    const partidos = await paraNotificar(quiniela.id, { ahora, antelacionMinutos });
    if (!partidos.length) continue;

    /*
     * Los que NO son el primero se agrupan por hora de arranque y por persona:
     * si a las 15:00 arrancan tres y a alguien le faltan dos, recibe UN aviso
     * con esos dos, no dos avisos ni uno con los tres.
     */
    const porHoraYPersona = new Map();
    const marcar = [];

    for (const partido of partidos) {
      const usuarios = partido.esPrimero
        ? await losQueNoHanTerminado(quiniela.id, partido.jornada)
        : await losQueLesFaltaEstePartido(quiniela.id, partido.jornada.id, partido.id);

      marcar.push(partido.id);
      if (!usuarios.length) continue;

      if (partido.esPrimero) {
        /*
         * El aviso del primero habla de la JORNADA, no de ese partido: su
         * audiencia es «te falta algo», y a esa persona puede faltarle
         * cualquier otro. Decirle «pronostica este partido» cuando ése ya lo
         * tiene sería mandarla a un sitio donde no hay nada que hacer.
         */
        const salieron = await repartir({
          quinielaId: quiniela.id, usuarios, quiniela, enviar, contador,
          mensaje: {
            titulo: `${partido.jornada.nombre} arranca en ${antelacionMinutos} minutos`,
            cuerpo: `Última llamada: te faltan pronósticos en ${quiniela.nombre}.`,
            url: '/index.html'
          }
        });
        if (salieron) contador.avisados += 1;
        continue;
      }

      for (const usuarioId of usuarios) {
        const clave = `${partido.apiDate}|${usuarioId}`;
        if (!porHoraYPersona.has(clave)) porHoraYPersona.set(clave, { usuarioId, partidos: [] });
        porHoraYPersona.get(clave).partidos.push(partido);
      }
    }

    for (const { usuarioId, partidos: suyos } of porHoraYPersona.values()) {
      const uno = suyos.length === 1;
      const salieron = await repartir({
        quinielaId: quiniela.id, usuarios: [usuarioId], quiniela, enviar, contador,
        mensaje: {
          titulo: uno
            ? `${suyos[0].equipo1} vs ${suyos[0].equipo2} arranca en ${antelacionMinutos} minutos`
            : `${suyos.length} partidos arrancan en ${antelacionMinutos} minutos`,
          cuerpo: uno
            ? `Te falta pronosticarlo en ${quiniela.nombre}.`
            : `Te faltan por pronosticar en ${quiniela.nombre}.`,
          url: '/index.html'
        }
      });
      if (salieron) contador.avisados += 1;
    }

    /*
     * ⛔ Los partidos de la ventana se marcan AUNQUE no se avisara a nadie.
     *
     * Si no, un partido que a nadie le falta se volvería a mirar cada minuto de
     * su ventana. Y lo peor: si alguien borrase un pronóstico a falta de tres
     * minutos, recibiría un aviso cuando ya no le da tiempo a nada.
     *
     * Esto es distinto de la regla de «marcar después de enviar»: aquella
     * protege de dar por avisado lo que falló; ésta cierra la ventana de un
     * partido que ya se procesó.
     */
    await marcarNotificados(quiniela.id, marcar, { ahora });
  }

  return contador;
}

module.exports = {
  ANTELACION_MINUTOS, HORAS_AVISO_PREVIO, TOLERANCIA_AVISO_PREVIO_MINUTOS,
  suscribir, desuscribir, olvidarMuerta, cuantasTiene,
  suscripcionesDe,
  losQueNoHanTerminado, losQueLesFaltaEstePartido,
  jornadasParaAvisoPrevio, paraNotificar,
  marcarNotificados, marcarAvisoPrevio, notificarDeTodas
};

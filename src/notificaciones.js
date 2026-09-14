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

/**
 * Los navegadores a los que hay que escribir para una quiniela.
 *
 * ⚠️ `membresias` y `suscripciones_push` son tablas de PLATAFORMA: no llevan
 * RLS, así que esto va con `db.consulta` y el filtro por quiniela va ESCRITO en
 * el `WHERE`. Escrito es la única forma de que no se olvide.
 */
async function destinatariosDe(quinielaId) {
  const { rows } = await db.consulta(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.usuario_id
       FROM suscripciones_push s
       JOIN membresias m ON m.usuario_id = s.usuario_id
      WHERE m.quiniela_id = $1 AND m.estado = 'activo'`,
    [quinielaId]);

  return rows.map(r => ({
    id: r.id,
    usuarioId: r.usuario_id,
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth }
  }));
}

/* ==================== Qué partidos toca avisar ==================== */

/**
 * Los partidos que entran en la ventana ahora mismo, agrupados por hora.
 *
 * ⛔ LA VENTANA ES ABIERTA POR ABAJO: `api_date > ahora`.
 *
 * Ese `>` estricto ES la decisión de «callarse» de Marco. Un partido que ya
 * arrancó queda fuera por la propia consulta, sin necesidad de una segunda
 * comprobación que pudiera discrepar. Si el servicio estuvo caído una hora, esos
 * partidos no avisan nunca — y es lo correcto: su pronóstico ya está cerrado.
 *
 * ⚠️ Se comparan TEXTOS, y funciona porque `api_date` es «YYYY-MM-DD HH:MM» con
 * ceros a la izquierda: en ese formato el orden alfabético y el cronológico son
 * el mismo. Un partido sin hora prevista queda fuera, que es lo que toca: sin
 * hora no hay «quince minutos antes».
 *
 * Se agrupa por hora de arranque igual que el aviso por correo: si a las 15:00
 * arrancan cuatro partidos, es UNA notificación con los cuatro, no cuatro.
 */
async function paraNotificar(quinielaId, { ahora = new Date(), antelacionMinutos = ANTELACION_MINUTOS } = {}) {
  const desde = comoApiDate(ahora);
  const hasta = comoApiDate(new Date(ahora.getTime() + antelacionMinutos * 60 * 1000));

  const { rows } = await db.enQuiniela(quinielaId, async c => c.query(`
    SELECT p.id, p.equipo1, p.equipo2, p.api_date,
           jor.nombre AS jornada, jor.secuencia
      FROM partidos p
      JOIN jornadas jor ON jor.id = p.jornada_id
     WHERE p.notificado_en IS NULL
       AND p.api_date > $1
       AND p.api_date <= $2
     ORDER BY p.api_date, jor.secuencia, p.orden`,
    [desde, hasta]));

  const porHora = new Map();

  for (const p of rows) {
    if (!porHora.has(p.api_date)) {
      porHora.set(p.api_date, { apiDate: p.api_date, jornada: p.jornada, partidos: [] });
    }
    porHora.get(p.api_date).partidos.push({
      id: p.id, equipo1: p.equipo1, equipo2: p.equipo2
    });
  }

  return [...porHora.values()];
}

/** Deja constancia de que estos partidos ya avisaron. */
async function marcarNotificados(quinielaId, partidoIds, { ahora = new Date() } = {}) {
  if (!partidoIds?.length) return 0;

  const { rowCount } = await db.enQuiniela(quinielaId, async c => c.query(
    `UPDATE partidos SET notificado_en = $2
      WHERE id = ANY($1::uuid[]) AND notificado_en IS NULL`,
    [partidoIds, ahora]));

  return rowCount;
}

/* ==================== El barrido ==================== */

/**
 * Recorre las quinielas activas y manda lo que toque.
 *
 * `enviar` recibe `{ destinatario, quiniela, grupo, mensaje }` y devuelve
 * `{ ok }` o `{ ok: false, muerta: true }` si el servicio dice que ese navegador
 * ya no existe. Se inyecta para que las pruebas no salgan a la red.
 */
async function notificarDeTodas({ ahora = new Date(), enviar, antelacionMinutos = ANTELACION_MINUTOS }) {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre FROM quinielas WHERE estado = 'activa'`);

  let notificaciones = 0;
  let avisados = 0;
  let muertas = 0;

  for (const quiniela of quinielas) {
    const grupos = await paraNotificar(quiniela.id, { ahora, antelacionMinutos });
    if (!grupos.length) continue;

    /*
     * ⚠️ Los destinatarios se piden UNA vez por quiniela, no por grupo: son los
     * mismos para todos los grupos de esa quiniela, y pedirlos dentro del bucle
     * sería el mismo N+1 que ya se quitó dos veces en este proyecto.
     */
    const destinatarios = await destinatariosDe(quiniela.id);
    if (!destinatarios.length) continue;

    for (const grupo of grupos) {
      const cuantos = grupo.partidos.length;
      const mensaje = {
        titulo: cuantos === 1
          ? `${grupo.partidos[0].equipo1} vs ${grupo.partidos[0].equipo2} arranca en ${antelacionMinutos} min`
          : `${cuantos} partidos arrancan en ${antelacionMinutos} min`,
        cuerpo: `${quiniela.nombre} · ${grupo.jornada}. Revisa tus pronósticos antes de que cierren.`,
        url: '/index.html'
      };

      let alguno = false;

      for (const destinatario of destinatarios) {
        try {
          const r = await enviar({ destinatario, quiniela, grupo, mensaje });
          if (r?.muerta) { await olvidarMuerta(destinatario.endpoint); muertas += 1; continue; }
          if (r?.ok !== false) { notificaciones += 1; alguno = true; }
        } catch (error) {
          console.error(`No se pudo notificar a ${destinatario.endpoint.slice(0, 40)}…:`, error.message);
        }
      }

      /*
       * ⛔ Se marca DESPUÉS, y sólo si alguno salió.
       *
       * Marcar antes de enviar deja a todo el mundo sin aviso y sin rastro de
       * que debió haberlo: el partido quedaría como notificado para siempre. Es
       * la misma regla que en `avisarDeTodas` (Entrada 086).
       */
      if (alguno) {
        avisados += await marcarNotificados(quiniela.id, grupo.partidos.map(p => p.id), { ahora });
      }
    }
  }

  return { notificaciones, avisados, muertas };
}

module.exports = {
  ANTELACION_MINUTOS,
  suscribir, desuscribir, olvidarMuerta, cuantasTiene, destinatariosDe,
  paraNotificar, marcarNotificados, notificarDeTodas
};

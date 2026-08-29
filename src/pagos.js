/*
 * Los abonos, y las cuentas de cada jugador.
 *
 * ============================================================================
 * ⚠️ LOS ABONOS NO SE EDITAN NI SE BORRAN
 * ============================================================================
 *
 * Un abono mal anotado se corrige con un **asiento inverso** que apunta al
 * original. El día que alguien diga «yo sí pagué», la discusión se resuelve
 * mirando el historial —no la palabra de quien pudo reescribirlo—. Por eso
 * aquí no hay ni `actualizar` ni `eliminar`: sólo `registrar` y `anular`.
 *
 * ============================================================================
 * LAS CUENTAS SE CALCULAN, NO SE GUARDAN
 * ============================================================================
 *
 * No hay ninguna columna «saldo». Se suma lo abonado, se suma lo que costaron
 * sus jornadas y se resta. Es la misma decisión que el ranking: si mañana se
 * borra una jornada o se corrige un abono, la cuenta sale bien sola. Un
 * contador que se va descontando se desincroniza en cuanto algo cambia, y
 * cuando se descubre ya nadie sabe cuál era el número bueno.
 *
 * La aritmética vive en `src/cobros.js`, que es pura. Aquí sólo se van a
 * buscar los datos.
 */
'use strict';

const db = require('./db');
const cobros = require('./cobros');

/**
 * Todos los abonos de una quiniela, del más nuevo al más viejo.
 *
 * ⚠️ `monto` y `precio` son `numeric`, y el cliente `pg` los entrega como
 * CADENA para no perder precisión. No se convierten aquí a propósito: los
 * convierte `cobros.aMonto` en el único sitio donde se suman.
 */
async function deQuiniela(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      /*
       * ⚠️ El nombre del jugador viene de aquí, no se cruza en la pantalla.
       *
       * Cruzarlo contra la lista de cuentas obligaría a pedir las dos cosas y
       * en ese orden; el día que alguien cambie el orden de las llamadas, el
       * historial se queda sin nombres **sin fallar**. Y un historial de dinero
       * que no dice de quién es cada asiento no sirve para nada: era imposible
       * saber a quién anularle un abono.
       */
      `SELECT p.id, p.jugador_id, p.concepto, p.monto, p.nota,
              p.anula_a, p.created_at,
              j.nombre   AS jugador,
              u.username AS registrado_por
         FROM pagos p
         JOIN jugadores j ON j.id = p.jugador_id
         LEFT JOIN usuarios u ON u.id = p.registrado_por
        ORDER BY p.created_at DESC, p.id`);
    return rows;
  });
}

/** Los abonos de un jugador, del más nuevo al más viejo. */
async function deJugador(quinielaId, jugadorId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `SELECT p.id, p.concepto, p.monto, p.nota, p.anula_a, p.created_at,
              u.username AS registrado_por
         FROM pagos p
         LEFT JOIN usuarios u ON u.id = p.registrado_por
        WHERE p.jugador_id = $1
        ORDER BY p.created_at DESC, p.id`,
      [jugadorId]);
    return rows;
  });
}

/** Anota un abono. `monto` puede ser negativo sólo si anula a otro. */
async function registrar(quinielaId, { jugadorId, concepto, monto, nota, registradoPor }) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [p] } = await c.query(
      `INSERT INTO pagos (quiniela_id, jugador_id, concepto, monto, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, jugador_id, concepto, monto, nota, created_at`,
      [quinielaId, jugadorId, concepto, monto, nota || '', registradoPor || null]);
    return p;
  });
}

/**
 * Anula un abono con su inverso.
 *
 * ⚠️ Las dos cosas van en la MISMA transacción, y el índice único sobre
 * `anula_a` es lo que impide anular dos veces el mismo asiento. Sin él, dos
 * pulsaciones seguidas restarían el doble y la cuenta quedaría mal **sin que
 * nada avisara**: no hay error, sólo un número que no cuadra.
 */
async function anular(quinielaId, pagoId, { registradoPor, nota } = {}) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [original] } = await c.query(
      'SELECT id, jugador_id, concepto, monto, anula_a FROM pagos WHERE id = $1',
      [pagoId]);

    if (!original) return { ok: false, motivo: 'no-existe' };

    // Un asiento de corrección no se corrige: se anota otro abono si hace falta.
    if (original.anula_a) return { ok: false, motivo: 'es-una-anulacion' };

    const { rows: [yaAnulado] } = await c.query(
      'SELECT id FROM pagos WHERE anula_a = $1', [pagoId]);
    if (yaAnulado) return { ok: false, motivo: 'ya-anulado' };

    const { rows: [inverso] } = await c.query(
      `INSERT INTO pagos (quiniela_id, jugador_id, concepto, monto, nota,
                          registrado_por, anula_a)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, monto, created_at`,
      [quinielaId, original.jugador_id, original.concepto,
       -Number(original.monto), nota || 'Corrección', registradoPor || null, pagoId]);

    return { ok: true, inverso };
  });
}

/**
 * La cuenta de cada jugador de la quiniela.
 *
 * Se trae todo de una vez —jugadores, jornadas y abonos— y se cruza en
 * memoria. Son tres consultas fijas, no tres por jugador: con veinte personas
 * y treinta jornadas, hacerlo por jugador serían sesenta viajes a la base para
 * pintar una tabla.
 */
async function cuentas(quinielaId, configuracion) {
  const { jugadores, jornadas, pagos } = await db.enQuiniela(quinielaId, async c => {
    const [j, jo, p] = await Promise.all([
      c.query(`SELECT id, nombre, usuario_id, cobrar_desde, juega_torneo, juega_jornadas, juega_acumulado
                 FROM jugadores ORDER BY nombre`),
      c.query('SELECT id, nombre, secuencia, precio, al_acumulado FROM jornadas ORDER BY secuencia'),
      c.query('SELECT jugador_id, concepto, monto FROM pagos')
    ]);
    return { jugadores: j.rows, jornadas: jo.rows, pagos: p.rows };
  });

  const porJugador = new Map();
  for (const pago of pagos) {
    if (!porJugador.has(pago.jugador_id)) porJugador.set(pago.jugador_id, []);
    porJugador.get(pago.jugador_id).push(pago);
  }

  return jugadores.map(jugador => ({
    jugadorId: jugador.id,
    nombre: jugador.nombre,
    tieneCuenta: Boolean(jugador.usuario_id),
    cobrarDesde: jugador.cobrar_desde,
    juegaTorneo: jugador.juega_torneo,
    juegaJornadas: jugador.juega_jornadas,
    juegaAcumulado: jugador.juega_acumulado,
    ...cobros.cuentaDeJugador({
      jugador: {
        juegaTorneo: jugador.juega_torneo,
        juegaJornadas: jugador.juega_jornadas,
        juegaAcumulado: jugador.juega_acumulado,
        cobrarDesde: jugador.cobrar_desde
      },
      jornadas,
      pagos: porJugador.get(jugador.id) || [],
      cobros: configuracion?.cobros
    })
  }));
}

/**
 * La cuenta de UN jugador, más el estado de cada una de sus jornadas.
 *
 * Es lo que ve el propio jugador: su saldo y, jornada por jornada, si le quedó
 * pagada. Eso último **sí es exacto** —el precio de cada jornada ya está
 * fijado—, a diferencia de la estimación de «te quedan 3».
 */
async function cuentaDetallada(quinielaId, jugadorId, configuracion) {
  const { jugador, jornadas, pagos } = await db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      `SELECT id, nombre, cobrar_desde, juega_torneo, juega_jornadas, juega_acumulado
         FROM jugadores WHERE id = $1`,
      [jugadorId]);
    if (!j) return { jugador: null, jornadas: [], pagos: [] };

    const [jo, p] = await Promise.all([
      c.query('SELECT id, nombre, secuencia, precio, al_acumulado FROM jornadas ORDER BY secuencia'),
      c.query('SELECT concepto, monto FROM pagos WHERE jugador_id = $1', [jugadorId])
    ]);
    return { jugador: j, jornadas: jo.rows, pagos: p.rows };
  });

  if (!jugador) return null;

  const suyo = {
    juegaTorneo: jugador.juega_torneo,
    juegaJornadas: jugador.juega_jornadas,
    juegaAcumulado: jugador.juega_acumulado,
    cobrarDesde: jugador.cobrar_desde
  };
  const cuenta = cobros.cuentaDeJugador({
    jugador: suyo, jornadas, pagos, cobros: configuracion?.cobros
  });

  const desde = jugador.cobrar_desde === null ? -Infinity : Number(jugador.cobrar_desde);

  return {
    jugadorId: jugador.id,
    nombre: jugador.nombre,
    ...cuenta,
    jornadas: jornadas
      .filter(j => Number(j.secuencia) >= desde)
      .map(j => ({
        id: j.id,
        nombre: j.nombre,
        /*
         * ⚠️ Lo que le toca pagar a ESTA persona, no lo que cuesta la jornada.
         * Quien no juega el acumulado paga sólo la parte de jornada, y ponerle
         * el total sería enseñarle una deuda que no tiene —y que además no
         * cuadraría con el «pagada ✅» de al lado, que sí lo tiene en cuenta—.
         */
        precio: cobros.precioParaJugador(j, jugador.juega_acumulado !== false),
        pagada: cobros.jornadaPagada({ jugador: suyo, jornadas, pagos, jornadaId: j.id })
      }))
  };
}

/**
 * Cambia si un jugador entra al torneo completo y desde qué jornada se le cobra.
 *
 * Sólo lo toca un administrador, y a mano: son las dos cosas que no se pueden
 * deducir solas cuando alguien entra a mitad de temporada.
 */
/**
 * Cambia lo que se le cobra a un jugador.
 *
 * ⚠️ Cada campo se toca SÓLO si vino. `COALESCE($n, columna)` deja el valor
 * anterior cuando el parámetro es nulo, así que mandar una casilla no borra la
 * otra: la pantalla envía una sola cuando se marca, y la que no viaja se queda
 * como estaba.
 *
 * `cobrarDesde` necesita su propio interruptor porque su valor legítimo puede
 * ser `null` —«desde siempre»— y con `COALESCE` no habría forma de ponerlo.
 */
async function ajustarJugador(quinielaId, jugadorId, { juegaTorneo, juegaJornadas, juegaAcumulado, cobrarDesde }) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      `UPDATE jugadores
          SET juega_torneo    = COALESCE($2, juega_torneo),
              juega_jornadas  = COALESCE($5, juega_jornadas),
              juega_acumulado = COALESCE($6, juega_acumulado),
              cobrar_desde    = CASE WHEN $4 THEN $3 ELSE cobrar_desde END
        WHERE id = $1
        RETURNING id, nombre, juega_torneo, juega_jornadas, juega_acumulado, cobrar_desde`,
      [jugadorId,
       juegaTorneo === undefined ? null : Boolean(juegaTorneo),
       cobrarDesde === undefined || cobrarDesde === null ? null : Number(cobrarDesde),
       cobrarDesde !== undefined,
       juegaJornadas === undefined ? null : Boolean(juegaJornadas),
       juegaAcumulado === undefined ? null : Boolean(juegaAcumulado)]);
    return j || null;
  });
}

/**
 * La secuencia desde la que se le cobra a alguien que entra ahora.
 *
 * Es la de la jornada siguiente a la última creada: quien entra hoy no debe
 * las que ya se jugaron. Si no hay ninguna jornada todavía, se le cobra desde
 * el principio, que es lo mismo que decir «desde la primera que se cree».
 */
async function proximaSecuencia(cliente) {
  const { rows: [fila] } = await cliente.query(
    'SELECT COALESCE(MAX(secuencia), 0) + 1 AS siguiente FROM jornadas');
  return Number(fila.siguiente);
}

/* ==================== Los botes ==================== */

/**
 * Cuánto hay en el premio de cada jornada y en el acumulado.
 *
 * Se trae todo de una vez y se cruza en memoria, igual que `cuentas`: tres
 * consultas fijas en vez de tres por jugador.
 *
 * ⚠️ El acumulado disponible es lo cobrado MENOS lo ya entregado. Sin restar
 * las entregas, el bote seguiría mostrando dinero que ya se repartió.
 */
async function botes(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const [j, jo, p, e] = await Promise.all([
      c.query(`SELECT id, cobrar_desde, juega_jornadas, juega_acumulado FROM jugadores`),
      c.query('SELECT id, nombre, secuencia, precio, al_acumulado FROM jornadas ORDER BY secuencia'),
      c.query('SELECT jugador_id, concepto, monto FROM pagos'),
      c.query('SELECT COALESCE(sum(monto), 0) AS total FROM entregas_acumulado')
    ]);

    const pagosPorJugador = new Map();
    for (const pago of p.rows) {
      if (!pagosPorJugador.has(pago.jugador_id)) pagosPorJugador.set(pago.jugador_id, []);
      pagosPorJugador.get(pago.jugador_id).push(pago);
    }

    return cobros.botes({
      jugadores: j.rows.map(f => ({
        id: f.id,
        cobrarDesde: f.cobrar_desde,
        juegaJornadas: f.juega_jornadas,
        juegaAcumulado: f.juega_acumulado
      })),
      jornadas: jo.rows,
      pagosPorJugador,
      entregado: e.rows[0].total
    });
  });
}

/** Las entregas del acumulado, de la más nueva a la más vieja. */
async function entregas(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      `SELECT e.id, e.nombre_ganador, e.monto, e.nota, e.created_at,
              u.username AS registrado_por
         FROM entregas_acumulado e
         LEFT JOIN usuarios u ON u.id = e.registrado_por
        ORDER BY e.created_at DESC`);
    return rows;
  });
}

/**
 * Entrega el acumulado a alguien, y con eso el bote vuelve a empezar.
 *
 * ⚠️ El monto NO se recibe de fuera: se calcula aquí, dentro de la misma
 * transacción en la que se escribe. Si viniera del navegador, dos pestañas
 * abiertas podrían entregar dos veces el mismo dinero, o entregar una cifra que
 * ya cambió porque alguien acaba de abonar.
 *
 * ⛔ Y una entrega no se edita ni se borra —la base ni siquiera se lo permite a
 * la aplicación—. Si se anotó mal, se corrige con otra. El dinero entregado es
 * historia, igual que los abonos.
 */
async function entregarAcumulado(quinielaId, { jugadorId, nota, registradoPor } = {}) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [jugador] } = await c.query(
      'SELECT id, nombre FROM jugadores WHERE id = $1', [jugadorId]);

    if (!jugador) return { ok: false, motivo: 'jugador_no_encontrado' };

    const estado = await botes(quinielaId);
    const monto = estado.acumulado.disponible;

    if (!(monto > 0)) return { ok: false, motivo: 'sin_acumulado' };

    const { rows: [entrega] } = await c.query(
      `INSERT INTO entregas_acumulado
         (quiniela_id, jugador_id, nombre_ganador, monto, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre_ganador, monto, created_at`,
      [quinielaId, jugador.id, jugador.nombre, monto, nota || '', registradoPor || null]);

    return { ok: true, entrega };
  });
}

module.exports = {
  deQuiniela, deJugador,
  registrar, anular,
  cuentas, cuentaDetallada,
  ajustarJugador, proximaSecuencia,
  botes, entregas, entregarAcumulado
};

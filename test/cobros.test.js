/*
 * Cobros: la cuota del torneo y la cuota por jornada.
 *
 * Todo esto es aritmética pura —no toca la base ni la red—, y se prueba a
 * fondo porque **es lo primero del sistema que cuenta dinero**. Un error aquí
 * no rompe nada: le dice a alguien que debe cuando no debe, y eso acaba en una
 * discusión entre personas que la aplicación provocó.
 *
 * Cuatro cosas se vigilan con especial cuidado:
 *
 *   - **El precio de una jornada es el que tenía ELLA**, no el de hoy. Subir el
 *     precio no puede recalcular hacia atrás lo que la gente ya debía.
 *   - **El saldo es dinero, no jornadas.** «Te quedan 3» es una estimación al
 *     precio de hoy, y se marca como tal.
 *   - **Las dos cuentas no se mezclan.** Lo del torneo no paga jornadas.
 *   - **`numeric` llega como cadena** desde PostgreSQL. Sumar sin convertir
 *     concatena.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cobros = require('../src/cobros');

/** Jornadas de una quiniela, con el precio que tenía cada una. */
const jornadas = [
  { id: 'j1', secuencia: 1, precio: 2000 },
  { id: 'j2', secuencia: 2, precio: 2000 },
  { id: 'j3', secuencia: 3, precio: 2000 },
  { id: 'j4', secuencia: 4, precio: 5000 }   // la de finales, más cara
];

const CONFIG = { torneo: { activo: true, precio: 10000 },
                 jornada: { activo: true, precio: 2000 } };

const abono = (concepto, monto) => ({ concepto, monto });

/* ==================== Lo que se debe ==================== */

test('se deben todas las jornadas cuando no se dijo desde cuándo', () => {
  assert.equal(cobros.debePorJornadas(jornadas, null), 11000);
});

test('⚠️ quien entra en la jornada 3 no debe las dos anteriores', () => {
  /*
   * No estaba. Cobrarle lo de antes es el error que hace que alguien se sienta
   * estafado el primer día.
   */
  assert.equal(cobros.debePorJornadas(jornadas, 3), 7000);
});

test('⚠️ cada jornada cuesta LO QUE COSTÓ ELLA, no el precio de hoy', () => {
  /*
   * La cuarta valía 5000 porque el premio estaba grande. Si el cálculo mirara
   * el precio configurado (2000), esa jornada se abarataría sola y la cuenta
   * de todos cambiaría hacia atrás. Por eso el precio vive en la jornada.
   */
  assert.equal(cobros.debePorJornadas(jornadas, null), 2000 + 2000 + 2000 + 5000);
});

test('una jornada sin precio no suma nada', () => {
  assert.equal(cobros.debePorJornadas([{ secuencia: 1, precio: 0 }], null), 0);
});

/* ==================== Las dos cuentas ==================== */

test('las cuentas del torneo y de las jornadas NO se mezclan', () => {
  /*
   * Con una bolsa común, los 10000 de la cuota del torneo se los irían
   * comiendo las jornadas y nadie sabría cuánto hay puesto para el premio
   * final.
   */
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: true, cobrarDesde: null },
    jornadas,
    pagos: [abono('torneo', 10000)],
    cobros: CONFIG
  });

  assert.equal(cuenta.torneo.pendiente, 0, 'el torneo queda pagado');
  assert.equal(cuenta.jornada.saldo, -11000, 'y las jornadas siguen debiéndose enteras');
  assert.equal(cuenta.alDia, false);
});

test('quien no juega el torneo no debe su cuota', () => {
  /*
   * Quien entra a mitad de temporada juega por jornada. Sin esta marca
   * aparecería como deudor eterno de algo que nunca quiso pagar.
   */
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: false, cobrarDesde: 4 },
    jornadas,
    pagos: [abono('jornada', 5000)],
    cobros: CONFIG
  });

  assert.equal(cuenta.torneo.debe, 0);
  assert.equal(cuenta.jornada.debe, 5000, 'sólo la cuarta, que es desde donde entró');
  assert.equal(cuenta.alDia, true);
});

test('con los cobros apagados nadie debe nada', () => {
  /*
   * Es el estado de todas las quinielas que ya existían. Desplegar esto no
   * puede hacer que a nadie le aparezca una deuda.
   */
  const cuenta = cobros.cuentaDeJugador({
    jugador: {}, jornadas, pagos: [], cobros: cobros.COBROS_POR_DEFECTO
  });

  assert.equal(cuenta.torneo.debe, 0);
  assert.equal(cuenta.jornada.debe, 0);
  assert.equal(cuenta.alDia, true);
});

test('sin configuración de cobros se asume que no se cobra', () => {
  const cuenta = cobros.cuentaDeJugador({ jugador: {}, jornadas, pagos: [] });
  assert.equal(cuenta.alDia, true);
  assert.equal(cuenta.jornada.debe, 0);
});

/* ==================== Saldo a favor ==================== */

test('quien paga 5 jornadas por adelantado queda con saldo a favor', () => {
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: false, cobrarDesde: null },
    jornadas: jornadas.slice(0, 2),          // sólo se han jugado dos, a 2000
    pagos: [abono('jornada', 10000)],        // pagó cinco de un golpe
    cobros: CONFIG
  });

  assert.equal(cuenta.jornada.debe, 4000);
  assert.equal(cuenta.jornada.saldo, 6000);
  assert.equal(cuenta.jornada.jornadasQueCubre, 3, 'al precio de hoy');
});

test('⚠️ «te quedan 3» es una ESTIMACIÓN al precio de hoy', () => {
  /*
   * Un saldo de 6000 no son «3 jornadas»: son tres a 2000, o una a 5000 y
   * sobra. Cuántas cubra depende de lo que valgan las que vienen, y eso
   * todavía no se sabe. Por eso el saldo se lleva en dinero y esto se calcula
   * aparte.
   */
  assert.equal(cobros.jornadasQueCubre(6000, 2000), 3);
  assert.equal(cobros.jornadasQueCubre(6000, 5000), 1, 'la misma plata, otra respuesta');
});

test('sin precio no se inventa una estimación', () => {
  /*
   * Devolver 0 diría «no te alcanza para ninguna» e infinito no se puede
   * pintar. `null` obliga a quien muestra a no inventarse un número.
   */
  assert.equal(cobros.jornadasQueCubre(6000, 0), null);
});

test('el saldo negativo es lo que se debe, y no se estima nada', () => {
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: false }, jornadas, pagos: [abono('jornada', 3000)], cobros: CONFIG
  });

  assert.equal(cuenta.jornada.saldo, -8000);
  assert.equal(cuenta.jornada.jornadasQueCubre, 0,
    'con deuda la pregunta es cuánto debe, no cuántas cubre');
});

/* ==================== Correcciones ==================== */

test('⚠️ un abono mal anotado se corrige con su inverso, no borrándolo', () => {
  /*
   * El día que alguien diga «yo sí pagué», la discusión se resuelve mirando el
   * historial. Sumar todos los asientos —incluidos los negativos— da la cuenta
   * correcta sin tener que saber cuál anula a cuál.
   */
  const pagos = [
    abono('jornada', 10000),   // se anotó de más
    abono('jornada', -10000),  // el asiento que lo anula
    abono('jornada', 4000)     // el bueno
  ];

  assert.equal(cobros.totalAbonado(pagos, 'jornada'), 4000);
});

/* ==================== ¿Está pagada ESTA jornada? ==================== */

test('las jornadas se cubren en orden, y eso SÍ es exacto', () => {
  /*
   * A diferencia de la estimación, aquí el precio de cada jornada ya está
   * fijado, así que se puede decir con certeza cuáles quedaron cubiertas.
   */
  const args = {
    jugador: { cobrarDesde: null },
    jornadas,
    pagos: [abono('jornada', 6000)]   // cubre las tres de 2000
  };

  assert.equal(cobros.jornadaPagada({ ...args, jornadaId: 'j1' }), true);
  assert.equal(cobros.jornadaPagada({ ...args, jornadaId: 'j3' }), true);
  assert.equal(cobros.jornadaPagada({ ...args, jornadaId: 'j4' }), false,
    'la de finales vale 5000 y ya no queda saldo');
});

test('una jornada gratis está pagada y no consume saldo', () => {
  /*
   * Sin este caso, una quiniela que no cobra mostraría todas sus jornadas como
   * impagadas, que es exactamente lo contrario de la verdad.
   */
  const gratis = [{ id: 'g1', secuencia: 1, precio: 0 }, { id: 'g2', secuencia: 2, precio: 2000 }];

  assert.equal(cobros.jornadaPagada({ jugador: {}, jornadas: gratis, pagos: [], jornadaId: 'g1' }), true);
  assert.equal(cobros.jornadaPagada({
    jugador: {}, jornadas: gratis, pagos: [abono('jornada', 2000)], jornadaId: 'g2'
  }), true, 'la gratis no se comió el abono');
});

test('las jornadas anteriores a su entrada no cuentan para cubrir', () => {
  const args = {
    jugador: { cobrarDesde: 4 },
    jornadas,
    pagos: [abono('jornada', 5000)]
  };

  assert.equal(cobros.jornadaPagada({ ...args, jornadaId: 'j4' }), true,
    'sus 5000 van a la cuarta, no a pagar las tres que no le tocaban');
});

/* ==================== El dinero que llega como texto ==================== */

test('⛔ `numeric` llega de PostgreSQL como CADENA, y sumar sin convertir concatena', () => {
  /*
   * El cliente `pg` no convierte `numeric` a propósito, para no perder
   * precisión. Sin convertir, "2000" + "2000" da "20002000": el error de
   * dinero más tonto y el más difícil de ver mirando una pantalla.
   */
  const pagos = [abono('jornada', '2000'), abono('jornada', '2000.50')];
  assert.equal(cobros.totalAbonado(pagos, 'jornada'), 4000.5);

  const conTexto = cobros.debePorJornadas([{ secuencia: 1, precio: '2000' }], null);
  assert.equal(conTexto, 2000);
  assert.equal(typeof conTexto, 'number');
});

test('la basura no rompe la cuenta', () => {
  assert.equal(cobros.totalAbonado([null, { concepto: 'jornada', monto: 'x' }], 'jornada'), 0);
  assert.equal(cobros.debePorJornadas([null, undefined], null), 0);
  assert.equal(cobros.aMonto('no es plata'), 0);
});

test('los precios negativos de la configuración se ignoran', () => {
  const config = cobros.normalizarCobros({ cobros: { jornada: { activo: true, precio: -500 } } });
  assert.equal(config.jornada.precio, 0, 'un precio negativo pagaría por jugar');
});


/* ============ A quién se le cobran las jornadas ============ */

/*
 * La casilla «Se le cobran las jornadas», gemela de la del torneo. La pidió el
 * usuario para poder eximir a alguien —el caso que la motivó: que un
 * administrador no pague— y vale para cualquier persona, no sólo para quien
 * administra.
 */

const JORNADAS = [
  { secuencia: 1, precio: 2000 },
  { secuencia: 2, precio: 2000 }
];

const COBRA_JORNADAS = { jornada: { activo: true, precio: 2000 }, torneo: { activo: false, precio: 0 } };

test('⛔ a quien no se le cobran las jornadas no debe nada, aunque la quiniela cobre', () => {
  const exento = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: false },
    jornadas: JORNADAS,
    pagos: [],
    cobros: COBRA_JORNADAS
  });

  assert.equal(exento.jornada.debe, 0, 'no se le cobra nada');
  assert.equal(exento.jornada.juega, false, 'y se dice, para que la pantalla no lo pinte como al día');
  assert.equal(exento.jornada.alDia, true);

  // Y quien sí paga, sigue debiendo lo de siempre.
  const normal = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: true },
    jornadas: JORNADAS,
    pagos: [],
    cobros: COBRA_JORNADAS
  });

  assert.equal(normal.jornada.debe, 4000, 'a los demás no les cambia nada');
});

test('⚠️ sin el campo, se cobra: el valor por defecto de una duda sobre dinero es cobrar', () => {
  /*
   * Un jugador que llegue sin `juegaJornadas` —de una consulta vieja, de un
   * arnés que no lo pase— tiene que pagar. Si el defecto fuera «exento», una
   * consulta a la que se le olvide la columna perdonaría la deuda de todos
   * **sin dar ningún error**.
   */
  const cuenta = cobros.cuentaDeJugador({
    jugador: {},
    jornadas: JORNADAS,
    pagos: [],
    cobros: COBRA_JORNADAS
  });

  assert.equal(cuenta.jornada.debe, 4000);
  assert.equal(cuenta.jornada.juega, true);
});

test('⛔ eximir a alguien NO le borra lo que ya había abonado', () => {
  /*
   * Decisión del usuario: lo pagado queda como saldo a favor. El historial no
   * se toca, y si se le vuelve a marcar la casilla su dinero sigue contando.
   */
  const pagos = [{ concepto: 'jornada', monto: '6000' }];

  const exento = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: false },
    jornadas: JORNADAS,
    pagos,
    cobros: COBRA_JORNADAS
  });

  assert.equal(exento.jornada.debe, 0);
  assert.equal(exento.jornada.abonado, 6000, 'sus abonos siguen ahí');
  assert.equal(exento.jornada.saldo, 6000, 'y salen como saldo a favor');

  // Y al volver a marcársela, la cuenta vuelve a salir como antes.
  const otraVez = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: true },
    jornadas: JORNADAS,
    pagos,
    cobros: COBRA_JORNADAS
  });

  assert.equal(otraVez.jornada.debe, 4000);
  assert.equal(otraVez.jornada.saldo, 2000, 'los 6000 menos las dos jornadas');
});

test('las dos casillas son independientes', () => {
  const soloTorneo = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: true, juegaJornadas: false },
    jornadas: JORNADAS,
    pagos: [],
    cobros: { torneo: { activo: true, precio: 10000 }, jornada: { activo: true, precio: 2000 } }
  });

  assert.equal(soloTorneo.torneo.debe, 10000, 'el torneo sí');
  assert.equal(soloTorneo.jornada.debe, 0, 'las jornadas no');

  const soloJornadas = cobros.cuentaDeJugador({
    jugador: { juegaTorneo: false, juegaJornadas: true },
    jornadas: JORNADAS,
    pagos: [],
    cobros: { torneo: { activo: true, precio: 10000 }, jornada: { activo: true, precio: 2000 } }
  });

  assert.equal(soloJornadas.torneo.debe, 0);
  assert.equal(soloJornadas.jornada.debe, 4000);
});

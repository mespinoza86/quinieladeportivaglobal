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

/* ==================== El acumulado ==================== */

/*
 * De cada cuota, una parte es el premio de esa jornada y otra se va guardando
 * para el ganador de la tabla general al final del torneo.
 *
 * Lo que se vigila aquí:
 *
 *   - **El reparto vive en la jornada**, congelado como el precio. Cambiar hoy
 *     «mil y mil» a «dos mil y cero» no puede reinterpretar el bote de octubre.
 *   - **Quien no juega el acumulado paga menos**, no paga igual y se le
 *     devuelve.
 *   - **El bote es lo COBRADO**, no lo esperado. Un premio anunciado con dinero
 *     que nadie ha puesto es una promesa que alguien tiene que cubrir.
 *   - **Un abono a medias paga primero el premio de la jornada.** Hay que
 *     elegir un orden; éste es el que deja el bote como lo último que se llena.
 */

/** Dos jornadas de ₡2.000, mil de premio y mil al bote. */
const CON_BOTE = [
  { id: 'b1', secuencia: 1, precio: 2000, al_acumulado: 1000 },
  { id: 'b2', secuencia: 2, precio: 2000, al_acumulado: 1000 }
];

test('quien no juega el acumulado paga sólo la parte de la jornada', () => {
  assert.equal(cobros.precioParaJugador(CON_BOTE[0], true), 2000);
  assert.equal(cobros.precioParaJugador(CON_BOTE[0], false), 1000);
});

test('⚠️ sin el campo, se cobra completo', () => {
  /*
   * Misma regla que las otras dos casillas: el valor por defecto de una duda
   * sobre dinero es cobrar. Un jugador que venga de una consulta vieja, sin el
   * campo, no puede quedar eximido del bote sin que nadie lo decidiera.
   */
  assert.equal(cobros.precioParaJugador(CON_BOTE[0], undefined), 2000);
  assert.equal(cobros.precioParaJugador(CON_BOTE[0]), 2000);

  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: true },      // sin `juegaAcumulado`
    jornadas: CON_BOTE,
    pagos: [],
    cobros: { jornada: { activo: true, precio: 2000, alAcumulado: 1000 } }
  });

  assert.equal(cuenta.jornada.debe, 4000, 'las dos completas');
  assert.equal(cuenta.jornada.juegaAcumulado, true);
});

test('a quien no juega el acumulado se le deben sólo los premios de jornada', () => {
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: true, juegaAcumulado: false },
    jornadas: CON_BOTE,
    pagos: [],
    cobros: { jornada: { activo: true, precio: 2000, alAcumulado: 1000 } }
  });

  assert.equal(cuenta.jornada.debe, 2000, 'mil por jornada, no dos mil');
  assert.equal(cuenta.jornada.juegaAcumulado, false);
});

test('⚠️ y su estimación «te alcanza para N» va a SU precio, no al de la lista', () => {
  /*
   * Con el precio completo le diríamos que ₡2.000 le alcanzan para una jornada
   * cuando le alcanzan para dos. La estimación ya era delicada; con dos precios
   * distintos conviviendo, usar el que no es se vuelve fácil.
   */
  const cuenta = cobros.cuentaDeJugador({
    jugador: { juegaJornadas: true, juegaAcumulado: false },
    jornadas: CON_BOTE,
    pagos: [abono('jornada', '4000')],
    cobros: { jornada: { activo: true, precio: 2000, alAcumulado: 1000 } }
  });

  assert.equal(cuenta.jornada.saldo, 2000, 'pagó 4000 y sólo debía 2000');
  assert.equal(cuenta.jornada.precioActual, 1000, 'su precio, no el de la lista');
  assert.equal(cuenta.jornada.jornadasQueCubre, 2);
});

test('el reparto congelado en la jornada manda sobre la configuración de hoy', () => {
  /*
   * La misma razón por la que el precio vive en la jornada. La configuración de
   * hoy no entra en este cálculo: los números salen de lo que guardó cada
   * jornada, así que cambiarla mañana no reinterpreta el bote de octubre.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '4000')]]]),
    entregado: 0
  });

  assert.equal(estado.acumulado.cobrado, 2000, 'mil de cada jornada');
  assert.deepEqual(estado.jornadas.map(j => j.premio), [1000, 1000]);
});

test('⚠️ el bote es lo COBRADO, y se dice al lado cuánto se espera', () => {
  /*
   * Dos jugadores, uno pagó todo y el otro nada. Si el bote enseñara lo
   * esperado, se anunciaría un premio de ₡4.000 cuando en la mano hay ₡2.000.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }, { id: 'p2' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '4000')]]]),
    entregado: 0
  });

  assert.equal(estado.acumulado.cobrado, 2000, 'sólo lo que entró');
  assert.equal(estado.acumulado.esperado, 4000, 'lo que entrará si todos pagan');
  assert.deepEqual(estado.jornadas.map(j => j.premio), [1000, 1000]);
  assert.deepEqual(estado.jornadas.map(j => j.esperado), [2000, 2000]);
});

test('un abono a medias llena primero el premio de la jornada', () => {
  /*
   * ₡1.500 de una jornada de ₡2.000: ₡1.000 al premio y los ₡500 que sobran al
   * bote. Al revés —bote primero— el premio de la jornada que se está jugando
   * saldría corto mientras el bote, que no se entrega hasta el final, va lleno.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '1500')]]]),
    entregado: 0
  });

  assert.equal(estado.jornadas[0].premio, 1000, 'el premio primero, completo');
  assert.equal(estado.acumulado.cobrado, 500, 'y lo que sobró al bote');
  assert.equal(estado.jornadas[1].premio, 0, 'la segunda ni empezó');
});

test('lo que no llega ni al premio de la primera jornada no toca el bote', () => {
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '600')]]]),
    entregado: 0
  });

  assert.equal(estado.jornadas[0].premio, 600);
  assert.equal(estado.acumulado.cobrado, 0);
});

test('⛔ el abono del torneo no entra en ningún bote de jornada', () => {
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('torneo', '10000')]]]),
    entregado: 0
  });

  assert.equal(estado.acumulado.cobrado, 0);
  assert.deepEqual(estado.jornadas.map(j => j.premio), [0, 0]);
});

test('quien no juega el acumulado aporta todo su abono al premio de la jornada', () => {
  const estado = cobros.botes({
    jugadores: [{ id: 'p1', juegaAcumulado: false }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '2000')]]]),
    entregado: 0
  });

  assert.equal(estado.acumulado.cobrado, 0, 'ni un colón al bote');
  assert.equal(estado.acumulado.esperado, 0, 'y tampoco se espera de él');
  assert.deepEqual(estado.jornadas.map(j => j.premio), [1000, 1000],
    'sus 2000 pagaron las dos jornadas enteras');
});

test('a quien no se le cobran las jornadas no se le espera nada, en ningún bote', () => {
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }, { id: 'p2', juegaJornadas: false }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map(),
    entregado: 0
  });

  assert.equal(estado.acumulado.esperado, 2000, 'sólo lo del que sí paga');
  assert.deepEqual(estado.jornadas.map(j => j.esperado), [1000, 1000]);
});

test('a quien entró a mitad no se le espera lo de antes de entrar', () => {
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }, { id: 'p2', cobrarDesde: 2 }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map(),
    entregado: 0
  });

  assert.deepEqual(estado.jornadas.map(j => j.esperado), [1000, 2000]);
  assert.equal(estado.acumulado.esperado, 3000);
});

test('⚠️ lo entregado se resta del disponible, y lo cobrado no se toca', () => {
  /*
   * Sin restar las entregas el bote seguiría enseñando dinero que ya se
   * repartió, y alguien lo entregaría dos veces. `cobrado` se conserva aparte
   * porque es historia: es cuánto se juntó, aunque ya no esté.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: CON_BOTE,
    pagosPorJugador: new Map([['p1', [abono('jornada', '4000')]]]),
    entregado: '1500'                      // cadena, como llega de `numeric`
  });

  assert.equal(estado.acumulado.cobrado, 2000);
  assert.equal(estado.acumulado.entregado, 1500);
  assert.equal(estado.acumulado.disponible, 500);
});

test('la cuota al acumulado no puede pasarse del precio', () => {
  /*
   * La base lo impide con un CHECK, y aquí se recorta antes de llegar: una
   * configuración con el bote más grande que la cuota daría una parte de
   * jornada negativa, y eso descuadraría todas las cuentas en silencio.
   */
  const config = cobros.normalizarCobros({
    cobros: { jornada: { activo: true, precio: 2000, alAcumulado: 5000 } }
  });

  assert.equal(config.jornada.alAcumulado, 2000);
  assert.equal(config.jornada.aLaJornada, 0);
});

test('una cuota al acumulado negativa se trata como cero', () => {
  const config = cobros.normalizarCobros({
    cobros: { jornada: { activo: true, precio: 2000, alAcumulado: -1000 } }
  });

  assert.equal(config.jornada.alAcumulado, 0);
  assert.equal(config.jornada.aLaJornada, 2000);
});

test('una quiniela sin acumulado se comporta exactamente como antes', () => {
  /*
   * ⚠️ Lo que más importa de todo esto: las quinielas que ya funcionan no
   * pueden notar el cambio. Sin `alAcumulado`, el bote es cero y cada premio de
   * jornada es la cuota entera.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1' }],
    jornadas: [{ id: 'x1', secuencia: 1, precio: 2000 }],
    pagosPorJugador: new Map([['p1', [abono('jornada', '2000')]]]),
    entregado: 0
  });

  assert.equal(estado.acumulado.cobrado, 0);
  assert.equal(estado.acumulado.esperado, 0);
  assert.equal(estado.jornadas[0].premio, 2000);
});

/* ==================== Sólo se paga lo que se jugó ==================== */

/*
 * Una jornada que alguien no jugó no se le cobra, y no se le va a cobrar nunca:
 * no es que la deba más tarde, es que no la debe.
 *
 * ⛔ Y lo que más se vigila aquí no es la regla —es fácil— sino su borde:
 * distinguir «no jugó ninguna» de «no me dijeron qué jugó». Los dos dan cero, y
 * uno de los dos es un fallo que perdona la deuda de toda la quiniela.
 */

const TRES = [
  { id: 'a', secuencia: 1, precio: 2000, al_acumulado: 1000 },
  { id: 'b', secuencia: 2, precio: 2000, al_acumulado: 1000 },
  { id: 'c', secuencia: 3, precio: 2000, al_acumulado: 1000 }
];

const COBRA_2000 = { jornada: { activo: true, precio: 2000, alAcumulado: 1000 } };

test('sólo se deben las jornadas jugadas', () => {
  const cuenta = cobros.cuentaDeJugador({
    jugador: { jugadas: new Set(['a', 'c']) },
    jornadas: TRES,
    pagos: [],
    cobros: COBRA_2000
  });

  assert.equal(cuenta.jornada.debe, 4000, 'la primera y la tercera, no la del medio');
});

test('⛔ una jornada saltada NO se arrastra: nunca se cobra', () => {
  /*
   * No es un aplazamiento. Aunque después juegue todas, la que se saltó sigue
   * sin deberse: si se «recuperara» más tarde, la deuda de alguien crecería
   * sola sin que nadie hiciera nada.
   */
  const antes = cobros.cuentaDeJugador({
    jugador: { jugadas: new Set(['a']) },
    jornadas: TRES, pagos: [], cobros: COBRA_2000
  });

  const despues = cobros.cuentaDeJugador({
    jugador: { jugadas: new Set(['a', 'c']) },
    jornadas: TRES, pagos: [], cobros: COBRA_2000
  });

  assert.equal(antes.debe ?? antes.jornada.debe, 2000);
  assert.equal(despues.jornada.debe, 4000, 'sube por la tercera, NO por la segunda');
});

test('⛔ quien no jugó ninguna no debe nada', () => {
  const cuenta = cobros.cuentaDeJugador({
    jugador: { jugadas: new Set() },
    jornadas: TRES, pagos: [], cobros: COBRA_2000
  });

  assert.equal(cuenta.jornada.debe, 0);
});

test('⛔⛔ pero si NO SE DICE qué jugó, se cobra todo', () => {
  /*
   * ============================================================================
   * LA PRUEBA MÁS IMPORTANTE DE ESTE ARCHIVO
   * ============================================================================
   *
   * `undefined` significa «nadie me pasó el dato», y eso NO puede leerse como
   * «no jugó nada». Si se leyera así, una consulta a la que se le olvide traer
   * los pronósticos pondría a CERO la deuda de toda la quiniela, y la pantalla
   * se vería perfecta: todo el mundo al día.
   *
   * ⛔ La dirección del defecto importa. Cobrar de más lo reclama alguien
   * mañana; perdonar no lo reclama nadie —¿quién avisa de que debería deber
   * más?— y se descubriría al final del torneo, con el bote corto y sin forma de
   * reconstruir el número bueno, porque las cuentas se calculan y no se guardan.
   */
  const sinDato = cobros.cuentaDeJugador({
    jugador: {},                       // sin `jugadas`
    jornadas: TRES, pagos: [], cobros: COBRA_2000
  });

  assert.equal(sinDato.jornada.debe, 6000, 'las tres: que falte el dato no perdona nada');

  // Y `null` tampoco es «no jugó nada»: es otra forma de no haber traído el dato.
  const conNulo = cobros.cuentaDeJugador({
    jugador: { jugadas: null },
    jornadas: TRES, pagos: [], cobros: COBRA_2000
  });

  assert.equal(conNulo.jornada.debe, 6000);
});

test('la condición está en UN sitio, y responde a las dos preguntas', () => {
  const j = TRES[1];                                   // secuencia 2

  assert.equal(cobros.leTocaLaJornada(j, {}), true, 'sin condiciones, le toca');
  assert.equal(cobros.leTocaLaJornada(j, { cobrarDesde: 3 }), false, 'entró después');
  assert.equal(cobros.leTocaLaJornada(j, { jugadas: new Set(['b']) }), true);
  assert.equal(cobros.leTocaLaJornada(j, { jugadas: new Set(['a']) }), false, 'no la jugó');

  // Las dos a la vez: basta con que falle una.
  assert.equal(
    cobros.leTocaLaJornada(j, { cobrarDesde: 3, jugadas: new Set(['b']) }), false);
});

test('los abonos sólo se imputan a jornadas jugadas', () => {
  /*
   * Si el reparto no lo tuviera en cuenta, el dinero de alguien engordaría el
   * premio de una jornada que no jugó —y faltaría en la que sí—.
   */
  const estado = cobros.botes({
    jugadores: [{ id: 'p1', jugadas: new Set(['a', 'c']) }],
    jornadas: TRES,
    pagosPorJugador: new Map([['p1', [abono('jornada', '4000')]]]),
    entregado: 0
  });

  const premios = new Map(estado.jornadas.map(j => [j.id, j.premio]));
  assert.equal(premios.get('a'), 1000);
  assert.equal(premios.get('b'), 0, 'no la jugó: su dinero no puede caer aquí');
  assert.equal(premios.get('c'), 1000);
  assert.equal(estado.acumulado.cobrado, 2000, 'mil de cada una de las dos');
});

test('⚠️ el esperado de cada bote sólo cuenta a quien jugó esa jornada', () => {
  /*
   * Dos personas: una jugó las tres y la otra sólo la primera. El premio de la
   * segunda y la tercera no puede anunciarse contando con las dos.
   */
  const estado = cobros.botes({
    jugadores: [
      { id: 'p1', jugadas: new Set(['a', 'b', 'c']) },
      { id: 'p2', jugadas: new Set(['a']) }
    ],
    jornadas: TRES,
    pagosPorJugador: new Map(),
    entregado: 0
  });

  const esperado = new Map(estado.jornadas.map(j => [j.id, j.esperado]));
  assert.equal(esperado.get('a'), 2000, 'la jugaron los dos: 1000 + 1000');
  assert.equal(esperado.get('b'), 1000, 'sólo uno');
  assert.equal(esperado.get('c'), 1000);
  assert.equal(estado.acumulado.esperado, 4000, 'cuatro aportes de 1000');
});

test('una jornada no jugada tampoco cuenta como pagada ni como impagada', () => {
  /*
   * `jornadaPagada` se pregunta caminando por las jornadas que le tocan, y la
   * que no jugó no está en ese camino: ni consume saldo ni bloquea a las
   * siguientes.
   */
  const pagos = [abono('jornada', '2000')];

  assert.equal(cobros.jornadaPagada({
    jugador: { jugadas: new Set(['a', 'c']) }, jornadas: TRES, pagos, jornadaId: 'a'
  }), true, 'el abono cubre la primera que le toca');

  assert.equal(cobros.jornadaPagada({
    jugador: { jugadas: new Set(['b', 'c']) }, jornadas: TRES, pagos, jornadaId: 'b'
  }), true, 'saltarse la primera no deja a la segunda esperando');
});

test('el desglose dice cuánto va al premio y cuánto al bote', () => {
  const suyo = cobros.desgloseParaJugador(TRES[0], true);
  assert.deepEqual(suyo, { alPremio: 1000, alAcumulado: 1000, total: 2000 });

  const fuera = cobros.desgloseParaJugador(TRES[0], false);
  assert.deepEqual(fuera, { alPremio: 1000, alAcumulado: 0, total: 1000 },
    'el premio de la jornada es el mismo para todos; lo que cambia es el bote');
});

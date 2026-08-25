/*
 * Puntuación, pronósticos y ranking (tajada 4 de la migración).
 *
 * Cinco cosas se prueban aquí con especial cuidado, porque son las que cambian
 * de verdad respecto a Mongo y las que romperían en silencio:
 *
 *   - **El comodín se lee del partido.** En Mongo se copiaba dentro del
 *     resultado oficial y marcarlo tarde no movía los puntos.
 *   - **Una jornada congelada conserva sus comodines.** Si no, tocar una
 *     casilla en enero reescribiría la clasificación en marzo.
 *   - **Borrar un partido no descoloca los pronósticos de los demás.** Era M-02,
 *     y era un `splice` que nadie compensaba.
 *   - **El cierre es por partido**: los abiertos se guardan, los cerrados no.
 *   - **La foto congelada sustituye, no se funde.**
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielasMod = require('../src/quinielas');
const jornadas = require('../src/jornadas');
const jugadores = require('../src/jugadores');
const pronosticos = require('../src/pronosticos');
const oficiales = require('../src/oficiales');
const ranking = require('../src/ranking');
const puntuacionMod = require('../src/puntuacion');
const { normalizarMarcador } = require('../src/validacion');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

const PUNTUACION = quinielasMod.PUNTUACION_POR_DEFECTO;   // 5 / 3 / 7 / 4

let n = 0;
async function cuentaNueva(prefijo = 'u') {
  n += 1;
  return usuarios.crear({
    username: `${prefijo}${n}`, email: `${prefijo}${n}@x.com`, password: 'contrasena-larga-1'
  });
}

async function quinielaNueva() {
  const u = await cuentaNueva('dueno');
  const q = await quinielasMod.crear({ nombre: `Q-${n}`, propietarioId: u.id });
  return q;
}

/* Una fecha muy pasada cierra el partido; una muy futura lo deja abierto. */
const PASADO = '2020-01-01 12:00';
const FUTURO = '2099-01-01 12:00';

const partido = (equipo1, equipo2, extra = {}) => ({
  equipo1, equipo2, logoEquipo1: '', logoEquipo2: '',
  comodin: false, apiFixtureId: null, apiLeagueId: null,
  apiDate: FUTURO, apiStatus: null,
  ...extra
});

/** Carga los resultados oficiales de una jornada como lo haría un admin. */
async function cargarOficiales(quinielaId, jornada, marcadores) {
  return oficiales.guardarManual(quinielaId, jornada, marcadores, normalizarMarcador);
}

/** Los ids de los partidos de una jornada, en orden. */
async function idsDePartidos(quinielaId, jornada) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, jornada);
    const filas = await pronosticos.partidosDe(c, jornadaId);
    return filas.map(f => f.id);
  });
}

/* ==================== El motor, en seco ==================== */

test('el motor da los puntos de siempre: exacto, resultado y fallo', () => {
  const p = { marcador1: 2, marcador2: 1 };

  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 2, marcador2: 1 }, false, PUNTUACION), 5);
  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 3, marcador2: 0 }, false, PUNTUACION), 3);
  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 0, marcador2: 2 }, false, PUNTUACION), 0);
  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 1, marcador2: 1 }, false, PUNTUACION), 0);
});

test('un partido comodín paga con la tarifa de comodín', () => {
  const p = { marcador1: 2, marcador2: 1 };

  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 2, marcador2: 1 }, true, PUNTUACION), 7);
  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 4, marcador2: 2 }, true, PUNTUACION), 4);
  assert.equal(puntuacionMod.puntosDePartido(p, { marcador1: 0, marcador2: 1 }, true, PUNTUACION), 0);
});

test('sin pronóstico, sin resultado o con un marcador nulo, son cero puntos', () => {
  const oficial = { marcador1: 1, marcador2: 1 };

  assert.equal(puntuacionMod.puntosDePartido(null, oficial, false, PUNTUACION), 0);
  assert.equal(puntuacionMod.puntosDePartido({ marcador1: 1, marcador2: 1 }, null, false, PUNTUACION), 0);
  assert.equal(puntuacionMod.puntosDePartido({ marcador1: null, marcador2: 1 }, oficial, false, PUNTUACION), 0);
});

test('⛔ un partido que quedó 0-0 NO paga a quien dejó la casilla en blanco', () => {
  /*
   * El caso que de verdad importa, y el que faltaba: la prueba de arriba usa un
   * oficial 1-1, donde un nulo y un número nunca se parecen. Con un **0-0** sí,
   * porque `null` y `0` son la misma cosa para cualquier comparación laxa
   * —`null == 0` es falso, pero `Number(null)` es 0 y `!null` es `!0`—.
   *
   * Si esto se rompiera, todos los que no pronosticaron un partido cobrarían
   * cada empate a cero de la temporada. Y no fallaría: pagaría de más.
   */
  const cero = { marcador1: 0, marcador2: 0 };
  const puntos = pron => puntuacionMod.puntosDePartido(pron, cero, false, PUNTUACION);

  assert.equal(puntos({ marcador1: null, marcador2: null }), 0, 'no pronosticó: no cobra');
  assert.equal(puntos({ marcador1: 0, marcador2: null }), 0, 'medio pronóstico tampoco');
  assert.equal(puntos({ marcador1: null, marcador2: 0 }), 0);
  assert.equal(puntos(null), 0, 'sin fila: no cobra');

  // Y quien SÍ escribió 0-0 cobra el marcador exacto. Es lo que se protege.
  assert.equal(puntos({ marcador1: 0, marcador2: 0 }), PUNTUACION.marcadorExacto);

  /*
   * La cadena vacía no debería llegar hasta aquí —`normalizarMarcador` la
   * convierte en `null` antes— pero el motor es la última red y tiene que
   * aguantarla igual.
   */
  assert.equal(puntos({ marcador1: '', marcador2: '' }), 0, 'la red de seguridad del motor');
});

test('una jornada sin partidos no se da por terminada', () => {
  assert.equal(puntuacionMod.jornadaEstaFinalizada([], new Map()), false);
  assert.equal(puntuacionMod.jornadaEstaFinalizada(null, new Map()), false);
});

test('falta el resultado de un solo partido y la jornada sigue viva', () => {
  const partidos = [{ id: 'a' }, { id: 'b' }];
  const completos = new Map([['a', { estado: 'TC' }], ['b', { bloqueadoFinal: true }]]);
  const aMedias = new Map([['a', { estado: 'TC' }]]);

  assert.equal(puntuacionMod.jornadaEstaFinalizada(partidos, completos), true);
  assert.equal(puntuacionMod.jornadaEstaFinalizada(partidos, aMedias), false);
});

test('los empatados comparten puesto, y el siguiente salta', () => {
  const filas = puntuacionMod.repartirPuestos([
    { jugador: 'a', puntos: 10 }, { jugador: 'b', puntos: 7 },
    { jugador: 'c', puntos: 7 }, { jugador: 'd', puntos: 3 }
  ]);

  assert.deepEqual(filas.map(f => f.puesto), [1, 2, 2, 4]);
  assert.deepEqual(filas.map(f => f.empate), [false, true, true, false]);
});

/* ==================== El cierre por partido ==================== */

test('se guardan los partidos abiertos y se dejan intactos los cerrados', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiDate: FUTURO }),
    partido('C', 'D', { apiDate: PASADO })
  ]);

  const r = await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 3, marcador2: 3 }]
  });

  assert.equal(r.guardados, 1);
  assert.equal(r.bloqueados, 1);

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.deepEqual(mios.map(p => p.marcador1), [1, null], 'el cerrado no debe haberse escrito');
  assert.deepEqual(mios.map(p => p.bloqueado), [false, true]);
});

test('un partido que ya empezó no deja pisar lo que el jugador había puesto', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiDate: FUTURO })]);

  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });

  // El partido arranca: se cierra por hora, no por jornada.
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiDate: PASADO })]);

  const r = await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 9, marcador2: 9 }] });

  assert.equal(r.guardados, 0);
  assert.equal(r.bloqueados, 1);

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.deepEqual([mios[0].marcador1, mios[0].marcador2], [1, 0], 'debe conservar el pronóstico original');
});

test('el estado del resultado oficial cierra el partido aunque su hora no haya llegado', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiDate: FUTURO })]);

  const [partidoId] = await idsDePartidos(q.id, 'J1');
  await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    const ro = await oficiales.asegurarContenedor(c, q.id, jornadaId);
    await oficiales.escribir(c, q.id, ro, [{ partidoId, estado: 'LIVE', minuto: '31' }]);
  });

  const r = await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  assert.equal(r.bloqueados, 1, 'un partido en juego está cerrado aunque el calendario diga otra cosa');
});

test('un marcador inválido no guarda ninguno de los demás', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);

  await assert.rejects(
    () => pronosticos.guardar(q.id, {
      jugador: 'ana', jornada: 'J1',
      pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: -3, marcador2: 0 }]
    }),
    /entero entre 0 y 99/);

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.deepEqual(mios.map(p => p.marcador1), [null, null], 'la transacción entera se deshace');
});

test('guardar sobre lo ya guardado actualiza en vez de duplicar', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 2 }] });

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.equal(mios.length, 1);
  assert.deepEqual([mios[0].marcador1, mios[0].marcador2], [2, 2]);
});

/* ==================== M-02: la identidad del partido ==================== */

test('borrar un partido del medio no descoloca los puntos de los demás', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D'), partido('E', 'F')]);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [
      { marcador1: 1, marcador2: 0 },   // A-B  → exacto
      { marcador1: 5, marcador2: 5 },   // C-D  → fallo
      { marcador1: 2, marcador2: 2 }    // E-F  → exacto
    ]
  });

  await cargarOficiales(q.id, 'J1', [
    { marcador1: 1, marcador2: 0 }, { marcador1: 0, marcador2: 3 }, { marcador1: 2, marcador2: 2 }
  ]);

  // Se va el del medio. En Mongo, el pronóstico de E-F pasaba a ser el de C-D.
  await jornadas.eliminarPartidos(q.id, 'J1', [1]);

  const { clasificacion } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  const ana = clasificacion.find(f => f.jugador === 'ana');

  assert.equal(ana.puntos, 10, 'los dos aciertos que quedan siguen siendo aciertos: 5 + 5');
  assert.equal(ana.marcadoresExactos, 2);
});

test('cambiar el partido de una posición se lleva su pronóstico, y sólo ése', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiFixtureId: '111' }),
    partido('C', 'D', { apiFixtureId: '222' })
  ]);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 2 }]
  });

  // La segunda posición pasa a ser OTRO partido del API.
  const r = await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiFixtureId: '111' }),
    partido('X', 'Y', { apiFixtureId: '999' })
  ]);

  assert.equal(r.partidosReemplazados, 1);
  assert.equal(r.pronosticosBorrados, 1);

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.equal(mios[0].marcador1, 1, 'el que no cambió conserva su pronóstico');
  assert.equal(mios[1].marcador1, null, 'el que cambió de partido se queda sin él');
});

test('cambiar sólo el logo o la hora no borra ningún pronóstico', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });

  const r = await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiFixtureId: '111', logoEquipo1: 'nuevo.png', apiDate: '2099-02-02 18:00' })
  ]);

  assert.equal(r.pronosticosBorrados, 0);
  assert.equal((await pronosticos.deJugador(q.id, 'ana', 'J1'))[0].marcador1, 1);
});

/* ==================== El comodín ==================== */

test('marcar el comodín después de que el partido terminó SÍ mueve los puntos', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiDate: FUTURO })]);

  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);

  let tabla = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(tabla.clasificacion.find(f => f.jugador === 'ana').puntos, 5, 'sin comodín, marcador exacto');

  /*
   * Ahora el administrador marca el comodín. En Mongo esto no movía nada: el
   * partido terminado ya no se vuelve a consultar, así que la copia del comodín
   * dentro del resultado oficial se quedaba en `false` para siempre.
   */
  await jornadas.fijarComodines(q.id, 'J1', [{ comodin: true }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  tabla = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(tabla.clasificacion.find(f => f.jugador === 'ana').puntos, 7, 'con comodín, tarifa de comodín');
});

test('la carga manual ignora el comodín que venga en el cuerpo: manda la jornada', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { comodin: true })]);

  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  // El formulario manda `comodin: false`, que es justo lo que NO debe ganar.
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1, comodin: false }]);

  const { clasificacion } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(clasificacion.find(f => f.jugador === 'ana').puntos, 7);
});

/* ==================== El congelado ==================== */

test('una jornada terminada se congela, y una a medias no', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);
  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 0, marcador2: 0 }]
  });

  const [, segundo] = await idsDePartidos(q.id, 'J1');

  // Sólo el segundo tiene resultado definitivo: la jornada sigue viva.
  await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    const ro = await oficiales.asegurarContenedor(c, q.id, jornadaId);
    await oficiales.escribir(c, q.id, ro, [
      { partidoId: segundo, marcador1: 0, marcador2: 0, estado: 'TC', bloqueadoFinal: true }
    ]);
  });

  assert.equal(await ranking.actualizar(q.id, 'J1', PUNTUACION), null, 'a medias no se congela');

  await cargarOficiales(q.id, 'J1', [{ marcador1: 1, marcador2: 0 }, { marcador1: 0, marcador2: 0 }]);
  const congelado = await ranking.actualizar(q.id, 'J1', PUNTUACION);

  assert.ok(congelado, 'con todos los resultados, se congela');
  assert.equal(congelado.find(f => f.jugador === 'ana').puntos, 10);
});

test('cambiar la puntuación de la quiniela no reescribe una jornada congelada', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  // El administrador sube el marcador exacto de 5 a 10. Es M-03.
  const nueva = { ...PUNTUACION, marcadorExacto: 10 };
  await ranking.actualizar(q.id, 'J1', nueva);

  const { clasificacion } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: nueva });
  assert.equal(clasificacion.find(f => f.jugador === 'ana').puntos, 5, 'la jornada terminada se queda con sus reglas');
});

test('corregir un comodín en una jornada congelada la recalcula, pero con SUS reglas', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  /*
   * ⚠️ La distinción que sostiene todo esto: el comodín es LOCAL —quien lo marca
   * está editando esta jornada y la tiene delante— mientras que la puntuación es
   * GLOBAL y tocaría todas a la vez sin que nadie mirara ninguna. Por eso el
   * comodín corrige y la puntuación no.
   *
   * Se cambian las dos a la vez a propósito: sólo debe ganar el comodín.
   */
  await jornadas.fijarComodines(q.id, 'J1', [{ comodin: true }]);
  await ranking.actualizar(q.id, 'J1', { ...PUNTUACION, comodinExacto: 99 });

  const { clasificacion } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(clasificacion.find(f => f.jugador === 'ana').puntos, 7,
    'la tarifa de comodín es la congelada (7), no la de hoy (99)');
});

test('corregir un resultado sí recalcula, y con las reglas congeladas', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 0, marcador2: 3 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  let tabla = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(tabla.clasificacion.find(f => f.jugador === 'ana').puntos, 0);

  // El marcador estaba mal cargado. Eso sí es un hecho del juego que cambió.
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);
  await ranking.actualizar(q.id, 'J1', { ...PUNTUACION, marcadorExacto: 99 });

  tabla = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(tabla.clasificacion.find(f => f.jugador === 'ana').puntos, 5,
    'recalcula con las reglas de cuando se congeló, no con las de hoy');
});

test('reabrir un partido descongela la jornada', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  const [partidoId] = await idsDePartidos(q.id, 'J1');
  await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    const ro = await oficiales.asegurarContenedor(c, q.id, jornadaId);
    await oficiales.escribir(c, q.id, ro, [
      { partidoId, marcador1: 2, marcador2: 1, estado: 'LIVE', bloqueadoFinal: false }
    ]);
  });

  assert.equal(await ranking.actualizar(q.id, 'J1', PUNTUACION), null);

  const congelado = await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    return ranking.congeladoDe(c, jornadaId);
  });
  assert.equal(congelado, null, 'la foto se retira: la jornada vuelve a calcularse al vuelo');

  const { estado } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(estado, 'provisional');
});

test('la foto congelada se sustituye entera, no se funde con la anterior', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 2, marcador2: 1 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  const leerFoto = () => db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    return (await ranking.congeladoDe(c, jornadaId)).puntuacion;
  });

  assert.deepEqual(Object.keys(await leerFoto()).sort(), [...ranking.CAMPOS_DE_PUNTUACION].sort(),
    'sólo las cuatro reglas: triviasHabilitadas y puntosTriviaDefault no puntúan partidos');

  /*
   * Se le mete una clave que no debería estar, como la habría dejado una versión
   * anterior. Al volver a congelar tiene que desaparecer: si el `UPDATE` usara
   * `||` en vez de `=`, sobreviviría para siempre.
   */
  await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    await c.query(
      `UPDATE puntos_jornada SET puntuacion = puntuacion || '{"basura": 1}'::jsonb
        WHERE jornada_id = $1`, [jornadaId]);
  });
  assert.equal((await leerFoto()).basura, 1, 'preparado: la clave intrusa está dentro');

  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  assert.equal((await leerFoto()).basura, undefined, 'la foto nueva no arrastra nada de la vieja');
});

/* ==================== Las tablas ==================== */

test('la tabla general suma jornadas congeladas, vivas y trivias', async () => {
  const q = await quinielaNueva();

  // J1 termina y se congela: 5 puntos.
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 1, marcador2: 0 }]);
  await ranking.actualizar(q.id, 'J1', PUNTUACION);

  // J2 sigue viva: 3 puntos, calculados al vuelo.
  await jornadas.guardar(q.id, 'J2', [partido('C', 'D')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J2', pronosticos: [{ marcador1: 2, marcador2: 0 }] });
  await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J2');
    const [p] = await pronosticos.partidosDe(c, jornadaId);
    const ro = await oficiales.asegurarContenedor(c, q.id, jornadaId);
    await oficiales.escribir(c, q.id, ro, [
      { partidoId: p.id, marcador1: 3, marcador2: 1, estado: 'LIVE' }
    ]);
  });

  const { jornadas: columnas, tabla } = await ranking.tablaGeneral(q.id, { puntuacionActual: PUNTUACION });

  assert.deepEqual(columnas, ['J1', 'J2']);
  assert.equal(tabla.ana.J1, 5);
  assert.equal(tabla.ana.J2, 3);
  assert.equal(tabla.ana.Trivias, 0);
  assert.equal(tabla.ana.total, 8);
});

test('la tabla congela por su cuenta una jornada terminada que nadie congeló', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  await cargarOficiales(q.id, 'J1', [{ marcador1: 1, marcador2: 0 }]);
  // A propósito NO se llama a ranking.actualizar: es el caso de los datos migrados.

  await ranking.tablaGeneral(q.id, { puntuacionActual: PUNTUACION });

  const congelado = await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    return ranking.congeladoDe(c, jornadaId);
  });
  assert.ok(congelado, 'la red de seguridad la congela al leer la tabla');
  assert.equal(congelado.puntos.get('ana'), 5);
});

test('el propietario aparece en la tabla aunque no haya pronosticado', async () => {
  const u = await cuentaNueva('jefe');
  const q = await quinielasMod.crear({ nombre: `Q-${n}`, propietarioId: u.id });
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  const { tabla } = await ranking.tablaGeneral(q.id, { puntuacionActual: PUNTUACION });

  assert.ok(tabla[u.username], 'quien no jugó sigue teniendo su fila');
  assert.equal(tabla[u.username].total, 0);
});

/* ==================== El aislamiento sigue en pie ==================== */

test('los pronósticos de una quiniela no se ven ni se cuentan desde otra', async () => {
  const a = await quinielaNueva();
  const b = await quinielaNueva();

  for (const q of [a, b]) {
    await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
  }

  await pronosticos.guardar(a.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  await cargarOficiales(a.id, 'J1', [{ marcador1: 1, marcador2: 0 }]);

  const enB = await pronosticos.deJugador(b.id, 'ana', 'J1');
  assert.deepEqual(enB.map(p => p.marcador1), [null], 'la quiniela B no ve el pronóstico de la A');

  const { tabla } = await ranking.tablaGeneral(b.id, { puntuacionActual: PUNTUACION });
  assert.equal(tabla.ana, undefined, 'ni siquiera aparece como jugadora');
});

test('congelar en una quiniela no toca la jornada del mismo nombre de otra', async () => {
  const a = await quinielaNueva();
  const b = await quinielaNueva();

  for (const q of [a, b]) {
    await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);
    await pronosticos.guardar(q.id, { jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }] });
  }

  await cargarOficiales(a.id, 'J1', [{ marcador1: 1, marcador2: 0 }]);
  await ranking.actualizar(a.id, 'J1', PUNTUACION);

  const enB = await db.enQuiniela(b.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    return ranking.congeladoDe(c, jornadaId);
  });
  assert.equal(enB, null, 'la J1 de B sigue sin congelar');
});


/* ========== El fallo de quitar un partido desde la pantalla ========== */

/*
 * La pantalla de jornadas no llama a `eliminarPartidos`: quita el partido de su
 * lista en el navegador y vuelve a guardar la jornada entera. Con la
 * reconciliación por posición, eso borraba los pronósticos de todos los
 * partidos POSTERIORES al que se quitó, en silencio.
 */

test('⛔ quitar el del medio DESDE LA PANTALLA no puede borrar los pronósticos de los demás', async () => {
  const q = await quinielaNueva();

  const cuatro = [
    partido('A', 'B', { apiFixtureId: '1' }),
    partido('C', 'D', { apiFixtureId: '2' }),
    partido('E', 'F', { apiFixtureId: '3' }),
    partido('G', 'H', { apiFixtureId: '4' })
  ];

  await jornadas.guardar(q.id, 'J1', cuatro);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [
      { marcador1: 1, marcador2: 0 },
      { marcador1: 2, marcador2: 0 },
      { marcador1: 3, marcador2: 0 },
      { marcador1: 4, marcador2: 0 }
    ]
  });

  /*
   * Esto es exactamente lo que manda la pantalla al quitar el segundo: la misma
   * lista, sin él. No pasa por `eliminarPartidos`.
   */
  const r = await jornadas.guardar(q.id, 'J1', [cuatro[0], cuatro[2], cuatro[3]]);

  assert.equal(r.pronosticosBorrados, 1,
    'sólo el del partido que se quitó de verdad');

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  const conPronostico = mios.filter(p => p.marcador1 !== null);
  assert.equal(conPronostico.length, 3, 'los otros tres pronósticos siguen ahí');

  /*
   * Y cada uno sigue pegado a SU partido, que es lo que de verdad importa:
   * perderlos es malo, pero que apunten al equivocado sería peor.
   */
  const j = await jornadas.porNombre(q.id, 'J1');
  assert.deepEqual(j.partidos.map(p => p.equipo1), ['A', 'E', 'G']);

  const porPartido = new Map(conPronostico.map(p => [p.equipo1, p.marcador1]));
  assert.equal(porPartido.get('A'), 1);
  assert.equal(porPartido.get('E'), 3, 'E-F conserva SU marcador, no el de C-D');
  assert.equal(porPartido.get('G'), 4);
});

test('quitar el del medio conserva los id de los que quedan', async () => {
  const q = await quinielaNueva();
  const tres = [
    partido('A', 'B', { apiFixtureId: '1' }),
    partido('C', 'D', { apiFixtureId: '2' }),
    partido('E', 'F', { apiFixtureId: '3' })
  ];
  await jornadas.guardar(q.id, 'J1', tres);

  const antes = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT id, equipo1 FROM partidos ORDER BY orden');
    return rows;
  });

  await jornadas.guardar(q.id, 'J1', [tres[0], tres[2]]);

  const despues = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT id, orden, equipo1 FROM partidos ORDER BY orden');
    return rows;
  });

  assert.deepEqual(despues.map(p => p.orden), [0, 1], 'renumerados sin huecos');
  assert.equal(despues[0].id, antes[0].id);
  assert.equal(despues[1].id, antes[2].id, 'E-F conserva su id aunque suba de posición');
});

test('sustituir un partido por otro sí se lleva su pronóstico, y sólo ése', async () => {
  /*
   * La red de seguridad tiene que seguir funcionando: si el administrador
   * cambia un partido por otro distinto, lo que se pronosticó del viejo ya no
   * vale y no puede quedarse pegado al nuevo.
   */
  const q = await quinielaNueva();
  const dos = [
    partido('A', 'B', { apiFixtureId: '1' }),
    partido('C', 'D', { apiFixtureId: '2' })
  ];
  await jornadas.guardar(q.id, 'J1', dos);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 0 }]
  });

  const r = await jornadas.guardar(q.id, 'J1', [
    dos[0],
    partido('X', 'Y', { apiFixtureId: '99' })   // otro partido en lugar de C-D
  ]);

  assert.equal(r.pronosticosBorrados, 1);

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  const conPronostico = mios.filter(p => p.marcador1 !== null);

  assert.equal(conPronostico.length, 1);
  assert.equal(conPronostico[0].equipo1, 'A', 'el que sobrevive es el de A-B');

  // Y el partido nuevo entra en blanco: nadie lo ha pronosticado.
  assert.equal(mios.find(p => p.equipo1 === 'X').marcador1, null);
});

test('los partidos SIN identificador siguen por el camino de siempre', async () => {
  /*
   * Son los históricos de la migración. Ahí no hay forma de saber si es el
   * mismo partido, y adivinar podría dejar un pronóstico colgando del
   * equivocado, que es peor que perderlo.
   */
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);

  const antes = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT id FROM partidos ORDER BY orden');
    return rows;
  });

  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);

  const despues = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT id FROM partidos ORDER BY orden');
    return rows;
  });

  assert.deepEqual(despues.map(p => p.id), antes.map(p => p.id),
    'sin identificador se empareja por posición, y las posiciones no cambiaron');
});


/* ============ «No vino» y «vino vacío» son cosas distintas ============ */

/*
 * Entrada 068. La pantalla, al dejar un partido a medias, mandaba los DOS
 * marcadores en blanco, y `guardar` lo tomaba como «ponlo todo a nulo»: se
 * llevaba por delante el pronóstico que la persona ya tenía guardado. Sin
 * error, sin aviso, y con un «guardado correctamente» en pantalla.
 */

test('⛔ lo que NO viene no se toca: un hueco no borra el pronóstico guardado', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [{ marcador1: 2, marcador2: 1 }, { marcador1: 0, marcador2: 0 }]
  });

  // El primero llega como `null` —es lo que manda la pantalla para lo que
  // quedó a medias— y el segundo se cambia.
  const r = await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1',
    pronosticos: [null, { marcador1: 3, marcador2: 3 }]
  });

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');

  assert.deepEqual(mios.map(p => `${p.marcador1}-${p.marcador2}`), ['2-1', '3-3'],
    'el 2-1 tiene que seguir ahí: nadie pidió tocarlo');
  assert.equal(r.sinTocar, 1);
  assert.equal(r.guardados, 1);
});

test('los dos marcadores vacíos quitan el pronóstico, y no dejan una fila de nulos', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }]
  });

  const r = await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: '', marcador2: '' }]
  });

  assert.equal(r.borrados, 1);

  /*
   * Sin fila, no con una fila de nulos: no pronosticar y pronosticar «nada» no
   * pueden ser dos estados distintos que signifiquen lo mismo.
   */
  const filas = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM pronosticos');
    return rows[0].n;
  });

  assert.equal(filas, 0, 'la fila se va: no hay pronóstico');

  // Y la pantalla lo sigue viendo como una casilla vacía, igual que antes.
  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.equal(mios[0].marcador1, null);
});

test('un cero SÍ se guarda: no es lo mismo que dejarlo en blanco', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  const r = await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: '0', marcador2: '0' }]
  });

  assert.equal(r.guardados, 1);
  assert.equal(r.borrados, 0, 'un 0-0 es un pronóstico, no un borrado');

  const mios = await pronosticos.deJugador(q.id, 'ana', 'J1');
  assert.equal(mios[0].marcador1, 0);
  assert.equal(mios[0].marcador2, 0);
});

/*
 * Trivias y respuestas (tajada 5 de la migración).
 *
 * Cuatro cosas se prueban aquí con especial cuidado:
 *
 *   - **S-10**: dos envíos de la misma respuesta no pueden dar puntos dobles.
 *   - **La trivia cuelga del partido, no de su posición.** Borrar un partido se
 *     lleva sus trivias; borrar OTRO no las descoloca.
 *   - **Los dos relojes del cierre**: la fecha de cierre y el inicio del
 *     partido, lo que ocurra antes.
 *   - **La reconciliación es atómica**, y mover la fecha reabre la pregunta.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielasMod = require('../src/quinielas');
const jornadas = require('../src/jornadas');
const trivias = require('../src/trivias');
const respuestas = require('../src/respuestas-trivia');
const oficiales = require('../src/oficiales');
const pronosticos = require('../src/pronosticos');
const ranking = require('../src/ranking');
const { normalizarMarcador } = require('../src/validacion');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

const PUNTUACION = quinielasMod.PUNTUACION_POR_DEFECTO;
const PASADO = '2020-01-01 12:00';
const FUTURO = '2099-01-01 12:00';
const CIERRE_FUTURO = new Date('2099-06-01T12:00:00Z');
const CIERRE_PASADO = new Date('2020-06-01T12:00:00Z');

let n = 0;
async function cuentaNueva(prefijo = 'u') {
  n += 1;
  return usuarios.crear({
    username: `${prefijo}${n}`, email: `${prefijo}${n}@x.com`, password: 'contrasena-larga-1'
  });
}

async function quinielaNueva() {
  const u = await cuentaNueva('dueno');
  return quinielasMod.crear({ nombre: `Q-${n}`, propietarioId: u.id });
}

const partido = (equipo1, equipo2, extra = {}) => ({
  equipo1, equipo2, logoEquipo1: '', logoEquipo2: '',
  comodin: false, apiFixtureId: `fx-${equipo1}${equipo2}`, apiLeagueId: null,
  apiDate: FUTURO, apiStatus: null,
  ...extra
});

/** Una jornada con dos partidos y trivias en el primero. */
async function escenario({ apiDate = FUTURO, fechaCierre = CIERRE_FUTURO, tipos = ['ambos_anotan'] } = {}) {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiDate }),
    partido('C', 'D', { apiDate })
  ]);
  await trivias.crear(q.id, {
    jornadaNombre: 'J1', partidoIndex: 0, tipos, fechaCierre, puntos: 1
  });
  return q;
}

/** Marca el partido de esa posición como terminado. */
async function terminarPartido(quinielaId, jornadaNombre, indice, marcadores = { marcador1: 1, marcador2: 1 }) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, jornadaNombre);
    const partidos = await pronosticos.partidosDe(c, jornadaId);
    const ro = await oficiales.asegurarContenedor(c, quinielaId, jornadaId);
    await oficiales.escribir(c, quinielaId, ro, [{
      partidoId: partidos[indice].id, ...marcadores, estado: 'TC', bloqueadoFinal: true
    }]);
  });
}

/* ==================== Las ocho preguntas, en seco ==================== */

test('los ocho tipos tienen pregunta y opciones', () => {
  const tipos = Object.keys(trivias.TIPOS_TRIVIA);
  assert.equal(tipos.length, 8);

  for (const tipo of tipos) {
    assert.ok(trivias.TIPOS_TRIVIA[tipo].pregunta, `${tipo} sin pregunta`);
    assert.ok(trivias.opcionesTrivia(tipo, 'A', 'B').length >= 2, `${tipo} sin opciones`);
  }
});

test('las opciones de equipo llevan el nombre del equipo, no un número', () => {
  assert.deepEqual(trivias.opcionesTrivia('primer_gol', 'Saprissa', 'Alajuelense'),
    ['Saprissa', 'Alajuelense', 'Nadie anotará']);
  assert.deepEqual(trivias.opcionesTrivia('ambos_anotan', 'Saprissa', 'Alajuelense'), ['Sí', 'No']);
  assert.deepEqual(trivias.opcionesTrivia('inventado', 'A', 'B'), []);
});

test('una trivia se cierra por su fecha O porque su partido empezó', () => {
  const abierta = { fecha_cierre: CIERRE_FUTURO };
  const conPartidoEmpezado = { api_date: PASADO };
  const conPartidoPorJugar = { api_date: FUTURO };

  assert.equal(trivias.estaCerrada(abierta, conPartidoPorJugar), false);
  assert.equal(trivias.estaCerrada(abierta, conPartidoEmpezado), true,
    'el partido ya empezó: cerrada aunque la fecha de cierre no haya llegado');
  assert.equal(trivias.estaCerrada({ fecha_cierre: CIERRE_PASADO }, conPartidoPorJugar), true,
    'la fecha pasó: cerrada aunque el partido no haya empezado');
  assert.equal(trivias.estaCerrada({ fecha_cierre: null }, conPartidoPorJugar), false);
});

/* ==================== Crear ==================== */

test('crear las trivias de un partido las deja listas para responder', async () => {
  const q = await escenario({ tipos: ['ambos_anotan', 'primer_gol'] });

  const lista = await trivias.deJornada(q.id, 'J1');

  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(t => t.tipo).sort(), ['ambos_anotan', 'primer_gol']);
  assert.equal(lista[0].partidoIndex, 0);
  assert.equal(lista[0].equipo1, 'A', 'los equipos salen del partido, no de una copia');
  assert.equal(lista[0].resuelta, false);
});

test('crear dos veces el mismo tipo no duplica la pregunta', async () => {
  const q = await escenario({ tipos: ['ambos_anotan'] });

  const segunda = await trivias.crear(q.id, {
    jornadaNombre: 'J1', partidoIndex: 0, tipos: ['ambos_anotan'], fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  assert.equal(segunda.creadas, 0);
  assert.equal((await trivias.deJornada(q.id, 'J1')).length, 1);
});

test('un tipo que no existe se ignora sin tumbar los demás', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  const r = await trivias.crear(q.id, {
    jornadaNombre: 'J1', partidoIndex: 0,
    tipos: ['ambos_anotan', 'inventado'], fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  assert.equal(r.creadas, 1);
});

test('una jornada o un partido que no existen devuelven un motivo, no una excepción', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B')]);

  assert.equal((await trivias.crear(q.id, {
    jornadaNombre: 'no-existe', partidoIndex: 0, tipos: ['ambos_anotan'], fechaCierre: CIERRE_FUTURO, puntos: 1
  })).motivo, 'jornada_no_encontrada');

  assert.equal((await trivias.crear(q.id, {
    jornadaNombre: 'J1', partidoIndex: 7, tipos: ['ambos_anotan'], fechaCierre: CIERRE_FUTURO, puntos: 1
  })).motivo, 'partido_no_encontrado');
});

/* ==================== La identidad del partido ==================== */

test('borrar un partido se lleva sus trivias y deja en paz las de los demás', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D'), partido('E', 'F')]);

  for (const indice of [0, 1, 2]) {
    await trivias.crear(q.id, {
      jornadaNombre: 'J1', partidoIndex: indice, tipos: ['ambos_anotan'],
      fechaCierre: CIERRE_FUTURO, puntos: 1
    });
  }

  // Se va el del medio. En Mongo, la trivia de E-F pasaba a apuntar a C-D.
  await jornadas.eliminarPartidos(q.id, 'J1', [1]);

  const lista = await trivias.deJornada(q.id, 'J1');

  assert.equal(lista.length, 2, 'la trivia del partido borrado se fue con él');
  assert.deepEqual(lista.map(t => [t.partidoIndex, t.equipo1, t.equipo2]),
    [[0, 'A', 'B'], [1, 'E', 'F']],
    'la que quedaba sigue siendo la de E-F, ahora en la posición 1');
});

/* ==================== Responder ==================== */

test('una respuesta se guarda y se puede corregir mientras la trivia siga abierta', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'No' }] });

  const mias = await respuestas.deJugador(q.id, 'ana', 'J1', { puedeVerTodo: true });
  assert.equal(mias.length, 1);
  assert.equal(mias[0].respuesta, 'No');
});

test('S-10: dos envíos de la misma respuesta dejan UNA fila, no dos', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });

  const filas = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM respuestas_trivia');
    return rows[0].n;
  });

  assert.equal(filas, 1, 'el índice único es quien lo impide, no el código');
});

test('una trivia cerrada se salta, y las abiertas del mismo envío sí se guardan', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiDate: PASADO }),    // ya empezó: cerrada
    partido('C', 'D', { apiDate: FUTURO })     // por jugar: abierta
  ]);
  for (const indice of [0, 1]) {
    await trivias.crear(q.id, {
      jornadaNombre: 'J1', partidoIndex: indice, tipos: ['ambos_anotan'],
      fechaCierre: CIERRE_FUTURO, puntos: 1
    });
  }

  const lista = await trivias.deJornada(q.id, 'J1');
  const r = await respuestas.guardar(q.id, {
    jugador: 'ana',
    respuestas: lista.map(t => ({ triviaId: t.id, respuesta: 'Sí' }))
  });

  assert.equal(r.guardadas, 1);
  assert.equal(r.cerradas, 1, 'la del partido empezado se salta; el envío no se pierde entero');
});

test('una trivia que no existe se cuenta aparte en vez de tumbar el envío', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  const r = await respuestas.guardar(q.id, {
    jugador: 'ana',
    respuestas: [
      { triviaId: trivia.id, respuesta: 'Sí' },
      { triviaId: '00000000-0000-0000-0000-000000000000', respuesta: 'No' }
    ]
  });

  assert.equal(r.guardadas, 1);
  assert.equal(r.desconocidas, 1);
});

test('las respuestas ajenas no se ven hasta que la trivia cierra', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });

  const paraOtro = await respuestas.deJugador(q.id, 'ana', 'J1');
  assert.equal(paraOtro[0].cerrada, false);
  assert.equal(paraOtro[0].respuesta, null, 'abierta: lo de ana no se enseña');

  const paraElla = await respuestas.deJugador(q.id, 'ana', 'J1', { puedeVerTodo: true });
  assert.equal(paraElla[0].respuesta, 'Sí');
});

test('cerrada la trivia, la respuesta ajena se hace pública', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  // Ana responde con la trivia abierta, y nadie más puede verlo.
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });
  assert.equal((await respuestas.deJugador(q.id, 'ana', 'J1'))[0].respuesta, null);

  // El partido arranca. Es el mismo disparador que abre los pronósticos.
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiDate: PASADO }),
    partido('C', 'D', { apiDate: FUTURO })
  ]);

  const vista = await respuestas.deJugador(q.id, 'ana', 'J1');
  assert.equal(vista[0].cerrada, true, 'el partido ya empezó');
  assert.equal(vista[0].respuesta, 'Sí', 'y con él se abre lo que respondió');
});

/* ==================== Reconciliar ==================== */

test('la reconciliación crea las que faltan y borra las que sobran', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);
  await trivias.crear(q.id, {
    jornadaNombre: 'J1', partidoIndex: 0, tipos: ['ambos_anotan', 'primer_gol'],
    fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  const r = await trivias.reconciliar(q.id, {
    jornadaNombre: 'J1',
    configuracion: [
      { partidoIndex: 0, tipos: ['ambos_anotan'] },   // primer_gol se va
      { partidoIndex: 1, tipos: ['hubo_penales'] }    // ésta es nueva
    ],
    fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  assert.deepEqual([r.creadas, r.actualizadas, r.eliminadas], [1, 1, 1]);

  const lista = await trivias.deJornada(q.id, 'J1');
  assert.deepEqual(lista.map(t => `${t.partidoIndex}_${t.tipo}`).sort(),
    ['0_ambos_anotan', '1_hubo_penales']);
});

test('borrar una trivia se lleva sus respuestas: no quedan puntos huérfanos', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });

  await trivias.reconciliar(q.id, {
    jornadaNombre: 'J1', configuracion: [], fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  const filas = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM respuestas_trivia');
    return rows[0].n;
  });
  assert.equal(filas, 0, 'la clave ajena en cascada las borra: no hacen falta dos pasos');
});

test('mover la fecha de cierre reabre la pregunta y devuelve los puntos a cero', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');
  await respuestas.guardar(q.id, { jugador: 'ana', respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });

  // Se resuelve a mano, como si el barrido ya hubiera pasado.
  await db.enQuiniela(q.id, c => c.query(
    `UPDATE trivias SET resuelta = true, respuesta_correcta = 'Sí' WHERE id = $1`, [trivia.id]));
  await db.enQuiniela(q.id, c => c.query(
    'UPDATE respuestas_trivia SET puntos = 1 WHERE trivia_id = $1', [trivia.id]));

  await trivias.reconciliar(q.id, {
    jornadaNombre: 'J1',
    configuracion: [{ partidoIndex: 0, tipos: ['ambos_anotan'] }],
    fechaCierre: new Date('2099-07-01T12:00:00Z'),   // otra fecha
    puntos: 1
  });

  const [despues] = await trivias.deJornada(q.id, 'J1');
  assert.equal(despues.resuelta, false);
  assert.equal(despues.respuestaCorrecta, '');

  const mias = await respuestas.deJugador(q.id, 'ana', 'J1', { puedeVerTodo: true });
  assert.equal(mias[0].puntos, 0, 'lo puntuado con el resultado anterior ya no vale');
});

test('reconciliar sin cambiar la fecha no reabre nada', async () => {
  const q = await escenario();
  const [trivia] = await trivias.deJornada(q.id, 'J1');
  await db.enQuiniela(q.id, c => c.query(
    `UPDATE trivias SET resuelta = true, respuesta_correcta = 'Sí' WHERE id = $1`, [trivia.id]));

  await trivias.reconciliar(q.id, {
    jornadaNombre: 'J1',
    configuracion: [{ partidoIndex: 0, tipos: ['ambos_anotan'] }],
    fechaCierre: CIERRE_FUTURO, puntos: 1
  });

  const [despues] = await trivias.deJornada(q.id, 'J1');
  assert.equal(despues.resuelta, true, 'la misma fecha no es un cambio');
});

/* ==================== Resolver ==================== */

/** Un intérprete de mentira: devuelve lo que le digan, sin proveedor. */
const interprete = respuesta => () => respuesta;
const evento = async () => ({ fixture: 'lo que sea' });

test('una trivia vencida con el partido terminado se resuelve y reparte puntos', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO });
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  await db.enQuiniela(q.id, async c => {
    await c.query(
      `INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,'ana'),($1,'beto')
       ON CONFLICT DO NOTHING`, [q.id]);
  });
  await respuestas.guardar(q.id, {
    jugador: 'ana', ahora: new Date('2020-01-01'),
    respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });

  await terminarPartido(q.id, 'J1', 0);

  const r = await trivias.resolverPendientes(q.id, {
    obtenerEvento: evento, interpretar: interprete('Sí')
  });

  assert.equal(r.resueltas, 1);
  assert.equal(r.puntosActualizados, true);

  const [despues] = await trivias.deJornada(q.id, 'J1');
  assert.equal(despues.resuelta, true);
  assert.equal(despues.respuestaCorrecta, 'Sí');

  const mias = await respuestas.deJugador(q.id, 'ana', 'J1', { puedeVerTodo: true });
  assert.equal(mias[0].puntos, 1);
});

test('quien falló se queda en cero, y en la misma pasada', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO });
  const [trivia] = await trivias.deJornada(q.id, 'J1');

  const ayer = new Date('2020-01-01');
  await respuestas.guardar(q.id, { jugador: 'ana', ahora: ayer, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }] });
  await respuestas.guardar(q.id, { jugador: 'beto', ahora: ayer, respuestas: [{ triviaId: trivia.id, respuesta: 'No' }] });

  await terminarPartido(q.id, 'J1', 0);
  await trivias.resolverPendientes(q.id, { obtenerEvento: evento, interpretar: interprete('Sí') });

  const deAna = await respuestas.deJugador(q.id, 'ana', 'J1', { puedeVerTodo: true });
  const deBeto = await respuestas.deJugador(q.id, 'beto', 'J1', { puedeVerTodo: true });

  assert.equal(deAna[0].puntos, 1);
  assert.equal(deBeto[0].puntos, 0);
});

test('un partido que no ha terminado no resuelve su trivia aunque la fecha haya pasado', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO });

  const r = await trivias.resolverPendientes(q.id, { obtenerEvento: evento, interpretar: interprete('Sí') });

  assert.equal(r.resueltas, 0, 'antes de TC el proveedor todavía puede cambiar de opinión');
  assert.equal((await trivias.deJornada(q.id, 'J1'))[0].resuelta, false);
});

test('si el intérprete no sabe responder, la trivia queda pendiente para el próximo pase', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO });
  await terminarPartido(q.id, 'J1', 0);

  const r = await trivias.resolverPendientes(q.id, { obtenerEvento: evento, interpretar: interprete('') });

  assert.equal(r.resueltas, 0);
  assert.equal((await trivias.deJornada(q.id, 'J1'))[0].resuelta, false,
    'marcarla resuelta con respuesta vacía la dejaría sin puntuar para siempre');
});

test('el fallo de una trivia no impide resolver las demás', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO, tipos: ['ambos_anotan', 'hubo_penales'] });
  await terminarPartido(q.id, 'J1', 0);

  let primera = true;
  const r = await trivias.resolverPendientes(q.id, {
    obtenerEvento: evento,
    interpretar: () => {
      if (primera) { primera = false; throw new Error('el proveedor devolvió basura'); }
      return 'Sí';
    }
  });

  assert.equal(r.resueltas, 1, 'la segunda se resolvió pese al fallo de la primera');
});

test('resolver se puede acotar a una jornada', async () => {
  const q = await quinielaNueva();
  for (const nombre of ['J1', 'J2']) {
    await jornadas.guardar(q.id, nombre, [partido('A', 'B')]);
    await trivias.crear(q.id, {
      jornadaNombre: nombre, partidoIndex: 0, tipos: ['ambos_anotan'],
      fechaCierre: CIERRE_PASADO, puntos: 1
    });
    await terminarPartido(q.id, nombre, 0);
  }

  const r = await trivias.resolverPendientes(q.id, {
    obtenerEvento: evento, interpretar: interprete('Sí'), jornadaNombre: 'J1'
  });

  assert.equal(r.resueltas, 1);
  assert.equal((await trivias.deJornada(q.id, 'J2'))[0].resuelta, false);
});

/* ==================== La columna del ranking ==================== */

test('los puntos de trivias entran en la tabla general', async () => {
  const q = await escenario({ fechaCierre: CIERRE_PASADO, tipos: ['ambos_anotan', 'hubo_penales'] });
  const lista = await trivias.deJornada(q.id, 'J1');

  const ayer = new Date('2020-01-01');
  await respuestas.guardar(q.id, {
    jugador: 'ana', ahora: ayer,
    respuestas: lista.map(t => ({ triviaId: t.id, respuesta: 'Sí' }))
  });

  await terminarPartido(q.id, 'J1', 0);
  await trivias.resolverPendientes(q.id, { obtenerEvento: evento, interpretar: interprete('Sí') });

  const { tabla } = await ranking.tablaGeneral(q.id, { puntuacionActual: PUNTUACION });

  assert.equal(tabla.ana.Trivias, 2, 'las dos preguntas acertadas, un punto cada una');
  assert.equal(tabla.ana.total, 2);
});

/* ==================== El aislamiento ==================== */

test('las trivias de una quiniela no se ven desde otra', async () => {
  const a = await escenario();
  const b = await quinielaNueva();
  await jornadas.guardar(b.id, 'J1', [partido('A', 'B')]);

  assert.equal((await trivias.deJornada(a.id, 'J1')).length, 1);
  assert.equal((await trivias.deJornada(b.id, 'J1')).length, 0,
    'mismo nombre de jornada, otra quiniela: no debe cruzarse nada');
});

test('resolver en una quiniela no resuelve las trivias de otra', async () => {
  const a = await escenario({ fechaCierre: CIERRE_PASADO });
  const b = await escenario({ fechaCierre: CIERRE_PASADO });

  await terminarPartido(a.id, 'J1', 0);
  await terminarPartido(b.id, 'J1', 0);

  await trivias.resolverPendientes(a.id, { obtenerEvento: evento, interpretar: interprete('Sí') });

  assert.equal((await trivias.deJornada(a.id, 'J1'))[0].resuelta, true);
  assert.equal((await trivias.deJornada(b.id, 'J1'))[0].resuelta, false);
});

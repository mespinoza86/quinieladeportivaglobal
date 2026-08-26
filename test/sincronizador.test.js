/*
 * Sincronizador, caché de partidos y cerrojo (tajada 6 de la migración).
 *
 * Lo que se prueba con especial cuidado, porque es donde está el dinero —la
 * cuota del proveedor— y donde estaban C-01, C-02 y C-05:
 *
 *   - **Dos quinielas que siguen el mismo partido lo consultan UNA vez.**
 *   - **La ventana evita preguntar por lo que no ha cambiado**, y un partido
 *     terminado no se vuelve a consultar jamás.
 *   - **El cerrojo sólo lo tiene uno**, caduca solo, y sólo lo suelta su dueño.
 *   - **Un error del proveedor no borra un marcador bueno.**
 *   - **El censo no cruza quinielas** aunque compartan nombre de jornada.
 *
 * ⚠️ Ni una sola prueba de aquí sale a la red: `consultar` es un argumento.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielasMod = require('../src/quinielas');
const jornadas = require('../src/jornadas');
const fixtures = require('../src/fixtures');
const cerrojos = require('../src/cerrojos');
const sinc = require('../src/sincronizador');
const oficiales = require('../src/oficiales');
const pronosticos = require('../src/pronosticos');
const ranking = require('../src/ranking');
const eventos = require('../src/eventos');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); sinc.reiniciarMetricas(); });

const PUNTUACION = quinielasMod.PUNTUACION_POR_DEFECTO;

let n = 0;
async function quinielaNueva() {
  n += 1;
  const u = await usuarios.crear({
    username: `u${n}`, email: `u${n}@x.com`, password: 'contrasena-larga-1'
  });
  return quinielasMod.crear({ nombre: `Q-${n}`, propietarioId: u.id });
}

const partido = (equipo1, equipo2, extra = {}) => ({
  equipo1, equipo2, logoEquipo1: '', logoEquipo2: '', comodin: false,
  apiFixtureId: null, apiLeagueId: null, apiDate: '2026-09-01 15:00', apiStatus: null,
  ...extra
});

/** Un evento del proveedor, con la forma que devuelve APIFootball. */
const eventoDe = ({ local = 'A', visitante = 'B', m1 = 1, m2 = 0, estado = 'Finished' } = {}) => ({
  match_hometeam_name: local,
  match_awayteam_name: visitante,
  match_hometeam_score: String(m1),
  match_awayteam_score: String(m2),
  match_hometeam_ft_score: String(m1),
  match_awayteam_ft_score: String(m2),
  match_status: estado
});

const descriptor = (clave, extra = {}) => ({
  clave, apiFixtureId: clave, apiDate: '2026-09-01 15:00',
  busqueda: { fecha: '2026-09-01', ligaId: '', equipo1: 'A', equipo2: 'B' },
  ...extra
});

/* ==================== La identidad compartida ==================== */

test('un partido con id del proveedor se identifica por ese id', () => {
  assert.equal(fixtures.claveDeFixture({ apiFixtureId: '12345' }), '12345');
  assert.equal(fixtures.claveDeFixture({ api_fixture_id: '12345' }), '12345',
    'las dos formas del nombre, porque la fila viene de PostgreSQL');
});

test('sin id del proveedor, la fecha y los equipos son la identidad', () => {
  const clave = fixtures.claveDeFixture({
    apiDate: '2026-09-01 15:00', equipo1: 'Sapríssa F.C.', equipo2: 'Alajuelense'
  });
  assert.equal(clave, 'sin-id:2026-09-01:saprissa fc|alajuelense');
});

test('un partido sin fecha ni equipos no tiene clave, y no se sigue', () => {
  assert.equal(fixtures.claveDeFixture({ equipo1: 'A' }), null);
  assert.equal(fixtures.claveDeFixture({}), null);
});

/* ==================== La ventana ==================== */

test('un partido terminado no se vuelve a consultar nunca', () => {
  assert.equal(fixtures.calcularProximaConsulta('TC', '2026-09-01 15:00'), null);
});

test('un partido en vivo se consulta cada minuto', () => {
  const ahora = new Date('2026-09-01T21:20:00Z');
  const proxima = fixtures.calcularProximaConsulta('LIVE', '2026-09-01 15:00', ahora);
  assert.equal(proxima.getTime() - ahora.getTime(), fixtures.VENTANAS_MS.enVivo);
});

test('la próxima consulta nunca se pospone más allá del pitido inicial', () => {
  /*
   * Un partido que empieza en tres horas cae en la ventana "lejano" de seis.
   * Sin el tope se consultaría por primera vez tres horas DESPUÉS de empezar.
   */
  const ahora = new Date('2026-09-01T18:00:00Z');          // faltan 3 h
  const proxima = fixtures.calcularProximaConsulta('PROGRAMADO', '2026-09-01 15:00', ahora);

  assert.equal(proxima.toISOString(), '2026-09-01T21:00:00.000Z',
    'debe caer justo en el inicio, no seis horas después');
});

test('un error acorta la espera en vez de alargarla', () => {
  const ahora = new Date('2026-08-01T00:00:00Z');
  const conError = fixtures.calcularProximaConsulta('PROGRAMADO', '2026-09-01 15:00', ahora, true);
  const sinError = fixtures.calcularProximaConsulta('PROGRAMADO', '2026-09-01 15:00', ahora, false);

  assert.ok(conError < sinError, 'ante un fallo se reintenta antes, no después');
});

test('tocaConsultar respeta la ventana, el estado y el forzado', () => {
  const ahora = new Date('2026-09-01T12:00:00Z');
  const futuro = { estado: 'PROGRAMADO', proximaConsulta: new Date('2026-09-01T18:00:00Z') };
  const vencido = { estado: 'PROGRAMADO', proximaConsulta: new Date('2026-09-01T06:00:00Z') };

  assert.equal(fixtures.tocaConsultar(null, ahora), true, 'nunca visto: se consulta');
  assert.equal(fixtures.tocaConsultar(futuro, ahora), false);
  assert.equal(fixtures.tocaConsultar(vencido, ahora), true);
  assert.equal(fixtures.tocaConsultar({ estado: 'TC' }, ahora), false);
  assert.equal(fixtures.tocaConsultar(futuro, ahora, true), true, 'forzar se salta la ventana');
});

/* ==================== La caché ==================== */

test('guardar un evento deja el fixture consultable, con su estado', async () => {
  const d = descriptor('fx1');
  const hubo = await fixtures.guardar(d, { evento: eventoDe({ estado: 'Finished' }) });

  assert.equal(hubo, true);

  const cache = await fixtures.porClaves(['fx1']);
  assert.equal(cache.get('fx1').estado, 'TC');
  assert.equal(cache.get('fx1').proximaConsulta, null, 'terminado: no se pregunta más');
});

test('un error del proveedor NO borra el marcador que ya se tenía', async () => {
  const d = descriptor('fx1');
  await fixtures.guardar(d, { evento: eventoDe({ m1: 3, m2: 2, estado: '70' }) });

  const previo = (await fixtures.porClaves(['fx1'])).get('fx1');
  await fixtures.guardar(d, { evento: null, error: 'ECONNRESET', previo });

  const despues = (await fixtures.porClaves(['fx1'])).get('fx1');
  assert.equal(despues.evento.match_hometeam_score, '3', 'el marcador bueno sobrevive al fallo de red');
  assert.equal(despues.estado, 'LIVE', 'y el estado también: se conserva el último que se supo');
  assert.equal(despues.fallosConsecutivos, 1);
  assert.equal(despues.ultimoError, 'ECONNRESET');
});

test('un acierto después de un fallo pone el contador de fallos a cero', async () => {
  const d = descriptor('fx1');
  await fixtures.guardar(d, { evento: null, error: 'timeout' });

  const previo = (await fixtures.porClaves(['fx1'])).get('fx1');
  await fixtures.guardar(d, { evento: eventoDe(), previo });

  assert.equal((await fixtures.porClaves(['fx1'])).get('fx1').fallosConsecutivos, 0);
});

/* ==================== El cerrojo ==================== */

test('el cerrojo lo toma uno solo', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');

  assert.equal(await cerrojos.tomar('prueba', 60_000, ahora, 'A'), true);
  assert.equal(await cerrojos.tomar('prueba', 60_000, ahora, 'B'), false,
    'mientras el de A siga vivo, B no lo consigue');
});

test('el cerrojo caduca solo: un proceso muerto no lo bloquea para siempre', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');
  const masTarde = new Date('2026-09-01T12:02:00Z');

  await cerrojos.tomar('prueba', 60_000, ahora, 'A');   // caduca al minuto
  assert.equal(await cerrojos.tomar('prueba', 60_000, masTarde, 'B'), true);
});

test('sólo lo suelta su dueño', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');
  await cerrojos.tomar('prueba', 60_000, ahora, 'A');

  assert.equal(await cerrojos.soltar('prueba', 'B'), false, 'B no puede soltar lo de A');
  assert.equal(await cerrojos.tomar('prueba', 60_000, ahora, 'B'), false);

  assert.equal(await cerrojos.soltar('prueba', 'A'), true);
  assert.equal(await cerrojos.tomar('prueba', 60_000, ahora, 'B'), true);
});

test('un ciclo abandonado que termina tarde no le quita el cerrojo al siguiente', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');
  const masTarde = new Date('2026-09-01T12:10:00Z');

  await cerrojos.tomar('prueba', 60_000, ahora, 'proc#1');       // ciclo 1, se abandona
  await cerrojos.tomar('prueba', 60_000, masTarde, 'proc#2');    // ciclo 2, mismo proceso

  // El ciclo 1 termina por fin y suelta. No debe llevarse el cerrojo del 2.
  await cerrojos.soltar('prueba', 'proc#1');

  assert.equal(await cerrojos.tomar('prueba', 60_000, masTarde, 'otro'), false,
    'el cerrojo sigue siendo del ciclo 2');
});

/* ==================== El censo y la deduplicación ==================== */

test('dos quinielas con el mismo partido lo consultan UNA vez', async () => {
  const a = await quinielaNueva();
  const b = await quinielaNueva();

  for (const q of [a, b]) {
    await jornadas.guardar(q.id, 'J1', [
      partido('A', 'B', { apiFixtureId: '111' }),
      partido('C', 'D', { apiFixtureId: '222' })
    ]);
  }

  const { catalogo, partidosSeguidos, trabajo } = await sinc.censar();

  assert.equal(partidosSeguidos, 4, 'cuatro partidos entre las dos quinielas');
  assert.equal(catalogo.size, 2, 'pero sólo dos partidos distintos que consultar');
  assert.equal(trabajo.length, 2, 'una entrada de trabajo por jornada y quiniela');
});

test('el censo no mezcla las jornadas de dos quinielas con el mismo nombre', async () => {
  const a = await quinielaNueva();
  const b = await quinielaNueva();

  await jornadas.guardar(a.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);
  await jornadas.guardar(b.id, 'J1', [partido('C', 'D', { apiFixtureId: '222' })]);

  const { trabajo } = await sinc.censar();

  const deA = trabajo.find(t => t.quinielaId === a.id);
  const deB = trabajo.find(t => t.quinielaId === b.id);

  assert.deepEqual(deA.claves, ['111']);
  assert.deepEqual(deB.claves, ['222'], 'es C-02: mismo nombre, datos distintos');
});

test('una quiniela archivada no gasta cuota', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);
  await quinielasMod.cambiarEstado(q.id, 'archivada');

  const { catalogo, quinielas } = await sinc.censar();

  assert.equal(quinielas.length, 0);
  assert.equal(catalogo.size, 0);
});

/* ==================== El refresco ==================== */

test('sólo se consulta lo que ya venció, y se cuenta lo evitado', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');

  await fixtures.guardar(descriptor('fx1'), { evento: eventoDe({ estado: 'Finished' }), ahora });

  const catalogo = new Map([['fx1', descriptor('fx1')], ['fx2', descriptor('fx2')]]);

  const consultadas = [];
  const refrescadas = await sinc.refrescarPendientes(catalogo, {
    ahora,
    consultar: async d => { consultadas.push(d.clave); return eventoDe(); }
  });

  assert.deepEqual(consultadas, ['fx2'], 'fx1 está terminado: no se le pregunta');
  assert.deepEqual([...refrescadas], ['fx2']);
  assert.equal(sinc.metricas.consultasEvitadasPorVentana, 1);
});

test('un fallo del proveedor no tumba el refresco de los demás', async () => {
  const catalogo = new Map([['fx1', descriptor('fx1')], ['fx2', descriptor('fx2')]]);

  const refrescadas = await sinc.refrescarPendientes(catalogo, {
    consultar: async d => {
      if (d.clave === 'fx1') throw new Error('el proveedor devolvió 500');
      return eventoDe();
    }
  });

  assert.deepEqual([...refrescadas], ['fx2']);
  assert.equal(sinc.metricas.erroresApi, 1);
  assert.equal((await fixtures.porClaves(['fx1'])).get('fx1').ultimoError, 'el proveedor devolvió 500');
});

/* ==================== El ciclo entero ==================== */

test('un ciclo completo escribe los resultados oficiales y mueve los puntos', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);
  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }],
    ahora: new Date('2026-01-01')
  });

  const r = await sinc.ejecutarCiclo({
    consultar: async () => eventoDe({ m1: 2, m2: 1, estado: 'Finished' }),
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  assert.equal(r.omitido, false);
  assert.equal(r.fixturesUnicos, 1);
  assert.equal(r.jornadasReescritas, 1);

  const { clasificacion, estado } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(estado, 'confirmada', 'el partido terminó: la jornada se congela');
  assert.equal(clasificacion.find(f => f.jugador === 'ana').puntos, 5);
});

test('el proveedor que da local y visitante al revés no invierte el marcador', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);
  await pronosticos.guardar(q.id, {
    jugador: 'ana', jornada: 'J1', pronosticos: [{ marcador1: 0, marcador2: 3 }],
    ahora: new Date('2026-01-01')
  });

  // El proveedor devuelve B como local: su 3-0 es el 0-3 de la jornada.
  await sinc.ejecutarCiclo({
    consultar: async () => eventoDe({ local: 'B', visitante: 'A', m1: 3, m2: 0, estado: 'Finished' }),
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  const { clasificacion } = await ranking.clasificacionDeJornada(q.id, 'J1', { puntuacionActual: PUNTUACION });
  assert.equal(clasificacion.find(f => f.jugador === 'ana').puntos, 5,
    'sin voltear, un 0-3 acertado contaría como fallo');
});

test('un ciclo sin datos nuevos no reescribe ninguna jornada', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);

  await sinc.ejecutarCiclo({
    consultar: async () => eventoDe({ estado: 'Finished' }),
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  const segundo = await sinc.ejecutarCiclo({
    consultar: async () => { throw new Error('no debería preguntarse'); },
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  assert.equal(segundo.jornadasReescritas, 0);
  assert.equal(segundo.fixturesRefrescados, 0);
});

test('el minuto en vivo llega a la pantalla pero no rehace la clasificación', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);

  await sinc.ejecutarCiclo({
    consultar: async () => eventoDe({ m1: 0, m2: 0, estado: '31' }),
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  const antes = sinc.metricas.syncsSinCambioDePuntos;

  // Mismo 0-0, otro minuto: cambia lo que se ve, no lo que se puntúa.
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');
  await fixtures.guardar(descriptor('111'), { evento: eventoDe({ m1: 0, m2: 0, estado: '75' }) });
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  assert.ok(sinc.metricas.syncsSinCambioDePuntos > antes,
    'invalidar la tabla cada minuto es el peor momento para recalcularla');

  const { partidos } = await oficiales.deJornada(q.id, 'J1');
  assert.equal(partidos[0].minuto, '75', 'y aun así el minuto nuevo sí se guardó');
});

test('una carga manual bloqueada no la pisa el proveedor', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);

  /*
   * ⚠️ `final: true` desde el 25 de agosto. Antes CUALQUIER carga manual
   * congelaba el partido, y por eso esta prueba no lo declaraba; ahora hace
   * falta decir que el partido terminó, porque guardar un marcador de un
   * partido que aún no se ha jugado **no debe** dejar al proveedor sin poder
   * actualizarlo.
   *
   * La intención de la prueba no cambia: lo que el administrador fija, se
   * respeta. Lo que cambió es cómo se fija.
   */
  const { normalizarMarcador } = require('../src/validacion');
  await oficiales.guardarManual(
    q.id, 'J1', [{ marcador1: 4, marcador2: 4, final: true }], normalizarMarcador);

  await sinc.ejecutarCiclo({
    consultar: async () => eventoDe({ m1: 1, m2: 0, estado: 'Finished' }),
    reescribirJornada: sinc.reescribirJornadaDesdeCache
  });

  const { partidos } = await oficiales.deJornada(q.id, 'J1');
  assert.deepEqual([partidos[0].marcador1, partidos[0].marcador2], [4, 4],
    'el administrador miró el partido: es la última palabra');
});

test('el ciclo se salta si otra instancia tiene el cerrojo', async () => {
  const ahora = new Date('2026-09-01T12:00:00Z');
  await cerrojos.tomar(sinc.CERROJO_SYNC, 5 * 60_000, ahora, 'otra-instancia');

  const r = await sinc.ejecutarCiclo({
    ahora,
    consultar: async () => { throw new Error('no debería llegar aquí'); },
    reescribirJornada: async () => {}
  });

  assert.equal(r.omitido, true);
  assert.equal(sinc.metricas.ciclosOmitidosPorCerrojo, 1);
});

test('el ciclo suelta el cerrojo aunque falle por el camino', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: '111' })]);

  await sinc.ejecutarCiclo({
    consultar: async () => eventoDe(),
    reescribirJornada: async () => { throw new Error('reventó al reescribir'); }
  });

  const estado = await cerrojos.estado(sinc.CERROJO_SYNC);
  assert.ok(new Date(estado.expira_en) <= new Date(0),
    'sin esto, un fallo dejaría la sincronización parada cinco minutos');
});

/* ==================== El vigilante ==================== */

test('el vigilante devuelve el control cuando una promesa no termina', async () => {
  const nuncaTermina = new Promise(() => {});

  await assert.rejects(
    () => sinc.conVigilante(nuncaTermina, 20, 'se acabó el tiempo'),
    error => error.esTiempoAgotado === true && /se acabó el tiempo/.test(error.message));
});

test('el limitador no lanza más tareas a la vez de las permitidas', async () => {
  let simultaneas = 0;
  let maximo = 0;

  await sinc.conLimiteDeConcurrencia([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    simultaneas += 1;
    maximo = Math.max(maximo, simultaneas);
    await new Promise(r => setTimeout(r, 5));
    simultaneas -= 1;
  });

  assert.equal(maximo, 3, 'sin tope, ocho peticiones a la vez contra el proveedor');
});


/* ============ El partido que todavía no tiene marcador ============ */

/*
 * ⛔ EL CASO QUE FALTABA, Y QUE ROMPIÓ PRODUCCIÓN.
 *
 * Todas las pruebas de arriba construyen eventos CON marcador (`m1 = 1, m2 = 0`
 * por defecto). Un partido programado —el estado normal de cualquier partido
 * antes de jugarse— llega del proveedor con los marcadores vacíos, y eso no se
 * probaba en ningún sitio.
 *
 * En Mongo daba igual: el campo aceptaba `''`. En PostgreSQL `marcador1` es
 * `integer` y la cadena vacía la rechaza:
 *
 *     invalid input syntax for type integer: ""
 *
 * El error tumbaba la reescritura de la jornada entera, así que los resultados
 * oficiales se quedaban congelados y el registro repetía lo mismo cada minuto.
 */

const eventoSinMarcador = ({ local = 'A', visitante = 'B' } = {}) => ({
  match_hometeam_name: local,
  match_awayteam_name: visitante,
  match_hometeam_score: '',
  match_awayteam_score: '',
  match_hometeam_ft_score: '',
  match_awayteam_ft_score: '',
  match_status: '',
  goalscorer: []
});

test('⛔ un partido sin marcador da null, no cadena vacía', () => {
  const evento = eventoSinMarcador();
  const estado = eventos.obtenerEstadoPartido(evento, { apiStatus: '' });
  const marcador = eventos.obtenerMarcador90Minutos(evento, estado);

  assert.equal(marcador.marcador1, null, 'una cadena vacía no cabe en una columna integer');
  assert.equal(marcador.marcador2, null);

  // Y el 0 sigue siendo un marcador de verdad, no «vacío».
  const cero = eventos.obtenerMarcador90Minutos({
    ...evento, match_hometeam_ft_score: '0', match_awayteam_ft_score: '0'
  }, estado);

  assert.equal(cero.marcador1, 0, 'un 0-0 es un marcador, no la ausencia de uno');
  assert.equal(cero.marcador2, 0);
});

test('⛔ sincronizar una jornada con partidos aún sin jugar no revienta', async () => {
  const q = await quinielaNueva();

  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiFixtureId: 'f-jugado' }),
    partido('C', 'D', { apiFixtureId: 'f-porjugar' })
  ]);

  await fixtures.guardar(descriptor('f-jugado'), { evento: eventoDe({ local: 'A', visitante: 'B', m1: 2, m2: 1 }) });
  await fixtures.guardar(descriptor('f-porjugar'), { evento: eventoSinMarcador({ local: 'C', visitante: 'D' }) });

  const r = await sinc.reescribirJornadaDesdeCache(q.id, "J1");

  assert.equal(r.ok, true, 'la jornada entera no puede caerse por un partido sin marcador');

  const doc = await oficiales.deJornada(q.id, 'J1');

  /*
   * ⛔ Lo que de verdad importa: el partido JUGADO se guardó. Antes, el fallo
   * del segundo impedía escribir el primero, y por eso «los resultados no se
   * actualizan».
   */
  const jugado = doc.partidos.find(p => p.equipo1 === 'A');
  assert.equal(jugado.marcador1, 2, 'el partido con resultado tiene que guardarse igual');
  assert.equal(jugado.marcador2, 1);

  const porJugar = doc.partidos.find(p => p.equipo1 === 'C');
  assert.equal(porJugar.marcador1, null, 'y el que no se ha jugado queda en nulo');
});

test('⚠️ escribir informa de los partidos que fallaron, y guarda los demás', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B'), partido('C', 'D')]);

  const r = await db.enQuiniela(q.id, async c => {
    const jornadaId = await pronosticos.jornadaIdDe(c, 'J1');
    const lista = await pronosticos.partidosDe(c, jornadaId);
    const contenedor = await oficiales.asegurarContenedor(c, q.id, jornadaId);

    return oficiales.escribir(c, q.id, contenedor, [
      { partidoId: lista[0].id, marcador1: 3, marcador2: 1, estado: 'TC' },
      // Un partido que no existe: la clave ajena lo rechaza.
      { partidoId: '00000000-0000-0000-0000-000000000000', marcador1: 1, marcador2: 1 },
      { partidoId: lista[1].id, marcador1: 0, marcador2: 0, estado: 'TC' }
    ]);
  });

  /*
   * ⛔ Los dos buenos se guardan aunque el del medio falle. Esto sólo funciona
   * con SAVEPOINT: en PostgreSQL un error aborta la transacción entera, y un
   * `try/catch` a secas dejaría las siguientes fallando por eco del primero.
   */
  assert.equal(r.escritas, 2, 'un partido malo no puede llevarse los buenos');
  assert.equal(r.fallos.length, 1);

  const doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos.find(p => p.equipo1 === 'A').marcador1, 3);
  assert.equal(doc.partidos.find(p => p.equipo1 === 'C').marcador1, 0);
});


/* ============ Quién manda: el proveedor o el administrador ============ */

/*
 * La regla decidida el 25 de agosto, y el motivo: que la historia de la
 * quiniela deje de depender del proveedor en cuanto un partido termina.
 *
 *   - programado o en juego -> manda el proveedor;
 *   - terminado y con resultado del administrador -> manda el administrador;
 *   - y un resultado ya definitivo NO SE VUELVE A TOCAR, venga de donde venga.
 */

/** Carga manual como la haría la pantalla, con su casilla de «ya terminó». */
async function cargarAMano(quinielaId, jornada, resultados) {
  const { normalizarMarcador } = require('../src/validacion');
  return oficiales.guardarManual(quinielaId, jornada, resultados, normalizarMarcador);
}

test('⛔ un partido TERMINADO y cargado a mano gana al proveedor, para siempre', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: 'f1' })]);

  // El administrador lo declara terminado con 3-1.
  await cargarAMano(q.id, 'J1', [{ marcador1: 3, marcador2: 1, final: true }]);

  // Y el proveedor insiste con otra cosa, incluso dándolo por terminado.
  await fixtures.guardar(descriptor('f1'), {
    evento: eventoDe({ local: 'A', visitante: 'B', m1: 2, m2: 2, estado: 'Finished' })
  });

  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  const doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].marcador1, 3, 'lo que escribió el administrador es definitivo');
  assert.equal(doc.partidos[0].marcador2, 1);
  assert.equal(doc.partidos[0].origen, 'manual');
});

test('⚠️ un partido SIN terminar cargado a mano lo sigue actualizando el proveedor', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: 'f1' })]);

  /*
   * Sin marcar la casilla: sirve para adelantarse cuando el proveedor va
   * retrasado, pero no congela nada.
   */
  await cargarAMano(q.id, 'J1', [{ marcador1: 1, marcador2: 0, final: false }]);

  let doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].marcador1, 1, 'se guarda igual');
  assert.equal(doc.partidos[0].bloqueadoFinal, false, 'pero no queda fijado');

  await fixtures.guardar(descriptor('f1'), {
    evento: eventoDe({ local: 'A', visitante: 'B', m1: 2, m2: 0, estado: '70' })
  });

  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].marcador1, 2, 'mientras no termine, manda el proveedor');
});

test('⛔ guardar la jornada NO congela los partidos que aún no se han jugado', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [
    partido('A', 'B', { apiFixtureId: 'f1' }),
    partido('C', 'D', { apiFixtureId: 'f2' })
  ]);

  /*
   * El caso que motivó el cambio: antes, guardar la jornada marcaba TODAS las
   * filas como definitivas y el proveedor dejaba de actualizar el domingo.
   */
  await cargarAMano(q.id, 'J1', [
    { marcador1: 2, marcador2: 1, final: true },   // éste sí terminó
    { marcador1: null, marcador2: null, final: false }  // éste todavía no se juega
  ]);

  await fixtures.guardar(descriptor('f2'), {
    evento: eventoDe({ local: 'C', visitante: 'D', m1: 4, m2: 0, estado: 'Finished' })
  });

  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  const doc = await oficiales.deJornada(q.id, 'J1');

  assert.equal(doc.partidos.find(p => p.equipo1 === 'A').marcador1, 2, 'el fijado no se toca');
  assert.equal(doc.partidos.find(p => p.equipo1 === 'C').marcador1, 4,
    'el que no se había jugado sí se actualiza: guardar la jornada no lo congeló');
});

test('⛔ un evento sin marcador NO borra el que ya había', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: 'f1' })]);

  // El partido va 2-1 en vivo.
  await fixtures.guardar(descriptor('f1'), {
    evento: eventoDe({ local: 'A', visitante: 'B', m1: 2, m2: 1, estado: '70' })
  });
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  /*
   * Y ahora el proveedor responde 200 con un evento DEGRADADO: el partido está
   * pero sin marcador. Es la respuesta mala que la caché no filtra —la caída sí
   * la cubre, ésta no— y la que borraba el marcador bueno dejándolo en nulo.
   */
  await fixtures.guardar(descriptor('f1'), {
    evento: {
      match_hometeam_name: 'A', match_awayteam_name: 'B',
      match_hometeam_score: '', match_awayteam_score: '',
      match_hometeam_ft_score: '', match_awayteam_ft_score: '',
      match_status: '71', goalscorer: []
    }
  });
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  const doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].marcador1, 2, 'el sincronizador puede mejorar un dato, no empeorarlo');
  assert.equal(doc.partidos[0].marcador2, 1);
});

test('un partido terminado por el proveedor tampoco se reescribe después', async () => {
  const q = await quinielaNueva();
  await jornadas.guardar(q.id, 'J1', [partido('A', 'B', { apiFixtureId: 'f1' })]);

  await fixtures.guardar(descriptor('f1'), {
    evento: eventoDe({ local: 'A', visitante: 'B', m1: 3, m2: 0, estado: 'Finished' })
  });
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  let doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].bloqueadoFinal, true, 'TC deja el resultado fijado');

  // El proveedor se contradice más tarde.
  await fixtures.guardar(descriptor('f1'), {
    evento: eventoDe({ local: 'A', visitante: 'B', m1: 1, m2: 1, estado: 'Finished' })
  });
  await sinc.reescribirJornadaDesdeCache(q.id, 'J1');

  doc = await oficiales.deJornada(q.id, 'J1');
  assert.equal(doc.partidos[0].marcador1, 3, 'lo terminado es historia: no se reescribe');
});

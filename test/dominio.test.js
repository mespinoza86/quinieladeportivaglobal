/*
 * Jornadas, partidos, jugadores y equipos (tajada 3 de la migración).
 *
 * Dos cosas se prueban aquí con especial cuidado, porque son las que cambian de
 * verdad respecto a Mongo y las que romperían en silencio:
 *
 *   - **La jornada actual es la última CREADA**, no la de fecha más tardía.
 *     Las pruebas cruzan las fechas a propósito: la jornada más nueva lleva los
 *     partidos más viejos. Si alguien "arregla" eso para que vayan alineadas,
 *     dejan de distinguir qué regla aplica el servidor.
 *   - **Los partidos conservan su identidad** al editar la jornada. Era M-02.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielasMod = require('../src/quinielas');
const membresias = require('../src/membresias');
const jornadas = require('../src/jornadas');
const jugadores = require('../src/jugadores');
const ligas = require('../src/ligas');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

let n = 0;
async function cuentaNueva(prefijo = 'u') {
  n += 1;
  return usuarios.crear({
    username: `${prefijo}${n}`, email: `${prefijo}${n}@x.com`, password: 'contrasena-larga-1'
  });
}

async function quinielaNueva(nombre = 'Q') {
  const u = await cuentaNueva('dueno');
  const q = await quinielasMod.crear({ nombre: `${nombre}-${n}`, propietarioId: u.id });
  return { quiniela: q, usuario: u };
}

const partido = (equipo1, equipo2, extra = {}) => ({
  equipo1, equipo2, logoEquipo1: `${equipo1}.png`, logoEquipo2: `${equipo2}.png`,
  comodin: false, apiFixtureId: null, apiLeagueId: null, apiDate: null, apiStatus: null,
  ...extra
});

/* ==================== La jornada actual ==================== */

test('la jornada actual es la última creada, aunque sus partidos sean los más viejos', async () => {
  const { quiniela } = await quinielaNueva();

  // Las fechas van cruzadas a propósito: la creada después juega antes.
  await jornadas.guardar(quiniela.id, 'Jornada 1',
    [partido('A', 'B', { apiDate: '2026-12-01 20:00' })]);
  await jornadas.guardar(quiniela.id, 'Jornada 2',
    [partido('C', 'D', { apiDate: '2026-01-05 20:00' })]);

  const { sugerida, jornadas: lista } = await jornadas.actual(quiniela.id);

  assert.equal(sugerida, 'Jornada 2', 'debe ganar la última creada, no la de fecha más tardía');
  assert.deepEqual(lista.map(j => j.nombre), ['Jornada 2', 'Jornada 1']);
});

test('volver a guardar una jornada no la convierte en la más nueva', async () => {
  const { quiniela } = await quinielaNueva();

  await jornadas.guardar(quiniela.id, 'Jornada 1', [partido('A', 'B')]);
  await jornadas.guardar(quiniela.id, 'Jornada 2', [partido('C', 'D')]);
  // Editar la 1 no la asciende: sigue siendo la primera que se creó.
  await jornadas.guardar(quiniela.id, 'Jornada 1', [partido('A', 'B'), partido('E', 'F')]);

  assert.equal((await jornadas.actual(quiniela.id)).sugerida, 'Jornada 2');
});

test('sin jornadas, la actual responde vacío en vez de fallar', async () => {
  const { quiniela } = await quinielaNueva();
  const r = await jornadas.actual(quiniela.id);
  assert.equal(r.sugerida, null);
  assert.deepEqual(r.jornadas, []);
});

test('la jornada actual no cruza entre quinielas', async () => {
  const a = await quinielaNueva('A');
  const b = await quinielaNueva('B');

  await jornadas.guardar(a.quiniela.id, 'Solo de A', [partido('A', 'B')]);
  await jornadas.guardar(b.quiniela.id, 'Solo de B', [partido('C', 'D')]);

  assert.equal((await jornadas.actual(a.quiniela.id)).sugerida, 'Solo de A');
  assert.equal((await jornadas.actual(b.quiniela.id)).sugerida, 'Solo de B');
});

/* ==================== Partidos ==================== */

test('los partidos vuelven con la forma que espera el frontend', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J', [
    partido('Saprissa', 'Alajuelense', { comodin: true, apiFixtureId: '123', apiDate: '2026-08-20 20:00' })
  ]);

  const j = await jornadas.porNombre(quiniela.id, 'J');
  assert.deepEqual(j.partidos[0], {
    equipo1: 'Saprissa', equipo2: 'Alajuelense',
    logoEquipo1: 'Saprissa.png', logoEquipo2: 'Alajuelense.png',
    comodin: true, apiFixtureId: '123', apiLeagueId: null,
    apiDate: '2026-08-20 20:00', apiStatus: null
  });
});

test('el orden de los partidos se conserva', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J',
    [partido('A', 'B'), partido('C', 'D'), partido('E', 'F')]);

  const j = await jornadas.porNombre(quiniela.id, 'J');
  assert.deepEqual(j.partidos.map(p => p.equipo1), ['A', 'C', 'E']);
});

/*
 * Es M-02. En Mongo, guardar reemplazaba el arreglo entero y los pronósticos
 * -que apuntaban por posición- pasaban a otro partido sin avisar.
 */
test('editar una jornada NO le cambia el id a los partidos que siguen ahí', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J', [partido('A', 'B'), partido('C', 'D')]);

  const antes = await db.enQuiniela(quiniela.id, async c => {
    const { rows } = await c.query('SELECT id, orden FROM partidos ORDER BY orden');
    return rows;
  });

  // Se cambia el logo del primero y se añade un tercero.
  await jornadas.guardar(quiniela.id, 'J', [
    partido('A', 'B', { logoEquipo1: 'otro.png' }), partido('C', 'D'), partido('E', 'F')
  ]);

  const despues = await db.enQuiniela(quiniela.id, async c => {
    const { rows } = await c.query('SELECT id, orden FROM partidos ORDER BY orden');
    return rows;
  });

  assert.equal(despues[0].id, antes[0].id, 'el partido de la posición 0 debe conservar su id');
  assert.equal(despues[1].id, antes[1].id, 'el de la posición 1 también');
  assert.equal(despues.length, 3);
});

test('guardar con menos partidos quita los que sobran', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J', [partido('A', 'B'), partido('C', 'D'), partido('E', 'F')]);
  await jornadas.guardar(quiniela.id, 'J', [partido('A', 'B')]);

  const j = await jornadas.porNombre(quiniela.id, 'J');
  assert.equal(j.partidos.length, 1);
});

test('agregar un partido lo pone al final, y respeta el máximo', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J', [partido('A', 'B')]);

  assert.equal((await jornadas.agregarPartido(quiniela.id, 'J', partido('C', 'D'), 50)).ok, true);
  const j = await jornadas.porNombre(quiniela.id, 'J');
  assert.deepEqual(j.partidos.map(p => p.equipo1), ['A', 'C']);

  const lleno = await jornadas.agregarPartido(quiniela.id, 'J', partido('E', 'F'), 2);
  assert.equal(lleno.motivo, 'demasiados');
});

test('agregar a una jornada que no existe da un motivo, no un error', async () => {
  const { quiniela } = await quinielaNueva();
  assert.equal((await jornadas.agregarPartido(quiniela.id, 'No existe', partido('A', 'B'), 50)).motivo,
    'no_encontrada');
});

test('eliminar partidos renumera, y los que quedan conservan su id', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J',
    [partido('A', 'B'), partido('C', 'D'), partido('E', 'F'), partido('G', 'H')]);

  const antes = await db.enQuiniela(quiniela.id, async c => {
    const { rows } = await c.query('SELECT id, orden, equipo1 FROM partidos ORDER BY orden');
    return rows;
  });

  await jornadas.eliminarPartidos(quiniela.id, 'J', [1, 2]);   // fuera C-D y E-F

  const despues = await db.enQuiniela(quiniela.id, async c => {
    const { rows } = await c.query('SELECT id, orden, equipo1 FROM partidos ORDER BY orden');
    return rows;
  });

  assert.deepEqual(despues.map(p => p.equipo1), ['A', 'G']);
  assert.deepEqual(despues.map(p => p.orden), [0, 1], 'deben quedar renumerados sin huecos');
  assert.equal(despues[0].id, antes[0].id);
  assert.equal(despues[1].id, antes[3].id, 'G-H conserva su id aunque haya cambiado de posición');
});

test('el comodín se cambia sin tocar el resto, y sólo si la lista coincide', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J', [partido('A', 'B'), partido('C', 'D')]);

  const r = await jornadas.fijarComodines(quiniela.id, 'J', [
    { comodin: false }, { comodin: true }
  ]);
  assert.equal(r.ok, true);

  const j = await jornadas.porNombre(quiniela.id, 'J');
  assert.deepEqual(j.partidos.map(p => p.comodin), [false, true]);
  assert.equal(j.partidos[0].equipo1, 'A', 'los equipos no debían tocarse');

  const desajustada = await jornadas.fijarComodines(quiniela.id, 'J', [{ comodin: true }]);
  assert.equal(desajustada.motivo, 'no_coincide');
});

test('listar devuelve todas las jornadas con sus partidos en una sola consulta', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B')]);
  await jornadas.guardar(quiniela.id, 'J2', []);

  const todas = await jornadas.listar(quiniela.id);
  assert.deepEqual(todas.map(j => j.nombre), ['J1', 'J2']);
  assert.equal(todas[0].partidos.length, 1);
  assert.deepEqual(todas[1].partidos, [], 'una jornada sin partidos debe traer lista vacía, no null');
});

test('las jornadas no se ven entre quinielas aunque se llamen igual', async () => {
  const a = await quinielaNueva('A');
  const b = await quinielaNueva('B');

  await jornadas.guardar(a.quiniela.id, 'Jornada 1', [partido('A', 'B')]);
  await jornadas.guardar(b.quiniela.id, 'Jornada 1', [partido('C', 'D'), partido('E', 'F')]);

  assert.equal((await jornadas.porNombre(a.quiniela.id, 'Jornada 1')).partidos.length, 1);
  assert.equal((await jornadas.porNombre(b.quiniela.id, 'Jornada 1')).partidos.length, 2);
});

/* ==================== Jugadores y equipos ==================== */

test('los nombres juntan a los miembros de dentro y a los históricos sin cuenta', async () => {
  const { quiniela, usuario } = await quinielaNueva();
  const otro = await cuentaNueva('zeta');

  await membresias.solicitarIngreso(quiniela.id, otro.id);
  const m = await membresias.de(quiniela.id, otro.id);
  await membresias.aprobarIngreso(quiniela.id, m.id);

  // Un jugador histórico, sin cuenta, como los que trajo la migración.
  await db.enQuiniela(quiniela.id, c =>
    c.query('INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1, $2)', [quiniela.id, 'Ávila']));

  const lista = await jugadores.nombres(quiniela.id);
  assert.ok(lista.includes(otro.username), 'el miembro aprobado debe estar');
  assert.ok(lista.includes('Ávila'), 'el histórico sin cuenta también');

  /*
   * Y el propietario TAMBIÉN, aunque nunca haya pedido ingresar: crear la
   * quiniela le dejó una membresía activa. Es el comportamiento que tenía
   * Mongo —`estado IN ('activo','pendiente_retiro')` lo incluye— y conviene
   * dejarlo escrito, porque leyendo el código parece que sólo entran quienes
   * fueron aprobados.
   */
  assert.ok(lista.includes(usuario.username), 'el propietario es miembro activo desde que crea');
});

test('los nombres no se repiten aunque el miembro tenga jugador propio', async () => {
  const { quiniela } = await quinielaNueva();
  const otro = await cuentaNueva('repe');

  await membresias.solicitarIngreso(quiniela.id, otro.id);
  const m = await membresias.de(quiniela.id, otro.id);
  await membresias.aprobarIngreso(quiniela.id, m.id);   // crea el jugador

  const lista = await jugadores.nombres(quiniela.id);
  assert.equal(lista.filter(x => x === otro.username).length, 1);
});

test('los equipos se añaden sin duplicar y se borran', async () => {
  const { quiniela } = await quinielaNueva();

  await jugadores.agregarEquipo(quiniela.id, 'Saprissa');
  await jugadores.agregarEquipo(quiniela.id, 'Saprissa');
  assert.deepEqual(await jugadores.equipos(quiniela.id), ['Saprissa']);

  assert.equal((await jugadores.eliminarEquipo(quiniela.id, 'Saprissa')).ok, true);
  assert.deepEqual(await jugadores.equipos(quiniela.id), []);
});

test('los equipos de una quiniela no se ven desde otra', async () => {
  const a = await quinielaNueva('A');
  const b = await quinielaNueva('B');

  await jugadores.agregarEquipo(a.quiniela.id, 'Solo de A');
  assert.deepEqual(await jugadores.equipos(b.quiniela.id), []);
});


/* ==================== Ligas favoritas ==================== */

/*
 * Nada de esto toca la base: son funciones puras. Viven aquí porque las ligas
 * son de lo que se arma una jornada, que es el tema de esta suite.
 */

/** Lo que devuelve `agruparLigasPorPais`, escrito a mano para no depender de él. */
const agrupado = () => ({
  desde: '2099-01-01',
  hasta: '2099-01-07',
  paises: [
    { pais: 'Costa Rica', ligas: [
      { id: '7', nombre: 'Primera División', partidos: 6 },
      { id: '9', nombre: 'Segunda División', partidos: 4 }
    ] },
    { pais: 'México', ligas: [{ id: '12', nombre: 'Liga MX', partidos: 9 }] }
  ]
});

test('las favoritas suben arriba y NO se repiten en su país', () => {
  const salida = ligas.aplicarFavoritas(agrupado(), [{ id: '12', nombre: 'Liga MX' }]);

  assert.deepEqual(salida.favoritas.map(l => l.nombre), ['Liga MX']);
  assert.equal(salida.favoritas[0].partidos, 9);

  const nombresAbajo = salida.paises.flatMap(g => g.ligas.map(l => l.nombre));
  assert.ok(!nombresAbajo.includes('Liga MX'), 'verla dos veces confunde más de lo que ayuda');
});

test('un país que se queda sin ligas desaparece de la lista', () => {
  const salida = ligas.aplicarFavoritas(agrupado(), [{ id: '12', nombre: 'Liga MX' }]);
  assert.deepEqual(salida.paises.map(g => g.pais), ['Costa Rica'],
    'un grupo vacío es un rótulo sin nada debajo');
});

test('⚠️ una favorita que esta semana no juega sale igual, con partidos en 0', () => {
  /*
   * Es lo que el navegador pinta en gris. Esconderla haría pensar que la
   * configuración se perdió.
   */
  const salida = ligas.aplicarFavoritas(agrupado(), [{ id: '999', nombre: 'Liga Centroamericana' }]);

  assert.equal(salida.favoritas.length, 1);
  assert.equal(salida.favoritas[0].nombre, 'Liga Centroamericana');
  assert.equal(salida.favoritas[0].partidos, 0);
});

test('las favoritas que juegan van antes que las que no', () => {
  const salida = ligas.aplicarFavoritas(agrupado(), [
    { id: '999', nombre: 'AAA sin partidos' },
    { id: '12', nombre: 'Liga MX' }
  ]);

  assert.deepEqual(salida.favoritas.map(l => l.partidos), [9, 0],
    'empezar por lo que no se puede elegir sería empezar por lo inútil');
});

test('⚠️ el rótulo que se muestra es el del proveedor, no el que se guardó', () => {
  /*
   * Si renombraron el torneo, el nombre guardado al marcarlo es el desfasado.
   * El id es lo que identifica; el nombre sólo rotula. Ésa fue la lección de la
   * Fase C y aquí vuelve a aplicar.
   */
  const salida = ligas.aplicarFavoritas(agrupado(), [{ id: '12', nombre: 'Nombre viejo' }]);
  assert.equal(salida.favoritas[0].nombre, 'Liga MX');
});

test('⛔ aplicar favoritas NO TOCA lo que recibe: la caché se comparte entre quinielas', () => {
  /*
   * La caché de ligas tiene por clave el rango de fechas y nada más, para que
   * dos quinielas que sigan los mismos días compartan la consulta. Si esto
   * mutara el objeto guardado, la quiniela siguiente recibiría los favoritos de
   * la anterior, con las ligas ya arrancadas de sus países.
   */
  const original = agrupado();
  const copia = JSON.parse(JSON.stringify(original));

  ligas.aplicarFavoritas(original, [{ id: '12', nombre: 'Liga MX' }]);

  assert.deepEqual(original, copia, 'la entrada de la caché tiene que quedar intacta');
});

test('sin favoritas, la lista de países queda como estaba', () => {
  const salida = ligas.aplicarFavoritas(agrupado(), []);
  assert.deepEqual(salida.favoritas, []);
  assert.deepEqual(salida.paises, agrupado().paises);
});

test('las favoritas sin id o sin nombre se descartan', () => {
  /*
   * El nombre es obligatorio porque una favorita que no juega esta semana no
   * tiene de dónde sacar su rótulo: los nombres llegan con los partidos.
   */
  assert.deepEqual(ligas.normalizarFavoritas([
    { id: '7', nombre: 'Vale' },
    { id: '', nombre: 'Sin id' },
    { id: '8', nombre: '   ' },
    null,
    'basura'
  ]), [{ id: '7', nombre: 'Vale' }]);
});

test('las favoritas repetidas se quedan en una, y hay un tope', () => {
  assert.deepEqual(ligas.normalizarFavoritas([
    { id: '7', nombre: 'Primera' },
    { id: '7', nombre: 'Primera otra vez' }
  ]), [{ id: '7', nombre: 'Primera' }]);

  const muchas = Array.from({ length: ligas.MAXIMO_FAVORITAS + 5 },
    (_, i) => ({ id: String(i), nombre: 'Liga ' + i }));

  assert.equal(ligas.normalizarFavoritas(muchas).length, ligas.MAXIMO_FAVORITAS,
    'esto vive dentro de un jsonb que se lee entero en cada consulta de la quiniela');

  assert.deepEqual(ligas.normalizarFavoritas('no es una lista'), []);
});

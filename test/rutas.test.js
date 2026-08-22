/*
 * Las rutas sobre PostgreSQL (tajada 7, pasos 1 a 3).
 *
 * Es la suite que releva a `test/integracion.test.js`, que sigue existiendo y
 * verde contra `server.js` y Mongo hasta el paso 7.7.
 *
 * ⚠️ Lo que se prueba aquí NO son las reglas —eso ya está en las suites de los
 * módulos, con 138 pruebas— sino **la traducción**: que la ruta correcta llame
 * a la regla correcta, con el código HTTP correcto, y que las guardias no dejen
 * pasar a quien no debe.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const db = require('../src/db');
const enMemoria = require('./postgres-en-memoria');

let app;
let adaptador;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  adaptador = await enMemoria.levantar();
  /*
   * El almacén de sesiones habla con la base por su cuenta, sin pasar por los
   * ayudantes de `src/db.js`: una sesión no pertenece a ninguna quiniela, así
   * que no hay contexto que fijar. Por eso se le pasa el adaptador directo.
   */
  app = require('../src/servidor').crearApp({
    pool: adaptador,
    secretoSesion: 'secreto-solo-para-pruebas'
  }).app;
});

test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

/* ==================== Utilidades ==================== */

let n = 0;
/*
 * ⚠️ El prefijo por defecto tiene tres letras a propósito: el registro exige un
 * nombre de 3 a 30, y con un prefijo de una letra las nueve primeras cuentas
 * —"u1" … "u9"— salían de dos. Fallaban sólo las primeras pruebas de la suite,
 * que es la peor forma de fallar: parece un problema de orden.
 */
function credenciales(prefijo = 'usu') {
  n += 1;
  return {
    username: `${prefijo}${n}`,
    email: `${prefijo}${n}@ejemplo.com`,
    password: 'contrasena-larga-1',
    confirmarPassword: 'contrasena-larga-1'
  };
}

/** Registra una cuenta y devuelve un agente con la sesión ya iniciada. */
async function cuentaNueva(prefijo = 'usu') {
  const agente = request.agent(app);
  const datos = credenciales(prefijo);
  const res = await agente.post('/api/auth/registro').send(datos);
  assert.equal(res.status, 201, `No se pudo registrar: ${JSON.stringify(res.body)}`);
  return { agente, datos, usuarioId: res.body.usuario?.id };
}

/** Crea una quiniela, la deja seleccionada y activa el Admin Mode. */
async function quinielaNueva(agente, datos, nombre = 'Mi quiniela') {
  const creada = await agente.post('/api/quinielas').send({ nombre });
  assert.equal(creada.status, 201, `No se pudo crear: ${JSON.stringify(creada.body)}`);

  const { id, codigoIngreso } = creada.body.quiniela;

  const sel = await agente.post(`/api/quinielas/${id}/seleccionar`).send({});
  assert.equal(sel.status, 200, `No se pudo seleccionar: ${JSON.stringify(sel.body)}`);

  const admin = await agente.post('/api/admin-mode/activar').send({ password: datos.password });
  assert.equal(admin.status, 200, `No se pudo activar Admin Mode: ${JSON.stringify(admin.body)}`);

  return { id, codigoIngreso };
}

/** Una cuenta con quiniela propia y Admin Mode puesto: el caso de siempre. */
async function admin(prefijo = 'admin') {
  const { agente, datos, usuarioId } = await cuentaNueva(prefijo);
  const quiniela = await quinielaNueva(agente, datos);
  return { agente, datos, usuarioId, quiniela };
}

const partido = (equipo1, equipo2, extra = {}) => ({
  equipo1, equipo2, logoEquipo1: '', logoEquipo2: '',
  comodin: false, apiFixtureId: '', apiLeagueId: '',
  apiDate: '2099-01-01 15:00', apiStatus: '',
  ...extra
});

/* ==================== 7.1 — Cimientos ==================== */

test('/healthz responde aunque no se haya tocado la base', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'vivo');
});

test('/readyz responde listo con la base en pie', async () => {
  const res = await request(app).get('/readyz');
  assert.equal(res.status, 200);
  assert.equal(res.body.base, 'conectada');
});

test('las cabeceras de seguridad llegan puestas', async () => {
  const res = await request(app).get('/healthz');
  const csp = res.headers['content-security-policy'];

  assert.match(csp, /script-src-attr 'none'/, 'los manejadores en atributo siguen prohibidos');
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/, 'S-04: el marcado no ejecuta código');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

/* ---------- Registro y login ---------- */

test('registrarse deja la sesión iniciada', async () => {
  const { agente, datos } = await cuentaNueva();

  const yo = await agente.get('/api/auth/me');
  assert.equal(yo.status, 200);
  assert.equal(yo.body.usuario.username, datos.username);
  assert.equal(yo.body.quinielaActivaId, null);
});

test('la contraseña nunca sale en una respuesta', async () => {
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/registro').send(credenciales());

  assert.equal(res.status, 201);
  assert.equal(JSON.stringify(res.body).includes('contrasena-larga-1'), false);
  assert.equal('password' in res.body.usuario, false);
});

test('el registro rechaza los datos malos con su motivo', async () => {
  const corta = { ...credenciales(), password: 'corta', confirmarPassword: 'corta' };
  const res = await request(app).post('/api/auth/registro').send(corta);

  assert.equal(res.status, 400);
  assert.match(res.body.error, /al menos 8 caracteres/);
});

test('un nombre ya cogido responde 409 y dice cuál de los dos campos es', async () => {
  const { datos } = await cuentaNueva();

  const res = await request(app).post('/api/auth/registro').send({
    ...credenciales(), username: datos.username
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.usernameEnUso, true);
  assert.equal(res.body.emailEnUso, false);
});

test('se entra con el nombre o con el correo, indistintamente', async () => {
  const { datos } = await cuentaNueva();

  for (const identificador of [datos.username, datos.email, datos.username.toUpperCase()]) {
    const res = await request(app).post('/api/auth/login')
      .send({ identificador, password: datos.password });
    assert.equal(res.status, 200, `falló con "${identificador}"`);
  }
});

test('la contraseña equivocada y el usuario inexistente dan el MISMO mensaje', async () => {
  const { datos } = await cuentaNueva();

  const mala = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'otra-cosa-larga' });
  const nadie = await request(app).post('/api/auth/login')
    .send({ identificador: 'no-existe-nadie', password: 'otra-cosa-larga' });

  assert.equal(mala.status, 401);
  assert.equal(nadie.status, 401);
  assert.equal(mala.body.error, nadie.body.error,
    'distinguirlos diría qué cuentas existen');
});

test('la sesión se regenera al entrar: una cookie fijada de antes no sirve', async () => {
  const { datos } = await cuentaNueva();

  /*
   * Si un atacante consigue fijar un identificador de sesión ANTES de que la
   * víctima entre, y ese identificador sobrevive al login, se queda dentro de
   * la sesión de la víctima. `req.session.regenerate` lo impide dando uno
   * nuevo, y esto comprueba que se da: dos entradas, dos identificadores.
   */
  const sid = res => String(res.headers['set-cookie'] || '')
    .match(/connect\.sid=([^;]+)/)?.[1] ?? null;

  const primera = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });
  const segunda = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });

  assert.ok(sid(primera), 'entrar debe dar una cookie de sesión');
  assert.notEqual(sid(primera), sid(segunda), 'el identificador tiene que cambiar');
});

test('salir deja la sesión sin efecto', async () => {
  const { agente } = await cuentaNueva();

  await agente.post('/logout').send({});
  const res = await agente.get('/check-auth');

  assert.equal(res.body.authenticated, false);
});

test('sin sesión, /api responde 401 y no 500', async () => {
  const res = await request(app).get('/api/jornadas');
  assert.equal(res.status, 401);
});

test('con sesión pero sin quiniela elegida, /api responde 409', async () => {
  const { agente } = await cuentaNueva();
  const res = await agente.get('/api/jornadas');

  assert.equal(res.status, 409);
  assert.match(res.body.error, /seleccionar una quiniela/);
});

test('un JSON mal formado es culpa del cliente, no del servidor', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{esto no es json');

  assert.equal(res.status, 400, 'antes esto acababa en 500 y ensuciaba los registros');
});

test('las páginas de administración no se descargan sin ser administrador', async () => {
  const { agente } = await cuentaNueva();

  const res = await agente.get('/jornadas.html');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/quinielas.html');
});

/* ==================== 7.2 — Plataforma ==================== */

test('crear una quiniela deja a quien la crea dentro y como propietario', async () => {
  const { agente, datos } = await cuentaNueva();
  const creada = await agente.post('/api/quinielas').send({ nombre: 'La de siempre' });

  assert.equal(creada.status, 201);
  assert.ok(creada.body.quiniela.id);
  assert.ok(creada.body.quiniela.codigoIngreso);

  const lista = await agente.get('/api/quinielas');
  assert.equal(lista.body.length, 1);
  assert.equal(lista.body[0].rol, 'propietario');
  assert.equal(lista.body[0].estadoMembresia, 'activo');
});

test('el nombre de la quiniela se valida antes de escribir nada', async () => {
  const { agente } = await cuentaNueva();
  const res = await agente.post('/api/quinielas').send({ nombre: 'ab' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /entre 3 y 80/);
});

test('un miembro normal no ve el código de ingreso: no puede invitar', async () => {
  const jefe = await admin('jefe');
  const { agente: otro } = await cuentaNueva('otro');

  await otro.post('/api/quinielas/unirse').send({ codigoIngreso: jefe.quiniela.codigoIngreso });

  const miembros = await jefe.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.estado === 'pendiente_ingreso');
  await jefe.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});

  await otro.post(`/api/quinielas/${jefe.quiniela.id}/seleccionar`).send({});
  const lista = await otro.get('/api/quinielas');

  assert.equal(lista.body[0].rol, 'user');
  assert.equal(lista.body[0].codigoIngreso, undefined);
});

test('unirse con un código inventado responde 404', async () => {
  const { agente } = await cuentaNueva();
  const res = await agente.post('/api/quinielas/unirse').send({ codigoIngreso: 'NOEXISTE00' });

  assert.equal(res.status, 404);
});

test('unirse dos veces no crea dos solicitudes', async () => {
  const jefe = await admin('jefe');
  const { agente: otro } = await cuentaNueva('otro');

  const primera = await otro.post('/api/quinielas/unirse')
    .send({ codigoIngreso: jefe.quiniela.codigoIngreso });
  const segunda = await otro.post('/api/quinielas/unirse')
    .send({ codigoIngreso: jefe.quiniela.codigoIngreso });

  assert.equal(primera.status, 202);
  assert.equal(segunda.status, 409);
});

test('no se puede seleccionar una quiniela a la que no perteneces', async () => {
  const jefe = await admin('jefe');
  const { agente: intruso } = await cuentaNueva('intruso');

  const res = await intruso.post(`/api/quinielas/${jefe.quiniela.id}/seleccionar`).send({});
  assert.equal(res.status, 403);
});

/* ---------- Admin Mode ---------- */

test('el rol no basta: sin Admin Mode las rutas de administración responden 401', async () => {
  const { agente, datos } = await cuentaNueva();
  const creada = await agente.post('/api/quinielas').send({ nombre: 'Sin admin mode' });
  await agente.post(`/api/quinielas/${creada.body.quiniela.id}/seleccionar`).send({});

  const res = await agente.post('/api/jornadas')
    .send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  assert.equal(res.status, 401);
  assert.equal(res.body.requiereAdminMode, true);
});

test('el Admin Mode exige la contraseña de verdad', async () => {
  const { agente, datos } = await cuentaNueva();
  const creada = await agente.post('/api/quinielas').send({ nombre: 'Quiniela de prueba' });
  await agente.post(`/api/quinielas/${creada.body.quiniela.id}/seleccionar`).send({});

  const mala = await agente.post('/api/admin-mode/activar').send({ password: 'no-es-esta-larga' });
  assert.equal(mala.status, 401);

  const buena = await agente.post('/api/admin-mode/activar').send({ password: datos.password });
  assert.equal(buena.status, 200);
  assert.equal((await agente.get('/api/admin-mode')).body.activo, true);
});

test('⚠️ cambiar de quiniela tira el Admin Mode', async () => {
  const { agente, datos } = await cuentaNueva();
  const primera = await quinielaNueva(agente, datos, 'Primera');
  const segunda = await quinielaNueva(agente, datos, 'Segunda');

  await agente.post(`/api/quinielas/${primera.id}/seleccionar`).send({});

  const estado = await agente.get('/api/admin-mode');
  assert.equal(estado.body.autorizadoPorRol, true);
  assert.equal(estado.body.activo, false,
    'arrastrarlo daría permisos administrativos en otra quiniela sin confirmar nada');
});

/* ---------- Miembros ---------- */

test('aprobar a un miembro lo mete en la quiniela y lo deja jugar', async () => {
  const jefe = await admin('jefe');
  const nuevo = await cuentaNueva('nuevo');

  await nuevo.agente.post('/api/quinielas/unirse').send({ codigoIngreso: jefe.quiniela.codigoIngreso });

  const miembros = await jefe.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.estado === 'pendiente_ingreso');
  assert.equal(pendiente.username, nuevo.datos.username);

  const r = await jefe.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});
  assert.equal(r.status, 200);

  const jugadores = await jefe.agente.get('/api/jugadores');
  assert.ok(jugadores.body.includes(nuevo.datos.username));
});

test('la quiniela no puede quedarse sin administrador', async () => {
  const jefe = await admin('jefe');

  const miembros = await jefe.agente.get('/api/quiniela-actual/miembros');
  const propietario = miembros.body.find(m => m.rol === 'propietario');

  const res = await jefe.agente
    .patch(`/api/quiniela-actual/miembros/${propietario.id}/rol`).send({ rol: 'user' });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /propietario/);
});

test('un miembro normal no puede administrar', async () => {
  const jefe = await admin('jefe');
  const nuevo = await cuentaNueva('nuevo');

  await nuevo.agente.post('/api/quinielas/unirse').send({ codigoIngreso: jefe.quiniela.codigoIngreso });
  const miembros = await jefe.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.estado === 'pendiente_ingreso');
  await jefe.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});

  await nuevo.agente.post(`/api/quinielas/${jefe.quiniela.id}/seleccionar`).send({});
  const res = await nuevo.agente.get('/api/quiniela-actual/miembros');

  assert.equal(res.status, 403);
});

/* ---------- Configuración ---------- */

test('cambiar un campo de puntuación no borra los otros cinco', async () => {
  const jefe = await admin('jefe');

  const res = await jefe.agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { marcadorExacto: 9 } });

  assert.equal(res.status, 200);
  assert.equal(res.body.configuracion.puntuacion.marcadorExacto, 9);
  assert.equal(res.body.configuracion.puntuacion.resultadoCorrecto, 3,
    '⚠️ `jsonb ||` es superficial: fundir sin cuidado se lleva el objeto entero');
  assert.equal(res.body.configuracion.puntuacion.comodinExacto, 7);
  assert.equal(res.body.configuracion.incluirExpulsadosEnRanking, true);
});

test('una puntuación negativa o no numérica se rechaza', async () => {
  const jefe = await admin('jefe');

  for (const valor of [-1, 'muchos']) {
    const res = await jefe.agente.patch('/api/quiniela-actual/configuracion')
      .send({ puntuacion: { marcadorExacto: valor } });
    assert.equal(res.status, 400, `aceptó ${JSON.stringify(valor)}`);
  }
});

test('una quiniela archivada es de sólo lectura, salvo para desarchivarla', async () => {
  const jefe = await admin('jefe');

  await jefe.agente.patch('/api/quiniela-actual/archivar').send({ archivada: true });

  const escritura = await jefe.agente.post('/api/jornadas')
    .send({ nombre: 'J1', partidos: [partido('A', 'B')] });
  assert.equal(escritura.status, 409);

  const lectura = await jefe.agente.get('/api/jornadas');
  assert.equal(lectura.status, 200, 'leer sí se puede');

  const volver = await jefe.agente.patch('/api/quiniela-actual/archivar').send({ archivada: false });
  assert.equal(volver.status, 200, 'sin esta excepción quedaría archivada para siempre');
});

test('eliminar la quiniela exige escribir su nombre exacto', async () => {
  const jefe = await admin('jefe');

  const mal = await jefe.agente.delete('/api/quiniela-actual').send({ confirmacion: 'otra cosa' });
  assert.equal(mal.status, 400);

  const bien = await jefe.agente.delete('/api/quiniela-actual').send({ confirmacion: 'Mi quiniela' });
  assert.equal(bien.status, 200);

  const lista = await jefe.agente.get('/api/quinielas');
  assert.equal(lista.body.length, 0, 'una quiniela eliminada no sale en la lista');
});

/* ==================== 7.3 — Dominio ==================== */

test('guardar una jornada la deja consultable con sus partidos', async () => {
  const jefe = await admin('jefe');

  const res = await jefe.agente.post('/api/jornadas').send({
    nombre: 'Jornada 1',
    partidos: [partido('Alfa', 'Beta'), partido('Gamma', 'Delta')]
  });
  assert.equal(res.status, 200);

  const una = await jefe.agente.get('/api/jornadas/Jornada 1');
  assert.equal(una.body.partidos.length, 2);
  assert.equal(una.body.partidos[0].equipo1, 'Alfa');
});

test('la jornada actual es la última CREADA, no la de fecha más tardía', async () => {
  const jefe = await admin('jefe');

  // Cruzadas a propósito: la creada después juega antes.
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'Jornada 1', partidos: [partido('A', 'B', { apiDate: '2099-12-01 20:00' })]
  });
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'Jornada 2', partidos: [partido('C', 'D', { apiDate: '2099-01-05 20:00' })]
  });

  const res = await jefe.agente.get('/api/jornada-actual');
  assert.equal(res.body.sugerida, 'Jornada 2');
  assert.deepEqual(res.body.jornadas.map(j => j.nombre), ['Jornada 2', 'Jornada 1']);
});

test('el resumen trae sólo los nombres, no la temporada entera', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('A', 'B'), partido('C', 'D')]
  });

  const res = await jefe.agente.get('/api/jornadas?resumen=1');
  assert.deepEqual(res.body, [{ nombre: 'J1' }]);
  assert.equal('partidos' in res.body[0], false, 'es M-26: no se traen los partidos');
});

test('una jornada que no existe responde 404', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente.get('/api/jornadas/No existe');
  assert.equal(res.status, 404);
});

test('una jornada sin partidos o sin nombre se rechaza con su motivo', async () => {
  const jefe = await admin('jefe');

  const sinNombre = await jefe.agente.post('/api/jornadas').send({ partidos: [partido('A', 'B')] });
  assert.equal(sinNombre.status, 400);
  assert.match(sinNombre.body.error, /nombre de la jornada es obligatorio/);

  const sinPartidos = await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [] });
  assert.equal(sinPartidos.status, 400);
  assert.match(sinPartidos.body.error, /al menos un partido/);
});

test('agregar un partido lo pone al final, y el tope se respeta', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const r = await jefe.agente.post('/api/jornadas/agregar-partido')
    .send({ jornada: 'J1', partido: partido('C', 'D') });
  assert.equal(r.status, 200);

  const una = await jefe.agente.get('/api/jornadas/J1');
  assert.deepEqual(una.body.partidos.map(p => p.equipo1), ['A', 'C']);
});

test('eliminar partidos renumera los que quedan', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('A', 'B'), partido('C', 'D'), partido('E', 'F')]
  });

  const r = await jefe.agente.post('/api/jornadas/eliminar-partidos')
    .send({ jornada: 'J1', indices: [1] });
  assert.equal(r.status, 200);

  const una = await jefe.agente.get('/api/jornadas/J1');
  assert.deepEqual(una.body.partidos.map(p => p.equipo1), ['A', 'E']);
});

test('un índice de partido que no existe se rechaza', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await jefe.agente.post('/api/jornadas/eliminar-partidos')
    .send({ jornada: 'J1', indices: [7] });

  assert.equal(res.status, 400);
});

test('el comodín se marca, y la lista tiene que coincidir con la jornada', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('A', 'B'), partido('C', 'D')]
  });

  const ok = await jefe.agente.post('/api/jornadas/comodin').send({
    jornada: 'J1', partidos: [partido('A', 'B', { comodin: true }), partido('C', 'D')]
  });
  assert.equal(ok.status, 200);

  const una = await jefe.agente.get('/api/jornadas/J1');
  assert.deepEqual(una.body.partidos.map(p => p.comodin), [true, false]);

  // Una lista más corta no es «la misma jornada con otro comodín».
  const corta = await jefe.agente.post('/api/jornadas/comodin')
    .send({ jornada: 'J1', partidos: [partido('A', 'B', { comodin: true })] });
  assert.equal(corta.status, 400);
});

test('borrar una jornada se lleva lo que colgaba de ella', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const r = await jefe.agente.delete('/api/jornadas/J1');
  assert.equal(r.status, 200);

  assert.equal((await jefe.agente.get('/api/jornadas')).body.length, 0);
  assert.equal((await jefe.agente.delete('/api/jornadas/J1')).status, 404);
});

/* ---------- Equipos ---------- */

test('la lista de equipos queda exactamente como la que se manda', async () => {
  const jefe = await admin('jefe');

  await jefe.agente.post('/actualizar-equipos').send({ equipos: ['Alfa', 'Beta', 'Gamma'] });
  assert.deepEqual((await jefe.agente.get('/api/equipos')).body, ['Alfa', 'Beta', 'Gamma']);

  await jefe.agente.post('/actualizar-equipos').send({ equipos: ['Beta', 'Delta'] });
  assert.deepEqual((await jefe.agente.get('/api/equipos')).body, ['Beta', 'Delta'],
    'lo que no viene se va, y lo que repite no se duplica');
});

/* ---------- Cuenta ---------- */

test('nadie puede tocar la contraseña de otra persona', async () => {
  const jefe = await admin('jefe');
  const otro = await cuentaNueva('otro');

  const res = await jefe.agente.post(`/api/jugadores/${otro.datos.username}/cambiar-password`)
    .send({ currentPassword: 'x', newPassword: 'contrasena-nueva-1' });

  assert.equal(res.status, 403);
});

test('cambiar la propia contraseña exige la actual, y luego sirve para entrar', async () => {
  const jefe = await admin('jefe');
  const ruta = `/api/jugadores/${jefe.datos.username}/cambiar-password`;

  const mala = await jefe.agente.post(ruta)
    .send({ currentPassword: 'no-es-esta', newPassword: 'contrasena-nueva-1' });
  assert.equal(mala.status, 400);

  const buena = await jefe.agente.post(ruta)
    .send({ currentPassword: jefe.datos.password, newPassword: 'contrasena-nueva-1' });
  assert.equal(buena.status, 200);

  const entrada = await request(app).post('/api/auth/login')
    .send({ identificador: jefe.datos.username, password: 'contrasena-nueva-1' });
  assert.equal(entrada.status, 200);
});

/* ==================== El aislamiento, de punta a punta ==================== */

test('⚠️ dos quinielas con la MISMA jornada no se ven entre ellas', async () => {
  const a = await admin('a');
  const b = await admin('b');

  await a.agente.post('/api/jornadas').send({ nombre: 'Jornada 1', partidos: [partido('Alfa', 'Beta')] });
  await b.agente.post('/api/jornadas').send({ nombre: 'Jornada 1', partidos: [partido('Gamma', 'Delta')] });

  const deA = await a.agente.get('/api/jornadas/Jornada 1');
  const deB = await b.agente.get('/api/jornadas/Jornada 1');

  assert.equal(deA.body.partidos[0].equipo1, 'Alfa');
  assert.equal(deB.body.partidos[0].equipo1, 'Gamma', 'es C-02, y aquí lo impide la base');

  assert.equal((await a.agente.get('/api/jornadas')).body.length, 1);
  assert.equal((await b.agente.get('/api/jornadas')).body.length, 1);
});

test('los equipos tampoco cruzan de una quiniela a otra', async () => {
  const a = await admin('a');
  const b = await admin('b');

  await a.agente.post('/actualizar-equipos').send({ equipos: ['Solo de A'] });

  assert.deepEqual((await b.agente.get('/api/equipos')).body, []);
});

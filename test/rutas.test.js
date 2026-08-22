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

/* ==================== 7.4 — Puntuación ==================== */

/** Deja una jornada con dos partidos, uno ya empezado y otro por jugar. */
async function jornadaMixta(jefe, nombre = 'J1') {
  await jefe.agente.post('/api/jornadas').send({
    nombre,
    partidos: [
      partido('Alfa', 'Beta', { apiDate: '2020-01-01 15:00' }),   // ya empezó
      partido('Gamma', 'Delta', { apiDate: '2099-01-01 15:00' })  // por jugar
    ]
  });
}

/** Mete a una segunda persona en la quiniela del jefe, ya aprobada. */
async function miembroDe(jefe, prefijo = 'socio') {
  const socio = await cuentaNueva(prefijo);
  await socio.agente.post('/api/quinielas/unirse')
    .send({ codigoIngreso: jefe.quiniela.codigoIngreso });

  const miembros = await jefe.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.username === socio.datos.username);
  await jefe.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});

  await socio.agente.post(`/api/quinielas/${jefe.quiniela.id}/seleccionar`).send({});
  return socio;
}

test('un pronóstico se guarda, y sólo en los partidos que siguen abiertos', async () => {
  const jefe = await admin('jefe');
  await jornadaMixta(jefe);

  const res = await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username,
    jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 2 }]
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.guardados, 1, 'el partido ya empezado no se guarda');
  assert.equal(res.body.bloqueados, 1);

  const mios = await jefe.agente.get(`/api/resultados/${jefe.datos.username}/J1`);
  assert.deepEqual(mios.body.map(p => p.marcador1), [null, 2]);
});

test('nadie guarda pronósticos en nombre de otro', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jornadaMixta(jefe);

  const res = await socio.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{}, { marcador1: 1, marcador2: 1 }]
  });

  assert.equal(res.status, 403);
});

test('⚠️ de otro participante sólo se ve lo de los partidos que ya empezaron', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jornadaMixta(jefe);

  await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1',
    pronosticos: [{}, { marcador1: 3, marcador2: 3 }]
  });

  // El jefe es administrador: lo ve todo.
  const comoAdmin = await jefe.agente.get(`/api/resultados/${socio.datos.username}/J1`);
  assert.equal(comoAdmin.body[1].marcador1, 3);

  // Otro participante normal, no.
  const tercero = await miembroDe(jefe, 'tercero');
  const comoOtro = await tercero.agente.get(`/api/resultados/${socio.datos.username}/J1`);

  assert.equal(comoOtro.status, 200, 'no es un 403: la fila viaja, sin el marcador');
  assert.equal(comoOtro.body[1].oculto, true, 'el partido por jugar sigue tapado');
  assert.equal(comoOtro.body[1].marcador1, null);
  assert.equal(comoOtro.body[0].oculto, undefined, 'el que ya empezó sí se ve');
});

test('la tabla de todos contra todos tapa lo ajeno partido a partido', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jornadaMixta(jefe);

  await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1', pronosticos: [{}, { marcador1: 4, marcador2: 4 }]
  });

  const tercero = await miembroDe(jefe, 'tercero');
  const res = await tercero.agente.get('/api/resultados');

  const fila = res.body.find(([clave]) => clave === `${socio.datos.username}_J1`);
  assert.ok(fila, 'la fila viaja aunque la jornada no haya cerrado');
  assert.equal(fila[1][0].oculto, true, 'sólo se guardó el partido abierto, y está tapado');
});

test('resultados-con-equipos y resultados-seguros aplican la MISMA regla', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jornadaMixta(jefe);

  await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1', pronosticos: [{}, { marcador1: 5, marcador2: 5 }]
  });

  const tercero = await miembroDe(jefe, 'tercero');

  const conEquipos = await tercero.agente
    .get(`/api/resultados-con-equipos/${socio.datos.username}/J1`);
  assert.equal(conEquipos.body[1].oculto, true);
  assert.equal(conEquipos.body[1].marcador1, '');

  const seguros = await tercero.agente
    .post(`/api/resultados-seguros/${socio.datos.username}/J1`).send({});
  assert.equal(seguros.body.success, true, 'para lo ajeno ya no se pide contraseña');
  assert.equal(seguros.body.partidos[1].oculto, true);
});

test('⚠️ lo PROPIO en resultados-seguros sigue pidiendo la contraseña', async () => {
  const jefe = await admin('jefe');
  await jornadaMixta(jefe);
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{}, { marcador1: 2, marcador2: 1 }]
  });

  const ruta = `/api/resultados-seguros/${jefe.datos.username}/J1`;

  const sin = await jefe.agente.post(ruta).send({});
  assert.equal(sin.body.success, false);
  assert.match(sin.body.error, /Contraseña requerida/);

  const mala = await jefe.agente.post(ruta).send({ password: 'no-es-esta-larga' });
  assert.equal(mala.status, 401);

  const buena = await jefe.agente.post(ruta).send({ password: jefe.datos.password });
  assert.equal(buena.body.success, true);
  assert.equal(buena.body.partidos[1].marcador1, 2);
});

/* ---------- Resultados oficiales ---------- */

test('la carga manual bloquea los partidos y congela la jornada', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta')]
  });
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }]
  });

  const res = await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 2, marcador2: 1 }] });
  assert.equal(res.status, 200);

  const tabla = await jefe.agente.get('/api/clasificacion-jornada?jornada=J1');
  assert.equal(tabla.body.estado, 'confirmada');
  assert.equal(tabla.body.clasificacion.find(f => f.jugador === jefe.datos.username).puntos, 5);
});

test('⚠️ el comodín que sale del API es el del PARTIDO, no el del formulario', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { comodin: true })]
  });

  // El formulario manda `comodin: false`, que es justo lo que NO debe ganar.
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0, comodin: false }] });

  const res = await jefe.agente.get('/api/resultados-oficiales/J1');
  assert.equal(res.body.partidos[0].comodin, true);
});

test('un marcador oficial inválido no guarda ninguno', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('A', 'B'), partido('C', 'D')]
  });

  const res = await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }, { marcador1: -5, marcador2: 0 }] });

  assert.equal(res.status, 400);

  const guardados = await jefe.agente.get('/api/resultados-oficiales/J1');
  assert.equal(guardados.body.partidos[0].marcador1, '', 'la transacción entera se deshace');
});

test('un miembro normal no puede cargar resultados oficiales', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await socio.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 9, marcador2: 9 }] });

  assert.equal(res.status, 403);
});

test('los resultados oficiales se pueden acotar a una jornada', async () => {
  const jefe = await admin('jefe');
  for (const nombre of ['J1', 'J2']) {
    await jefe.agente.post('/api/jornadas').send({ nombre, partidos: [partido('A', 'B')] });
    await jefe.agente.post('/api/resultados-oficiales')
      .send({ jornada: nombre, resultados: [{ marcador1: 1, marcador2: 1 }] });
  }

  assert.equal((await jefe.agente.get('/api/resultados-oficiales')).body.length, 2);
  assert.equal((await jefe.agente.get('/api/resultados-oficiales?jornada=J1')).body.length, 1,
    'es M-26: quien mira una jornada no debe traerse las cuarenta');
});

/* ---------- Las dos tablas ---------- */

test('sin jornadas, la clasificación responde vacía en vez de fallar', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente.get('/api/clasificacion-jornada');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { jornadas: [], jornada: null, estado: null, clasificacion: [] });
});

test('la clasificación por defecto es la de la jornada actual', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J2', partidos: [partido('C', 'D')] });

  const res = await jefe.agente.get('/api/clasificacion-jornada');
  assert.equal(res.body.jornada, 'J2', 'la última creada');
  assert.equal(res.body.estado, 'provisional');
});

test('una jornada que no existe en la clasificación responde 404', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await jefe.agente.get('/api/clasificacion-jornada?jornada=No%20existe');
  assert.equal(res.status, 404);
});

test('los empatados comparten puesto en la clasificación', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  for (const quien of [jefe, socio]) {
    await quien.agente.post('/api/resultados').send({
      jugador: quien.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
    });
  }
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }] });

  const res = await jefe.agente.get('/api/clasificacion-jornada?jornada=J1');
  const conPuntos = res.body.clasificacion.filter(f => f.puntos > 0);

  assert.equal(conPuntos.length, 2);
  assert.deepEqual(conPuntos.map(f => f.puesto), [1, 1]);
  assert.deepEqual(conPuntos.map(f => f.empate), [true, true]);
});

test('la tabla general suma las jornadas y da el total', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }] });

  const res = await jefe.agente.get('/api/resultados-totales');
  const fila = res.body[jefe.datos.username];

  assert.equal(fila.J1, 5);
  assert.equal(fila.Trivias, 0);
  assert.equal(fila.total, 5);
});

test('la tabla general se pagina si se pide, y no si no', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const entera = await jefe.agente.get('/api/resultados-totales');
  assert.ok(entera.body[jefe.datos.username], 'sin parámetros responde el objeto de siempre');

  const paginada = await jefe.agente.get('/api/resultados-totales?pagina=1&limite=10');
  assert.ok(Array.isArray(paginada.body.jugadores));
  assert.equal(paginada.body.pagina, 1);
  assert.equal(paginada.body.totalPaginas, 1);
});

test('⚠️ cargar resultados oficiales tira la caché de la tabla', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });

  // Se llena la caché: todavía no hay resultado oficial, así que van cero puntos.
  const antes = await jefe.agente.get('/api/resultados-totales');
  assert.equal(antes.body[jefe.datos.username].total, 0);

  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }] });

  const despues = await jefe.agente.get('/api/resultados-totales');
  assert.equal(despues.body[jefe.datos.username].total, 5,
    'servir la tabla vieja tras una escritura es para lo que existe la invalidación');
});

test('cargar el resultado oficial CIERRA el partido: ya no admite pronósticos', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  /*
   * El partido se juega en 2099, pero un administrador acaba de escribir su
   * marcador: eso lo da por terminado. Manda el resultado oficial sobre el
   * calendario, y por eso ya no se puede pronosticar.
   */
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }] });

  const res = await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });

  assert.equal(res.body.guardados, 0);
  assert.equal(res.body.bloqueados, 1, 'acertar después de saber el resultado no es acertar');
});

test('⚠️ la caché de la tabla no cruza entre quinielas', async () => {
  const a = await admin('caa');
  const b = await admin('cab');

  await a.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });
  await a.agente.post('/api/resultados').send({
    jugador: a.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });
  await a.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 0 }] });

  await a.agente.get('/api/resultados-totales');           // llena la caché de A
  const tablaB = await b.agente.get('/api/resultados-totales');

  assert.equal(tablaB.body[a.datos.username], undefined,
    'una caché global sería C-02 otra vez, y en memoria, donde RLS no llega');
});

/* ==================== 7.5 — Trivias ==================== */

const CIERRE_FUTURO = '2099-06-01T12:00:00.000Z';
const CIERRE_PASADO = '2020-06-01T12:00:00.000Z';

/** Una jornada con un partido y sus trivias creadas. */
async function conTrivias(jefe, { tipos = ['ambos_anotan'], fechaCierre = CIERRE_FUTURO, apiDate = '2099-01-01 15:00' } = {}) {
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiDate, apiFixtureId: 'fx-1' })]
  });
  const r = await jefe.agente.post('/api/admin/trivias').send({
    jornadaNombre: 'J1', partidoIndex: 0, tipos, fechaCierre
  });
  assert.equal(r.status, 200, `No se pudieron crear las trivias: ${JSON.stringify(r.body)}`);

  const lista = await jefe.agente.get('/api/admin/trivias/J1');
  return lista.body;
}

test('el catálogo trae los ocho tipos con su pregunta', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente.get('/api/tipos-trivia');

  assert.equal(res.body.length, 8);
  assert.ok(res.body.every(t => t.tipo && t.pregunta));
});

test('crear trivias las deja listas, con la pregunta y las opciones puestas', async () => {
  const jefe = await admin('jefe');
  const trivias = await conTrivias(jefe, { tipos: ['ambos_anotan', 'primer_gol'] });

  assert.equal(trivias.length, 2);

  const primerGol = trivias.find(t => t.tipo === 'primer_gol');
  assert.match(primerGol.pregunta, /anota primero/);
  assert.deepEqual(primerGol.opciones, ['Alfa', 'Beta', 'Nadie anotará'],
    'las opciones llevan los equipos del PARTIDO, no una copia');
});

test('⚠️ una trivia trae `id`, no `_id`', async () => {
  const jefe = await admin('jefe');
  const [trivia] = await conTrivias(jefe);

  assert.ok(trivia.id, 'es el cambio de §21.1: uuid de verdad');
  assert.equal('_id' in trivia, false);
});

test('sin trivias habilitadas no se pueden crear ni responder', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { triviasHabilitadas: false } });

  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const creacion = await jefe.agente.post('/api/admin/trivias').send({
    jornadaNombre: 'J1', partidoIndex: 0, tipos: ['ambos_anotan'], fechaCierre: CIERRE_FUTURO
  });
  assert.equal(creacion.status, 409);

  const respuesta = await jefe.agente.post('/api/respuestas-trivia')
    .send({ jugador: jefe.datos.username, respuestas: [] });
  assert.equal(respuesta.status, 409,
    'apagarlas con preguntas ya publicadas dejaría a la gente respondiendo a nada');
});

test('crear trivias sin los datos completos se rechaza con 400', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await jefe.agente.post('/api/admin/trivias')
    .send({ jornadaNombre: 'J1', partidoIndex: 0, tipos: [] });

  assert.equal(res.status, 400);
});

test('un miembro normal no administra trivias', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await conTrivias(jefe);

  const res = await socio.agente.post('/api/admin/trivias').send({
    jornadaNombre: 'J1', partidoIndex: 0, tipos: ['primer_gol'], fechaCierre: CIERRE_FUTURO
  });

  assert.equal(res.status, 403);
});

/* ---------- Reconciliar ---------- */

test('la reconciliación crea, actualiza y borra en una sola pasada', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe, { tipos: ['ambos_anotan', 'primer_gol'] });

  const res = await jefe.agente.put('/api/admin/trivias/J1').send({
    fechaCierre: CIERRE_FUTURO,
    configuracion: [{ partidoIndex: 0, tipos: ['ambos_anotan', 'hubo_penales'] }]
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.creadas, 1);
  assert.equal(res.body.eliminadas, 1);

  const lista = await jefe.agente.get('/api/admin/trivias/J1');
  assert.deepEqual(lista.body.map(t => t.tipo).sort(), ['ambos_anotan', 'hubo_penales']);
});

test('mover la fecha de cierre reabre las preguntas', async () => {
  const jefe = await admin('jefe');
  const [trivia] = await conTrivias(jefe);

  await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username,
    respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });

  const res = await jefe.agente.put('/api/admin/trivias/J1').send({
    fechaCierre: '2099-07-01T12:00:00.000Z',
    configuracion: [{ partidoIndex: 0, tipos: ['ambos_anotan'] }]
  });

  assert.equal(res.body.actualizadas, 1);

  const lista = await jefe.agente.get('/api/admin/trivias/J1');
  assert.equal(lista.body[0].resuelta, false);
});

test('borrar una trivia se lleva sus respuestas', async () => {
  const jefe = await admin('jefe');
  const [trivia] = await conTrivias(jefe);

  await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });

  const borrada = await jefe.agente.delete(`/api/admin/trivias/${trivia.id}`);
  assert.equal(borrada.status, 200);

  assert.equal((await jefe.agente.get('/api/admin/trivias/J1')).body.length, 0);

  const mias = await jefe.agente
    .get(`/api/respuestas-trivia/${jefe.datos.username}/J1`);
  assert.deepEqual(mias.body, [], 'no quedan puntos sin pregunta a la que pertenecer');
});

test('borrar una trivia que no existe responde 404', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente
    .delete('/api/admin/trivias/00000000-0000-0000-0000-000000000000');

  assert.equal(res.status, 404);
});

/* ---------- Consulta ---------- */

test('⚠️ /api/trivias/activas no se confunde con una jornada llamada «activas»', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe);

  const res = await jefe.agente.get('/api/trivias/activas');

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1, 'la ruta literal debe declararse antes que /:jornadaNombre');
});

test('una trivia cuyo partido ya empezó deja de estar activa', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe, { apiDate: '2020-01-01 15:00' });

  assert.equal((await jefe.agente.get('/api/trivias/activas')).body.length, 0);
  assert.equal((await jefe.agente.get('/api/trivias')).body.length, 1,
    'sigue existiendo: sólo deja de admitir respuestas');
});

test('latest trae la jornada de trivias más reciente con todas sus preguntas', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe, { tipos: ['ambos_anotan', 'hubo_penales'] });

  const res = await jefe.agente.get('/api/trivias/latest');

  assert.equal(res.body.jornadaNombre, 'J1');
  assert.equal(res.body.trivias.length, 2);
  assert.equal(res.body.cerrada, false);
});

test('latest sin ninguna trivia responde vacío en vez de fallar', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente.get('/api/trivias/latest');

  assert.equal(res.status, 200);
  assert.equal(res.body.jornadaNombre, null);
  assert.deepEqual(res.body.trivias, []);
});

test('las jornadas con trivias se listan con su fecha de cierre', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe);

  const res = await jefe.agente.get('/api/trivias-jornadas');

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].jornadaNombre, 'J1');
  assert.equal(res.body[0].cerrada, false);
});

/* ---------- Responder ---------- */

test('una respuesta se guarda y se puede corregir hasta el cierre', async () => {
  const jefe = await admin('jefe');
  const [trivia] = await conTrivias(jefe);

  await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });
  const segunda = await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'No' }]
  });

  assert.equal(segunda.body.guardadas, 1);

  const mias = await jefe.agente.get(`/api/respuestas-trivia/${jefe.datos.username}/J1`);
  assert.equal(mias.body[0].respuesta, 'No');
});

test('nadie responde en nombre de otro', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  const [trivia] = await conTrivias(jefe);

  const res = await socio.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });

  assert.equal(res.status, 403);
});

test('⚠️ una trivia cerrada se salta, y las abiertas del mismo envío sí se guardan', async () => {
  const jefe = await admin('jefe');

  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1',
    partidos: [
      partido('Alfa', 'Beta', { apiDate: '2020-01-01 15:00' }),    // ya empezó
      partido('Gamma', 'Delta', { apiDate: '2099-01-01 15:00' })   // por jugar
    ]
  });
  for (const indice of [0, 1]) {
    await jefe.agente.post('/api/admin/trivias').send({
      jornadaNombre: 'J1', partidoIndex: indice, tipos: ['ambos_anotan'], fechaCierre: CIERRE_FUTURO
    });
  }

  const trivias = await jefe.agente.get('/api/admin/trivias/J1');
  const res = await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username,
    respuestas: trivias.body.map(t => ({ triviaId: t.id, respuesta: 'Sí' }))
  });

  assert.equal(res.body.guardadas, 1);
  assert.equal(res.body.cerradas, 1,
    'Mongo devolvía 403 y no guardaba ninguna: llegar tarde a una costaba las diez');
});

test('las respuestas ajenas no se ven hasta que la trivia cierra', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  const [trivia] = await conTrivias(jefe);

  await socio.agente.post('/api/respuestas-trivia').send({
    jugador: socio.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });

  const tercero = await miembroDe(jefe, 'tercero');
  const ajena = await tercero.agente
    .get(`/api/respuestas-trivia/${socio.datos.username}/J1`);
  assert.equal(ajena.body[0].respuesta, null);

  // Un administrador sí lo ve: es quien tiene que poder revisar.
  const comoAdmin = await jefe.agente
    .get(`/api/respuestas-trivia/${socio.datos.username}/J1`);
  assert.equal(comoAdmin.body[0].respuesta, 'Sí');
});

/* ---------- Resolver ---------- */

test('resolver reparte los puntos desde el evento guardado en la caché', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  const [trivia] = await conTrivias(jefe, { tipos: ['ambos_anotan'] });

  /*
   * Se responde por el API con la trivia abierta, que es como pasa de verdad.
   * Escribir las respuestas a mano en la tabla no vale: `jugadores` sólo tiene
   * fila de quien ya ha actuado —la crea `jugadores.asegurar` al vuelo— así que
   * un INSERT … SELECT sobre un propietario recién llegado inserta cero filas y
   * la prueba pasa sin probar nada.
   */
  await jefe.agente.post('/api/respuestas-trivia').send({
    jugador: jefe.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });
  await socio.agente.post('/api/respuestas-trivia').send({
    jugador: socio.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'No' }]
  });

  // Llega la hora de cierre.
  await jefe.agente.put('/api/admin/trivias/J1').send({
    fechaCierre: CIERRE_PASADO,
    configuracion: [{ partidoIndex: 0, tipos: ['ambos_anotan'] }]
  });

  // El partido termina y su evento entra en la caché compartida.
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 1 }] });

  const fixtures = require('../src/fixtures');
  await fixtures.guardar(
    { clave: 'fx-1', apiFixtureId: 'fx-1', apiDate: '2099-01-01 15:00', busqueda: {} },
    { evento: {
      match_hometeam_name: 'Alfa', match_awayteam_name: 'Beta',
      match_status: 'Finished',
      goalscorer: [
        { time: '20', home_scorer: 'uno', score: '1 - 0' },
        { time: '70', away_scorer: 'dos', score: '1 - 1' }
      ]
    } });

  const res = await jefe.agente.post('/api/admin/trivias/resolver').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.resueltas, 1);

  const lista = await jefe.agente.get('/api/admin/trivias/J1');
  assert.equal(lista.body[0].resuelta, true);
  assert.equal(lista.body[0].respuestaCorrecta, 'Sí', 'los dos anotaron');

  const tabla = await jefe.agente.get('/api/resultados-totales');
  assert.equal(tabla.body[jefe.datos.username].Trivias, 1, 'acertó');
  assert.equal(tabla.body[socio.datos.username].Trivias, 0, 'falló');
});

test('sin evento en la caché la trivia queda pendiente, no resuelta en falso', async () => {
  const jefe = await admin('jefe');
  await conTrivias(jefe, { fechaCierre: CIERRE_PASADO });
  await jefe.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'J1', resultados: [{ marcador1: 1, marcador2: 1 }] });

  const res = await jefe.agente.post('/api/admin/trivias/resolver').send({});

  assert.equal(res.body.resueltas, 0);
  assert.equal((await jefe.agente.get('/api/admin/trivias/J1')).body[0].resuelta, false);
});

/* ---------- Resultados de trivias ---------- */

test('⚠️ los resultados de trivias no se publican antes del cierre', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await conTrivias(jefe);

  const comoOtro = await socio.agente.get('/api/resultados-trivias/J1');
  assert.equal(comoOtro.status, 403, 'publicarlos abiertos sería regalar las respuestas');

  const comoAdmin = await jefe.agente.get('/api/resultados-trivias/J1');
  assert.equal(comoAdmin.status, 200);
});

test('cerrada la jornada, los resultados de trivias los ve todo el mundo', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  const [trivia] = await conTrivias(jefe, { fechaCierre: CIERRE_PASADO });

  await db.enQuiniela(jefe.quiniela.id, c => c.query(
    `INSERT INTO respuestas_trivia (quiniela_id, trivia_id, jugador_id, respuesta)
     SELECT $1, $2, id, 'Sí' FROM jugadores WHERE nombre = $3`,
    [jefe.quiniela.id, trivia.id, socio.datos.username]));

  const res = await socio.agente.get('/api/resultados-trivias/J1');

  assert.equal(res.status, 200);
  assert.equal(res.body.cerrada, true);
  assert.equal(res.body.trivias[0].respuestas.length, 1);
  assert.equal(res.body.trivias[0].respuestaCorrecta, 'Pendiente de calcular');
});

test('una jornada sin trivias responde vacía en vez de 403', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await jefe.agente.get('/api/resultados-trivias/J1');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.trivias, []);
});

/* ---------- Aislamiento ---------- */

test('las trivias de una quiniela no se ven ni se responden desde otra', async () => {
  const a = await admin('tra');
  const b = await admin('trb');

  const [trivia] = await conTrivias(a);
  await b.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  assert.equal((await b.agente.get('/api/trivias/J1')).body.length, 0);

  const intento = await b.agente.post('/api/respuestas-trivia').send({
    jugador: b.datos.username, respuestas: [{ triviaId: trivia.id, respuesta: 'Sí' }]
  });
  assert.equal(intento.body.desconocidas, 1, 'la trivia de A no existe para B');
  assert.equal(intento.body.guardadas, 0);
});

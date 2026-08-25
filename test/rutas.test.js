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
const correo = require('../src/correo');
const enMemoria = require('./postgres-en-memoria');

let app;
let adaptador;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  /*
   * Las rutas que hablan con el proveedor comprueban la clave ANTES de pedir
   * nada, para dar un motivo en vez de un error críptico. Aquí no se usa —la
   * puerta al exterior se sustituye con `usarFuente`— pero tiene que estar.
   */
  process.env.APIFOOTBALL_COM_KEY = 'clave-falsa-no-se-usa';
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

/**
 * El token del último correo enviado.
 *
 * ⚠️ Sale de la bandeja del transporte de consola porque **la base sólo guarda
 * el hash**: no hay forma de leerlo de la base, y ésa es justamente la
 * propiedad que se quiere.
 */
function ultimoToken() {
  const mensaje = correo.bandeja.at(-1);
  assert.ok(mensaje, 'no se envió ningún correo');
  const hallado = mensaje.texto.match(/token=([a-f0-9]{64})/);
  assert.ok(hallado, `el correo no trae un enlace con token:
${mensaje.texto}`);
  return hallado[1];
}

/**
 * Registra una cuenta, **confirma el correo** y devuelve un agente con la
 * sesión iniciada.
 *
 * ⚠️ Pasa por el flujo de verdad —registro, token del correo, confirmación y
 * login— en vez de marcar la cuenta como verificada en la base. Cuesta dos
 * peticiones más por cuenta y a cambio, si la verificación se rompe, **se cae
 * la suite entera** en vez de un puñado de pruebas dedicadas.
 */
async function cuentaNueva(prefijo = 'usu') {
  const agente = request.agent(app);
  const datos = credenciales(prefijo);

  const alta = await agente.post('/api/auth/registro').send(datos);
  assert.equal(alta.status, 201, `No se pudo registrar: ${JSON.stringify(alta.body)}`);

  const confirmada = await agente.post('/api/auth/verificar-correo')
    .send({ token: ultimoToken() });
  assert.equal(confirmada.status, 200, `No se pudo confirmar: ${JSON.stringify(confirmada.body)}`);

  const entrada = await agente.post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });
  assert.equal(entrada.status, 200, `No se pudo entrar: ${JSON.stringify(entrada.body)}`);

  return { agente, datos, usuarioId: alta.body.usuario?.id };
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

/* ==================== 7.6 — Sincronizador, admin y proveedor ==================== */

const proveedor = require('../src/proveedor');
const sincronizador = require('../src/sincronizador');
const planificador = require('../src/planificador');

/** Sustituye la puerta al proveedor y la restaura al terminar. */
async function conProveedorFalso(respuestas, fn) {
  const anterior = proveedor.usarFuente(async params => {
    const clave = `${params.action}${params.match_id ? ':' + params.match_id : ''}`;
    return typeof respuestas === 'function' ? respuestas(params) : (respuestas[clave] ?? []);
  });
  try { return await fn(); } finally { proveedor.usarFuente(anterior); }
}

const eventoApi = ({ id = '1', local = 'Alfa', visitante = 'Beta', liga = 'Primera', pais = 'Costa Rica', ligaId = '7' } = {}) => ({
  match_id: id,
  match_date: '2099-01-01',
  match_time: '15:00',
  match_status: 'Finished',
  league_name: liga,
  country_name: pais,
  league_id: ligaId,
  match_hometeam_name: local,
  match_awayteam_name: visitante,
  team_home_badge: '', team_away_badge: '',
  match_hometeam_score: '2',
  match_awayteam_score: '1',
  match_hometeam_ft_score: '2',
  match_awayteam_ft_score: '1'
});

/* ---------- El proveedor ---------- */

test('el cliente del proveedor tiene un plazo máximo de espera', () => {
  assert.ok(proveedor.TIMEOUT_MS > 0,
    'el valor por defecto de axios es esperar para siempre, y una petición colgada apaga el sincronizador en silencio');
});

test('los partidos del proveedor llegan traducidos a la forma de la aplicación', async () => {
  const jefe = await admin('jefe');

  await conProveedorFalso({ get_events: [eventoApi()] }, async () => {
    const res = await jefe.agente.get('/api/football/fixtures?date=2099-01-01');

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(
      { equipo1: res.body[0].equipo1, equipo2: res.body[0].equipo2, apiFixtureId: res.body[0].apiFixtureId },
      { equipo1: 'Alfa', equipo2: 'Beta', apiFixtureId: 1 });
  });
});

test('⚠️ las competiciones bloqueadas se descartan en el servidor, no en el navegador', async () => {
  const jefe = await admin('jefe');

  const lista = [
    eventoApi({ id: '1', liga: 'Primera División' }),
    eventoApi({ id: '2', liga: 'Primera División Femenina' })
  ];

  await conProveedorFalso({ get_events: lista }, async () => {
    // Sin torneo elegido: antes el filtro sólo se aplicaba si había uno.
    const res = await jefe.agente.get('/api/football/fixtures?date=2099-01-01');
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].apiFixtureId, 1);
  });
});

test('sin fecha, el buscador de partidos responde 400 y no consulta nada', async () => {
  const jefe = await admin('jefe');
  let consultas = 0;

  await conProveedorFalso(() => { consultas += 1; return []; }, async () => {
    const res = await jefe.agente.get('/api/football/fixtures');
    assert.equal(res.status, 400);
  });

  assert.equal(consultas, 0, 'una petición inválida no debe gastar cuota');
});

test('el buscador de ligas agrupa por país y se cachea', async () => {
  const jefe = await admin('jefe');
  proveedor.vaciarCacheLigas();

  let consultas = 0;
  const lista = [
    eventoApi({ id: '1', pais: 'Costa Rica' }),
    eventoApi({ id: '2', pais: 'México' })
  ];

  await conProveedorFalso(() => { consultas += 1; return lista; }, async () => {
    const primera = await jefe.agente.get('/api/football/ligas-disponibles');
    assert.equal(primera.status, 200);
    assert.equal(primera.body.deCache, false);
    assert.ok(primera.body.paises.length >= 2);

    const segunda = await jefe.agente.get('/api/football/ligas-disponibles');
    assert.equal(segunda.body.deCache, true);
  });

  assert.equal(consultas, 1, 'quien arma una jornada abre esa pantalla varias veces seguidas');
  proveedor.vaciarCacheLigas();
});

/* ---------- Ligas favoritas ---------- */

/** Marca favoritas en la quiniela de `jefe` y devuelve la respuesta. */
async function marcarFavoritas(jefe, ligasFavoritas) {
  return jefe.agente.patch('/api/quiniela-actual/configuracion').send({ ligasFavoritas });
}

const DOS_LIGAS = [
  eventoApi({ id: '1', liga: 'Primera División', pais: 'Costa Rica', ligaId: '7' }),
  eventoApi({ id: '2', liga: 'Liga MX', pais: 'México', ligaId: '12' })
];

test('las ligas favoritas salen de primero y no se repiten abajo', async () => {
  const jefe = await admin('jefe');
  proveedor.vaciarCacheLigas();

  assert.equal((await marcarFavoritas(jefe, [{ id: '12', nombre: 'Liga MX' }])).status, 200);

  await conProveedorFalso({ get_events: DOS_LIGAS }, async () => {
    const res = await jefe.agente.get('/api/football/ligas-disponibles');

    assert.deepEqual(res.body.favoritas.map(l => l.nombre), ['Liga MX']);
    assert.equal(res.body.favoritas[0].partidos, 1);

    const abajo = res.body.paises.flatMap(g => g.ligas.map(l => l.nombre));
    assert.ok(!abajo.includes('Liga MX'));
    assert.ok(abajo.includes('Primera División'));
  });

  proveedor.vaciarCacheLigas();
});

test('⛔ la caché compartida NO cuela las favoritas de una quiniela en otra', async () => {
  /*
   * La caché tiene por clave el rango de fechas y nada más, para que dos
   * quinielas que sigan los mismos días compartan la consulta al proveedor. Es
   * justo por eso que lo guardado tiene que ser lo que dijo el proveedor, sin
   * ordenar: el orden es de cada quiniela.
   */
  const uno = await admin('favuno');
  const otro = await admin('favotro');
  proveedor.vaciarCacheLigas();

  await marcarFavoritas(uno, [{ id: '12', nombre: 'Liga MX' }]);

  let consultas = 0;
  await conProveedorFalso(() => { consultas += 1; return DOS_LIGAS; }, async () => {
    // La primera llena la caché, ya con las favoritas de `uno` aplicadas.
    const primera = await uno.agente.get('/api/football/ligas-disponibles');
    assert.deepEqual(primera.body.favoritas.map(l => l.nombre), ['Liga MX']);

    // La segunda la lee de caché, y no tiene favoritas ningunas.
    const segunda = await otro.agente.get('/api/football/ligas-disponibles');
    assert.equal(segunda.body.deCache, true, 'el ahorro de cuota tiene que seguir en pie');
    assert.deepEqual(segunda.body.favoritas, [], 'no son sus favoritas');

    const abajo = segunda.body.paises.flatMap(g => g.ligas.map(l => l.nombre));
    assert.ok(abajo.includes('Liga MX'),
      'y la liga tiene que seguir en su país, no arrancada por la quiniela anterior');
  });

  assert.equal(consultas, 1);
  proveedor.vaciarCacheLigas();
});

test('una favorita sin partidos esta semana llega con partidos en 0', async () => {
  const jefe = await admin('jefe');
  proveedor.vaciarCacheLigas();

  await marcarFavoritas(jefe, [{ id: '999', nombre: 'Liga Centroamericana' }]);

  await conProveedorFalso({ get_events: DOS_LIGAS }, async () => {
    const res = await jefe.agente.get('/api/football/ligas-disponibles');
    assert.deepEqual(res.body.favoritas, [
      { id: '999', nombre: 'Liga Centroamericana', partidos: 0, pais: null }
    ]);
  });

  proveedor.vaciarCacheLigas();
});

test('guardar favoritas no se lleva por delante la puntuación', async () => {
  /*
   * `configuracion` es un bloque jsonb que se funde por arriba. Escribir la
   * lista no puede tocar lo demás.
   */
  const jefe = await admin('jefe');
  const antes = (await jefe.agente.get('/api/quiniela-actual')).body.configuracion;

  await marcarFavoritas(jefe, [{ id: '7', nombre: 'Primera División' }]);

  const despues = (await jefe.agente.get('/api/quiniela-actual')).body.configuracion;
  assert.deepEqual(despues.puntuacion, antes.puntuacion);
  assert.deepEqual(despues.ligasFavoritas, [{ id: '7', nombre: 'Primera División' }]);
});

test('mandar una lista vacía quita todas las favoritas', async () => {
  const jefe = await admin('jefe');

  await marcarFavoritas(jefe, [{ id: '7', nombre: 'Primera División' }]);
  assert.equal((await marcarFavoritas(jefe, [])).status, 200);

  const config = (await jefe.agente.get('/api/quiniela-actual')).body.configuracion;
  assert.deepEqual(config.ligasFavoritas, []);
});

test('⚠️ pasarse del tope avisa, en vez de recortar en silencio', async () => {
  const jefe = await admin('jefe');

  const muchas = Array.from({ length: 25 }, (_, i) => ({ id: String(i), nombre: 'Liga ' + i }));
  const res = await marcarFavoritas(jefe, muchas);

  assert.equal(res.status, 400, 'quien marcó veinticinco creería que se guardaron las veinticinco');
  assert.match(res.body.error, /favoritas/i);
});

test('las favoritas tienen que venir en una lista', async () => {
  const jefe = await admin('jefe');
  assert.equal((await marcarFavoritas(jefe, { id: '7' })).status, 400);
});

test('un miembro normal no puede cambiar las favoritas de la quiniela', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);

  const res = await socio.agente.patch('/api/quiniela-actual/configuracion')
    .send({ ligasFavoritas: [{ id: '7', nombre: 'Suya no' }] });

  assert.equal(res.status, 403);
});

test('un miembro normal no puede consultar las ligas disponibles', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);

  const res = await socio.agente.get('/api/football/ligas-disponibles');
  assert.equal(res.status, 403);
});

/* ---------- Sincronizar a mano ---------- */

test('sincronizar una jornada a mano escribe los resultados y mueve los puntos', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiFixtureId: '1' })]
  });
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }]
  });

  await conProveedorFalso({ 'get_events:1': [eventoApi()] }, async () => {
    const res = await jefe.agente.post('/api/sync-resultados-oficiales/J1').send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
  });

  const tabla = await jefe.agente.get('/api/clasificacion-jornada?jornada=J1');
  assert.equal(tabla.body.estado, 'confirmada', 'el partido vino terminado');
  assert.equal(tabla.body.clasificacion.find(f => f.jugador === jefe.datos.username).puntos, 5);
});

test('sincronizar una jornada que no existe responde 404', async () => {
  const jefe = await admin('jefe');

  await conProveedorFalso({}, async () => {
    const res = await jefe.agente.post('/api/sync-resultados-oficiales/No%20existe').send({});
    assert.equal(res.status, 404);
  });
});

test('⚠️ la sincronización a mano se salta las ventanas de consulta', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiFixtureId: '1', apiDate: '2099-06-01 15:00' })]
  });

  let consultas = 0;
  const responder = () => { consultas += 1; return [eventoApi({ id: '1' })]; };

  await conProveedorFalso(responder, async () => {
    await jefe.agente.post('/api/sync-resultados-oficiales/J1').send({});
    await jefe.agente.post('/api/sync-resultados-oficiales/J1').send({});
  });

  assert.equal(consultas, 2,
    'es una petición explícita de quien está mirando la pantalla, no el reloj');
});

/* ---------- Modo admin ---------- */

test('el modo admin carga los pronósticos de otra persona', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta')]
  });

  const res = await jefe.agente.post('/api/admin/resultados').send({
    jugador: socio.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 3, marcador2: 0 }]
  });

  assert.equal(res.status, 200);

  const suyos = await jefe.agente.get(`/api/resultados/${socio.datos.username}/J1`);
  assert.equal(suyos.body[0].marcador1, 3);
});

test('⚠️ el modo admin NO aplica el cierre por partido', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);

  // El partido ya empezó: por la vía normal esto no se guardaría.
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiDate: '2020-01-01 15:00' })]
  });

  const res = await jefe.agente.post('/api/admin/resultados').send({
    jugador: socio.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 1 }]
  });

  assert.equal(res.status, 200);
  const suyos = await jefe.agente.get(`/api/resultados/${socio.datos.username}/J1`);
  assert.equal(suyos.body[0].marcador1, 1,
    'un administrador transcribe lo que ya recibió, y suele hacerlo con la jornada empezada');
});

test('el modo admin valida los marcadores igual que la vía normal', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await jefe.agente.post('/api/admin/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 999, marcador2: 0 }]
  });

  assert.equal(res.status, 400);
});

test('un miembro normal no puede usar el modo admin', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  const res = await socio.agente.post('/api/admin/resultados').send({
    jugador: socio.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });

  assert.equal(res.status, 403);
});

/* ---------- Métricas ---------- */

test('las métricas del sincronizador traen su configuración y el cerrojo', async () => {
  const jefe = await admin('jefe');
  const res = await jefe.agente.get('/api/admin/sync-metricas');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ciclos, 'number');
  assert.equal(typeof res.body.consultasAhorradasPorDeduplicacion, 'number');
  assert.ok(res.body.configuracion.intervaloCicloMs > 0);
  assert.ok(res.body.configuracion.ventanasMs.enVivo > 0);
  assert.ok(res.body.instancia);
});

test('un miembro normal no ve las métricas', async () => {
  const jefe = await admin('jefe');
  const socio = await miembroDe(jefe);

  assert.equal((await socio.agente.get('/api/admin/sync-metricas')).status, 403);
});

/* ---------- Depuración ---------- */

test('⚠️ los endpoints de depuración responden 404, no 403, con la bandera apagada', async () => {
  const jefe = await admin('jefe');

  for (const ruta of [
    '/api/debug/estado-partido/Finished',
    '/api/debug/jornadas',
    '/api/debug/api-football-match/1'
  ]) {
    const res = await jefe.agente.get(ruta);
    assert.equal(res.status, 404, `${ruta} revela que existe`);
  }
});

/* ---------- El planificador ---------- */

test('un ciclo completo por el planificador usa el proveedor de verdad', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiFixtureId: '1' })]
  });
  await jefe.agente.post('/api/resultados').send({
    jugador: jefe.datos.username, jornada: 'J1', pronosticos: [{ marcador1: 2, marcador2: 1 }]
  });

  sincronizador.reiniciarMetricas();

  await conProveedorFalso({ 'get_events:1': [eventoApi()] }, async () => {
    const r = await planificador.unCiclo();
    assert.equal(r.omitido, false);
    assert.equal(r.jornadasReescritas, 1);
  });

  assert.ok(sincronizador.metricas.llamadasApi > 0, 'las llamadas se cuentan para las métricas');

  const tabla = await jefe.agente.get('/api/clasificacion-jornada?jornada=J1');
  assert.equal(tabla.body.clasificacion.find(f => f.jugador === jefe.datos.username).puntos, 5);
});

test('el barrido de trivias recorre cada quiniela en su propio contexto', async () => {
  const a = await admin('bta');
  const b = await admin('btb');

  for (const quien of [a, b]) {
    await quien.agente.post('/api/jornadas').send({
      nombre: 'J1', partidos: [partido('Alfa', 'Beta', { apiFixtureId: '1' })]
    });
  }

  const r = await planificador.resolverTriviasDeTodas();

  assert.equal(r.quinielas, 2, 'las dos quinielas activas, una por una');
  assert.equal(r.resueltas, 0, 'sin trivias no hay nada que resolver');
});

test('una quiniela archivada no entra en el barrido de trivias', async () => {
  const jefe = await admin('jefe');
  await jefe.agente.patch('/api/quiniela-actual/archivar').send({ archivada: true });

  const r = await planificador.resolverTriviasDeTodas();
  assert.equal(r.quinielas, 0, 'nadie va a puntuar ahí, y recorrerla gasta llamadas');
});

test('sin clave configurada, las rutas del proveedor dicen POR QUÉ', async () => {
  const jefe = await admin('jefe');
  const clave = process.env.APIFOOTBALL_COM_KEY;
  delete process.env.APIFOOTBALL_COM_KEY;

  try {
    const res = await jefe.agente.get('/api/football/fixtures?date=2099-01-01');
    assert.equal(res.status, 500);
    assert.match(res.body.error, /APIFOOTBALL_COM_KEY/,
      'un error críptico aquí cuesta media hora de diagnóstico');
  } finally {
    process.env.APIFOOTBALL_COM_KEY = clave;
  }
});

/* ==================== Fase E — verificación de correo ==================== */

const tokens = require('../src/tokens');

/** Registra sin confirmar. Devuelve el agente, los datos y el token del correo. */
async function sinConfirmar(prefijo = 'nuevo') {
  const agente = request.agent(app);
  const datos = credenciales(prefijo);
  const alta = await agente.post('/api/auth/registro').send(datos);
  assert.equal(alta.status, 201, JSON.stringify(alta.body));
  return { agente, datos, alta, token: ultimoToken() };
}

test('registrarse NO abre sesión: la cuenta nace sin confirmar', async () => {
  const { agente, alta } = await sinConfirmar();

  assert.equal(alta.body.success, true);
  assert.equal(alta.body.usuario.emailVerificado, false);
  assert.equal(alta.body.correoEnviado, true);

  const yo = await agente.get('/api/auth/me');
  assert.equal(yo.status, 401, 'entrar sin confirmar es justo lo que se impide');
});

test('⚠️ sin confirmar no se entra, y el mensaje dice qué hacer', async () => {
  const { datos } = await sinConfirmar();

  const entrada = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });

  assert.equal(entrada.status, 403);
  assert.equal(entrada.body.requiereVerificacion, true);
  assert.match(entrada.body.error, /confirmado tu correo/);
});

test('⚠️ la contraseña se comprueba ANTES de mirar si está confirmado', async () => {
  const { datos } = await sinConfirmar();

  const malaClave = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'no-es-esta-larga' });

  /*
   * 401 y no 403: con la contraseña equivocada la respuesta tiene que ser
   * indistinguible de la de una cuenta que no existe. Si aquí saliera
   * "confirma tu correo", cualquiera podría averiguar qué direcciones están
   * registradas probándolas.
   */
  assert.equal(malaClave.status, 401);
  assert.equal(malaClave.body.requiereVerificacion, undefined);

  const inexistente = await request(app).post('/api/auth/login')
    .send({ identificador: 'no-existe-nadie', password: 'no-es-esta-larga' });
  assert.equal(malaClave.body.error, inexistente.body.error);
});

test('el enlace del correo confirma la cuenta y entonces sí se entra', async () => {
  const { datos, token } = await sinConfirmar();

  const confirmada = await request(app).post('/api/auth/verificar-correo').send({ token });
  assert.equal(confirmada.status, 200);
  assert.equal(confirmada.body.username, datos.username);

  const entrada = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });
  assert.equal(entrada.status, 200);
  assert.equal(entrada.body.usuario.emailVerificado, true);
});

test('⚠️ el token es de UN SOLO uso', async () => {
  const { token } = await sinConfirmar();

  assert.equal((await request(app).post('/api/auth/verificar-correo').send({ token })).status, 200);

  const segunda = await request(app).post('/api/auth/verificar-correo').send({ token });
  assert.equal(segunda.status, 400);
  assert.match(segunda.body.error, /ya se usó o venció/);
});

test('un token inventado, vacío o de otro propósito no confirma nada', async () => {
  for (const token of ['', 'a'.repeat(64), 'no-es-un-hash']) {
    const res = await request(app).post('/api/auth/verificar-correo').send({ token });
    assert.equal(res.status, 400, `aceptó "${token.slice(0, 12)}"`);
  }
});

test('⚠️ en la base NO se guarda el token, sólo su hash', async () => {
  const { token } = await sinConfirmar();

  const { rows } = await db.consulta('SELECT token_hash FROM auth_tokens');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token, 'el token en claro no puede estar en la base');
  assert.equal(rows[0].token_hash, tokens.hashDe(token),
    'una filtración de la base no debe entregar la capacidad de entrar en cuentas ajenas');
});

test('⚠️ pedir el enlace otra vez anula el anterior', async () => {
  const { datos, token: primero } = await sinConfirmar();

  await request(app).post('/api/auth/reenviar-verificacion').send({ email: datos.email });
  const segundo = ultimoToken();

  assert.notEqual(primero, segundo);

  const viejo = await request(app).post('/api/auth/verificar-correo').send({ token: primero });
  assert.equal(viejo.status, 400, 'un correo viejo reenviado no puede seguir abriendo la cuenta');

  assert.equal((await request(app).post('/api/auth/verificar-correo').send({ token: segundo })).status, 200);
});

test('⚠️ el reenvío responde lo MISMO exista o no la cuenta', async () => {
  const { datos } = await sinConfirmar();

  const existe = await request(app).post('/api/auth/reenviar-verificacion').send({ email: datos.email });
  const noExiste = await request(app).post('/api/auth/reenviar-verificacion')
    .send({ email: 'nadie-de-por-aqui@ejemplo.com' });

  assert.equal(existe.status, 200);
  assert.equal(noExiste.status, 200);
  assert.deepEqual(existe.body, noExiste.body,
    'distinguirlas diría qué direcciones están registradas');
});

test('no se reenvía a una cuenta ya confirmada: ni da pistas ni gasta cuota', async () => {
  const { datos, token } = await sinConfirmar();
  await request(app).post('/api/auth/verificar-correo').send({ token });

  const cuantosAntes = correo.bandeja.length;
  const res = await request(app).post('/api/auth/reenviar-verificacion').send({ email: datos.email });

  assert.equal(res.status, 200);
  assert.equal(correo.bandeja.length, cuantosAntes, 'no debía salir ningún correo');
});

test('un token vencido no sirve', async () => {
  const { token } = await sinConfirmar();

  await db.consulta("UPDATE auth_tokens SET expira_en = now() - interval '1 hour'");

  const res = await request(app).post('/api/auth/verificar-correo').send({ token });
  assert.equal(res.status, 400);
});

test('borrar la cuenta se lleva sus tokens', async () => {
  const { datos } = await sinConfirmar();

  await db.consulta('DELETE FROM usuarios WHERE email = $1', [datos.email]);

  const { rows } = await db.consulta('SELECT count(*)::int n FROM auth_tokens');
  assert.equal(rows[0].n, 0, 'la clave ajena en cascada se los lleva');
});

/* ---------- El correo ---------- */

test('el correo lleva el enlace, el nombre y el plazo', async () => {
  const { datos } = await sinConfirmar();
  const mensaje = correo.bandeja.at(-1);

  assert.equal(mensaje.para, datos.email);
  assert.match(mensaje.asunto, /Confirma tu correo/);
  assert.ok(mensaje.texto.includes(datos.username), 'debe saludar por su nombre');
  assert.match(mensaje.texto, /verificar-correo\.html\?token=[a-f0-9]{64}/);
  assert.match(mensaje.texto, /vence en 24 hora/);
});

test('⚠️ el nombre se escapa dentro del HTML del correo', () => {
  const { html } = correo.plantilla({
    titulo: 'x', saludo: 'Hola <script>alert(1)</script>:', parrafo: 'y',
    boton: 'z', url: 'https://ejemplo.com', pie: 'w'
  });

  assert.doesNotMatch(html, /<script>/, 'el nombre viaja dentro del HTML: hay que escaparlo igual que en el DOM');
  assert.match(html, /&lt;script&gt;/);
});

test('el transporte de pruebas es el de consola, y no envía nada', () => {
  assert.equal(correo.TRANSPORTE, 'consola',
    'con otro transporte estas pruebas mandarían correos de verdad a direcciones inventadas');
});

test('⚠️ si el token no se puede emitir, la cuenta NO se crea', async () => {
  const datos = credenciales('atom');

  /*
   * Se rompe la emisión del token a propósito. Sin la transacción, la cuenta
   * quedaba creada y la persona ATRAPADA: no puede entrar porque no está
   * confirmada, y no puede volver a registrarse porque su nombre y su correo ya
   * están cogidos. Sin salida y sin ningún mensaje que lo explique.
   *
   * No es hipotético: pasó al desplegar la Fase E contra una base a la que
   * todavía le faltaba `auth_tokens` (Entrada 055).
   */
  const original = tokens.emitir;
  tokens.emitir = async () => { throw new Error('auth_tokens no existe'); };

  try {
    const res = await request(app).post('/api/auth/registro').send(datos);
    assert.equal(res.status, 500);
  } finally {
    tokens.emitir = original;
  }

  const { rows } = await db.consulta(
    'SELECT count(*)::int n FROM usuarios WHERE username = $1', [datos.username]);
  assert.equal(rows[0].n, 0, 'la cuenta no puede quedar creada sin su token');

  // Y la prueba de que no queda atrapada: puede registrarse otra vez.
  const segunda = await request(app).post('/api/auth/registro').send(datos);
  assert.equal(segunda.status, 201);
});

test('⚠️ el reenvío tiene su PROPIO limitador, con su propio mensaje', () => {
  /*
   * Compartia el del registro, y eso tenia dos problemas: registrarte dos veces
   * y pedir el enlace tres te dejaba bloqueado sin relacion aparente, y el
   * mensaje hablaba de «cuentas creadas» cuando lo que habias pedido era un
   * correo.
   *
   * Se comprueba leyendo el codigo porque los limitadores estan APAGADOS en
   * pruebas -si no, las 100 cuentas que crea la suite se bloquearian a la
   * sexta- asi que no hay forma de provocar el 429 aqui.
   */
  const fuente = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'servidor.js'), 'utf8');

  assert.match(fuente, /const limiteReenvio = rateLimit\(/);
  assert.match(fuente, /reenviar-verificacion', limiteReenvio/);

  // Y su mensaje habla de lo que se pidio, no de cuentas.
  const bloque = fuente.slice(
    fuente.indexOf('const limiteReenvio'),
    fuente.indexOf('const limiteAdminMode'));
  assert.match(bloque, /Has pedido el enlace demasiadas veces/);
  assert.doesNotMatch(bloque, /cuentas creadas/);
});

test('⚠️ la pantalla de confirmación mira el ESTADO, no sólo el cuerpo', () => {
  /*
   * Antes pintaba el mensaje del cuerpo o, si no venia, "le enviamos el
   * enlace". Ante un 429 el cuerpo trae `error` y no `mensaje`, asi que la
   * pantalla decia que el correo habia salido CUANDO NO ERA VERDAD.
   *
   * Un mensaje de exito falso es peor que un error: quien lo lee se queda
   * esperando un correo que nunca va a llegar.
   */
  /*
   * ⚠️ Sin comentarios. El comentario que explica el arreglo CITA el mensaje
   * viejo -"le enviamos el enlace"- y aparece antes del `if`, asi que la
   * comprobacion de orden fallaba contra su propia documentacion.
   *
   * Es la misma leccion que ya tenia aprendida `architecture.test.js`, y aqui
   * volvio a morder por escribir la prueba sin acordarse.
   */
  const script = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'private', 'js', 'verificar-correo.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const reenvio = script.slice(script.indexOf("reenviar.addEventListener"));

  assert.match(reenvio, /if \(!respuesta\.ok\)/);
  assert.ok(
    reenvio.indexOf('if (!respuesta.ok)') < reenvio.indexOf('le enviamos el enlace'),
    'el estado se comprueba ANTES de dar por bueno el envio'
  );
});

test('⚠️ /readyz dice qué transporte de correo está en uso', async () => {
  /*
   * Con `consola` los correos se escriben en el registro en vez de enviarse, y
   * -como sin confirmar no se entra- nadie puede usar la aplicacion. Pero todo
   * responde con normalidad: el unico sintoma es que no llega ningun correo.
   *
   * Paso de verdad al desplegar la Fase E, y costo dos vueltas: `correoEnviado:
   * true` NO prueba que el correo saliera, solo que la funcion no fallo, y con
   * el transporte de consola nunca falla. Sin esto habia que entrar a los
   * registros del servidor para saberlo.
   */
  const res = await request(app).get('/readyz');

  assert.equal(res.status, 200);
  assert.equal(res.body.correo.transporte, 'consola');
  assert.equal(res.body.correo.envia, false,
    'el de consola NO envia, y la sonda tiene que decirlo');
});

test('⚠️ correoEnviado true NO significa que el correo saliera', async () => {
  /*
   * Se deja escrito porque es la trampa que costo el diagnostico. `intentar()`
   * devuelve true si el envio no lanzo, y el transporte de consola nunca lanza:
   * escribe en el registro y termina bien.
   *
   * Lo que hay que mirar para saber si los correos salen de verdad es
   * `/readyz`, no la respuesta del registro.
   */
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/registro').send(credenciales('trampa'));

  assert.equal(res.body.correoEnviado, true);
  assert.equal(correo.TRANSPORTE, 'consola', 'y sin embargo no salio ningun correo');
  assert.equal(correo.bandeja.at(-1).para, res.body.usuario.email,
    'se quedo en la bandeja en memoria, que es donde acaba lo que no se envia');
});

/* ==================== Recuperar la contraseña ==================== */

/** Pide el enlace de restablecimiento y devuelve su token. */
async function pedirEnlace(email) {
  const res = await request(app).post('/api/auth/olvide-password').send({ email });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return ultimoToken();
}

test('el enlace llega, cambia la contraseña, y la nueva sirve para entrar', async () => {
  const { datos } = await cuentaNueva('olvida');

  const token = await pedirEnlace(datos.email);

  const cambio = await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'contrasena-nueva-1' });
  assert.equal(cambio.status, 200);
  assert.equal(cambio.body.username, datos.username);

  const conNueva = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'contrasena-nueva-1' });
  assert.equal(conNueva.status, 200);

  const conVieja = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });
  assert.equal(conVieja.status, 401, 'la contraseña anterior deja de valer');
});

test('⚠️ restablecer CIERRA las sesiones abiertas', async () => {
  const { agente, datos } = await cuentaNueva('sesion');

  // La sesión está viva antes del cambio.
  assert.equal((await agente.get('/api/auth/me')).status, 200);

  const token = await pedirEnlace(datos.email);
  const cambio = await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'contrasena-nueva-1' });

  assert.equal(cambio.body.sesionesCerradas, 1);

  /*
   * Si el motivo del cambio fue que otra persona entró a la cuenta, su sesión
   * NO puede sobrevivir: cambiar la clave sin esto la dejaría dentro.
   */
  assert.equal((await agente.get('/api/auth/me')).status, 401,
    'la sesión de antes del cambio tiene que morir');
});

test('⚠️ restablecer confirma la dirección de paso', async () => {
  /*
   * Quien abrió el enlace demostró que controla el buzón. Sin esto, alguien que
   * recuperara la contraseña sin haber confirmado nunca SEGUIRÍA sin poder
   * entrar, y el mensaje de error no le diría por qué.
   */
  const agente = request.agent(app);
  const datos = credenciales('sinconf');
  await agente.post('/api/auth/registro').send(datos);

  const token = await pedirEnlace(datos.email);
  await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'contrasena-nueva-1' });

  const entrada = await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'contrasena-nueva-1' });

  assert.equal(entrada.status, 200, 'no puede quedarse fuera por no haber confirmado');
  assert.equal(entrada.body.usuario.emailVerificado, true);
});

test('⚠️ el token de restablecer es de UN SOLO uso', async () => {
  const { datos } = await cuentaNueva('unsolo');
  const token = await pedirEnlace(datos.email);

  assert.equal((await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'contrasena-nueva-1' })).status, 200);

  const segunda = await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'otra-contrasena-1' });
  assert.equal(segunda.status, 400);

  // Y la contraseña sigue siendo la del primer cambio.
  assert.equal((await request(app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'contrasena-nueva-1' })).status, 200);
});

test('⚠️ un token de confirmar NO sirve para restablecer', async () => {
  /*
   * Los dos viven en la misma tabla. Si `usable` no filtrara por propósito,
   * el enlace de confirmar el correo —que dura 24 horas— serviría para cambiar
   * la contraseña de cualquiera.
   */
  const agente = request.agent(app);
  const datos = credenciales('cruzado');
  await agente.post('/api/auth/registro').send(datos);
  const tokenDeConfirmar = ultimoToken();

  const res = await request(app).post('/api/auth/restablecer-password')
    .send({ token: tokenDeConfirmar, password: 'contrasena-nueva-1' });

  assert.equal(res.status, 400);
});

test('una contraseña corta se rechaza, y el token NO se gasta', async () => {
  const { datos } = await cuentaNueva('corta');
  const token = await pedirEnlace(datos.email);

  const corta = await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'corta' });
  assert.equal(corta.status, 400);

  // El token sigue sirviendo: no se puede castigar por escribir mal una vez.
  assert.equal((await request(app).post('/api/auth/restablecer-password')
    .send({ token, password: 'contrasena-nueva-1' })).status, 200);
});

test('⚠️ pedir el enlace responde lo MISMO exista o no la cuenta', async () => {
  const { datos } = await cuentaNueva('misma');

  const existe = await request(app).post('/api/auth/olvide-password').send({ email: datos.email });
  const noExiste = await request(app).post('/api/auth/olvide-password')
    .send({ email: 'nadie-de-por-aqui@ejemplo.com' });

  assert.equal(existe.status, 200);
  assert.equal(noExiste.status, 200);
  assert.deepEqual(existe.body, noExiste.body,
    'distinguirlas diría qué direcciones están registradas');
});

test('no se manda ningún correo a una dirección sin cuenta', async () => {
  const cuantos = correo.bandeja.length;
  await request(app).post('/api/auth/olvide-password').send({ email: 'nadie@ejemplo.com' });
  assert.equal(correo.bandeja.length, cuantos, 'ni da pistas ni gasta cuota');
});

test('el enlace de restablecer vive MENOS que el de confirmar', async () => {
  /*
   * Este enlace ABRE la cuenta a quien lo tenga: un correo viejo olvidado en
   * una bandeja es una llave. Confirmar una dirección no tiene ese riesgo.
   */
  assert.ok(tokens.HORAS_RESTABLECER < tokens.HORAS_VERIFICACION);
  assert.equal(tokens.HORAS_RESTABLECER, 1);
});

test('el correo de restablecer dice que ignorarlo no cambia nada', async () => {
  const { datos } = await cuentaNueva('pie');
  await pedirEnlace(datos.email);

  const mensaje = correo.bandeja.at(-1);
  assert.match(mensaje.asunto, /Restablece tu contraseña/);
  assert.match(mensaje.texto, /restablecer-password\.html\?token=[a-f0-9]{64}/);
  /*
   * Quien recibe esto sin haberlo pedido tiene que saber que NO tiene que hacer
   * nada. Sin esa frase, un correo así asusta.
   */
  assert.match(mensaje.texto, /tu contraseña seguirá siendo la misma/);
});


/* ==================== Cobros ==================== */

const COBRA = { torneo: { activo: true, precio: 10000 },
                jornada: { activo: true, precio: 2000 } };

/** Enciende los cobros y devuelve al socio, que ya es jugador. */
async function conCobros(prefijo, config = COBRA) {
  const jefe = await admin(prefijo);
  const socio = await miembroDe(jefe, prefijo + 'socio');
  await jefe.agente.patch('/api/quiniela-actual/configuracion').send({ cobros: config });
  return { jefe, socio };
}

/** El id del jugador del socio, visto desde la cuenta del administrador. */
async function jugadorDe(jefe, username) {
  const res = await jefe.agente.get('/api/cobros/cuentas');
  return res.body.cuentas.find(c => c.nombre === username);
}

const crearJornada = (agente, nombre) => agente.post('/api/jornadas')
  .send({ nombre, partidos: [partido('Alfa', 'Beta')] });

test('⚠️ el precio se congela en la jornada: subirlo NO recalcula las viejas', async () => {
  /*
   * Es la decisión que sostiene todo lo demás. "Esta jornada vale 5000 porque
   * el premio está grande" no puede encarecer hacia atrás lo que la gente ya
   * debía por las anteriores.
   */
  const { jefe, socio } = await conCobros('congela');

  await crearJornada(jefe.agente, 'J1');            // a 2000
  await jefe.agente.patch('/api/quiniela-actual/configuracion')
    .send({ cobros: { ...COBRA, jornada: { activo: true, precio: 5000 } } });
  await crearJornada(jefe.agente, 'J2');            // a 5000

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.debe, 7000, '2000 la primera y 5000 la segunda');
});

test('⚠️ editar los partidos de una jornada no cambia lo que costó', async () => {
  const { jefe, socio } = await conCobros('editar');

  await crearJornada(jefe.agente, 'J1');
  await jefe.agente.patch('/api/quiniela-actual/configuracion')
    .send({ cobros: { ...COBRA, jornada: { activo: true, precio: 9000 } } });

  // Volver a guardar la MISMA jornada, ya con otro precio configurado.
  await jefe.agente.post('/api/jornadas')
    .send({ nombre: 'J1', partidos: [partido('Alfa', 'Beta'), partido('Ceta', 'Delta')] });

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.debe, 2000, 'guardar partidos no es cambiar el precio');
});

test('un abono deja saldo a favor, y se estima cuántas jornadas cubre', async () => {
  const { jefe, socio } = await conCobros('saldo');
  await crearJornada(jefe.agente, 'J1');

  const antes = await jugadorDe(jefe, socio.datos.username);

  const abono = await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: antes.jugadorId, concepto: 'jornada', monto: 10000, nota: 'cinco de un golpe' });
  assert.equal(abono.status, 200, JSON.stringify(abono.body));

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.debe, 2000);
  assert.equal(cuenta.jornada.saldo, 8000);
  assert.equal(cuenta.jornada.jornadasQueCubre, 4, 'al precio de hoy');
});

test('⚠️ lo del torneo no paga jornadas', async () => {
  const { jefe, socio } = await conCobros('bolsas');
  await crearJornada(jefe.agente, 'J1');

  const j = await jugadorDe(jefe, socio.datos.username);
  await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'torneo', monto: 10000 });

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.torneo.pendiente, 0);
  assert.equal(cuenta.jornada.saldo, -2000, 'la jornada sigue debiéndose');
});

test('⚠️ quien entra después no debe las jornadas que no jugó', async () => {
  const jefe = await admin('tarde');
  await jefe.agente.patch('/api/quiniela-actual/configuracion').send({ cobros: COBRA });

  await crearJornada(jefe.agente, 'J1');
  await crearJornada(jefe.agente, 'J2');

  // Entra ahora, con dos jornadas ya jugadas.
  const socio = await miembroDe(jefe, 'tardesocio');
  await crearJornada(jefe.agente, 'J3');

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.debe, 2000, 'sólo la tercera: no estaba en las dos primeras');
});

test('⚠️ un abono se corrige con su inverso, y no se puede anular dos veces', async () => {
  const { jefe, socio } = await conCobros('anula');
  const j = await jugadorDe(jefe, socio.datos.username);

  const abono = await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'jornada', monto: 10000 });

  const primera = await jefe.agente.post(`/api/cobros/abonos/${abono.body.pago.id}/anular`).send({});
  assert.equal(primera.status, 200);

  const segunda = await jefe.agente.post(`/api/cobros/abonos/${abono.body.pago.id}/anular`).send({});
  assert.equal(segunda.status, 409, 'anular dos veces restaría el doble EN SILENCIO');

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.abonado, 0);

  // Y los dos asientos quedan a la vista: el bueno y el que lo anula.
  const historial = await jefe.agente.get('/api/cobros/abonos');
  assert.equal(historial.body.length, 2, 'no se borra nada: se corrige');
});

test('por la ruta de abonos no entran montos negativos sueltos', async () => {
  /*
   * Un negativo es una corrección, y las correcciones van atadas al asiento que
   * anulan. Colar uno suelto daría un historial en el que no se sabe qué
   * corrige a qué.
   */
  const { jefe, socio } = await conCobros('negativo');
  const j = await jugadorDe(jefe, socio.datos.username);

  const res = await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'jornada', monto: -5000 });

  assert.equal(res.status, 400);
});

test('el concepto tiene que ser uno de los dos', async () => {
  const { jefe, socio } = await conCobros('concepto');
  const j = await jugadorDe(jefe, socio.datos.username);

  const res = await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'propina', monto: 500 });

  assert.equal(res.status, 400);
});

test('quien no juega el torneo no arrastra su cuota', async () => {
  const { jefe, socio } = await conCobros('sintorneo');
  const j = await jugadorDe(jefe, socio.datos.username);
  assert.equal(j.torneo.debe, 10000);

  const cambio = await jefe.agente.patch(`/api/cobros/jugadores/${j.jugadorId}`)
    .send({ juegaTorneo: false });
  assert.equal(cambio.status, 200);

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.torneo.debe, 0);
});

test('se puede cambiar el precio de UNA jornada', async () => {
  const { jefe, socio } = await conCobros('finales');
  await crearJornada(jefe.agente, 'Final');

  const res = await jefe.agente.patch('/api/cobros/jornadas/Final/precio').send({ precio: 5000 });
  assert.equal(res.status, 200);

  const cuenta = await jugadorDe(jefe, socio.datos.username);
  assert.equal(cuenta.jornada.debe, 5000);
});

/* ---------- Lo que ve el jugador ---------- */

test('si la quiniela no cobra, no hay cuenta que enseñar', async () => {
  const jefe = await admin('nocobra');
  const socio = await miembroDe(jefe, 'nocobrasocio');

  const res = await socio.agente.get('/api/quiniela-actual/mi-cuenta');
  assert.equal(res.status, 200);
  assert.equal(res.body.cobra, false);
});

test('el jugador ve su saldo y qué jornadas le quedaron pagadas', async () => {
  const { jefe, socio } = await conCobros('mia');
  await crearJornada(jefe.agente, 'J1');
  await crearJornada(jefe.agente, 'J2');

  const j = await jugadorDe(jefe, socio.datos.username);
  await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'jornada', monto: 2000 });

  const res = await socio.agente.get('/api/quiniela-actual/mi-cuenta');

  assert.equal(res.body.cobra, true);
  assert.equal(res.body.juega, true);
  assert.deepEqual(res.body.jornadas.map(x => x.pagada), [true, false],
    'el abono cubre la primera, y eso SÍ es exacto');
});

test('⛔ cada quien ve SU cuenta en mi-cuenta, no la del de al lado', async () => {
  /*
   * El jugador se resuelve desde la sesión y no desde un id que venga por la
   * URL, así que no hay forma de pedir la de otro. Se comprueba con dos socios
   * de verdad y saldos distintos: si se cruzaran, los números se notarían.
   */
  const { jefe, socio } = await conCobros('ajena');
  const otro = await miembroDe(jefe, 'ajenaotro');

  const unoJ = await jugadorDe(jefe, socio.datos.username);
  const otroJ = await jugadorDe(jefe, otro.datos.username);

  await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: unoJ.jugadorId, concepto: 'jornada', monto: 6000 });
  await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: otroJ.jugadorId, concepto: 'jornada', monto: 1000 });

  const suya = await socio.agente.get('/api/quiniela-actual/mi-cuenta');
  const ajena = await otro.agente.get('/api/quiniela-actual/mi-cuenta');

  assert.equal(suya.body.nombre, socio.datos.username);
  assert.equal(suya.body.jornada.saldo, 6000);

  assert.equal(ajena.body.nombre, otro.datos.username);
  assert.equal(ajena.body.jornada.saldo, 1000, 'no puede ver el saldo del otro');
});

test('un miembro normal no puede ver las cuentas de todos ni anotar abonos', async () => {
  const { jefe, socio } = await conCobros('permiso');

  assert.equal((await socio.agente.get('/api/cobros/cuentas')).status, 403);
  assert.equal((await socio.agente.post('/api/cobros/abonos')
    .send({ jugadorId: 'x', concepto: 'jornada', monto: 1000 })).status, 403);
});

test('⛔ los pagos de una quiniela no se ven desde otra', async () => {
  const uno = await conCobros('aisla1');
  const otro = await conCobros('aisla2');

  const j = await jugadorDe(uno.jefe, uno.socio.datos.username);
  await uno.jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'jornada', monto: 7000 });

  const ajenos = await otro.jefe.agente.get('/api/cobros/abonos');
  assert.deepEqual(ajenos.body, [], 'la RLS de `pagos` tiene que aguantar esto');
});


/* ============ Orden de los partidos, y lo que se borra al guardar ============ */

const conHoraApi = (equipo1, fixture, apiDate) =>
  partido(equipo1, 'X', { apiFixtureId: fixture, apiDate });

test('al crear la jornada los partidos se ordenan solos por hora', async () => {
  const jefe = await admin('orden');

  await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1',
    partidos: [
      conHoraApi('Tarde', '3', '2099-01-01 20:00'),
      conHoraApi('Manana', '1', '2099-01-01 09:00'),
      conHoraApi('Mediodia', '2', '2099-01-01 13:00')
    ]
  });

  const j = await jefe.agente.get('/api/jornadas');
  const jornada = j.body.find(x => x.nombre === 'J1');
  assert.deepEqual(jornada.partidos.map(p => p.equipo1), ['Manana', 'Mediodia', 'Tarde']);
});

test('⚠️ al añadir a una jornada con pronósticos, el nuevo va al FINAL y no se borra nada', async () => {
  const jefe = await admin('anade');
  const socio = await miembroDe(jefe, 'anadesocio');

  const dos = [
    conHoraApi('Primero', '1', '2099-01-01 09:00'),
    conHoraApi('Segundo', '2', '2099-01-01 20:00')
  ];
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: dos });

  await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 0 }]
  });

  // Se añade uno que por hora iría PRIMERO. Debe quedarse al final.
  const res = await jefe.agente.post('/api/jornadas').send({
    nombre: 'J1',
    partidos: [...dos, conHoraApi('Madrugada', '3', '2099-01-01 06:00')]
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.pronosticosBorrados, 0, 'añadir no puede costar ni un pronóstico');

  const j = await jefe.agente.get('/api/jornadas');
  const jornada = j.body.find(x => x.nombre === 'J1');
  assert.deepEqual(jornada.partidos.map(p => p.equipo1), ['Primero', 'Segundo', 'Madrugada'],
    'los guardados no se mueven; el nuevo va al final aunque se juegue antes');
});

test('⛔ quitar un partido desde la pantalla sólo borra los pronósticos de ESE', async () => {
  const jefe = await admin('quita');
  const socio = await miembroDe(jefe, 'quitasocio');

  const tres = [
    conHoraApi('A', '1', '2099-01-01 09:00'),
    conHoraApi('B', '2', '2099-01-01 15:00'),
    conHoraApi('C', '3', '2099-01-01 20:00')
  ];
  await jefe.agente.post('/api/jornadas').send({ nombre: 'J1', partidos: tres });

  await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1',
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 0 },
                  { marcador1: 3, marcador2: 0 }]
  });

  // Justo lo que manda la pantalla al quitar el del medio: la lista sin él.
  const res = await jefe.agente.post('/api/jornadas')
    .send({ nombre: 'J1', partidos: [tres[0], tres[2]] });

  assert.equal(res.body.pronosticosBorrados, 1, 'sólo el del partido retirado');
  assert.equal(res.body.partidosRetirados, 1);

  // Y el de C sigue siendo el de C, no el que era de B.
  const j = await jefe.agente.get('/api/jornadas');
  const jornada = j.body.find(x => x.nombre === 'J1');
  assert.deepEqual(jornada.partidos.map(x => x.equipo1), ['A', 'C']);

  const tabla = await socio.agente.get('/api/resultados?jornada=J1');
  const fila = tabla.body.find(([clave]) => clave === `${socio.datos.username}_J1`);

  assert.deepEqual(fila[1].map(x => x.marcador1), [1, 3],
    'A conserva su 1 y C su 3: ninguno hereda el marcador del que se quitó');
});

/* ==================== Los tres hallazgos de la auditoría ==================== */

test('⛔ un miembro normal NO puede gastar la cuota del proveedor', async () => {
  /*
   * La cuota de APIFootball es UNA SOLA para todas las quinielas. Sin guardia,
   * cualquiera con cuenta podía pedir rangos de fechas en bucle y dejar al
   * resto sin poder armar jornadas. No es fuga de datos: es dejar sin servicio
   * a quinielas ajenas.
   */
  const jefe = await admin('cuota');
  const socio = await miembroDe(jefe, 'cuotasocio');

  assert.equal((await socio.agente.get('/api/football/fixtures?date=2099-01-01')).status, 403);
  assert.equal((await socio.agente.get('/api/football/leagues')).status, 403);
  assert.equal((await socio.agente.get('/api/football/ligas-disponibles')).status, 403);
});

test('⛔ cambiar la contraseña cierra las OTRAS sesiones, no la propia', async () => {
  /*
   * Misma razón que en restablecer (Entrada 056): si otra persona entró a la
   * cuenta, su sesión no puede sobrevivir. Y aquí pesa más, porque quien lo
   * hace desde su perfil suele hacerlo precisamente porque sospecha.
   */
  const jefe = await admin('cierra');

  const otra = request.agent(app);
  await otra.post('/api/auth/login')
    .send({ identificador: jefe.datos.username, password: jefe.datos.password });
  await otra.post(`/api/quinielas/${jefe.quiniela.id}/seleccionar`).send({});
  assert.equal((await otra.get('/api/auth/me')).status, 200, 'la segunda sesión está viva');

  const cambio = await jefe.agente.post(`/api/jugadores/${jefe.datos.username}/cambiar-password`)
    .send({ currentPassword: jefe.datos.password, newPassword: 'contrasena-nueva-9' });

  assert.equal(cambio.status, 200);
  assert.equal(cambio.body.sesionesCerradas, 1);

  assert.equal((await otra.get('/api/auth/me')).status, 401,
    'la sesión de antes del cambio tiene que morir');

  // Y la de quien lo pidió sigue abierta: no se echa a quien hizo lo correcto.
  assert.equal((await jefe.agente.get('/api/auth/me')).status, 200);
});

test('las entradas inválidas de cobros dan 400, no 500', async () => {
  /*
   * Un identificador que no es uuid hacía que PostgreSQL rechazara la consulta
   * y salía como «error interno». No filtraba nada, pero cada petición
   * malformada escribía un error que podía tapar los de verdad.
   */
  const jefe = await admin('valida');

  assert.equal((await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: 'no-soy-un-uuid', concepto: 'jornada', monto: 1000 })).status, 400);

  assert.equal((await jefe.agente.post('/api/cobros/abonos/tampoco/anular').send({})).status, 400);

  assert.equal((await jefe.agente.patch('/api/cobros/jugadores/ni-yo')
    .send({ juegaTorneo: false })).status, 400);

  assert.equal((await jefe.agente.get('/api/cobros/abonos?jugador=basura')).status, 400);
});

test('un monto absurdo se rechaza con un mensaje, no con un 500', async () => {
  const jefe = await admin('tope');
  const socio = await miembroDe(jefe, 'topesocio');

  await jefe.agente.patch('/api/quiniela-actual/configuracion').send({
    cobros: { torneo: { activo: false, precio: 0 }, jornada: { activo: true, precio: 100 } }
  });

  const cuentas = await jefe.agente.get('/api/cobros/cuentas');
  const j = cuentas.body.cuentas.find(c => c.nombre === socio.datos.username);

  const res = await jefe.agente.post('/api/cobros/abonos')
    .send({ jugadorId: j.jugadorId, concepto: 'jornada', monto: 1e15 });

  assert.equal(res.status, 400, 'numeric(12,2) se desborda y la consulta revienta');
  assert.match(res.body.error, /monto/i);
});


/* ==================== El superadministrador ==================== */

/*
 * ============================================================================
 * ⛔ AQUÍ EL PESO ESTÁ EN LOS PERMISOS, NO EN LA FUNCIONALIDAD
 * ============================================================================
 *
 * Es la única pantalla del sistema que enseña **los correos de todo el mundo**.
 * Si la guardia dejara pasar, no sería un fallo de funcionalidad: sería una
 * fuga de datos personales de todos los usuarios de todas las quinielas, de una
 * sola vez. Por eso las primeras pruebas son de quién NO puede entrar.
 *
 * `SUPERADMIN_EMAILS` se toca en cada prueba y se deja como estaba: es una
 * variable de proceso, así que una prueba que la olvide puesta le daría poder a
 * las siguientes y podrían pasar por la razón equivocada.
 */

/** Corre `fn` con estos correos como superadministradores, y luego lo deshace. */
async function conSuperadmins(correos, fn) {
  const antes = process.env.SUPERADMIN_EMAILS;
  process.env.SUPERADMIN_EMAILS = correos;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.SUPERADMIN_EMAILS;
    else process.env.SUPERADMIN_EMAILS = antes;
  }
}

/**
 * Confirma la contraseña de quien ya está en la lista.
 *
 * Va aparte de `cuentaNueva` porque la variable de entorno se pone DESPUÉS de
 * crear la cuenta: `esSuperadmin` mira el correo, y ese correo no se conoce
 * hasta que la cuenta existe.
 */
async function confirmarPoder({ agente, datos }) {
  const res = await agente.post('/api/superadmin/confirmar').send({ password: datos.password });
  assert.equal(res.status, 200, `No se pudo confirmar: ${JSON.stringify(res.body)}`);
  return agente;
}

/** Las siete rutas de datos, para barrerlas de una. */
const RUTAS_SUPERADMIN = [
  ['get', '/api/superadmin/cuentas'],
  ['get', '/api/superadmin/cuentas/00000000-0000-0000-0000-000000000000'],
  ['get', '/api/superadmin/acciones'],
  ['post', '/api/superadmin/cuentas/00000000-0000-0000-0000-000000000000/desactivar'],
  ['post', '/api/superadmin/cuentas/00000000-0000-0000-0000-000000000000/reactivar'],
  ['post', '/api/superadmin/cuentas/00000000-0000-0000-0000-000000000000/liberar-correo'],
  ['delete', '/api/superadmin/cuentas/00000000-0000-0000-0000-000000000000']
];

test('⛔ sin SUPERADMIN_EMAILS no entra NADIE, ni el dueño de una quiniela', async () => {
  const { agente, datos } = await cuentaNueva('nadie');
  await quinielaNueva(agente, datos);

  await conSuperadmins('', async () => {
    for (const [metodo, ruta] of RUTAS_SUPERADMIN) {
      const res = await agente[metodo](ruta).send({ motivo: 'probando' });
      assert.equal(res.status, 403,
        `${metodo.toUpperCase()} ${ruta} dejó pasar sin superadministradores configurados`);
    }

    const quien = await agente.get('/api/superadmin/quien-soy');
    assert.equal(quien.body.esSuperadmin, false);
  });
});

test('⛔ un usuario normal recibe 403 en las siete rutas', async () => {
  const jefe = await cuentaNueva('conpoder');
  const otro = await cuentaNueva('sinpoder');

  await conSuperadmins(jefe.datos.email, async () => {
    for (const [metodo, ruta] of RUTAS_SUPERADMIN) {
      const res = await otro.agente[metodo](ruta).send({ motivo: 'probando' });
      assert.equal(res.status, 403, `${metodo.toUpperCase()} ${ruta} dejó pasar a un usuario normal`);
    }
  });
});

test('⚠️ estar en la lista NO basta: hay que confirmar la contraseña', async () => {
  const { agente, datos } = await cuentaNueva('sinconfirmar');

  await conSuperadmins(datos.email, async () => {
    const res = await agente.get('/api/superadmin/cuentas');

    assert.equal(res.status, 401, 'sin confirmar la contraseña no se opera');
    assert.equal(res.body.requiereConfirmacion, true);

    // Y la confirmación exige la contraseña de verdad.
    const mala = await agente.post('/api/superadmin/confirmar').send({ password: 'la-que-no-es' });
    assert.equal(mala.status, 401);

    const buena = await agente.post('/api/superadmin/confirmar').send({ password: datos.password });
    assert.equal(buena.status, 200);

    const ahora = await agente.get('/api/superadmin/cuentas');
    assert.equal(ahora.status, 200);
  });
});

test('⚠️ el correo se compara sin distinguir mayúsculas', async () => {
  const { agente, datos } = await cuentaNueva('mayus');

  await conSuperadmins(datos.email.toUpperCase(), async () => {
    const quien = await agente.get('/api/superadmin/quien-soy');
    assert.equal(quien.body.esSuperadmin, true,
      'un correo escrito con mayúsculas en Render tiene que casar igual');
  });
});

test('la lista trae los correos y las quinielas de cada quien', async () => {
  const jefe = await cuentaNueva('mando');
  const socio = await cuentaNueva('socio');
  await quinielaNueva(socio.agente, socio.datos, 'La de los amigos');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const res = await jefe.agente.get('/api/superadmin/cuentas');
    assert.equal(res.status, 200);

    const ficha = res.body.cuentas.find(c => c.email === socio.datos.email);
    assert.ok(ficha, 'el socio tiene que salir en la lista');
    assert.equal(ficha.quinielas.length, 1);
    assert.equal(ficha.quinielas[0].nombre, 'La de los amigos');
    assert.equal(ficha.quinielas[0].rol, 'propietario');

    // ⚠️ Y no sale la contraseña, ni siquiera cifrada.
    assert.equal(ficha.password, undefined);
    assert.equal(ficha.passwordHash, undefined);
  });
});

test('⛔ desactivar echa de verdad: no puede entrar y sus sesiones se cierran', async () => {
  const jefe = await cuentaNueva('mando2');
  const victima = await cuentaNueva('victima');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const res = await jefe.agente
      .post(`/api/superadmin/cuentas/${victima.usuarioId}/desactivar`)
      .send({ motivo: 'cuenta duplicada' });

    assert.equal(res.status, 200, JSON.stringify(res.body));

    // La sesión que ya tenía abierta deja de valer.
    const conSesionVieja = await victima.agente.get('/api/auth/me');
    assert.equal(conSesionVieja.status, 401, 'su sesión abierta tenía que cerrarse');

    // Y no puede volver a entrar.
    const login = await request(app).post('/api/auth/login')
      .send({ identificador: victima.datos.username, password: victima.datos.password });
    assert.equal(login.status, 401);
  });
});

test('el motivo es obligatorio: el registro existe para poder releerlo', async () => {
  const jefe = await cuentaNueva('mando3');
  const otro = await cuentaNueva('otro3');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    for (const motivo of ['', '  ', 'x']) {
      const res = await jefe.agente
        .post(`/api/superadmin/cuentas/${otro.usuarioId}/desactivar`).send({ motivo });
      assert.equal(res.status, 400, `un motivo "${motivo}" no debería valer`);
    }
  });
});

test('liberar el correo deja registrarse otra vez con esa dirección', async () => {
  const jefe = await cuentaNueva('mando4');
  const antigua = await cuentaNueva('antigua');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const res = await jefe.agente
      .post(`/api/superadmin/cuentas/${antigua.usuarioId}/liberar-correo`)
      .send({ motivo: 'se equivocó de correo al registrarse' });

    assert.equal(res.status, 200, JSON.stringify(res.body));

    /*
     * Lo que importa: la dirección vuelve a estar libre. Antes de esto, un
     * correo mal escrito en el registro dejaba esa dirección ocupada para
     * siempre y sin forma de recuperarla.
     */
    const denuevo = await request(app).post('/api/auth/registro').send({
      username: 'renacido', email: antigua.datos.email,
      password: 'contrasena-larga-1', confirmarPassword: 'contrasena-larga-1'
    });
    assert.equal(denuevo.status, 201, `la dirección tenía que quedar libre: ${JSON.stringify(denuevo.body)}`);
  });
});

test('⛔ no puedes tocarte a ti mismo, ni a otro superadministrador', async () => {
  const jefe = await cuentaNueva('mando5');
  const colega = await cuentaNueva('colega');

  await conSuperadmins(`${jefe.datos.email},${colega.datos.email}`, async () => {
    await confirmarPoder(jefe);

    const yo = await jefe.agente
      .post(`/api/superadmin/cuentas/${jefe.usuarioId}/desactivar`).send({ motivo: 'probando' });
    assert.equal(yo.status, 409, 'desactivarte a ti mismo te deja fuera de la propia pantalla');

    const elOtro = await jefe.agente
      .post(`/api/superadmin/cuentas/${colega.usuarioId}/desactivar`).send({ motivo: 'probando' });
    assert.equal(elOtro.status, 409, 'quitarle el poder a otro se hace en Render, no aquí');
  });
});

test('⛔ borrar a la dueña de una quiniela se rechaza y dice cuál', async () => {
  const jefe = await cuentaNueva('mando6');
  const duena = await cuentaNueva('duena');
  await quinielaNueva(duena.agente, duena.datos, 'La que no puede quedarse sin dueño');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const res = await jefe.agente
      .delete(`/api/superadmin/cuentas/${duena.usuarioId}`)
      .send({ motivo: 'limpieza' });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /La que no puede quedarse sin dueño/,
      'tiene que nombrar la quiniela, no dar un error de clave ajena');
  });
});

test('⚠️ borrar a quien tiene historial exige confirmarlo, y lo desvincula sin perderlo', async () => {
  const jefe = await cuentaNueva('mando7');

  // Una quiniela ajena donde el jugador tiene pronósticos.
  const jefa = await admin('lajefa');
  const socio = await cuentaNueva('sociojuega');

  const unirse = await socio.agente.post('/api/quinielas/unirse')
    .send({ codigoIngreso: jefa.quiniela.codigoIngreso });
  assert.equal(unirse.status, 202);

  const miembros = await jefa.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.username === socio.datos.username);
  await jefa.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});

  await jefa.agente.post('/api/jornadas')
    .send({ nombre: 'J1', partidos: [partido('A', 'B')] });

  await socio.agente.post(`/api/quinielas/${jefa.quiniela.id}/seleccionar`).send({});
  const pronostico = await socio.agente.post('/api/resultados').send({
    jugador: socio.datos.username, jornada: 'J1',
    pronosticos: [{ marcador1: 2, marcador2: 1 }]
  });
  assert.equal(pronostico.status, 200, JSON.stringify(pronostico.body));

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    // Sin confirmar la desvinculación, se rechaza y explica.
    const primero = await jefe.agente
      .delete(`/api/superadmin/cuentas/${socio.usuarioId}`).send({ motivo: 'se fue del grupo' });

    assert.equal(primero.status, 409);
    assert.match(primero.body.error, /desvincular/i);

    // Confirmando, se borra la cuenta y el juego se queda.
    const segundo = await jefe.agente
      .delete(`/api/superadmin/cuentas/${socio.usuarioId}`)
      .send({ motivo: 'se fue del grupo', desvincularJugadores: true });

    assert.equal(segundo.status, 200, JSON.stringify(segundo.body));
    assert.equal(segundo.body.jugadoresDesvinculados, 1);
  });

  /*
   * ⛔ Lo que de verdad se está probando: el pronóstico SIGUE AHÍ. Borrar una
   * cuenta no puede reescribir la historia de una quiniela ajena.
   */
  const quedan = await jefa.agente.get(`/api/resultados/${socio.datos.username}/J1`);
  assert.equal(quedan.status, 200);
  assert.equal(quedan.body[0].marcador1, 2, 'el pronóstico no puede desaparecer');
});

test('⛔ el registro sobrevive al borrado de la cuenta que registra', async () => {
  const jefe = await cuentaNueva('mando8');
  const efimera = await cuentaNueva('efimera');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const borrada = await jefe.agente
      .delete(`/api/superadmin/cuentas/${efimera.usuarioId}`)
      .send({ motivo: 'cuenta de prueba' });
    assert.equal(borrada.status, 200, JSON.stringify(borrada.body));

    const historial = await jefe.agente.get('/api/superadmin/acciones');
    assert.equal(historial.status, 200);

    const asiento = historial.body.find(a => a.objetivoEmail === efimera.datos.email);

    /*
     * Ésta es la prueba de que `objetivo_usuario_id` no tiene clave ajena. Con
     * `ON DELETE CASCADE`, borrar la cuenta se habría llevado el registro de
     * que la borraste —el único caso en que hace falta de verdad— y este
     * `assert.ok` fallaría.
     */
    assert.ok(asiento, 'el asiento tiene que sobrevivir a la cuenta que registra');
    assert.equal(asiento.accion, 'borrar');
    assert.equal(asiento.motivo, 'cuenta de prueba');
    assert.equal(asiento.objetivoUsername, efimera.datos.username);
    assert.equal(asiento.objetivoExiste, false, 'y sabe que esa cuenta ya no está');
  });
});

test('⚠️ el filtro de cuentas sin confirmar cuenta sobre TODAS, no sobre la página', async () => {
  const jefe = await cuentaNueva('mando9');

  /*
   * Una cuenta registrada y SIN confirmar. `cuentaNueva` confirma siempre, así
   * que ésta se registra a pelo: es justo el estado que el filtro busca.
   */
  const sinConfirmar = credenciales('pendiente');
  const alta = await request(app).post('/api/auth/registro').send(sinConfirmar);
  assert.equal(alta.status, 201, JSON.stringify(alta.body));

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const todas = await jefe.agente.get('/api/superadmin/cuentas');
    assert.equal(todas.status, 200);

    /*
     * ⚠️ Los conteos salen SIN el filtro puesto, para que los rótulos de los
     * botones digan cuántas hay de cada clase. Si se calcularan sobre lo
     * filtrado, el botón «Sin confirmar» diría 0 estando dentro de ese filtro.
     */
    assert.ok(todas.body.conteos, 'la respuesta tiene que traer los conteos');
    assert.equal(todas.body.conteos.sin_confirmar, 1);
    assert.ok(todas.body.conteos.todas >= 2);

    const filtradas = await jefe.agente.get('/api/superadmin/cuentas?filtro=sin_confirmar');
    assert.equal(filtradas.status, 200);

    assert.deepEqual(
      filtradas.body.cuentas.map(c => c.email), [sinConfirmar.email],
      'sólo la que no ha confirmado');

    // Y los conteos NO cambian por estar filtrando.
    assert.equal(filtradas.body.conteos.todas, todas.body.conteos.todas);

    // Un filtro inventado no rompe: devuelve todas.
    const raro = await jefe.agente.get('/api/superadmin/cuentas?filtro=loquesea');
    assert.equal(raro.status, 200);
    assert.equal(raro.body.cuentas.length, todas.body.cuentas.length);
  });
});

test('el filtro de desactivadas enseña justo las que se retiraron', async () => {
  const jefe = await cuentaNueva('mando10');
  const victima = await cuentaNueva('retirada');

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    const antes = await jefe.agente.get('/api/superadmin/cuentas?filtro=desactivadas');
    assert.equal(antes.body.cuentas.length, 0, 'todavía no hay ninguna desactivada');

    await jefe.agente.post(`/api/superadmin/cuentas/${victima.usuarioId}/desactivar`)
      .send({ motivo: 'probando el filtro' });

    const despues = await jefe.agente.get('/api/superadmin/cuentas?filtro=desactivadas');
    assert.deepEqual(despues.body.cuentas.map(c => c.email), [victima.datos.email]);
    assert.equal(despues.body.conteos.desactivadas, 1);
  });
});

test('⚠️ dar un correo por bueno a mano lo deja confirmado y con su rastro', async () => {
  const jefe = await cuentaNueva('mando11');

  const pendiente = credenciales('sinabrir');
  const alta = await request(app).post('/api/auth/registro').send(pendiente);
  assert.equal(alta.status, 201, JSON.stringify(alta.body));
  const pendienteId = alta.body.usuario.id;

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    // Sin confirmar, no puede entrar. Es el punto de partida.
    const antes = await request(app).post('/api/auth/login')
      .send({ identificador: pendiente.username, password: pendiente.password });
    assert.equal(antes.status, 403, 'sin confirmar no se entra');

    const r = await jefe.agente.post(`/api/superadmin/cuentas/${pendienteId}/verificar`)
      .send({ motivo: 'el correo le caia en spam' });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    /*
     * ⛔ Lo que de verdad importa: ahora SÍ puede entrar. Sin esta comprobación,
     * la prueba diría que el campo cambió sin decir si sirvió de algo.
     */
    const despues = await request(app).post('/api/auth/login')
      .send({ identificador: pendiente.username, password: pendiente.password });
    assert.equal(despues.status, 200, 'tras darlo por bueno tiene que poder entrar');

    // Y queda marcado como verificado A MANO, no como uno cualquiera.
    const lista = await jefe.agente.get('/api/superadmin/cuentas');
    const ficha = lista.body.cuentas.find(c => c.id === pendienteId);

    assert.equal(ficha.emailVerificado, true);
    assert.ok(ficha.verificadaAMano, 'tiene que distinguirse de una confirmada por su dueño');
    assert.equal(ficha.verificadaAMano.motivo, 'el correo le caia en spam');
    assert.equal(ficha.verificadaAMano.porQuien, jefe.datos.email);

    // La cuenta del jefe, que confirmó ella sola, no lleva esa marca.
    const suya = lista.body.cuentas.find(c => c.id === jefe.usuarioId);
    assert.equal(suya.verificadaAMano, null);

    // Repetirlo no tiene sentido y se dice.
    const otraVez = await jefe.agente.post(`/api/superadmin/cuentas/${pendienteId}/verificar`)
      .send({ motivo: 'otra vez' });
    assert.equal(otraVez.status, 409);
  });
});

test('una cuenta desactivada no se puede dar por confirmada a medias', async () => {
  const jefe = await cuentaNueva('mando12');

  const pendiente = credenciales('apagada');
  const alta = await request(app).post('/api/auth/registro').send(pendiente);
  const pendienteId = alta.body.usuario.id;

  await conSuperadmins(jefe.datos.email, async () => {
    await confirmarPoder(jefe);

    await jefe.agente.post(`/api/superadmin/cuentas/${pendienteId}/desactivar`)
      .send({ motivo: 'la apago para probar' });

    /*
     * `marcarVerificado` sólo actúa sobre cuentas activas: sobre una
     * desactivada no tocaría nada y devolvería silencio. Se rechaza diciendo
     * qué hacer, en vez de responder que sí sin haber hecho nada.
     */
    const r = await jefe.agente.post(`/api/superadmin/cuentas/${pendienteId}/verificar`)
      .send({ motivo: 'probando' });

    assert.equal(r.status, 409);
    assert.match(r.body.error, /reactívala primero/i);

    const lista = await jefe.agente.get('/api/superadmin/cuentas');
    const ficha = lista.body.cuentas.find(c => c.id === pendienteId);
    assert.equal(ficha.emailVerificado, false, 'no se tocó nada');
  });
});

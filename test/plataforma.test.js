/*
 * Las tres piezas de plataforma sobre PostgreSQL: cuentas, quinielas y
 * membresías (tajada 2 de la migración).
 *
 * Se prueban los MÓDULOS, no las rutas: son las reglas de negocio portadas de
 * `server.js`, y aquí se pueden comprobar sin levantar Express ni sesiones.
 * Las rutas se prueban después, cuando la tajada las enganche.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielas = require('../src/quinielas');
const membresias = require('../src/membresias');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

let n = 0;
function credenciales(prefijo = 'user') {
  n += 1;
  return {
    username: `${prefijo}${n}`,
    email: `${prefijo}${n}@ejemplo.com`,
    password: 'contrasena-larga-1',
    confirmarPassword: 'contrasena-larga-1'
  };
}

const cuentaNueva = async prefijo => usuarios.crear(credenciales(prefijo));

/* ==================== Cuentas ==================== */

test('el registro exige lo que exigía antes', () => {
  const base = credenciales();
  assert.match(usuarios.validarRegistro({ ...base, username: '' }), /obligatorios/);
  assert.match(usuarios.validarRegistro({ ...base, username: 'ab' }), /entre 3 y 30/);
  assert.match(usuarios.validarRegistro({ ...base, username: 'con espacio' }), /entre 3 y 30/);
  assert.match(usuarios.validarRegistro({ ...base, email: 'no-es-correo' }), /no es válido/);
  assert.match(usuarios.validarRegistro({ ...base, password: 'corta', confirmarPassword: 'corta' }), /8 caracteres/);
  assert.match(usuarios.validarRegistro({ ...base, confirmarPassword: 'otra-cosa-larga' }), /no coinciden/);
  assert.equal(usuarios.validarRegistro(base), null);
});

test('dos cuentas no pueden diferenciarse sólo por mayúsculas o espacios', async () => {
  await usuarios.crear({ username: 'Marco', email: 'Marco@Ejemplo.com', password: 'contrasena-larga-1' });

  const uso = await usuarios.enUso(
    usuarios.normalizarIdentidad('  marco  '),
    usuarios.normalizarIdentidad(' MARCO@ejemplo.COM '));

  assert.equal(uso.username, true);
  assert.equal(uso.email, true);
});

test('la base rechaza el duplicado aunque la comprobación previa no lo viera', async () => {
  await usuarios.crear({ username: 'repetido', email: 'r@x.com', password: 'contrasena-larga-1' });
  await assert.rejects(
    () => usuarios.crear({ username: 'REPETIDO', email: 'otro@x.com', password: 'contrasena-larga-1' }),
    e => e.duplicado === true);
});

test('se entra con el nombre o con el correo, y la contraseña se comprueba', async () => {
  const datos = credenciales('ana');
  await usuarios.crear(datos);

  assert.ok(await usuarios.autenticar(datos.username, datos.password));
  assert.ok(await usuarios.autenticar(datos.email.toUpperCase(), datos.password));
  assert.equal(await usuarios.autenticar(datos.username, 'otra-contrasena'), null);
  assert.equal(await usuarios.autenticar('no-existe', datos.password), null);
});

test('la contraseña nunca sale de la capa de datos', async () => {
  const datos = credenciales('secreta');
  await usuarios.crear(datos);

  const autenticado = await usuarios.autenticar(datos.username, datos.password);
  assert.equal(autenticado.password, undefined);
  assert.equal(usuarios.publico(autenticado).password, undefined);
});

test('una cuenta inactiva no puede entrar', async () => {
  const datos = credenciales('inactiva');
  const u = await usuarios.crear(datos);
  await db.consulta('UPDATE usuarios SET activo = false WHERE id = $1', [u.id]);

  assert.equal(await usuarios.autenticar(datos.username, datos.password), null);
});

/* ==================== Quinielas ==================== */

test('crear una quiniela deja dentro a su propietario', async () => {
  const u = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'La Quiniela', propietarioId: u.id });

  const m = await membresias.de(q.id, u.id);
  assert.equal(m.rol, 'propietario');
  assert.equal(m.estado, 'activo');
});

test('el nombre de la quiniela se valida', () => {
  assert.match(quinielas.validarNombre('ab'), /entre 3 y 80/);
  assert.match(quinielas.validarNombre('x'.repeat(81)), /entre 3 y 80/);
  assert.equal(quinielas.validarNombre('Quiniela del barrio'), null);
});

test('el código de ingreso encuentra la quiniela, y sólo si está activa', async () => {
  const u = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'Buscable', propietarioId: u.id });

  const encontrada = await quinielas.porCodigo(q.codigo_ingreso.toLowerCase());
  assert.equal(encontrada.id, q.id);

  await quinielas.cambiarEstado(q.id, 'archivada');
  assert.equal(await quinielas.porCodigo(q.codigo_ingreso), null);
});

test('el código de ingreso sólo se enseña a quien puede repartirlo', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Con codigo', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const pendiente = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, pendiente.id);

  const [comoDueno] = await quinielas.deUsuario(dueno.id);
  const [comoMiembro] = await quinielas.deUsuario(otro.id);

  assert.equal(comoDueno.codigo_ingreso, q.codigo_ingreso);
  assert.equal(comoMiembro.codigo_ingreso, null, 'un miembro normal no debe poder invitar');
});

test('las quinielas eliminadas no salen en la lista', async () => {
  const u = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'Se elimina', propietarioId: u.id });

  assert.equal((await quinielas.deUsuario(u.id)).length, 1);
  await quinielas.cambiarEstado(q.id, 'eliminada');
  assert.equal((await quinielas.deUsuario(u.id)).length, 0);
});

test('la configuración se funde, no se sustituye', async () => {
  const u = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'Config', propietarioId: u.id });

  await quinielas.actualizarConfiguracion(q.id, { incluirExpulsadosEnRanking: false });
  const despues = await quinielas.porId(q.id);

  assert.equal(despues.configuracion.incluirExpulsadosEnRanking, false);
  assert.equal(despues.configuracion.puntuacion.marcadorExacto, 5,
    'la puntuación no se pidió cambiar y debería seguir ahí');
});

/* ==================== Membresías ==================== */

test('unirse deja pendiente, no da acceso', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Cerrada', propietarioId: dueno.id });

  const r = await membresias.solicitarIngreso(q.id, otro.id);
  assert.equal(r.ok, true);

  const m = await membresias.de(q.id, otro.id);
  assert.equal(m.estado, 'pendiente_ingreso');
});

test('no se puede pedir entrar dos veces, ni estando ya dentro', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Una vez', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  assert.equal((await membresias.solicitarIngreso(q.id, otro.id)).motivo, 'ya_pendiente');

  const m = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);
  assert.equal((await membresias.solicitarIngreso(q.id, otro.id)).motivo, 'ya_dentro');
});

test('aprobar a un miembro le crea su jugador dentro de la quiniela', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('jugador');
  const q = await quinielas.crear({ nombre: 'Con jugadores', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  const r = await membresias.aprobarIngreso(q.id, m.id);
  assert.equal(r.ok, true);

  const nombres = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT nombre FROM jugadores');
    return rows.map(f => f.nombre);
  });
  assert.deepEqual(nombres, [otro.username]);
});

test('aprobar dos veces no duplica el jugador', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('jugador');
  const q = await quinielas.crear({ nombre: 'Sin duplicados', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);

  // La segunda no encuentra solicitud pendiente, y no rompe nada.
  assert.equal((await membresias.aprobarIngreso(q.id, m.id)).motivo, 'no_encontrada');

  const total = await db.enQuiniela(q.id, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM jugadores');
    return rows[0].n;
  });
  assert.equal(total, 1);
});

test('rechazar un ingreso lo marca rechazado; rechazar un retiro lo devuelve a activo', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Rechazos', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  assert.equal((await membresias.rechazar(q.id, m.id)).membresia.estado, 'rechazado');

  await membresias.solicitarIngreso(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);
  await membresias.solicitarRetiro(q.id, otro.id);
  assert.equal((await membresias.rechazar(q.id, m.id)).membresia.estado, 'activo');
});

test('la quiniela no puede quedarse sin administrador', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Con admin', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);
  await membresias.cambiarRol(q.id, m.id, 'admin');

  // Queda el propietario además de este admin: degradarlo sí se puede.
  assert.equal((await membresias.cambiarRol(q.id, m.id, 'user')).ok, true);
});

test('el rol del propietario no se cambia a mano', async () => {
  const dueno = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'Propiedad', propietarioId: dueno.id });
  const m = await membresias.de(q.id, dueno.id);

  assert.equal((await membresias.cambiarRol(q.id, m.id, 'admin')).motivo, 'es_propietario');
});

test('el propietario no puede irse sin transferir antes', async () => {
  const dueno = await cuentaNueva('dueno');
  const q = await quinielas.crear({ nombre: 'No se va', propietarioId: dueno.id });

  assert.equal((await membresias.solicitarRetiro(q.id, dueno.id)).motivo, 'es_propietario');
});

test('nadie puede expulsarse a sí mismo', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Autoexpulsion', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);

  assert.equal((await membresias.expulsar(q.id, m.id, otro.id)).motivo, 'uno_mismo');
  assert.equal((await membresias.expulsar(q.id, m.id, dueno.id)).ok, true);
});

test('transferir la propiedad deja un solo propietario', async () => {
  const dueno = await cuentaNueva('dueno');
  const relevo = await cuentaNueva('relevo');
  const q = await quinielas.crear({ nombre: 'Relevo', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, relevo.id);
  const m = await membresias.de(q.id, relevo.id);
  await membresias.aprobarIngreso(q.id, m.id);
  await membresias.cambiarRol(q.id, m.id, 'admin');

  const r = await membresias.transferirPropiedad(q.id, dueno.id, relevo.id);
  assert.equal(r.ok, true);

  assert.equal((await membresias.de(q.id, relevo.id)).rol, 'propietario');
  assert.equal((await membresias.de(q.id, dueno.id)).rol, 'admin');
  assert.equal((await quinielas.porId(q.id)).propietario_id, relevo.id);

  const { rows: [{ n }] } = await db.consulta(
    `SELECT count(*)::int AS n FROM membresias WHERE quiniela_id = $1 AND rol = 'propietario'`, [q.id]);
  assert.equal(n, 1);
});

test('sólo un administrador activo puede recibir la propiedad', async () => {
  const dueno = await cuentaNueva('dueno');
  const otro = await cuentaNueva('otro');
  const q = await quinielas.crear({ nombre: 'Sin relevo', propietarioId: dueno.id });

  await membresias.solicitarIngreso(q.id, otro.id);
  const m = await membresias.de(q.id, otro.id);
  await membresias.aprobarIngreso(q.id, m.id);   // queda como 'user', no admin

  assert.equal((await membresias.transferirPropiedad(q.id, dueno.id, otro.id)).motivo, 'destino_invalido');
});

/* ==================== Aislamiento entre quinielas ==================== */

test('los jugadores de dos quinielas no se mezclan aunque el usuario esté en las dos', async () => {
  const dueno = await cuentaNueva('dueno');
  const doble = await cuentaNueva('doble');
  const qa = await quinielas.crear({ nombre: 'Quiniela A', propietarioId: dueno.id });
  const qb = await quinielas.crear({ nombre: 'Quiniela B', propietarioId: dueno.id });

  for (const q of [qa, qb]) {
    await membresias.solicitarIngreso(q.id, doble.id);
    const m = await membresias.de(q.id, doble.id);
    await membresias.aprobarIngreso(q.id, m.id);
  }

  const enA = await db.enQuiniela(qa.id, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM jugadores');
    return rows[0].n;
  });

  // El propietario no es jugador hasta que juega; el doble sí, una vez por quiniela.
  assert.equal(enA, 1, 'cada quiniela ve un solo jugador, el suyo');
});

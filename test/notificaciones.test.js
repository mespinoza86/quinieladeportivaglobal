/*
 * Las notificaciones al teléfono: la ventana, la memoria y a quién le llegan.
 *
 * ⚠️ Nada de esto sale a la red. El envío se inyecta (`enviar`), igual que el
 * correo en la suite de compartir: lo que se prueba es QUÉ se manda y A QUIÉN,
 * no que el servicio de push funcione.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const usuarios = require('../src/usuarios');
const quinielasMod = require('../src/quinielas');
const membresias = require('../src/membresias');
const jornadas = require('../src/jornadas');
const notificaciones = require('../src/notificaciones');
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

async function quinielaNueva() {
  const u = await cuentaNueva('duena');
  const q = await quinielasMod.crear({ nombre: `Q-${n}`, propietarioId: u.id });
  return { quiniela: q, dueno: u };
}

const partido = (equipo1, equipo2, apiDate) => ({
  equipo1, equipo2, logoEquipo1: '', logoEquipo2: '', comodin: false,
  apiFixtureId: null, apiLeagueId: null, apiDate, apiStatus: null
});

/** Una suscripción de mentira, con endpoint distinto en cada llamada. */
let e = 0;
function suscripcionDe() {
  e += 1;
  return {
    endpoint: `https://push.ejemplo.com/${e}`,
    keys: { p256dh: `clave-publica-${e}`, auth: `secreto-${e}` },
    userAgent: 'Pruebas'
  };
}

/* ==================== La ventana ==================== */

test('⛔ entra lo que arranca DENTRO de los 15 minutos, y nada más', async () => {
  const { quiniela } = await quinielaNueva();

  /* Las 14:50 en Costa Rica = 20:50 UTC. */
  const ahora = new Date('2026-09-20T20:50:00Z');

  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Dentro', 'X', '2026-09-20 15:00'),   // faltan 10 min  → sí
    partido('Justo', 'X', '2026-09-20 15:05'),    // faltan 15 min  → sí (el borde)
    partido('Lejos', 'X', '2026-09-20 15:30'),    // faltan 40 min  → no
    partido('Yaarranco', 'X', '2026-09-20 14:45') // arrancó hace 5 → no
  ]);

  const grupos = await notificaciones.paraNotificar(quiniela.id, { ahora });
  const equipos = grupos.flatMap(g => g.partidos.map(p => p.equipo1)).sort();

  assert.deepEqual(equipos, ['Dentro', 'Justo']);
});

test('⛔ un partido que YA arrancó no avisa nunca — «callarse»', async () => {
  /*
   * La decisión de Marco del 14 de septiembre. Si el servicio estuvo caído una
   * hora, esos partidos NO avisan al volver: su pronóstico ya está cerrado y
   * «arranca en 15 minutos» sobre algo que lleva media hora jugándose sólo
   * genera desconfianza.
   *
   * Lo garantiza el `>` estricto de la propia consulta, no una comprobación
   * aparte que pudiera discrepar.
   */
  const { quiniela } = await quinielaNueva();

  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);

  /* Una hora tarde: el reloj estuvo parado. */
  const tarde = new Date('2026-09-20T22:00:00Z');   // 16:00 en Costa Rica
  assert.deepEqual(await notificaciones.paraNotificar(quiniela.id, { ahora: tarde }), []);
});

test('⛔ el partido que arranca EN ESTE MINUTO no avisa', async () => {
  /*
   * El borde exacto, y el único sitio donde `>` y `>=` se diferencian. Con
   * `>=` se le mandaría «arranca en 15 minutos» a alguien mientras el árbitro
   * pita el inicio: el pronóstico ya está cerrado y el aviso llega a burlarse.
   *
   * ⚠️ Esta prueba nació de una mutación que NO cayó. Las otras cuatro de la
   * ventana usaban partidos a 5, 10, 15 y 40 minutos, y ninguna toca el minuto
   * cero: el cambio de operador pasaba entero sin que nada se quejara.
   */
  const { quiniela } = await quinielaNueva();

  const ahora = new Date('2026-09-20T21:00:00Z');   // 15:00 clavadas en Costa Rica
  await jornadas.guardar(quiniela.id, 'J1', [partido('Ahora', 'X', '2026-09-20 15:00')]);

  assert.deepEqual(await notificaciones.paraNotificar(quiniela.id, { ahora }), [],
    'arrancando ahora mismo: ya es tarde para avisar');
});

test('⛔ la ventana NO se mueve con el huso del servidor', async () => {
  /*
   * El fallo exacto de la Entrada 086, que se coló escribiendo la primera
   * versión de `comoApiDate`: dar formato en la zona del SERVIDOR. Render corre
   * en UTC y `api_date` está en hora de Costa Rica, así que la ventana se
   * desplazaba SEIS HORAS sin dar ningún error.
   *
   * La prueba fija TZ a dos zonas distintas y exige el mismo resultado.
   */
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);

  const ahora = new Date('2026-09-20T20:50:00Z');   // 14:50 en Costa Rica
  const original = process.env.TZ;

  try {
    for (const zona of ['UTC', 'America/Costa_Rica', 'Asia/Tokyo']) {
      process.env.TZ = zona;
      const grupos = await notificaciones.paraNotificar(quiniela.id, { ahora });
      assert.equal(grupos.length, 1, `con TZ=${zona} deberia entrar el partido`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('un partido sin hora prevista no entra', async () => {
  /* Sin hora no hay «quince minutos antes»: no es un descuido, es que la
     pregunta no tiene respuesta para ese partido. */
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '')]);

  const grupos = await notificaciones.paraNotificar(quiniela.id,
    { ahora: new Date('2026-09-20T20:50:00Z') });

  assert.deepEqual(grupos, []);
});

test('los que arrancan a la misma hora van en UN grupo', async () => {
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [
    partido('A', 'B', '2026-09-20 15:00'),
    partido('C', 'D', '2026-09-20 15:00'),
    partido('E', 'F', '2026-09-20 15:03')
  ]);

  const grupos = await notificaciones.paraNotificar(quiniela.id,
    { ahora: new Date('2026-09-20T20:50:00Z') });

  assert.equal(grupos.length, 2, 'dos horas de arranque, dos grupos');
  assert.equal(grupos.find(g => g.apiDate === '2026-09-20 15:00').partidos.length, 2);
});

/* ==================== La memoria ==================== */

test('⛔ un partido ya notificado no vuelve a salir', async () => {
  /*
   * El reloj corre cada minuto y la ventana dura quince: sin esta marca, el
   * mismo partido avisaría QUINCE veces.
   */
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);

  const ahora = new Date('2026-09-20T20:50:00Z');

  const primera = await notificaciones.paraNotificar(quiniela.id, { ahora });
  assert.equal(primera.length, 1);

  await notificaciones.marcarNotificados(quiniela.id, primera[0].partidos.map(p => p.id));

  const segunda = await notificaciones.paraNotificar(quiniela.id, { ahora });
  assert.deepEqual(segunda, [], 'ya avisó: no se repite');
});

/* ==================== Las suscripciones ==================== */

test('⛔ suscribirse dos veces con el mismo navegador deja UNA fila', async () => {
  /*
   * El navegador reutiliza su endpoint si no te has dado de baja. Sin el
   * `ON CONFLICT`, pulsar «activar» dos veces mandaría DOS notificaciones del
   * mismo partido al mismo teléfono.
   */
  const u = await cuentaNueva();
  const s = suscripcionDe();

  await notificaciones.suscribir(u.id, s);
  await notificaciones.suscribir(u.id, s);

  assert.equal(await notificaciones.cuantasTiene(u.id), 1);
});

test('⛔ si otra persona entra en el mismo móvil, la suscripción cambia de dueño', async () => {
  /*
   * Y NO se duplica ni se ignora: el endpoint pertenece al navegador. Si al
   * chocar se ignorara, los avisos de ese teléfono seguirían siendo de quien ya
   * no lo usa — y esa persona recibiría los partidos de una quiniela ajena.
   */
  const ana = await cuentaNueva('ana');
  const beto = await cuentaNueva('beto');
  const mismoMovil = suscripcionDe();

  await notificaciones.suscribir(ana.id, mismoMovil);
  await notificaciones.suscribir(beto.id, mismoMovil);

  assert.equal(await notificaciones.cuantasTiene(ana.id), 0, 'ya no es de Ana');
  assert.equal(await notificaciones.cuantasTiene(beto.id), 1, 'ahora es de Beto');
});

test('una suscripción incompleta se rechaza en vez de guardarse a medias', async () => {
  const u = await cuentaNueva();

  assert.equal((await notificaciones.suscribir(u.id, {})).ok, false);
  assert.equal((await notificaciones.suscribir(u.id,
    { endpoint: 'https://x', keys: { p256dh: 'a' } })).ok, false, 'falta auth');
  assert.equal(await notificaciones.cuantasTiene(u.id), 0);
});

test('apagar los avisos borra la fila', async () => {
  const u = await cuentaNueva();
  const s = suscripcionDe();

  await notificaciones.suscribir(u.id, s);
  await notificaciones.desuscribir(s.endpoint);

  assert.equal(await notificaciones.cuantasTiene(u.id), 0);
});

/* ==================== A quién le llega ==================== */

test('⛔ sólo reciben los miembros ACTIVOS de esa quiniela', async () => {
  /*
   * `suscripciones_push` y `membresias` no llevan RLS: el filtro por quiniela va
   * escrito en el WHERE. Si se olvidara, los avisos de una quiniela llegarían a
   * gente de otra — que es la fuga C-02 con otra ropa.
   */
  const { quiniela, dueno } = await quinielaNueva();
  const otra = await quinielaNueva();

  const miembro = await cuentaNueva('miembro');
  const pendiente = await cuentaNueva('pendiente');
  const ajeno = await cuentaNueva('ajeno');

  await membresias.solicitarIngreso(quiniela.id, miembro.id);
  const suyas = await membresias.de(quiniela.id, miembro.id);
  await membresias.cambiarRol(quiniela.id, suyas.id, 'user');
  await db.consulta(`UPDATE membresias SET estado='activo' WHERE id = $1`, [suyas.id]);

  await membresias.solicitarIngreso(quiniela.id, pendiente.id);   // se queda pendiente
  await membresias.solicitarIngreso(otra.quiniela.id, ajeno.id);

  for (const u of [dueno, miembro, pendiente, ajeno]) {
    await notificaciones.suscribir(u.id, suscripcionDe());
  }

  const destinatarios = await notificaciones.destinatariosDe(quiniela.id);
  const ids = destinatarios.map(d => d.usuarioId).sort();

  assert.deepEqual(ids, [dueno.id, miembro.id].sort(),
    'el pendiente y el de otra quiniela NO reciben');
});

/* ==================== El barrido ==================== */

test('⛔ se marca DESPUÉS de enviar, y sólo si alguno salió', async () => {
  /*
   * Marcar antes deja a todo el mundo sin aviso y sin rastro de que debió
   * haberlo: el partido quedaría notificado para siempre. Misma regla que el
   * correo (Entrada 086).
   */
  const { quiniela, dueno } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);
  await notificaciones.suscribir(dueno.id, suscripcionDe());

  const ahora = new Date('2026-09-20T20:50:00Z');

  /* Primer intento: todo falla. */
  await notificaciones.notificarDeTodas({
    ahora, enviar: async () => { throw new Error('la red se cayó'); }
  });

  const siguen = await notificaciones.paraNotificar(quiniela.id, { ahora });
  assert.equal(siguen.length, 1, 'si no salió nada, el partido sigue pendiente');

  /* Segundo intento: ahora sí. */
  const r = await notificaciones.notificarDeTodas({ ahora, enviar: async () => ({ ok: true }) });
  assert.equal(r.notificaciones, 1);

  assert.deepEqual(await notificaciones.paraNotificar(quiniela.id, { ahora }), [],
    'ahora sí queda marcado');
});

test('una suscripción muerta se borra sola', async () => {
  /*
   * Un 404/410 del servicio significa que ese navegador ya no existe. Sin
   * borrarla, se le escribe en cada partido para siempre y cada intento cuesta
   * una petición de red.
   */
  const { quiniela, dueno } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);
  await notificaciones.suscribir(dueno.id, suscripcionDe());

  const r = await notificaciones.notificarDeTodas({
    ahora: new Date('2026-09-20T20:50:00Z'),
    enviar: async () => ({ ok: false, muerta: true })
  });

  assert.equal(r.muertas, 1);
  assert.equal(await notificaciones.cuantasTiene(dueno.id), 0, 'se quitó de la tabla');
});

test('el mensaje dice los equipos si es uno, y cuántos si son varios', async () => {
  const { quiniela, dueno } = await quinielaNueva();
  await notificaciones.suscribir(dueno.id, suscripcionDe());

  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Saprissa', 'Alajuelense', '2026-09-20 15:00'),
    partido('Cartago', 'Herediano', '2026-09-20 16:00'),
    partido('Otro', 'Mas', '2026-09-20 16:00')
  ]);

  const mensajes = [];
  await notificaciones.notificarDeTodas({
    ahora: new Date('2026-09-20T20:50:00Z'),
    antelacionMinutos: 90,
    enviar: async ({ mensaje }) => { mensajes.push(mensaje.titulo); return { ok: true }; }
  });

  assert.ok(mensajes.some(t => /Saprissa vs Alajuelense/.test(t)), mensajes.join(' | '));
  assert.ok(mensajes.some(t => /^2 partidos/.test(t)), mensajes.join(' | '));
});

test('una quiniela archivada no notifica', async () => {
  const { quiniela, dueno } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);
  await notificaciones.suscribir(dueno.id, suscripcionDe());
  await quinielasMod.cambiarEstado(quiniela.id, 'archivada');

  const r = await notificaciones.notificarDeTodas({
    ahora: new Date('2026-09-20T20:50:00Z'), enviar: async () => ({ ok: true })
  });

  assert.equal(r.notificaciones, 0);
});

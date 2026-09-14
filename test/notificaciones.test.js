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

  const enVentana = await notificaciones.paraNotificar(quiniela.id, { ahora });

  assert.deepEqual(enVentana.map(p => p.equipo1).sort(), ['Dentro', 'Justo']);
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

test('⛔ el «primero» es el MÁS TEMPRANO, no el de orden 1', async () => {
  /*
   * Decide a quién se avisa: el primero va a todo el que no haya terminado,
   * los demás sólo a quien empezó y le falta ése. Si se mirara `orden` —que es
   * la posición en la pantalla y se puede reordenar—, una jornada reordenada
   * avisaría del partido equivocado y nadie lo notaría.
   */
  const { quiniela } = await quinielaNueva();

  /* El que va PRIMERO en la lista arranca DESPUÉS. */
  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Tarde', 'X', '2026-09-20 15:05'),
    partido('Temprano', 'X', '2026-09-20 15:00')
  ]);

  const enVentana = await notificaciones.paraNotificar(quiniela.id,
    { ahora: new Date('2026-09-20T20:50:00Z') });

  assert.equal(enVentana.find(p => p.equipo1 === 'Temprano').esPrimero, true);
  assert.equal(enVentana.find(p => p.equipo1 === 'Tarde').esPrimero, false);
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

  await notificaciones.marcarNotificados(quiniela.id, primera.map(p => p.id));

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

  /*
   * Se le pasan los CUATRO y tienen que volver dos: el filtro no lo pone
   * quien llama, lo pone la consulta.
   */
  const destinatarios = await notificaciones.suscripcionesDe(quiniela.id,
    [dueno.id, miembro.id, pendiente.id, ajeno.id]);
  const ids = destinatarios.map(d => d.usuarioId).sort();

  assert.deepEqual(ids, [dueno.id, miembro.id].sort(),
    'el pendiente y el de otra quiniela NO reciben');
});

/* ==================== El barrido, y a quién le sirve ==================== */

/*
 * ⭐ LA REGLA QUE SE PRUEBA AQUÍ, Y DE LA QUE SALE TODO LO DEMÁS
 *
 * «Una notificación sólo se manda si quien la recibe todavía puede cambiar
 * algo» (Marco, 14 de septiembre). Sustituyó a un botón de «no me avises más»
 * que habría necesitado acciones dentro de la notificación — algo que en iPhone
 * probablemente no se muestra, dejando sin salida justo a quien más pasos tuvo
 * que dar para recibirlas.
 *
 * El escenario de abajo es siempre el mismo y cubre los tres casos:
 *
 *   completo  llenó los dos partidos     → no debe recibir NADA
 *   medias    llenó sólo el primero      → recibe, y sólo de lo que le falta
 *   vacio     no llenó ninguno           → recibe los dos avisos de jornada, y para
 */

const jugadoresMod = require('../src/jugadores');
const pronosticosMod = require('../src/pronosticos');

/** Un jugador ligado a una cuenta que juega TODAS las jornadas. */
async function jugadorNuevo(quinielaId, usuarioId, nombre) {
  await db.enQuiniela(quinielaId, async c => {
    await jugadoresMod.asegurar(c, quinielaId, nombre, usuarioId);
    /*
     * ⚠️ `asegurar` pone `cobrar_desde` en la PRÓXIMA jornada —a quien llega no
     * se le cobran las ya jugadas—. Aquí se limpia a propósito: lo que se quiere
     * probar es el aviso, no esa regla, y dejar el dato implícito haría que
     * estas pruebas dependieran de ella sin decirlo.
     */
    await c.query('UPDATE jugadores SET cobrar_desde = NULL WHERE nombre = $1', [nombre]);
  });
}

/**
 * El escenario: una jornada de dos partidos y tres personas con el teléfono
 * activado, en los tres estados posibles de llenado.
 */
async function escenario({ ahora = new Date('2026-09-20T20:50:00Z') } = {}) {
  const { quiniela, dueno } = await quinielaNueva();

  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Primero', 'X', '2026-09-20 15:00'),
    partido('Segundo', 'Y', '2026-09-20 16:00')
  ]);

  const gente = {};
  for (const nombre of ['completo', 'medias', 'vacio']) {
    const cuenta = await cuentaNueva(nombre);
    await membresias.solicitarIngreso(quiniela.id, cuenta.id);
    const m = await membresias.de(quiniela.id, cuenta.id);
    await db.consulta(`UPDATE membresias SET estado='activo' WHERE id = $1`, [m.id]);
    await jugadorNuevo(quiniela.id, cuenta.id, nombre);
    await notificaciones.suscribir(cuenta.id, suscripcionDe());
    gente[nombre] = cuenta;
  }

  /* Un tiempo MUY anterior, para que los partidos no estén cerrados al llenar. */
  const antes = new Date('2026-09-20T10:00:00Z');

  await pronosticosMod.guardar(quiniela.id, {
    jugador: 'completo', usuarioId: gente.completo.id, jornada: 'J1', ahora: antes,
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 2 }]
  });
  await pronosticosMod.guardar(quiniela.id, {
    jugador: 'medias', usuarioId: gente.medias.id, jornada: 'J1', ahora: antes,
    pronosticos: [{ marcador1: 1, marcador2: 0 }]          // sólo el primero
  });
  /* `vacio` no llena nada. */

  return { quiniela, dueno, gente, ahora };
}

/** Corre el barrido y devuelve quién recibió qué. */
async function barrer(opciones = {}) {
  const recibidos = [];
  const r = await notificaciones.notificarDeTodas({
    enviar: async ({ destinatario, mensaje }) => {
      recibidos.push({ usuarioId: destinatario.usuarioId, titulo: mensaje.titulo, cuerpo: mensaje.cuerpo });
      return { ok: true };
    },
    ...opciones
  });
  return { recibidos, resultado: r };
}

const quienRecibio = (recibidos, gente) =>
  [...new Set(recibidos.map(x =>
    Object.keys(gente).find(n => gente[n].id === x.usuarioId)))].sort();

test('⛔ dos horas antes: avisa a quien le falta algo, y a nadie más', async () => {
  const { gente } = await escenario();

  /* Dos horas antes de las 15:00 = 13:00 en Costa Rica = 19:00 UTC. */
  const { recibidos } = await barrer({ ahora: new Date('2026-09-20T19:00:00Z') });

  assert.deepEqual(quienRecibio(recibidos, gente), ['medias', 'vacio']);
  assert.ok(recibidos.every(x => /arranca en 2 horas/.test(x.titulo)), 'el texto del aviso previo');
});

test('⛔ quien ya llenó TODO no recibe absolutamente nada', async () => {
  /*
   * La prueba insignia de la regla. Se recorren los tres momentos de la jornada
   * y en ninguno debe aparecer.
   */
  const { gente } = await escenario();
  const todos = [];

  for (const momento of ['2026-09-20T19:00:00Z',    // dos horas antes
                         '2026-09-20T20:50:00Z',    // 15 min del primero
                         '2026-09-20T21:50:00Z']) { // 15 min del segundo
    const { recibidos } = await barrer({ ahora: new Date(momento) });
    todos.push(...recibidos);
  }

  assert.equal(todos.filter(x => x.usuarioId === gente.completo.id).length, 0,
    'llenó todo: no hay nada que pueda cambiar, no se le escribe');
  assert.ok(todos.length > 0, 'control: a los otros SÍ se les avisó');
});

test('⛔ quince minutos antes del primero: a quien le falta algo, incluido quien no llenó nada', async () => {
  const { gente } = await escenario();

  /* Sólo la ventana de 15 min: el aviso previo ya no entra a esta hora. */
  const { recibidos } = await barrer({ ahora: new Date('2026-09-20T20:50:00Z') });

  assert.deepEqual(quienRecibio(recibidos, gente), ['medias', 'vacio']);
  assert.ok(recibidos.every(x => /arranca en 15 minutos/.test(x.titulo)));
});

test('⛔ los partidos siguientes: sólo a quien EMPEZÓ y le falta ése', async () => {
  /*
   * Aquí es donde `vacio` deja de recibir, y es el silencio que antes iba a
   * necesitar un botón: quien se sienta la jornada recibe dos avisos y se acabó,
   * en vez de catorce.
   */
  const { gente } = await escenario();

  /* Se despacha primero la ventana del primer partido, para no mezclar. */
  await barrer({ ahora: new Date('2026-09-20T20:50:00Z') });

  /* 15 min antes de las 16:00 = 15:45 en Costa Rica = 21:45 UTC. */
  const { recibidos } = await barrer({ ahora: new Date('2026-09-20T21:45:00Z') });

  assert.deepEqual(quienRecibio(recibidos, gente), ['medias'],
    'vacio no empezó la jornada; completo ya lo tiene pronosticado');
  assert.ok(/Segundo vs Y/.test(recibidos[0].titulo), recibidos[0].titulo);
});

test('el aviso de dos horas se manda UNA vez, aunque el reloj siga corriendo', async () => {
  const { gente } = await escenario();

  const primera = await barrer({ ahora: new Date('2026-09-20T19:00:00Z') });
  assert.equal(primera.resultado.previos, 1);

  /* Un minuto después, todavía dentro de la ventana de dos horas. */
  const segunda = await barrer({ ahora: new Date('2026-09-20T19:01:00Z') });
  assert.equal(segunda.resultado.previos, 0, 'no se repite');
  assert.equal(quienRecibio(segunda.recibidos, gente).length, 0);
});

test('⛔ si la jornada se crea con menos de dos horas de margen, el aviso previo NO sale', async () => {
  /*
   * La misma regla de «callarse» que en los quince minutos: un aviso que dice
   * «en dos horas» cuando falta una hora miente, y se nota.
   */
  const { gente } = await escenario();

  /* Una hora antes de las 15:00: la ventana de dos horas ya pasó. */
  const { recibidos, resultado } = await barrer({ ahora: new Date('2026-09-20T20:00:00Z') });

  assert.equal(resultado.previos, 0);
  assert.equal(quienRecibio(recibidos, gente).length, 0);
});

test('a quien le faltan dos partidos de la MISMA hora le llega UN aviso con los dos', async () => {
  const { quiniela, dueno } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Uno', 'A', '2026-09-20 14:00'),      // el primero, para «empezar» la jornada
    partido('Dos', 'B', '2026-09-20 16:00'),
    partido('Tres', 'C', '2026-09-20 16:00')
  ]);

  const cuenta = await cuentaNueva('rezagado');
  await membresias.solicitarIngreso(quiniela.id, cuenta.id);
  const m = await membresias.de(quiniela.id, cuenta.id);
  await db.consulta(`UPDATE membresias SET estado='activo' WHERE id = $1`, [m.id]);
  await jugadorNuevo(quiniela.id, cuenta.id, 'rezagado');
  await notificaciones.suscribir(cuenta.id, suscripcionDe());

  /* Llena sólo el primero: ha empezado la jornada y le faltan los dos de las 16:00. */
  await pronosticosMod.guardar(quiniela.id, {
    jugador: 'rezagado', usuarioId: cuenta.id, jornada: 'J1',
    ahora: new Date('2026-09-20T10:00:00Z'),
    pronosticos: [{ marcador1: 1, marcador2: 0 }]
  });

  /* 15 min antes de las 16:00. */
  const { recibidos } = await barrer({ ahora: new Date('2026-09-20T21:45:00Z') });
  const suyos = recibidos.filter(x => x.usuarioId === cuenta.id);

  assert.equal(suyos.length, 1, 'un solo aviso, no dos');
  assert.match(suyos[0].titulo, /^2 partidos/);
});

test('⛔ un partido se marca aunque no se avise a NADIE', async () => {
  /*
   * Si no, se volvería a mirar cada minuto de su ventana. Y lo peor: alguien que
   * borrase un pronóstico a falta de tres minutos recibiría un aviso cuando ya
   * no le da tiempo a nada.
   */
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [partido('A', 'B', '2026-09-20 15:00')]);

  const ahora = new Date('2026-09-20T20:50:00Z');
  await barrer({ ahora });                       // no hay jugadores: no se avisa a nadie

  assert.deepEqual(await notificaciones.paraNotificar(quiniela.id, { ahora }), [],
    'la ventana de ese partido queda cerrada igual');
});

test('⛔ se marca DESPUÉS de enviar, y sólo si alguno salió', async () => {
  /*
   * Marcar antes deja a todo el mundo sin aviso y la jornada marcada para
   * siempre. Misma regla que el correo (Entrada 086).
   */
  const { gente } = await escenario();
  const ahora = new Date('2026-09-20T19:00:00Z');

  await notificaciones.notificarDeTodas({
    ahora, enviar: async () => { throw new Error('la red se cayó'); }
  });

  const segunda = await barrer({ ahora });
  assert.equal(segunda.resultado.previos, 1, 'si no salió nada, el aviso sigue pendiente');
  assert.deepEqual(quienRecibio(segunda.recibidos, gente), ['medias', 'vacio']);
});

test('una suscripción muerta se borra sola', async () => {
  const { gente } = await escenario();

  const r = await notificaciones.notificarDeTodas({
    ahora: new Date('2026-09-20T19:00:00Z'),
    enviar: async () => ({ ok: false, muerta: true })
  });

  assert.ok(r.muertas >= 1);
  assert.equal(await notificaciones.cuantasTiene(gente.vacio.id), 0);
});

test('una quiniela archivada no notifica', async () => {
  const { quiniela, gente } = await escenario();
  await quinielasMod.cambiarEstado(quiniela.id, 'archivada');

  const { recibidos } = await barrer({ ahora: new Date('2026-09-20T19:00:00Z') });
  assert.equal(quienRecibio(recibidos, gente).length, 0);
});

test('⛔ quien llenó y luego lo BORRÓ todo cuenta como que no empezó', async () => {
  /*
   * ⚠️ Esta prueba nació de una mutación que no caía. Quitar el `EXISTS` que
   * comprueba «tiene algún pronóstico» no rompía nada, porque en el escenario
   * normal quien no llenó tampoco tiene fila en `resultados` y el `JOIN` ya lo
   * deja fuera.
   *
   * Pero hay un estado intermedio real: borrar un pronóstico elimina su fila de
   * `pronosticos` y **deja la de `resultados`**. Quien llena y luego lo borra
   * todo queda con la fila de la jornada y cero pronósticos.
   *
   * Sin el `EXISTS`, esa persona recibiría un aviso por CADA partido siguiente
   * — justo lo que se decidió no hacer con quien se sienta la jornada.
   */
  const { quiniela } = await quinielaNueva();
  await jornadas.guardar(quiniela.id, 'J1', [
    partido('Uno', 'A', '2026-09-20 15:00'),
    partido('Dos', 'B', '2026-09-20 16:00')
  ]);

  const cuenta = await cuentaNueva('arrepentido');
  await membresias.solicitarIngreso(quiniela.id, cuenta.id);
  const m = await membresias.de(quiniela.id, cuenta.id);
  await db.consulta(`UPDATE membresias SET estado='activo' WHERE id = $1`, [m.id]);
  await jugadorNuevo(quiniela.id, cuenta.id, 'arrepentido');
  await notificaciones.suscribir(cuenta.id, suscripcionDe());

  const antes = new Date('2026-09-20T10:00:00Z');

  /* Llena los dos… */
  await pronosticosMod.guardar(quiniela.id, {
    jugador: 'arrepentido', usuarioId: cuenta.id, jornada: 'J1', ahora: antes,
    pronosticos: [{ marcador1: 1, marcador2: 0 }, { marcador1: 2, marcador2: 2 }]
  });

  /* …y los borra: marcadores vacíos quitan la fila, pero `resultados` se queda. */
  await pronosticosMod.guardar(quiniela.id, {
    jugador: 'arrepentido', usuarioId: cuenta.id, jornada: 'J1', ahora: antes,
    pronosticos: [{ marcador1: '', marcador2: '' }, { marcador1: '', marcador2: '' }]
  });

  await db.enQuiniela(quiniela.id, async c => {
    const { rows: [n] } = await c.query(
      `SELECT (SELECT count(*)::int FROM resultados) AS resultados,
              (SELECT count(*)::int FROM pronosticos) AS pronosticos`);
    assert.equal(n.resultados, 1, 'la fila de la jornada sigue ahí');
    assert.equal(n.pronosticos, 0, 'y sin ningún pronóstico');
  });

  /* Se despacha la ventana del primero, que sí debe recibir. */
  const primera = await barrer({ ahora: new Date('2026-09-20T20:50:00Z') });
  assert.equal(primera.recibidos.filter(x => x.usuarioId === cuenta.id).length, 1,
    'del primero sí se le avisa: le falta todo');

  /* Y la del segundo, que NO. */
  const segunda = await barrer({ ahora: new Date('2026-09-20T21:45:00Z') });
  assert.equal(segunda.recibidos.filter(x => x.usuarioId === cuenta.id).length, 0,
    'no empezó la jornada: no se le persigue partido a partido');
});

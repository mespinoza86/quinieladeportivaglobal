'use strict';

/*
 * Pruebas de integración con MongoDB en memoria.
 *
 * A diferencia de architecture.test.js, que inspecciona el texto del código,
 * estas ejecutan el servidor de verdad: abren sesiones, escriben en la base y
 * comprueban lo que sale por HTTP.
 *
 * El entorno se prepara ANTES de importar server.js, porque ese módulo lee la
 * configuración al cargarse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let mongoEnMemoria;
let srv;

/* ================= Utilidades ================= */

let contador = 0;
function credencialesNuevas(prefijo = 'user') {
  contador += 1;
  return {
    username: `${prefijo}${contador}`,
    email: `${prefijo}${contador}@ejemplo.com`,
    password: 'contrasena-larga-1',
    confirmarPassword: 'contrasena-larga-1'
  };
}

/** Registra una cuenta y devuelve un agente con la sesión ya iniciada. */
async function cuentaNueva(prefijo) {
  const agente = request.agent(srv.app);
  const datos = credencialesNuevas(prefijo);
  const res = await agente.post('/api/auth/registro').send(datos);
  assert.equal(res.status, 201, `No se pudo registrar: ${JSON.stringify(res.body)}`);
  return { agente, datos, usuarioId: res.body.usuario?.id };
}

/** Crea una quiniela y la deja seleccionada como activa para ese agente. */
async function quinielaNueva(agente, nombre) {
  const creada = await agente.post('/api/quinielas').send({ nombre });
  assert.equal(creada.status, 201, `No se pudo crear la quiniela: ${JSON.stringify(creada.body)}`);
  // La ruta devuelve el documento de Mongoose completo, así que el campo es _id.
  const id = creada.body.quiniela._id;
  assert.ok(id, `La respuesta no trae el id: ${JSON.stringify(creada.body)}`);
  const sel = await agente.post(`/api/quinielas/${id}/seleccionar`).send({});
  assert.equal(sel.status, 200, `No se pudo seleccionar: ${JSON.stringify(sel.body)}`);
  return { id, codigo: creada.body.quiniela.codigoIngreso };
}

/**
 * Ejecuta una función dentro del contexto de inquilino de una quiniela.
 *
 * OJO con el `await` de dentro, que no es adorno. Las consultas de Mongoose son
 * perezosas: `Model.findOne()` construye la consulta pero no la ejecuta, y el
 * gancho `pre(/^find/)` que aplica el filtro por quiniela corre en la
 * EJECUCIÓN, no en la construcción.
 *
 * Si se escribiera `run(store, () => Model.findOne(...))`, el `run` devolvería
 * la consulta sin ejecutar y el `await` ocurriría ya fuera del contexto:
 * AsyncLocalStorage devolvería `undefined`, el filtro no se aplicaría y la
 * consulta vería los datos de TODAS las quinielas. Es decir, la prueba de
 * aislamiento fallaría por culpa de la prueba, no del código.
 *
 * Con el `await` dentro, la ejecución ocurre dentro del contexto.
 *
 * El código de producción no sufre esto porque el middleware envuelve `next()`
 * y los manejadores async empiezan a ejecutarse ya dentro del contexto.
 */
function enQuiniela(quinielaId, fn) {
  return srv.tenantContext.run({ quinielaId }, async () => await fn());
}

/* ================= Arranque y limpieza ================= */

test.before(async () => {
  /*
   * Conjunto de réplicas, no un mongod suelto: MongoDB solo admite
   * transacciones sobre un conjunto de réplicas, y sin esto las pruebas de
   * atomicidad se ejercitarían contra la rama de respaldo de enTransaccion()
   * en vez de contra las transacciones de verdad. Un nodo basta y arranca en
   * medio segundo.
   */
  mongoEnMemoria = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI_MULTIQUINIELA = mongoEnMemoria.getUri('quiniela_pruebas');
  process.env.SESSION_SECRET = 'secreto-solo-para-pruebas';
  process.env.APIFOOTBALL_COM_KEY = 'clave-falsa-no-se-usa';

  srv = require('../server.js');
  await srv.conectarMongoConReintentos();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoEnMemoria.stop();
});

/* ================================================================
 * C-02 — Aislamiento entre quinielas
 * ================================================================ */

test('C-02: dos quinielas con el mismo nombre de jornada no se contaminan', async () => {
  const { agente: agenteA } = await cuentaNueva('aisla_a');
  const { agente: agenteB } = await cuentaNueva('aisla_b');
  const quinielaA = await quinielaNueva(agenteA, 'Quiniela Alfa');
  const quinielaB = await quinielaNueva(agenteB, 'Quiniela Beta');

  const idA = new mongoose.Types.ObjectId(quinielaA.id);
  const idB = new mongoose.Types.ObjectId(quinielaB.id);

  // Mismo nombre de jornada y mismos equipos en ambas: el escenario que rompía.
  const partido = { equipo1: 'Alfa FC', equipo2: 'Beta FC', apiFixtureId: '10001' };

  await enQuiniela(idA, () => srv.ResultadoOficial.create({
    jornada: 'Jornada1',
    resultados: [{ ...partido, marcador1: 3, marcador2: 1, estado: 'TC', bloqueadoFinal: true }]
  }));

  await enQuiniela(idB, () => srv.ResultadoOficial.create({
    jornada: 'Jornada1',
    resultados: [{ ...partido, marcador1: null, marcador2: null, estado: 'PROGRAMADO' }]
  }));

  // Cada contexto debe ver EXCLUSIVAMENTE su propio documento.
  const desdeA = await enQuiniela(idA, () => srv.ResultadoOficial.findOne({ jornada: 'Jornada1' }));
  const desdeB = await enQuiniela(idB, () => srv.ResultadoOficial.findOne({ jornada: 'Jornada1' }));

  assert.equal(desdeA.resultados[0].estado, 'TC', 'La quiniela A debe ver su partido terminado');
  assert.equal(desdeB.resultados[0].estado, 'PROGRAMADO', 'La quiniela B debe ver su partido sin jugar');
  assert.notEqual(String(desdeA._id), String(desdeB._id));

  // Y el conteo por contexto debe ser 1, no 2.
  const cuantosEnA = await enQuiniela(idA, () => srv.ResultadoOficial.countDocuments({ jornada: 'Jornada1' }));
  assert.equal(cuantosEnA, 1, 'La quiniela A no debe contar el documento de la quiniela B');
});

test('C-02: sin contexto, la consulta SÍ cruza — de ahí la necesidad del guardia', async () => {
  /*
   * Esta prueba documenta el fallo original. No comprueba una corrección, sino
   * la razón por la que resolverTriviasPendientes exige contexto: sin él, el
   * plugin de inquilino no filtra nada y findOne devuelve el primer documento
   * que MongoDB encuentre, sea de la quiniela que sea.
   */
  const total = await srv.ResultadoOficial.countDocuments({ jornada: 'Jornada1' });
  assert.ok(total >= 2, `Sin contexto se ven ${total} documentos de varias quinielas`);
});

test('C-02: resolverTriviasPendientes se niega a correr sin contexto de quiniela', async () => {
  await assert.rejects(
    () => srv.resolverTriviasPendientes(),
    /requiere contexto de quiniela/,
    'Debe fallar de inmediato en vez de leer datos de otras quinielas'
  );
});

test('C-02: el barrido global recorre cada quiniela en su propio contexto', async () => {
  const { agente } = await cuentaNueva('barrido');
  const quiniela = await quinielaNueva(agente, 'Quiniela Barrido');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await enQuiniela(id, async () => {
    await srv.ResultadoOficial.create({
      jornada: 'JornadaBarrido',
      resultados: [{ equipo1: 'Uno', equipo2: 'Dos', estado: 'PROGRAMADO' }]
    });
    await srv.Trivia.create({
      jornadaNombre: 'JornadaBarrido',
      partidoIndex: 0,
      apiFixtureId: '20002',
      equipo1: 'Uno',
      equipo2: 'Dos',
      tipo: 'ambos_anotan',
      pregunta: '¿Ambos anotan?',
      opciones: ['Sí', 'No'],
      puntos: 1,
      fechaCierre: ayer,
      activa: true,
      resuelta: false
    });
  });

  // No debe lanzar. El partido está PROGRAMADO, así que la trivia se salta
  // antes de llegar a consultar el API externo.
  await srv.resolverTriviasDeTodasLasQuinielas();

  const trivia = await enQuiniela(id, () => srv.Trivia.findOne({ jornadaNombre: 'JornadaBarrido' }));
  assert.equal(trivia.resuelta, false, 'Con el partido sin terminar, la trivia no debe resolverse');
});

test('el aislamiento se aplica también a las escrituras y los borrados', async () => {
  const { agente: a1 } = await cuentaNueva('escritura_a');
  const { agente: a2 } = await cuentaNueva('escritura_b');
  const q1 = await quinielaNueva(a1, 'Escrituras Uno');
  const q2 = await quinielaNueva(a2, 'Escrituras Dos');
  const id1 = new mongoose.Types.ObjectId(q1.id);
  const id2 = new mongoose.Types.ObjectId(q2.id);

  await enQuiniela(id1, () => srv.Equipo.create({ nombre: 'Compartido' }));
  await enQuiniela(id2, () => srv.Equipo.create({ nombre: 'Compartido' }));

  // El índice único es {quinielaId, nombre}: el mismo nombre en dos quinielas
  // es legítimo y no debe chocar.
  const enUno = await enQuiniela(id1, () => srv.Equipo.countDocuments({ nombre: 'Compartido' }));
  assert.equal(enUno, 1);

  // Un deleteMany desde una quiniela no puede tocar los datos de la otra.
  await enQuiniela(id1, () => srv.Equipo.deleteMany({ nombre: 'Compartido' }));

  const quedanEnUno = await enQuiniela(id1, () => srv.Equipo.countDocuments({ nombre: 'Compartido' }));
  const quedanEnDos = await enQuiniela(id2, () => srv.Equipo.countDocuments({ nombre: 'Compartido' }));
  assert.equal(quedanEnUno, 0, 'El borrado debe afectar a la quiniela que lo pidió');
  assert.equal(quedanEnDos, 1, 'El borrado NO debe alcanzar a la otra quiniela');
});

/* ================================================================
 * Sondas de salud y autenticación
 * ================================================================ */

test('las sondas de salud responden y reflejan el estado de Mongo', async () => {
  const salud = await request(srv.app).get('/healthz');
  assert.equal(salud.status, 200);
  assert.equal(salud.body.estado, 'vivo');

  const listo = await request(srv.app).get('/readyz');
  assert.equal(listo.status, 200);
  assert.equal(listo.body.mongo, 'conectado');
});

test('el registro exige contraseñas coincidentes y de largo mínimo', async () => {
  const base = credencialesNuevas('validacion');

  const corta = await request(srv.app).post('/api/auth/registro')
    .send({ ...base, password: 'corta', confirmarPassword: 'corta' });
  assert.equal(corta.status, 400);

  const distintas = await request(srv.app).post('/api/auth/registro')
    .send({ ...base, confirmarPassword: 'otra-cosa-distinta' });
  assert.equal(distintas.status, 400);
});

test('el usuario y el correo son únicos globalmente', async () => {
  const { datos } = await cuentaNueva('unico');
  const repetido = await request(srv.app).post('/api/auth/registro').send(datos);
  assert.equal(repetido.status, 409);
  assert.equal(repetido.body.usernameEnUso, true);
  assert.equal(repetido.body.emailEnUso, true);
});

test('el login no revela si la cuenta existe', async () => {
  const { datos } = await cuentaNueva('generico');

  const inexistente = await request(srv.app).post('/api/auth/login')
    .send({ identificador: 'no_existe_jamas', password: 'lo-que-sea-1' });
  const claveMala = await request(srv.app).post('/api/auth/login')
    .send({ identificador: datos.username, password: 'clave-incorrecta-1' });

  assert.equal(inexistente.status, 401);
  assert.equal(claveMala.status, 401);
  assert.equal(inexistente.body.error, claveMala.body.error,
    'El mensaje debe ser idéntico para no filtrar qué cuentas existen');
});

test('se puede iniciar sesión con el usuario o con el correo', async () => {
  const { datos } = await cuentaNueva('doble');

  for (const identificador of [datos.username, datos.email]) {
    const res = await request(srv.app).post('/api/auth/login')
      .send({ identificador, password: datos.password });
    assert.equal(res.status, 200, `Falló entrando con ${identificador}`);
  }
});

test('sin quiniela activa, las rutas de dominio responden 409', async () => {
  const { agente } = await cuentaNueva('sin_quiniela');
  const res = await agente.get('/api/jornadas');
  assert.equal(res.status, 409);
});

/* ================================================================
 * Invariantes de roles
 * ================================================================ */

test('una quiniela nunca se queda sin administración', async () => {
  const { agente } = await cuentaNueva('solo_dueno');
  const quiniela = await quinielaNueva(agente, 'Sin Relevo');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const membresia = await srv.Membresia.findOne({ quinielaId: id });
  assert.equal(membresia.rol, 'propietario', 'Quien crea la quiniela es su propietario');

  // Activar Admin Mode para poder operar como administrador.
  const admin = await agente.post('/api/admin-mode/activar')
    .send({ password: 'contrasena-larga-1' });
  assert.equal(admin.status, 200, `No se pudo activar Admin Mode: ${JSON.stringify(admin.body)}`);

  // Degradar al único administrador debe rechazarse.
  const degradar = await agente
    .patch(`/api/quiniela-actual/miembros/${membresia._id}/rol`)
    .send({ rol: 'user' });
  assert.ok([400, 403, 409].includes(degradar.status),
    `Degradar al último administrador debería rechazarse, devolvió ${degradar.status}`);

  // Y autoexpulsarse también.
  const expulsar = await agente
    .patch(`/api/quiniela-actual/miembros/${membresia._id}/expulsar`)
    .send({});
  assert.ok([400, 403, 409].includes(expulsar.status),
    `Expulsar al propietario debería rechazarse, devolvió ${expulsar.status}`);

  const sigue = await srv.Membresia.findById(membresia._id);
  assert.equal(sigue.rol, 'propietario');
  assert.equal(sigue.estado, 'activo');
});

test('el Admin Mode exige la contraseña correcta y queda atado a la quiniela', async () => {
  const { agente } = await cuentaNueva('modo_admin');
  await quinielaNueva(agente, 'Con Admin Mode');

  const malo = await agente.post('/api/admin-mode/activar').send({ password: 'incorrecta-99' });
  assert.equal(malo.status, 401);

  const bueno = await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  assert.equal(bueno.status, 200);

  const estado = await agente.get('/api/admin-mode');
  assert.equal(estado.body.activo, true);
  assert.equal(estado.body.autorizadoPorRol, true);

  // Al cambiar de quiniela, la autorización no debe arrastrarse.
  await quinielaNueva(agente, 'Otra Quiniela');
  const trasCambiar = await agente.get('/api/admin-mode');
  assert.equal(trasCambiar.body.activo, false,
    'El Admin Mode de una quiniela no puede valer para otra');
});

test('las rutas administrativas rechazan a quien no ha confirmado su contraseña', async () => {
  const { agente } = await cuentaNueva('sin_confirmar');
  await quinielaNueva(agente, 'Requiere Confirmacion');

  const res = await agente.get('/api/quiniela-actual/miembros');
  assert.equal(res.status, 401);
  assert.equal(res.body.requiereAdminMode, true);
});

/* ================================================================
 * Motor de puntuación
 * ================================================================ */

/**
 * Siembra una jornada completa con sus resultados oficiales y el pronóstico de
 * un jugador, cubriendo todos los casos de puntuación de una sola pasada.
 *
 * El comodín se lee del RESULTADO OFICIAL, no de la jornada, que es un detalle
 * fácil de equivocar al leer el código.
 */
async function sembrarJornadaDePrueba(quinielaId, jugador) {
  const partidos = [
    { equipo1: 'Alfa', equipo2: 'Beta' },
    { equipo1: 'Gamma', equipo2: 'Delta' },
    { equipo1: 'Epsilon', equipo2: 'Zeta' },
    { equipo1: 'Eta', equipo2: 'Theta' },
    { equipo1: 'Iota', equipo2: 'Kappa' },
    { equipo1: 'Lambda', equipo2: 'Mu' }
  ];

  /*
   * `estado: 'TC'` y `bloqueadoFinal` no son adorno: desde la Fase 5 son lo que
   * distingue una jornada terminada —cuyos puntos se congelan— de una en curso,
   * que se sigue calculando al vuelo. Así es como queda un partido real cuando
   * el sincronizador lo da por acabado o un administrador lo carga a mano.
   */
  const terminado = { estado: 'TC', bloqueadoFinal: true };

  //                        oficial      pronóstico    comodín  → puntos esperados
  const oficiales = [
    { ...partidos[0], ...terminado, marcador1: 2, marcador2: 1, comodin: false }, // exacto        → 5
    { ...partidos[1], ...terminado, marcador1: 0, marcador2: 0, comodin: false }, // solo signo    → 3
    { ...partidos[2], ...terminado, marcador1: 3, marcador2: 0, comodin: true },  // exacto comodín→ 7
    { ...partidos[3], ...terminado, marcador1: 1, marcador2: 2, comodin: true },  // signo comodín → 4
    { ...partidos[4], ...terminado, marcador1: 1, marcador2: 0, comodin: false }, // sin pronóstico→ 0
    { ...partidos[5], ...terminado, marcador1: 2, marcador2: 2, comodin: false }  // signo erróneo → 0
  ];

  const pronosticos = [
    { ...partidos[0], marcador1: 2, marcador2: 1 },
    { ...partidos[1], marcador1: 1, marcador2: 1 },
    { ...partidos[2], marcador1: 3, marcador2: 0 },
    { ...partidos[3], marcador1: 0, marcador2: 3 },
    { ...partidos[4], marcador1: null, marcador2: null },
    { ...partidos[5], marcador1: 1, marcador2: 0 }
  ];

  await enQuiniela(quinielaId, async () => {
    await srv.Jornada.create({ nombre: 'Jornada1', partidos });
    await srv.ResultadoOficial.create({ jornada: 'Jornada1', resultados: oficiales });
    await srv.Resultado.create({ jugador, jornada: 'Jornada1', pronosticos });
  });

  return 5 + 3 + 7 + 4; // 19
}

test('el motor de puntuación aplica las cuatro reglas de acierto', async () => {
  const { agente, datos } = await cuentaNueva('puntos');
  const quiniela = await quinielaNueva(agente, 'Puntuacion Completa');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const esperadoJornada = await sembrarJornadaDePrueba(id, datos.username);

  const res = await agente.get('/api/resultados-totales');
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const mio = res.body[datos.username];
  assert.ok(mio, `El ranking no incluye a ${datos.username}: ${JSON.stringify(res.body)}`);

  assert.equal(mio.Jornada1, esperadoJornada,
    'Marcador exacto 5, solo signo 3, exacto con comodín 7, signo con comodín 4');
  assert.equal(mio.Trivias, 0);
  assert.equal(mio.total, esperadoJornada);
});

test('un pronóstico sin marcadores no suma ni resta', async () => {
  const { agente, datos } = await cuentaNueva('nulos');
  const quiniela = await quinielaNueva(agente, 'Marcadores Nulos');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'JornadaNula', partidos: [{ equipo1: 'A', equipo2: 'B' }] });
    await srv.ResultadoOficial.create({
      jornada: 'JornadaNula',
      resultados: [{ equipo1: 'A', equipo2: 'B', marcador1: 1, marcador2: 0, comodin: false }]
    });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'JornadaNula',
      pronosticos: [{ equipo1: 'A', equipo2: 'B', marcador1: null, marcador2: null }]
    });
  });

  const res = await agente.get('/api/resultados-totales');
  assert.equal(res.body[datos.username].JornadaNula, 0);
});

test('los puntos de trivia se suman al total', async () => {
  const { agente, datos } = await cuentaNueva('trivia_puntos');
  const quiniela = await quinielaNueva(agente, 'Trivias Suman');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, async () => {
    await srv.RespuestaTrivia.create({ jugador: datos.username, triviaId: 't1', respuesta: 'Sí', puntos: 2 });
    await srv.RespuestaTrivia.create({ jugador: datos.username, triviaId: 't2', respuesta: 'No', puntos: 3 });
  });

  const res = await agente.get('/api/resultados-totales');
  assert.equal(res.body[datos.username].Trivias, 5);
  assert.equal(res.body[datos.username].total, 5);
});

test('S-10: el índice único impide duplicar la respuesta de una trivia', async () => {
  const { agente } = await cuentaNueva('duplicado');
  const quiniela = await quinielaNueva(agente, 'Sin Duplicados');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, () => srv.RespuestaTrivia.create({
    jugador: 'alguien', triviaId: 'misma', respuesta: 'Sí', puntos: 1
  }));

  /*
   * Sin el índice único {quinielaId, jugador, triviaId}, dos envíos simultáneos
   * insertaban dos documentos y el jugador cobraba los puntos dos veces.
   */
  await assert.rejects(
    () => enQuiniela(id, () => srv.RespuestaTrivia.create({
      jugador: 'alguien', triviaId: 'misma', respuesta: 'No', puntos: 1
    })),
    error => error.code === 11000,
    'La segunda inserción debe chocar contra el índice único'
  );
});

test('M-03: cambiar la puntuación ya NO reescribe el histórico', async () => {
  /*
   * Esta prueba estaba escrita al revés hasta la Fase 5, y a propósito: fijaba
   * el comportamiento de entonces —los puntos se recalculaban con la
   * configuración vigente, así que subir marcadorExacto a mitad de temporada
   * reescribía las jornadas ya jugadas— para que el día que se decidiera
   * congelar, el cambio fuera deliberado y esta prueba fallara.
   *
   * Ese día fue el 17 de agosto de 2026. Ahora comprueba lo contrario.
   */
  const { agente, datos } = await cuentaNueva('historico');
  const quiniela = await quinielaNueva(agente, 'Historico Congelado');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const esperado = await sembrarJornadaDePrueba(id, datos.username);

  // Primera lectura: la jornada está terminada, así que aquí queda congelada.
  const antes = await agente.get('/api/resultados-totales');
  assert.equal(antes.body[datos.username].Jornada1, esperado);

  const congelada = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'Jornada1' }));
  assert.ok(congelada, 'Una jornada terminada debe quedar congelada al leerse');
  assert.equal(congelada.puntuacion.marcadorExacto, 5,
    'Se guarda la configuración con la que se calculó');

  const activar = await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  assert.equal(activar.status, 200);

  const cambio = await agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { marcadorExacto: 50, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4, puntosTriviaDefault: 1 } });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.body));

  const despues = await agente.get('/api/resultados-totales');

  assert.equal(despues.body[datos.username].Jornada1, esperado,
    'Una jornada ya terminada no cambia de puntuación porque se cambie la configuración');
  assert.equal(despues.body[datos.username].total, antes.body[datos.username].total,
    'Y por tanto el total tampoco se mueve');
});

test('una jornada en curso sí se calcula con la configuración vigente', async () => {
  /*
   * El congelamiento es para lo terminado. Mientras la jornada está viva, la
   * tabla debe seguir el marcador en tiempo real y las reglas de hoy: si no,
   * un administrador no podría corregir la puntuación antes de que empiece a
   * contar de verdad.
   */
  const { agente, datos } = await cuentaNueva('encurso');
  const quiniela = await quinielaNueva(agente, 'Jornada Viva');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const partidos = [{ equipo1: 'Uno', equipo2: 'Dos' }, { equipo1: 'Tres', equipo2: 'Cuatro' }];

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'JornadaViva', partidos });
    await srv.ResultadoOficial.create({
      jornada: 'JornadaViva',
      resultados: [
        { ...partidos[0], marcador1: 1, marcador2: 0, estado: 'TC', bloqueadoFinal: true },
        // El segundo sigue en juego: la jornada no está terminada.
        { ...partidos[1], marcador1: 0, marcador2: 0, estado: 'LIVE', bloqueadoFinal: false }
      ]
    });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'JornadaViva',
      pronosticos: [
        { ...partidos[0], marcador1: 1, marcador2: 0 },
        { ...partidos[1], marcador1: 0, marcador2: 0 }
      ]
    });
  });

  const antes = await agente.get('/api/resultados-totales');
  assert.equal(antes.body[datos.username].JornadaViva, 10, 'Dos marcadores exactos a 5 puntos');

  const sinCongelar = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'JornadaViva' }));
  assert.equal(sinCongelar, null, 'Una jornada con un partido en juego no se congela');

  await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  await agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { marcadorExacto: 50, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4, puntosTriviaDefault: 1 } });

  const despues = await agente.get('/api/resultados-totales');
  assert.equal(despues.body[datos.username].JornadaViva, 100,
    'Mientras la jornada vive, manda la configuración de hoy');
});

test('corregir un resultado recalcula con la puntuación congelada, no con la de hoy', async () => {
  /*
   * El caso que hace falta acertar para que el congelamiento sirva de algo.
   *
   * Un administrador corrige meses después un marcador que estaba mal. La
   * jornada TIENE que recalcularse —cambió un hecho del juego— pero con las
   * reglas que regían cuando se jugó. Si se recalculara con las de hoy, bastaría
   * corregir una errata para colar todos los cambios de puntuación acumulados.
   */
  const { agente, datos } = await cuentaNueva('correccion');
  const quiniela = await quinielaNueva(agente, 'Correccion Tardia');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await sembrarJornadaDePrueba(id, datos.username);

  await agente.get('/api/resultados-totales');   // congela con marcadorExacto = 5

  await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  await agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { marcadorExacto: 50, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4, puntosTriviaDefault: 1 } });

  /*
   * La corrección: el primer partido no fue 2-1 sino 4-0. El jugador había
   * pronosticado 2-1, así que pierde el acierto exacto (5) y conserva el signo
   * (3), porque en ambos casos ganó el local.
   */
  const oficialCorregido = await enQuiniela(id, () => srv.ResultadoOficial.findOne({ jornada: 'Jornada1' }));
  const resultadosCorregidos = oficialCorregido.resultados.map((r, indice) =>
    indice === 0 ? { ...r.toObject(), marcador1: 4, marcador2: 0 } : r.toObject()
  );

  const envio = await agente.post('/api/resultados-oficiales')
    .send({ jornada: 'Jornada1', resultados: resultadosCorregidos });
  assert.equal(envio.status, 200, JSON.stringify(envio.body));

  const res = await agente.get('/api/resultados-totales');

  assert.equal(res.body[datos.username].Jornada1, 3 + 3 + 7 + 4,
    'Se recalcula con la puntuación congelada (exacto=5 → ahora signo=3), no con la de hoy (50)');

  const congelada = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'Jornada1' }));
  assert.equal(congelada.puntuacion.marcadorExacto, 5,
    'La jornada conserva la configuración con la que se cerró');
});

test('C-03: con todo congelado, la tabla no lee los pronósticos', async () => {
  /*
   * El arreglo de rendimiento, comprobado por donde se nota: no en el tiempo
   * —que en una prueba mide ruido— sino en si la consulta llega a hacerse.
   *
   * Antes, cada carga de la tabla leía `Resultado` y `ResultadoOficial`
   * completos, con sus arrays de pronósticos, y recalculaba todo desde cero.
   * Con las jornadas congeladas, esas dos colecciones no se tocan.
   */
  const { agente, datos } = await cuentaNueva('lecturas');
  const quiniela = await quinielaNueva(agente, 'Sin Lecturas');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await sembrarJornadaDePrueba(id, datos.username);
  await agente.get('/api/resultados-totales');   // congela

  const originalResultado = srv.Resultado.find;
  const originalOficial = srv.ResultadoOficial.find;

  let lecturasDePronosticos = 0;
  let lecturasDeOficiales = 0;

  srv.Resultado.find = function (...args) {
    lecturasDePronosticos += 1;
    return originalResultado.apply(this, args);
  };
  srv.ResultadoOficial.find = function (...args) {
    lecturasDeOficiales += 1;
    return originalOficial.apply(this, args);
  };

  try {
    const res = await agente.get('/api/resultados-totales');
    assert.equal(res.status, 200);
    assert.equal(res.body[datos.username].Jornada1, 19, 'Y el número sigue siendo el correcto');
  } finally {
    srv.Resultado.find = originalResultado;
    srv.ResultadoOficial.find = originalOficial;
  }

  assert.equal(lecturasDePronosticos, 0,
    'Con todas las jornadas congeladas no hace falta leer un solo pronóstico');
  assert.equal(lecturasDeOficiales, 0,
    'Ni un solo resultado oficial');
});

test('Fase 5: editar una jornada descongela sus puntos materializados', async () => {
  const { agente, datos } = await cuentaNueva('edita_jornada');
  const quiniela = await quinielaNueva(agente, 'Edicion de Jornada');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await sembrarJornadaDePrueba(id, datos.username);
  await agente.get('/api/resultados-totales'); // deja Jornada1 congelada

  const antes = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'Jornada1' }));
  assert.ok(antes, 'La jornada debe estar congelada antes de editarla');

  const activar = await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  assert.equal(activar.status, 200);

  const edicion = await agente.post('/api/jornadas/agregar-partido').send({
    jornada: 'Jornada1',
    partido: { equipo1: 'Nuevo', equipo2: 'Partido' }
  });
  assert.equal(edicion.status, 200, JSON.stringify(edicion.body));

  const despues = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'Jornada1' }));
  assert.equal(despues, null,
    'Al faltar resultado oficial para el partido nuevo, la jornada deja de estar congelada');
});

test('Fase 5: la caché se invalida y el ranking se puede paginar', async () => {
  const { agente, datos } = await cuentaNueva('cache_ranking');
  const quiniela = await quinielaNueva(agente, 'Cache y Paginas');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, async () => {
    await srv.Jugador.create({ nombre: 'Historico Uno' });
    await srv.Jugador.create({ nombre: 'Historico Dos' });
  });

  const primera = await agente.get('/api/resultados-totales');
  assert.equal(primera.status, 200);
  assert.ok(primera.body[datos.username]);

  const originalFind = srv.Jornada.find;
  let lecturasDeJornadas = 0;
  srv.Jornada.find = function (...args) {
    lecturasDeJornadas += 1;
    return originalFind.apply(this, args);
  };

  try {
    const paginada = await agente.get('/api/resultados-totales?pagina=1&limite=1');
    assert.equal(paginada.status, 200, JSON.stringify(paginada.body));
    assert.equal(paginada.body.pagina, 1);
    assert.equal(paginada.body.limite, 1);
    assert.equal(paginada.body.totalJugadores, 3);
    assert.equal(paginada.body.totalPaginas, 3);
    assert.equal(paginada.body.jugadores.length, 1);
    assert.equal(lecturasDeJornadas, 0, 'La segunda lectura debe salir de caché');

    const activar = await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
    assert.equal(activar.status, 200);
    const cambio = await agente.patch('/api/quiniela-actual/configuracion')
      .send({ incluirExpulsadosEnRanking: false });
    assert.equal(cambio.status, 200, JSON.stringify(cambio.body));

    const trasInvalidar = await agente.get('/api/resultados-totales?pagina=1&limite=1');
    assert.equal(trasInvalidar.status, 200);
    assert.ok(lecturasDeJornadas > 0, 'Cambiar la configuración debe invalidar la caché');
  } finally {
    srv.Jornada.find = originalFind;
  }
});

test('la clasificación por jornada es provisional, ordena empates y no suma trivias', async () => {
  const { agente, datos } = await cuentaNueva('clasificacion');
  const quiniela = await quinielaNueva(agente, 'Tabla por Jornada');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  const partido = { equipo1: 'Uno', equipo2: 'Dos' };

  await enQuiniela(id, async () => {
    await srv.Quiniela.updateOne(
      { _id: id },
      { $set: { 'configuracion.puntuacion.resultadoCorrecto': 5 } }
    );
    await srv.Jugador.create({ nombre: 'Rival Empatado' });
    await srv.Jornada.create({ nombre: 'Jornada Clasificacion', partidos: [partido] });
    await srv.ResultadoOficial.create({
      jornada: 'Jornada Clasificacion',
      resultados: [{ ...partido, marcador1: 2, marcador2: 1, estado: 'LIVE', bloqueadoFinal: false }]
    });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'Jornada Clasificacion',
      pronosticos: [{ ...partido, marcador1: 2, marcador2: 1 }]
    });
    await srv.Resultado.create({
      jugador: 'Rival Empatado',
      jornada: 'Jornada Clasificacion',
      pronosticos: [{ ...partido, marcador1: 3, marcador2: 2 }]
    });
    await srv.RespuestaTrivia.create({ jugador: 'Rival Empatado', triviaId: 'fuera-de-jornada', respuesta: 'Sí', puntos: 99 });
  });

  const provisional = await agente.get('/api/clasificacion-jornada');
  assert.equal(provisional.status, 200, JSON.stringify(provisional.body));
  assert.equal(provisional.body.jornada, 'Jornada Clasificacion', 'Por defecto usa la jornada más reciente');
  assert.equal(provisional.body.estado, 'provisional');
  assert.equal(provisional.body.clasificacion.length, 2);
  assert.equal(provisional.body.clasificacion[0].jugador, datos.username,
    'A igualdad de puntos, el marcador exacto ordena primero');
  assert.equal(provisional.body.clasificacion[0].puntos, 5);
  assert.equal(provisional.body.clasificacion[1].puntos, 5,
    'Los puntos permanecen empatados; las trivias no se incluyen');
  assert.equal(provisional.body.clasificacion[0].puesto, 1);
  assert.equal(provisional.body.clasificacion[1].puesto, 1);
  assert.equal(provisional.body.clasificacion[0].empate, true);

  await enQuiniela(id, () => srv.ResultadoOficial.updateOne(
    { jornada: 'Jornada Clasificacion' },
    { $set: { 'resultados.0.estado': 'TC', 'resultados.0.bloqueadoFinal': true } }
  ));

  const confirmada = await agente.get('/api/clasificacion-jornada?jornada=Jornada%20Clasificacion');
  assert.equal(confirmada.status, 200);
  assert.equal(confirmada.body.estado, 'confirmada');
  const materializada = await enQuiniela(id, () => srv.PuntosJornada.findOne({ jornada: 'Jornada Clasificacion' }));
  assert.ok(materializada, 'Una jornada confirmada queda materializada');
});

/* ================================================================
 * Normalización de datos de APIFootball (funciones puras)
 * ================================================================ */

test('obtenerEstadoPartido normaliza los estados crudos del API', () => {
  const casos = [
    ['Finished', 'TC'], ['FT', 'TC'], ['After Pen.', 'TC'],
    ['Half Time', 'MT'], ['HT', 'MT'],
    ['', 'PROGRAMADO'], ['Not Started', 'PROGRAMADO'],
    ['67', 'LIVE'], ['45+2', 'LIVE'], ['90+3', 'LIVE']
  ];
  for (const [crudo, esperado] of casos) {
    // La función recibe el fixture del API, no la cadena suelta.
    const { estado } = srv.obtenerEstadoPartido({ match_status: crudo });
    assert.equal(estado, esperado, `"${crudo}" debería normalizarse a ${esperado}`);
  }

  // El minuto se conserva en los partidos en curso y se anula en los demás.
  assert.equal(srv.obtenerEstadoPartido({ match_status: '67' }).minuto, 67);
  assert.equal(srv.obtenerEstadoPartido({ match_status: '45+2' }).minuto, '45+');
  assert.equal(srv.obtenerEstadoPartido({ match_status: 'FT' }).minuto, null);
});

/* ================================================================
 * Marcador a 90 minutos
 *
 * Resuelve un problema real de eliminatorias: un partido decidido en penales o
 * en la prórroga no debe alterar el pronóstico del tiempo reglamentario.
 * ================================================================ */

test('el marcador en vivo se usa mientras el partido está en curso', () => {
  const enVivo = {
    match_hometeam_score: '1', match_awayteam_score: '0',
    match_hometeam_ft_score: '', match_awayteam_ft_score: ''
  };
  for (const estado of ['LIVE', 'MT']) {
    const m = srv.obtenerMarcador90Minutos(enVivo, { estado });
    assert.deepEqual({ ...m }, { marcador1: 1, marcador2: 0 }, `Falló con estado ${estado}`);
  }
});

test('terminado el partido manda el marcador de tiempo reglamentario', () => {
  const m = srv.obtenerMarcador90Minutos({
    match_hometeam_score: '5', match_awayteam_score: '4',   // incluiría los penales
    match_hometeam_ft_score: '2', match_awayteam_ft_score: '2'
  }, { estado: 'TC' });

  assert.deepEqual({ ...m }, { marcador1: 2, marcador2: 2 },
    'Debe ganar el marcador a 90 minutos, no el que incluye la tanda');
});

test('sin marcador de 90\' se reconstruye descartando penales y prórroga', () => {
  /*
   * Escenario de eliminatoria: 1-1 en el tiempo reglamentario, gol en la
   * prórroga y tanda de penales. El pronóstico se juzga sobre el 1-1.
   */
  const m = srv.obtenerMarcador90Minutos({
    match_hometeam_score: '4', match_awayteam_score: '3',
    match_hometeam_ft_score: '', match_awayteam_ft_score: '',
    goalscorer: [
      { time: '15', home_scorer: 'A', score: '1 - 0', score_info_time: '' },
      { time: '77', away_scorer: 'B', score: '1 - 1', score_info_time: '' },
      { time: '105', home_scorer: 'C', score: '2 - 1', score_info_time: 'extra time' },
      { time: '120', away_scorer: 'D', score: '2 - 2', score_info_time: 'penalty' }
    ]
  }, { estado: 'TC' });

  assert.deepEqual({ ...m }, { marcador1: 1, marcador2: 1 },
    'El gol de la prórroga y el de la tanda no cuentan para el marcador a 90 minutos');
});

/* ================================================================
 * Autorresolución de trivias — los 8 tipos
 * ================================================================ */

/** Construye un evento de APIFootball con la forma que devuelve el proveedor. */
function eventoApi({ local = 'Alfa', visitante = 'Beta', goles = [], tarjetas = [], estadisticas = [] } = {}) {
  return {
    match_hometeam_name: local,
    match_awayteam_name: visitante,
    match_hometeam_score: '0',
    match_awayteam_score: '0',
    goalscorer: goles,
    cards: tarjetas,
    statistics: estadisticas
  };
}

const gol = (time, quien, extra = {}) => ({
  time: String(time),
  home_scorer: quien === 'local' ? 'Jugador Local' : '',
  away_scorer: quien === 'visitante' ? 'Jugador Visitante' : '',
  score: '1 - 0',
  info: '',
  ...extra
});

const triviaDe = tipo => ({ tipo, equipo1: 'Alfa', equipo2: 'Beta' });

test('los 8 tipos de trivia están declarados y se resuelven', () => {
  const tipos = Object.keys(srv.TIPOS_TRIVIA);
  assert.equal(tipos.length, 8, `Se esperaban 8 tipos, hay ${tipos.length}: ${tipos}`);
  for (const tipo of tipos) {
    assert.ok(srv.TIPOS_TRIVIA[tipo].pregunta, `El tipo ${tipo} no declara pregunta`);
  }
});

test('trivia primer_gol: identifica al equipo que anota primero', () => {
  const conGoles = eventoApi({ goles: [gol(60, 'local'), gol(20, 'visitante')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('primer_gol'), conGoles), 'Beta',
    'El primer gol es el del minuto 20, aunque venga después en el arreglo');

  const sinGoles = eventoApi({ goles: [] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('primer_gol'), sinGoles), 'Nadie anotará');
});

test('trivia primer_gol: corrige los equipos invertidos por el API', () => {
  /*
   * El API a veces devuelve local y visitante al revés respecto a cómo se
   * guardó el partido. Sin la corrección, el primer gol se atribuiría al
   * equipo equivocado y TODOS los que acertaron perderían sus puntos.
   */
  const invertido = eventoApi({ local: 'Beta', visitante: 'Alfa', goles: [gol(10, 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('primer_gol'), invertido), 'Beta',
    'Si el API pone a Beta de local, su gol sigue siendo de Beta');

  const normal = eventoApi({ local: 'Alfa', visitante: 'Beta', goles: [gol(10, 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('primer_gol'), normal), 'Alfa');
});

test('trivia ambos_anotan: exige gol de los dos equipos', () => {
  const ambos = eventoApi({ goles: [gol(10, 'local'), gol(50, 'visitante')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('ambos_anotan'), ambos), 'Sí');

  const soloUno = eventoApi({ goles: [gol(10, 'local'), gol(70, 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('ambos_anotan'), soloUno), 'No');

  const ninguno = eventoApi({ goles: [] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('ambos_anotan'), ninguno), 'No');
});

test('trivias de primer y segundo tiempo: el corte está en el 45', () => {
  const primero = eventoApi({ goles: [gol(30, 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_primer_tiempo'), primero), 'Sí');
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_segundo_tiempo'), primero), 'No');

  const segundo = eventoApi({ goles: [gol(70, 'visitante')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_primer_tiempo'), segundo), 'No');
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_segundo_tiempo'), segundo), 'Sí');

  // El añadido del primer tiempo ("45+2") cuenta como primer tiempo.
  const anadido = eventoApi({ goles: [gol('45+2', 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_primer_tiempo'), anadido), 'Sí',
    'Un gol en el 45+2 es del primer tiempo');
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('gol_segundo_tiempo'), anadido), 'No');
});

test('trivia mas_amarillas: cuenta por cards y compara equipos', () => {
  const amarilla = (quien) => ({
    card: 'yellow card',
    home_fault: quien === 'local' ? 'Jugador' : '',
    away_fault: quien === 'visitante' ? 'Jugador' : ''
  });

  const ganaLocal = eventoApi({ tarjetas: [amarilla('local'), amarilla('local'), amarilla('visitante')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('mas_amarillas'), ganaLocal), 'Alfa');

  const empate = eventoApi({ tarjetas: [amarilla('local'), amarilla('visitante')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('mas_amarillas'), empate), 'Empate');

  const ninguna = eventoApi({ tarjetas: [] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('mas_amarillas'), ninguna), 'No habrá tarjetas amarillas');
});

test('trivia mas_amarillas: si cards viene vacío, recurre a statistics', () => {
  /*
   * APIFootball no siempre rellena `cards`. El respaldo por `statistics` evita
   * que la trivia se resuelva como "no hubo amarillas" cuando sí las hubo.
   */
  const soloStats = eventoApi({
    tarjetas: [],
    estadisticas: [{ type: 'Yellow Cards', home: '1', away: '4' }]
  });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('mas_amarillas'), soloStats), 'Beta');
});

test('trivia mas_rojas: sin rojas responde que no hubo', () => {
  const roja = (quien) => ({
    card: 'red card',
    home_fault: quien === 'local' ? 'Jugador' : '',
    away_fault: quien === 'visitante' ? 'Jugador' : ''
  });

  assert.equal(
    srv.resolverRespuestaTrivia(triviaDe('mas_rojas'), eventoApi({ tarjetas: [] })),
    'No habrá tarjetas rojas'
  );
  assert.equal(
    srv.resolverRespuestaTrivia(triviaDe('mas_rojas'), eventoApi({ tarjetas: [roja('visitante')] })),
    'Beta'
  );
});

test('trivias de tiempo extra y penales', () => {
  const conProrroga = eventoApi({ goles: [gol(105, 'local', { score_info_time: 'extra time' })] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('hubo_tiempo_extra'), conProrroga), 'Sí');

  const conPenales = eventoApi({ goles: [gol(120, 'local', { score_info_time: 'penalty' })] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('hubo_penales'), conPenales), 'Sí');

  const normal = eventoApi({ goles: [gol(30, 'local')] });
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('hubo_tiempo_extra'), normal), 'No');
  assert.equal(srv.resolverRespuestaTrivia(triviaDe('hubo_penales'), normal), 'No');
});

test('sin evento del API, ninguna trivia se resuelve', () => {
  for (const tipo of Object.keys(srv.TIPOS_TRIVIA)) {
    assert.equal(srv.resolverRespuestaTrivia(triviaDe(tipo), null), '',
      `El tipo ${tipo} debe devolver cadena vacía sin evento, para no resolver a ciegas`);
  }
});

/* ================================================================
 * Transferencia de propiedad
 * ================================================================ */

test('la propiedad solo se transfiere a un administrador activo', async () => {
  const { agente: duenoAgente, datos: dueno } = await cuentaNueva('dueno');
  const { agente: socioAgente, datos: socio } = await cuentaNueva('socio');

  const quiniela = await quinielaNueva(duenoAgente, 'Traspaso');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await duenoAgente.post('/api/admin-mode/activar').send({ password: dueno.password });

  // El socio solicita ingreso y el propietario lo aprueba.
  const unirse = await socioAgente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigo });
  assert.equal(unirse.status, 202, JSON.stringify(unirse.body));

  const socioUsuario = await srv.Usuario.findOne({ usernameNormalizado: socio.username.toLowerCase() });
  const membresiaSocio = await srv.Membresia.findOne({ quinielaId: id, usuarioId: socioUsuario._id });

  const aprobar = await duenoAgente.patch(`/api/quiniela-actual/miembros/${membresiaSocio._id}/aprobar`).send({});
  assert.equal(aprobar.status, 200, JSON.stringify(aprobar.body));

  // La ruta identifica al destinatario por id de USUARIO, no de membresía.
  const destino = { usuarioId: String(socioUsuario._id) };

  // Con el socio como simple 'user', la transferencia debe rechazarse.
  const prematura = await duenoAgente.post('/api/quiniela-actual/transferir-propiedad').send(destino);
  assert.equal(prematura.status, 400,
    `Transferir a un 'user' debe rechazarse: ${JSON.stringify(prematura.body)}`);

  // Se le asciende a admin y ahora sí.
  const ascender = await duenoAgente.patch(`/api/quiniela-actual/miembros/${membresiaSocio._id}/rol`)
    .send({ rol: 'admin' });
  assert.equal(ascender.status, 200, JSON.stringify(ascender.body));

  const transferir = await duenoAgente.post('/api/quiniela-actual/transferir-propiedad').send(destino);
  assert.equal(transferir.status, 200, JSON.stringify(transferir.body));

  // Los roles quedan intercambiados y sigue habiendo exactamente un propietario.
  const membresias = await srv.Membresia.find({ quinielaId: id });
  const propietarios = membresias.filter(m => m.rol === 'propietario');
  assert.equal(propietarios.length, 1, 'Debe quedar exactamente un propietario');
  assert.equal(String(propietarios[0].usuarioId), String(socioUsuario._id),
    'El nuevo propietario debe ser el socio');

  const quinielaActualizada = await srv.Quiniela.findById(id);
  assert.equal(String(quinielaActualizada.propietarioId), String(socioUsuario._id),
    'El campo propietarioId de la quiniela también debe actualizarse');
});

test('M-11: no se anulan los goles de jugadores con "var" en el apellido', () => {
  // Goles legítimos que la versión anterior descartaba por subcadena.
  for (const anotador of ['R. Varela', 'R. Varane', 'L. Álvarez', 'J. Navarro']) {
    assert.equal(
      srv.esGolApiFootball({ home_scorer: anotador, info: '' }), true,
      `El gol de ${anotador} es legítimo y no debe descartarse`
    );
  }

  // Anulaciones reales, que sí deben descartarse.
  for (const info of ['Goal cancelled by VAR', 'disallowed', 'cancelled']) {
    assert.equal(
      srv.esGolApiFootball({ home_scorer: 'X. Jugador', info }), false,
      `Un gol con info "${info}" debe descartarse`
    );
  }

  // Los penales de tanda no cuentan como gol del tiempo reglamentario.
  assert.equal(
    srv.esGolApiFootball({ home_scorer: 'X. Jugador', score_info_time: 'penalty' }), false
  );
});

/* ================================================================
 * Fase 4 — Sincronizador: deduplicación, ventanas y cerrojo
 *
 * Ninguna de estas pruebas toca la red. El sincronizador habla con el
 * proveedor por un único punto —`proveedorDeEventos`— y aquí se sustituye por
 * eventos sintéticos que además CUENTAN las consultas. Ese conteo es el objeto
 * de la prueba: el hallazgo C-01 no era un error de resultado, era un error de
 * cuántas veces se preguntaba.
 * ================================================================ */

/** Sustituye el proveedor por uno sintético que lleva la cuenta de consultas. */
function proveedorFalso(eventosPorId = {}) {
  const consultas = { porId: [], porFecha: [] };

  const originalPorId = srv.proveedorDeEventos.porId;
  const originalPorFecha = srv.proveedorDeEventos.porFecha;

  srv.proveedorDeEventos.porId = async (id) => {
    consultas.porId.push(String(id));
    return eventosPorId[String(id)] || null;
  };

  srv.proveedorDeEventos.porFecha = async (partido) => {
    consultas.porFecha.push(partido);
    return null;
  };

  return {
    consultas,
    /** Cuántas veces se preguntó por un partido concreto. */
    vecesConsultado(id) {
      return consultas.porId.filter(consultado => consultado === String(id)).length;
    },
    restaurar() {
      srv.proveedorDeEventos.porId = originalPorId;
      srv.proveedorDeEventos.porFecha = originalPorFecha;
    }
  };
}

/** Evento con la forma que devuelve APIFootball para un partido terminado. */
function eventoTerminado(idPartido, local, visita, golesLocal, golesVisita) {
  return {
    match_id: String(idPartido),
    match_status: 'Finished',
    match_live: '0',
    match_hometeam_name: local,
    match_awayteam_name: visita,
    match_hometeam_score: String(golesLocal),
    match_awayteam_score: String(golesVisita),
    match_hometeam_ft_score: String(golesLocal),
    match_awayteam_ft_score: String(golesVisita),
    goalscorer: [],
    cards: []
  };
}

test('C-01: un partido seguido por dos quinielas se consulta UNA vez', async () => {
  const { agente: agenteA } = await cuentaNueva('sync_a');
  const { agente: agenteB } = await cuentaNueva('sync_b');
  const quinielaA = await quinielaNueva(agenteA, 'Sync Alfa');
  const quinielaB = await quinielaNueva(agenteB, 'Sync Beta');

  const idA = new mongoose.Types.ObjectId(quinielaA.id);
  const idB = new mongoose.Types.ObjectId(quinielaB.id);

  // El mismo partido real, seguido desde dos quinielas distintas.
  const partido = {
    equipo1: 'Costa Rica',
    equipo2: 'Panamá',
    apiFixtureId: '900001',
    apiDate: '2026-06-20 15:00'
  };

  await enQuiniela(idA, () => srv.Jornada.create({ nombre: 'JornadaSync', partidos: [partido] }));
  await enQuiniela(idB, () => srv.Jornada.create({ nombre: 'JornadaSync', partidos: [partido] }));

  await srv.Fixture.deleteMany({ clave: '900001' });

  const proveedor = proveedorFalso({
    900001: eventoTerminado(900001, 'Costa Rica', 'Panamá', 2, 1)
  });

  try {
    await srv.ejecutarCicloDeSincronizacion();
  } finally {
    proveedor.restaurar();
  }

  /*
   * El corazón de la Fase 4. Antes eran dos consultas —una por quiniela— y con
   * cuarenta quinielas habrían sido cuarenta. Ahora el partido es uno solo.
   */
  assert.equal(proveedor.vecesConsultado('900001'), 1,
    'El mismo partido debe consultarse una sola vez aunque lo sigan varias quinielas');

  // Y aun así las DOS quinielas quedan con su resultado escrito.
  const oficialA = await enQuiniela(idA, () => srv.ResultadoOficial.findOne({ jornada: 'JornadaSync' }));
  const oficialB = await enQuiniela(idB, () => srv.ResultadoOficial.findOne({ jornada: 'JornadaSync' }));

  assert.ok(oficialA, 'La quiniela A debe quedar sincronizada');
  assert.ok(oficialB, 'La quiniela B debe quedar sincronizada');
  assert.equal(oficialA.resultados[0].marcador1, 2);
  assert.equal(oficialA.resultados[0].marcador2, 1);
  assert.equal(oficialB.resultados[0].marcador1, 2);
  assert.equal(oficialB.resultados[0].estado, 'TC');

  // Cada resultado vive en su propia quiniela, no en un documento compartido.
  assert.notEqual(oficialA._id.toString(), oficialB._id.toString());
  assert.equal(oficialA.quinielaId.toString(), idA.toString());
  assert.equal(oficialB.quinielaId.toString(), idB.toString());
});

test('un partido terminado no se vuelve a consultar nunca', async () => {
  await srv.Fixture.deleteMany({ clave: '900002' });

  await srv.Fixture.create({
    clave: '900002',
    apiFixtureId: '900002',
    estado: 'TC',
    proximaConsulta: null,
    evento: eventoTerminado(900002, 'A', 'B', 1, 0)
  });

  const catalogo = new Map([['900002', {
    clave: '900002',
    apiFixtureId: '900002',
    apiDate: '2026-06-01 12:00',
    busqueda: { fecha: '2026-06-01', ligaId: '', equipo1: 'A', equipo2: 'B' }
  }]]);

  const proveedor = proveedorFalso();

  try {
    const refrescadas = await srv.refrescarFixturesPendientes(catalogo);
    assert.equal(refrescadas.size, 0);
  } finally {
    proveedor.restaurar();
  }

  assert.equal(proveedor.consultas.porId.length, 0,
    'Un partido con estado TC ya no puede cambiar: consultarlo es cuota tirada');
});

test('dentro de su ventana, un partido tampoco se consulta', async () => {
  await srv.Fixture.deleteMany({ clave: '900003' });

  await srv.Fixture.create({
    clave: '900003',
    apiFixtureId: '900003',
    estado: 'PROGRAMADO',
    // Todavía faltan horas para que toque preguntar otra vez.
    proximaConsulta: new Date(Date.now() + 3 * 60 * 60 * 1000)
  });

  const catalogo = new Map([['900003', {
    clave: '900003',
    apiFixtureId: '900003',
    apiDate: '2026-07-01 12:00',
    busqueda: { fecha: '2026-07-01', ligaId: '', equipo1: 'A', equipo2: 'B' }
  }]]);

  const proveedor = proveedorFalso();

  try {
    await srv.refrescarFixturesPendientes(catalogo);
    assert.equal(proveedor.consultas.porId.length, 0, 'La ventana aún no ha vencido');

    // Con `forzar`, que es lo que hace un administrador al pulsar "sincronizar".
    await srv.refrescarFixturesPendientes(catalogo, { forzar: true });
    assert.equal(proveedor.consultas.porId.length, 1,
      'La petición manual sí debe saltarse la ventana');
  } finally {
    proveedor.restaurar();
  }
});

test('la ventana de consulta depende del estado y nunca se salta el inicio', () => {
  const ahora = new Date('2026-06-20T12:00:00Z');
  const minutos = (fecha) => Math.round((fecha.getTime() - ahora.getTime()) / 60000);

  // Terminado: nunca más.
  assert.equal(srv.calcularProximaConsulta('TC', '2026-06-20 06:00', ahora), null);

  // En vivo: cada minuto.
  assert.equal(minutos(srv.calcularProximaConsulta('LIVE', '2026-06-20 05:00', ahora)), 1);
  assert.equal(minutos(srv.calcularProximaConsulta('MT', '2026-06-20 05:00', ahora)), 1);

  /*
   * Costa Rica es UTC-6, así que "2026-06-20 12:30" son las 18:30 UTC: faltan
   * seis horas y media, que es la ventana "lejano".
   */
  const lejano = srv.calcularProximaConsulta('PROGRAMADO', '2026-06-20 12:30', ahora);
  assert.equal(minutos(lejano), 360, 'Un partido lejano se revisa cada seis horas');

  // "07:30" en Costa Rica son las 13:30 UTC: falta hora y media.
  const inminente = srv.calcularProximaConsulta('PROGRAMADO', '2026-06-20 07:30', ahora);
  assert.equal(minutos(inminente), 15, 'A hora y media del inicio se revisa cada quince minutos');

  /*
   * El tope que evita el error silencioso: un partido que empieza dentro de
   * cinco minutos cae en la ventana "inminente" de quince, y sin el tope se
   * consultaría por primera vez diez minutos después de haber empezado.
   */
  const casiEmpieza = srv.calcularProximaConsulta('PROGRAMADO', '2026-06-20 06:05', ahora);
  assert.equal(minutos(casiEmpieza), 5, 'La consulta se adelanta al pitido inicial');

  // Sin fecha del proveedor no hay nada que calcular: media hora.
  assert.equal(minutos(srv.calcularProximaConsulta('PROGRAMADO', '', ahora)), 30);
});

test('el cerrojo impide que dos instancias sincronicen a la vez', async () => {
  await srv.JobLock.deleteMany({ nombre: srv.CERROJO_SYNC });

  const primero = await srv.tomarCerrojo(srv.CERROJO_SYNC, 60 * 1000);
  assert.equal(primero, true, 'El primero en llegar se lo lleva');

  const segundo = await srv.tomarCerrojo(srv.CERROJO_SYNC, 60 * 1000);
  assert.equal(segundo, false, 'Mientras esté vivo, nadie más puede tomarlo');

  /*
   * Un ciclo que arranca con el cerrojo tomado se retira sin hacer nada. Eso es
   * lo que evita que N instancias del proceso web hagan N sincronizaciones
   * simultáneas, que era el hallazgo C-05.
   */
  const resultado = await srv.ejecutarCicloDeSincronizacion();
  assert.equal(resultado.omitido, true);

  await srv.soltarCerrojo(srv.CERROJO_SYNC);

  const tercero = await srv.tomarCerrojo(srv.CERROJO_SYNC, 60 * 1000);
  assert.equal(tercero, true, 'Una vez suelto, vuelve a estar disponible');

  await srv.soltarCerrojo(srv.CERROJO_SYNC);
});

test('un cerrojo caducado se puede volver a tomar', async () => {
  await srv.JobLock.deleteMany({ nombre: 'cerrojo-de-prueba' });

  // Lo toma alguien que luego "muere" sin soltarlo.
  assert.equal(await srv.tomarCerrojo('cerrojo-de-prueba', 50), true);
  assert.equal(await srv.tomarCerrojo('cerrojo-de-prueba', 50), false);

  /*
   * Sin caducidad, un proceso que cae a mitad de ciclo dejaría la
   * sincronización parada para siempre. Se comprueba pidiéndolo con un "ahora"
   * posterior al vencimiento, sin esperas reales.
   */
  const despues = new Date(Date.now() + 5 * 60 * 1000);
  assert.equal(await srv.tomarCerrojo('cerrojo-de-prueba', 50, despues), true);

  await srv.JobLock.deleteMany({ nombre: 'cerrojo-de-prueba' });
});

test('sincronizarJornadaDesdeApi se niega a correr sin contexto de quiniela', async () => {
  await assert.rejects(
    () => srv.sincronizarJornadaDesdeApi('JornadaSync'),
    /requiere contexto de quiniela/,
    'Sin contexto escribiría los resultados de una quiniela en otra'
  );
});

test('el limitador de concurrencia nunca supera su tope', async () => {
  let simultaneas = 0;
  let maximo = 0;

  const items = Array.from({ length: 20 }, (unused, indice) => indice);

  await srv.conLimiteDeConcurrencia(items, 4, async () => {
    simultaneas += 1;
    maximo = Math.max(maximo, simultaneas);
    await new Promise(resolver => setTimeout(resolver, 1));
    simultaneas -= 1;
  });

  assert.ok(maximo <= 4, `Se abrieron ${maximo} consultas a la vez, el tope es 4`);
  assert.ok(maximo > 1, 'Con tope 4 y veinte tareas debería haber paralelismo real');
});

test('un fallo del proveedor no borra el último marcador conocido', async () => {
  await srv.Fixture.deleteMany({ clave: '900004' });

  await srv.Fixture.create({
    clave: '900004',
    apiFixtureId: '900004',
    estado: 'LIVE',
    proximaConsulta: new Date(Date.now() - 60 * 1000),
    evento: eventoTerminado(900004, 'A', 'B', 1, 1)
  });

  const catalogo = new Map([['900004', {
    clave: '900004',
    apiFixtureId: '900004',
    apiDate: '2026-07-01 12:00',
    busqueda: { fecha: '2026-07-01', ligaId: '', equipo1: 'A', equipo2: 'B' }
  }]]);

  const originalPorId = srv.proveedorDeEventos.porId;
  const originalPorFecha = srv.proveedorDeEventos.porFecha;

  srv.proveedorDeEventos.porId = async () => { throw new Error('ECONNRESET'); };
  srv.proveedorDeEventos.porFecha = async () => { throw new Error('ECONNRESET'); };

  try {
    await srv.refrescarFixturesPendientes(catalogo);
  } finally {
    srv.proveedorDeEventos.porId = originalPorId;
    srv.proveedorDeEventos.porFecha = originalPorFecha;
  }

  const guardado = await srv.Fixture.findOne({ clave: '900004' }).lean();

  /*
   * Un corte de red no es información sobre el partido. Sobrescribir con vacío
   * borraría un marcador bueno y dejaría a los jugadores viendo un partido sin
   * resultado hasta la siguiente consulta afortunada.
   */
  assert.ok(guardado.evento, 'El evento anterior debe conservarse');
  assert.equal(guardado.estado, 'LIVE');
  assert.equal(guardado.fallosConsecutivos, 1);
  assert.match(guardado.ultimoError, /ECONNRESET/);

  // Y el reintento se espacia, en vez de martillear al proveedor caído.
  const espera = new Date(guardado.proximaConsulta).getTime() - Date.now();
  assert.ok(espera > 5 * 60 * 1000, 'Tras un fallo la siguiente consulta debe espaciarse');
});

/* ================================================================
 * Endurecimiento: plazos del sincronizador y robustez de la lectura
 * ================================================================ */

test('el vigilante abandona una promesa que nunca se resuelve', async () => {
  /*
   * El caso real: una petición al proveedor que se queda colgada. Sin plazo, el
   * `await` del ciclo no vuelve nunca, `cicloEnCurso` se queda en true y la
   * sincronización de esa instancia se apaga hasta el reinicio.
   */
  const nuncaTermina = new Promise(() => {});

  await assert.rejects(
    () => srv.conVigilante(nuncaTermina, 30, 'plazo agotado'),
    error => {
      assert.equal(error.message, 'plazo agotado');
      assert.equal(error.esTiempoAgotado, true, 'El fallo debe distinguirse de un error del ciclo');
      return true;
    }
  );

  // Y lo que sí termina a tiempo pasa intacto, sin que el vigilante estorbe.
  assert.equal(await srv.conVigilante(Promise.resolve('listo'), 5000, 'no debería'), 'listo');
});

test('un ciclo abandonado no suelta el cerrojo del ciclo siguiente', async () => {
  /*
   * Un ciclo que el vigilante dio por perdido puede terminar más tarde y llegar
   * a soltar el cerrojo. Si el titular fuera el proceso, soltaría el del ciclo
   * que ya está corriendo y habría dos sincronizando a la vez.
   */
  const cerrojo = 'cerrojo-de-ciclo-abandonado';
  const abandonado = 'instancia#1';
  const vigente = 'instancia#2';

  assert.equal(await srv.tomarCerrojo(cerrojo, 60 * 1000, new Date(), abandonado), true);

  // El ciclo abandonado caduca y el siguiente toma el cerrojo con su testigo.
  const despues = new Date(Date.now() + 61 * 1000);
  assert.equal(await srv.tomarCerrojo(cerrojo, 60 * 1000, despues, vigente), true);

  // Ahora el zombi termina y suelta. No es suyo: no debe soltar nada.
  await srv.soltarCerrojo(cerrojo, abandonado);
  assert.equal(await srv.tomarCerrojo(cerrojo, 60 * 1000, despues), false,
    'El cerrojo del ciclo vigente debe seguir tomado');

  // Su dueño real sí lo suelta.
  await srv.soltarCerrojo(cerrojo, vigente);
  assert.equal(await srv.tomarCerrojo(cerrojo, 60 * 1000, despues), true);
  await srv.soltarCerrojo(cerrojo);
});

test('la clasificación responde aunque no se pueda congelar la jornada', async () => {
  const { agente, datos } = await cuentaNueva('congelado');
  const quiniela = await quinielaNueva(agente, 'Congelado Tolerante');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  const partido = { equipo1: 'Alfa', equipo2: 'Beta' };

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'Jornada Tolerante', partidos: [partido] });
    await srv.ResultadoOficial.create({
      jornada: 'Jornada Tolerante',
      resultados: [{ ...partido, marcador1: 1, marcador2: 0, estado: 'TC', bloqueadoFinal: true }]
    });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'Jornada Tolerante',
      pronosticos: [{ ...partido, marcador1: 1, marcador2: 0 }]
    });
  });

  /*
   * Dos peticiones simultáneas sobre una jornada recién confirmada hacen el
   * mismo upsert y chocan contra el índice único {quinielaId, jornada}. Aquí se
   * fuerza ese 11000 en vez de esperar a que la carrera ocurra sola.
   */
  const originalUpsert = srv.PuntosJornada.findOneAndUpdate;
  const originalError = console.error;
  srv.PuntosJornada.findOneAndUpdate = function () {
    const duplicado = new Error('E11000 duplicate key error');
    duplicado.code = 11000;
    throw duplicado;
  };
  console.error = () => {};

  let respuesta;
  try {
    respuesta = await agente.get('/api/clasificacion-jornada?jornada=Jornada%20Tolerante');
  } finally {
    srv.PuntosJornada.findOneAndUpdate = originalUpsert;
    console.error = originalError;
  }

  assert.equal(respuesta.status, 200, JSON.stringify(respuesta.body));
  assert.equal(respuesta.body.estado, 'confirmada');
  assert.equal(respuesta.body.clasificacion[0].jugador, datos.username);
  assert.equal(respuesta.body.clasificacion[0].puntos, 5,
    'Sin materializado, los puntos se calculan al vuelo y dan el mismo número');
});

/* ================================================================
 * Validación de dominio y privacidad de pronósticos
 * ================================================================ */

/** Activa Admin Mode, que `requireAdmin` exige además del rol. */
async function conModoAdmin(agente, password = 'contrasena-larga-1') {
  const res = await agente.post('/api/admin-mode/activar').send({ password });
  assert.equal(res.status, 200, `No se pudo activar Admin Mode: ${JSON.stringify(res.body)}`);
}

test('normalizarMarcador rechaza lo que Number() dejaba pasar', () => {
  /*
   * Los tres casos del hallazgo: '-3', '2.5' y '1e999'. Ninguno da NaN, así que
   * la comprobación anterior los aceptaba y acababan en la base como
   * puntuación válida, corrompiendo el motor de puntos en silencio.
   */
  for (const malo of ['-3', -1, '2.5', 2.5, '1e999', Infinity, 'tres', true, {}]) {
    assert.throws(
      () => srv.normalizarMarcador(malo, 'El marcador'),
      /marcador/i,
      `Debía rechazarse: ${String(malo)}`
    );
  }

  // Y lo legítimo pasa intacto, incluido el blanco, que significa "sin pronóstico".
  assert.equal(srv.normalizarMarcador(0, 'x'), 0);
  assert.equal(srv.normalizarMarcador('7', 'x'), 7);
  assert.equal(srv.normalizarMarcador(99, 'x'), 99);
  assert.equal(srv.normalizarMarcador('', 'x'), null);
  assert.equal(srv.normalizarMarcador(null, 'x'), null);
  assert.equal(srv.normalizarMarcador(undefined, 'x'), null);
});

test('una jornada sin nombre ya no se cuela en la base', async () => {
  const { agente, datos } = await cuentaNueva('validacion');
  const quiniela = await quinielaNueva(agente, 'Validacion Jornadas');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  await conModoAdmin(agente, datos.password);

  /*
   * Mongoose casteaba el filtro `{nombre: undefined}` a `{nombre: null}`: el
   * upsert no sobrescribía nada, pero SÍ insertaba una jornada sin nombre, que
   * después aparecía como columna en la tabla general y como opción en el
   * desplegable de la tabla por jornada.
   */
  const sinNombre = await agente.post('/api/jornadas')
    .send({ partidos: [{ equipo1: 'Uno', equipo2: 'Dos' }], fechaCierre: '2027-01-01T00:00:00.000Z' });
  assert.equal(sinNombre.status, 400, JSON.stringify(sinNombre.body));
  assert.match(sinNombre.body.error, /nombre de la jornada es obligatorio/i);

  const sinPartidos = await agente.post('/api/jornadas')
    .send({ nombre: 'Vacia', partidos: [], fechaCierre: '2027-01-01T00:00:00.000Z' });
  assert.equal(sinPartidos.status, 400, JSON.stringify(sinPartidos.body));
  assert.match(sinPartidos.body.error, /al menos un partido/i);

  const equipoFaltante = await agente.post('/api/jornadas')
    .send({ nombre: 'Coja', partidos: [{ equipo1: 'Uno', equipo2: '   ' }], fechaCierre: '2027-01-01T00:00:00.000Z' });
  assert.equal(equipoFaltante.status, 400, JSON.stringify(equipoFaltante.body));
  assert.match(equipoFaltante.body.error, /los dos equipos/i);

  const total = await enQuiniela(id, () => srv.Jornada.countDocuments({}));
  assert.equal(total, 0, 'Ninguna petición inválida debe dejar rastro');
});

test('la jornada ya no tiene fecha de cierre', async () => {
  const { agente, datos } = await cuentaNueva('sinfecha');
  const quiniela = await quinielaNueva(agente, 'Sin Fecha De Cierre');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  await conModoAdmin(agente, datos.password);

  const partidos = [{ equipo1: 'Uno', equipo2: 'Dos' }];

  // Crear ya no exige fecha: el cierre lo marca la hora de cada partido.
  const creada = await agente.post('/api/jornadas').send({ nombre: 'Jornada Libre', partidos });
  assert.equal(creada.status, 200, JSON.stringify(creada.body));

  /*
   * Y si alguien la manda igualmente —una pantalla vieja en caché, un cliente
   * antiguo—, se ignora en vez de fallar: el campo ya no existe en el modelo.
   */
  const conFechaDeMas = await agente.post('/api/jornadas')
    .send({ nombre: 'Jornada Libre', partidos, fechaCierre: '2027-03-01T12:00:00.000Z' });
  assert.equal(conFechaDeMas.status, 200, JSON.stringify(conFechaDeMas.body));

  const doc = await enQuiniela(id, () => srv.Jornada.findOne({ nombre: 'Jornada Libre' }).lean());
  assert.equal(doc.fechaCierre, undefined, 'El modelo ya no guarda fecha de cierre');

  const detalle = await agente.get('/api/jornadas/Jornada%20Libre');
  assert.equal(detalle.status, 200);
  assert.ok(!('fechaCierre' in detalle.body), 'La respuesta tampoco debe traerla');
});

test('un marcador negativo o fraccionario no llega a la base', async () => {
  const { agente, datos } = await cuentaNueva('marcador');
  const quiniela = await quinielaNueva(agente, 'Marcadores Validos');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  const partido = { equipo1: 'Uno', equipo2: 'Dos' };

  await enQuiniela(id, () => srv.Jornada.create({
    nombre: 'Jornada Marcador',
    partidos: [partido],
    fechaCierre: new Date('2027-01-01')
  }));

  for (const malo of [-1, 2.5, '1e999']) {
    const res = await agente.post('/api/resultados').send({
      jugador: datos.username,
      jornada: 'Jornada Marcador',
      pronosticos: [{ marcador1: malo, marcador2: 0 }]
    });
    assert.equal(res.status, 400, `Debía rechazar ${malo}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /entero entre 0 y 99/i);
  }

  const guardado = await enQuiniela(id, () => srv.Resultado.findOne({ jornada: 'Jornada Marcador' }));
  assert.equal(guardado, null, 'Ningún pronóstico inválido debe haberse guardado');

  const bueno = await agente.post('/api/resultados').send({
    jugador: datos.username,
    jornada: 'Jornada Marcador',
    pronosticos: [{ marcador1: '3', marcador2: 0 }]
  });
  assert.equal(bueno.status, 200, JSON.stringify(bueno.body));
});

test('los pronósticos ajenos se destapan partido a partido', async () => {
  const { agente: duenoAgente, datos: dueno } = await cuentaNueva('privacidad');
  const { agente: mironAgente, datos: miron } = await cuentaNueva('miron');

  const quiniela = await quinielaNueva(duenoAgente, 'Privacidad Por Partido');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  await conModoAdmin(duenoAgente, dueno.password);

  const unirse = await mironAgente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigo });
  assert.equal(unirse.status, 202, JSON.stringify(unirse.body));

  const mironUsuario = await srv.Usuario.findOne({ usernameNormalizado: miron.username.toLowerCase() });
  const membresia = await srv.Membresia.findOne({ quinielaId: id, usuarioId: mironUsuario._id });
  const aprobar = await duenoAgente.patch(`/api/quiniela-actual/miembros/${membresia._id}/aprobar`).send({});
  assert.equal(aprobar.status, 200, JSON.stringify(aprobar.body));

  const seleccionar = await mironAgente.post(`/api/quinielas/${quiniela.id}/seleccionar`).send({});
  assert.equal(seleccionar.status, 200, JSON.stringify(seleccionar.body));

  /*
   * Una jornada a medias: el primero ya se jugó, el segundo todavía no. Es el
   * caso que la regla por jornada no sabía representar —o todo público, o todo
   * privado— y el que motivó el cambio.
   */
  const jugado = { equipo1: 'Uno', equipo2: 'Dos', apiDate: '2020-01-01 15:00' };
  const porJugar = { equipo1: 'Tres', equipo2: 'Cuatro', apiDate: '2099-01-01 15:00' };

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'Jornada Mixta', partidos: [jugado, porJugar] });
    await srv.Resultado.create({
      jugador: dueno.username,
      jornada: 'Jornada Mixta',
      pronosticos: [
        { equipo1: 'Uno', equipo2: 'Dos', marcador1: 2, marcador2: 1 },
        { equipo1: 'Tres', equipo2: 'Cuatro', marcador1: 3, marcador2: 0 }
      ]
    });
  });

  const ruta = `/api/resultados/${encodeURIComponent(dueno.username)}/Jornada%20Mixta`;

  const visto = await mironAgente.get(ruta);
  assert.equal(visto.status, 200, JSON.stringify(visto.body));
  assert.equal(visto.body[0].marcador1, 2, 'El partido ya jugado se ve');
  assert.equal(visto.body[0].marcador2, 1);
  assert.equal(visto.body[1].marcador1, null, 'El que no ha empezado sigue tapado');
  assert.equal(visto.body[1].marcador2, null);
  assert.equal(visto.body[1].oculto, true);
  assert.equal(visto.body[1].equipo1, 'Tres', 'La fila se conserva, solo se tapa el marcador');

  // La misma regla en las otras tres vías que entregan pronósticos ajenos.
  const conEquipos = await mironAgente.get(
    `/api/resultados-con-equipos/${encodeURIComponent(dueno.username)}/Jornada%20Mixta`
  );
  assert.equal(conEquipos.status, 200, JSON.stringify(conEquipos.body));
  assert.equal(conEquipos.body[0].marcador1, 2);
  assert.equal(conEquipos.body[1].marcador1, '', 'El pendiente no puede filtrarse por aquí');
  assert.equal(conEquipos.body[1].oculto, true);

  const seguro = await mironAgente
    .post(`/api/resultados-seguros/${encodeURIComponent(dueno.username)}/Jornada%20Mixta`)
    .send({});
  assert.equal(seguro.status, 200, JSON.stringify(seguro.body));
  assert.equal(seguro.body.partidos[0].marcador1, 2);
  assert.equal(seguro.body.partidos[1].marcador1, '');
  assert.equal(seguro.body.partidos[1].oculto, true);

  const listado = await mironAgente.get('/api/resultados');
  const fila = listado.body.find(([clave]) => clave === `${dueno.username}_Jornada Mixta`);
  assert.ok(fila, 'La fila viaja siempre; lo que se tapa es el marcador pendiente');
  assert.equal(fila[1][0].marcador1, 2);
  assert.equal(fila[1][1].marcador1, null);

  // Y el dueño de los pronósticos los sigue viendo enteros.
  const propios = await duenoAgente.get(ruta);
  assert.equal(propios.body[1].marcador1, 3, 'Cada quien ve sus propios pronósticos completos');

  /*
   * Cuando el segundo partido arranca, se destapa solo. Nadie tiene que
   * acordarse de cerrar nada, que es lo que se quitó de en medio.
   */
  await enQuiniela(id, () => srv.Jornada.updateOne(
    { nombre: 'Jornada Mixta' },
    { $set: { 'partidos.1.apiDate': '2020-01-02 15:00' } }
  ));

  const despues = await mironAgente.get(ruta);
  assert.equal(despues.body[1].marcador1, 3, 'Empezado el partido, su pronóstico ya es público');
  assert.equal(despues.body[1].marcador2, 0);
});

test('eliminar partidos exige índices reales y no borra de más al repetirlos', async () => {
  const { agente, datos } = await cuentaNueva('indices');
  const quiniela = await quinielaNueva(agente, 'Indices De Partido');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  await conModoAdmin(agente, datos.password);

  await enQuiniela(id, () => srv.Jornada.create({
    nombre: 'Jornada Indices',
    fechaCierre: new Date('2027-01-01'),
    partidos: [
      { equipo1: 'A', equipo2: 'B' },
      { equipo1: 'C', equipo2: 'D' },
      { equipo1: 'E', equipo2: 'F' }
    ]
  }));

  const fuera = await agente.post('/api/jornadas/eliminar-partidos')
    .send({ jornada: 'Jornada Indices', indices: [7] });
  assert.equal(fuera.status, 400, JSON.stringify(fuera.body));

  // Repetido: antes cada `splice` corría la lista y el segundo borraba al vecino.
  const repetido = await agente.post('/api/jornadas/eliminar-partidos')
    .send({ jornada: 'Jornada Indices', indices: [1, 1] });
  assert.equal(repetido.status, 200, JSON.stringify(repetido.body));

  const doc = await enQuiniela(id, () => srv.Jornada.findOne({ nombre: 'Jornada Indices' }).lean());
  assert.deepEqual(doc.partidos.map(p => p.equipo1), ['A', 'E'],
    'Solo debe desaparecer el partido señalado');
});

/* ================================================================
 * La caché del ranking sobrevive a los ciclos que no cambian nada
 * ================================================================ */

/** Evento de un partido en curso, con el minuto que avanza en cada consulta. */
function eventoEnVivo(idPartido, local, visita, golesLocal, golesVisita, minuto) {
  return {
    match_id: String(idPartido),
    match_status: String(minuto),
    match_live: '1',
    match_hometeam_name: local,
    match_awayteam_name: visita,
    match_hometeam_score: String(golesLocal),
    match_awayteam_score: String(golesVisita),
    match_hometeam_ft_score: String(golesLocal),
    match_awayteam_ft_score: String(golesVisita),
    goalscorer: [],
    cards: []
  };
}

test('puntosPuedenHaberCambiado ignora el minuto y ve el marcador', () => {
  const base = { equipo1: 'Uno', equipo2: 'Dos', marcador1: 1, marcador2: 0, estado: 'LIVE', minuto: 20, comodin: false };

  /*
   * El caso que motivó todo esto: el partido sigue igual, solo corre el reloj.
   * Si esto devolviera true, la caché del ranking se vaciaría cada minuto
   * durante los noventa del partido.
   */
  assert.equal(
    srv.puntosPuedenHaberCambiado([base], [{ ...base, minuto: 21 }]),
    false,
    'El minuto no mueve la puntuación de nadie'
  );

  // Un gol sí.
  assert.equal(srv.puntosPuedenHaberCambiado([base], [{ ...base, marcador2: 1 }]), true);

  // El pitido final también: es lo que congela la jornada.
  assert.equal(srv.puntosPuedenHaberCambiado([base], [{ ...base, estado: 'TC', bloqueadoFinal: true }]), true);

  // Y marcar el partido como comodín multiplica los puntos.
  assert.equal(srv.puntosPuedenHaberCambiado([base], [{ ...base, comodin: true }]), true);

  // Añadir o quitar partidos cambia la jornada entera.
  assert.equal(srv.puntosPuedenHaberCambiado([base], [base, base]), true);
  assert.equal(srv.puntosPuedenHaberCambiado(undefined, [base]), true);

  /*
   * Si el proveedor devuelve los equipos al revés, el marcador cambia de
   * significado. Por eso se empareja por equipos y no por posición.
   */
  const invertido = { ...base, equipo1: 'Dos', equipo2: 'Uno', marcador1: 0, marcador2: 1 };
  assert.equal(srv.puntosPuedenHaberCambiado([base], [invertido]), true);
});

test('un sync que no cambia nada deja la caché del ranking en pie', async () => {
  const { agente, datos } = await cuentaNueva('cacheviva');
  const quiniela = await quinielaNueva(agente, 'Cache Del Ranking');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const partido = {
    equipo1: 'Alfa',
    equipo2: 'Beta',
    apiFixtureId: '900010',
    apiDate: '2026-06-20 15:00'
  };

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'JornadaEnVivo', partidos: [partido] });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'JornadaEnVivo',
      pronosticos: [{ equipo1: 'Alfa', equipo2: 'Beta', marcador1: 1, marcador2: 0 }]
    });
  });

  await srv.Fixture.deleteMany({ clave: '900010' });

  // Minuto 20: 1-0. Este ciclo sí cambia el marcador y debe invalidar.
  let proveedor = proveedorFalso({ 900010: eventoEnVivo(900010, 'Alfa', 'Beta', 1, 0, 20) });
  try {
    await enQuiniela(id, () => srv.sincronizarJornadaDesdeApi('JornadaEnVivo', { forzar: true }));
  } finally {
    proveedor.restaurar();
  }

  // Se calienta la caché.
  const primera = await agente.get('/api/resultados-totales');
  assert.equal(primera.status, 200, JSON.stringify(primera.body));

  const originalFind = srv.Jornada.find;
  let lecturasDeJornadas = 0;
  srv.Jornada.find = function (...args) {
    lecturasDeJornadas += 1;
    return originalFind.apply(this, args);
  };

  try {
    // Minuto 21: el reloj corre, el marcador no. No debe invalidar nada.
    const antes = srv.metricasSync.syncsSinCambioDePuntos;

    proveedor = proveedorFalso({ 900010: eventoEnVivo(900010, 'Alfa', 'Beta', 1, 0, 21) });
    try {
      await enQuiniela(id, () => srv.sincronizarJornadaDesdeApi('JornadaEnVivo', { forzar: true }));
    } finally {
      proveedor.restaurar();
    }

    assert.equal(srv.metricasSync.syncsSinCambioDePuntos, antes + 1,
      'El sync sin cambios debe contarse como tal');

    const segunda = await agente.get('/api/resultados-totales');
    assert.equal(segunda.status, 200);
    assert.equal(lecturasDeJornadas, 0,
      'La tabla debe salir de caché: el minuto no movió la puntuación de nadie');

    // Pero el minuto sí llegó a la base, que es lo que ven las pantallas en vivo.
    const oficial = await enQuiniela(id, () => srv.ResultadoOficial.findOne({ jornada: 'JornadaEnVivo' }));
    assert.equal(oficial.resultados[0].minuto, 21, 'El documento se reescribe igualmente');

    // Y ahora un gol: eso sí tiene que tirar la caché.
    proveedor = proveedorFalso({ 900010: eventoEnVivo(900010, 'Alfa', 'Beta', 2, 0, 30) });
    try {
      await enQuiniela(id, () => srv.sincronizarJornadaDesdeApi('JornadaEnVivo', { forzar: true }));
    } finally {
      proveedor.restaurar();
    }

    const tercera = await agente.get('/api/resultados-totales');
    assert.equal(tercera.status, 200);
    assert.ok(lecturasDeJornadas > 0, 'Un gol debe invalidar la caché y recalcular');
  } finally {
    srv.Jornada.find = originalFind;
  }
});

/* ================================================================
 * Transacciones: una secuencia a medias no debe dejar rastro
 * ================================================================ */

/**
 * Hace que un método de un modelo falle una sola vez.
 *
 * Se sustituye el método real en el propio modelo que usa el servidor, que es
 * la única forma de provocar el fallo EN MITAD de la secuencia sin tocar el
 * código de producción para hacerlo comprobable.
 */
function fallaUnaVez(objeto, metodo, mensaje = 'fallo provocado por la prueba') {
  const original = objeto[metodo];
  let usado = false;

  objeto[metodo] = function (...args) {
    if (!usado) {
      usado = true;
      return Promise.reject(new Error(mensaje));
    }
    return original.apply(this, args);
  };

  return { restaurar() { objeto[metodo] = original; } };
}

test('crear quiniela: si falla la membresía, no queda la quiniela suelta', async () => {
  const { agente } = await cuentaNueva('tx_crear');

  const antes = await srv.Quiniela.countDocuments({ nombre: 'Quiniela Atomica' });
  assert.equal(antes, 0);

  const trampa = fallaUnaVez(srv.Membresia, 'create');
  let respuesta;
  try {
    respuesta = await agente.post('/api/quinielas').send({ nombre: 'Quiniela Atomica' });
  } finally {
    trampa.restaurar();
  }

  assert.equal(respuesta.status, 500, JSON.stringify(respuesta.body));

  /*
   * Lo que se comprueba: sin transacción, la quiniela ya estaba escrita cuando
   * falló la membresía, y quedaba una quiniela cuyo propietario no es miembro
   * de ella. No aparece en su lista y no puede entrar: invisible e inaccesible,
   * pero ocupando el nombre y el código de ingreso.
   */
  assert.equal(
    await srv.Quiniela.countDocuments({ nombre: 'Quiniela Atomica' }),
    0,
    'La quiniela no debe sobrevivir al fallo de la membresía'
  );

  // Y después del fallo, crear de verdad sigue funcionando.
  const buena = await agente.post('/api/quinielas').send({ nombre: 'Quiniela Atomica' });
  assert.equal(buena.status, 201, JSON.stringify(buena.body));

  const quinielaId = new mongoose.Types.ObjectId(buena.body.quiniela._id);
  const membresia = await srv.Membresia.findOne({ quinielaId, rol: 'propietario' });
  assert.ok(membresia, 'El propietario sí debe ser miembro cuando la creación va bien');
});

test('transferir propiedad: si falla a mitad, no quedan dos propietarios', async () => {
  const { agente: duenoAgente, datos: dueno } = await cuentaNueva('tx_dueno');
  const { agente: socioAgente, datos: socio } = await cuentaNueva('tx_socio');

  const quiniela = await quinielaNueva(duenoAgente, 'Traspaso Atomico');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await duenoAgente.post('/api/admin-mode/activar').send({ password: dueno.password });

  const unirse = await socioAgente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigo });
  assert.equal(unirse.status, 202, JSON.stringify(unirse.body));

  const socioUsuario = await srv.Usuario.findOne({ usernameNormalizado: socio.username.toLowerCase() });
  const membresiaSocio = await srv.Membresia.findOne({ quinielaId: id, usuarioId: socioUsuario._id });

  await duenoAgente.patch(`/api/quiniela-actual/miembros/${membresiaSocio._id}/aprobar`).send({});
  await duenoAgente.patch(`/api/quiniela-actual/miembros/${membresiaSocio._id}/rol`).send({ rol: 'admin' });

  /*
   * La transferencia son tres escrituras: el nuevo propietario, el antiguo y la
   * quiniela. Se hace fallar la de la quiniela, que es la última.
   */
  const trampa = fallaUnaVez(srv.Quiniela.prototype, 'save');
  let respuesta;
  try {
    respuesta = await duenoAgente.post('/api/quiniela-actual/transferir-propiedad')
      .send({ usuarioId: String(socioUsuario._id) });
  } finally {
    trampa.restaurar();
  }

  assert.equal(respuesta.status, 500, JSON.stringify(respuesta.body));

  // Sin transacción, aquí había DOS propietarios: el socio ascendido y el dueño.
  const membresias = await srv.Membresia.find({ quinielaId: id });
  const propietarios = membresias.filter(m => m.rol === 'propietario');
  assert.equal(propietarios.length, 1, 'Debe seguir habiendo exactamente un propietario');
  assert.equal(String(propietarios[0].usuarioId), String((await srv.Usuario.findOne({
    usernameNormalizado: dueno.username.toLowerCase()
  }))._id), 'Y debe ser el original');

  const quinielaDoc = await srv.Quiniela.findById(id);
  assert.equal(
    String(quinielaDoc.propietarioId),
    String(propietarios[0].usuarioId),
    'La quiniela y las membresías no pueden discrepar sobre quién manda'
  );
});

test('borrar jornada: si falla un borrado, la jornada sigue entera', async () => {
  const { agente, datos } = await cuentaNueva('tx_borrar');
  const quiniela = await quinielaNueva(agente, 'Borrado Atomico');
  const id = new mongoose.Types.ObjectId(quiniela.id);
  await agente.post('/api/admin-mode/activar').send({ password: datos.password });

  const partido = { equipo1: 'Uno', equipo2: 'Dos' };

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'Jornada Atomica', partidos: [partido] });
    await srv.Resultado.create({
      jugador: datos.username,
      jornada: 'Jornada Atomica',
      pronosticos: [{ ...partido, marcador1: 1, marcador2: 0 }]
    });
    await srv.ResultadoOficial.create({
      jornada: 'Jornada Atomica',
      resultados: [{ ...partido, marcador1: 1, marcador2: 0, estado: 'TC', bloqueadoFinal: true }]
    });
  });

  // El último de los cuatro borrados falla.
  const trampa = fallaUnaVez(srv.PuntosJornada, 'deleteMany');
  let respuesta;
  try {
    respuesta = await agente.delete('/api/jornadas/Jornada%20Atomica');
  } finally {
    trampa.restaurar();
  }

  assert.equal(respuesta.status, 500, JSON.stringify(respuesta.body));

  /*
   * Sin transacción quedaban pronósticos y puntos congelados de una jornada que
   * ya no existía. La tabla general los seguía sumando al total sin una columna
   * a la que pertenecer: los puntos de todos salían mal y nada decía por qué.
   */
  await enQuiniela(id, async () => {
    assert.ok(
      await srv.Jornada.findOne({ nombre: 'Jornada Atomica' }),
      'La jornada debe seguir existiendo'
    );
    assert.ok(
      await srv.Resultado.findOne({ jornada: 'Jornada Atomica' }),
      'Y sus pronósticos con ella'
    );
    assert.ok(
      await srv.ResultadoOficial.findOne({ jornada: 'Jornada Atomica' }),
      'Y sus resultados oficiales'
    );
  });

  // Sin la trampa, el borrado se lleva las cuatro colecciones.
  const buena = await agente.delete('/api/jornadas/Jornada%20Atomica');
  assert.equal(buena.status, 200, JSON.stringify(buena.body));

  await enQuiniela(id, async () => {
    assert.equal(await srv.Jornada.countDocuments({ nombre: 'Jornada Atomica' }), 0);
    assert.equal(await srv.Resultado.countDocuments({ jornada: 'Jornada Atomica' }), 0);
    assert.equal(await srv.ResultadoOficial.countDocuments({ jornada: 'Jornada Atomica' }), 0);
    assert.equal(await srv.PuntosJornada.countDocuments({ jornada: 'Jornada Atomica' }), 0);
  });
});

test('enTransaccion revierte lo ya escrito cuando la operación falla', async () => {
  const { agente } = await cuentaNueva('tx_directo');
  const quiniela = await quinielaNueva(agente, 'Reversion Directa');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await assert.rejects(
    () => enQuiniela(id, () => srv.enTransaccion(async sesion => {
      await srv.Jornada.create([{ nombre: 'Se Revierte', partidos: [{ equipo1: 'A', equipo2: 'B' }] }], { session: sesion });
      throw new Error('a mitad');
    })),
    /a mitad/
  );

  const quedan = await enQuiniela(id, () => srv.Jornada.countDocuments({ nombre: 'Se Revierte' }));
  assert.equal(quedan, 0, 'Lo escrito antes del fallo no debe quedar');

  // Y cuando no falla, se confirma.
  await enQuiniela(id, () => srv.enTransaccion(async sesion =>
    srv.Jornada.create([{ nombre: 'Se Confirma', partidos: [{ equipo1: 'A', equipo2: 'B' }] }], { session: sesion })
  ));

  assert.equal(
    await enQuiniela(id, () => srv.Jornada.countDocuments({ nombre: 'Se Confirma' })),
    1
  );
});

/* ================================================================
 * M-26: acotar lo que devuelven los listados
 * ================================================================ */

test('los listados aceptan acotarse sin romper a quien no los acota', async () => {
  const { agente, datos } = await cuentaNueva('m26');
  const quiniela = await quinielaNueva(agente, 'Listados Acotados');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const partido = { equipo1: 'Uno', equipo2: 'Dos' };

  await enQuiniela(id, async () => {
    for (const nombre of ['J1', 'J2']) {
      await srv.Jornada.create({ nombre, partidos: [partido] });
      await srv.ResultadoOficial.create({
        jornada: nombre,
        resultados: [{ ...partido, marcador1: 1, marcador2: 0, estado: 'TC', bloqueadoFinal: true }]
      });
      await srv.Resultado.create({
        jugador: datos.username,
        jornada: nombre,
        pronosticos: [{ ...partido, marcador1: 1, marcador2: 0 }]
      });
    }
  });

  /* ---------- Jornadas: resumen ---------- */

  const completas = await agente.get('/api/jornadas');
  assert.equal(completas.status, 200);
  assert.equal(completas.body.length, 2);
  assert.ok(completas.body[0].partidos, 'Sin parámetros sigue trayendo los partidos');

  const resumen = await agente.get('/api/jornadas?resumen=1');
  assert.equal(resumen.status, 200);
  assert.equal(resumen.body.length, 2);
  assert.ok(
    !('partidos' in resumen.body[0]),
    'El resumen no debe traer los partidos: es justo lo que se quiere ahorrar'
  );

  /* ---------- Resultados oficiales: por jornada ---------- */

  const todosOficiales = await agente.get('/api/resultados-oficiales');
  assert.equal(todosOficiales.body.length, 2);

  const unoOficial = await agente.get('/api/resultados-oficiales?jornada=J1');
  assert.equal(unoOficial.body.length, 1);
  assert.equal(unoOficial.body[0].nombre, 'J1');

  /* ---------- Pronósticos: por jornada ---------- */

  const todosPronosticos = await agente.get('/api/resultados');
  assert.equal(todosPronosticos.body.length, 2, 'Sin filtro llegan las dos jornadas');

  const unoPronostico = await agente.get('/api/resultados?jornada=J2');
  assert.equal(unoPronostico.body.length, 1);
  assert.equal(unoPronostico.body[0][0], `${datos.username}_J2`);

  // Una jornada que no existe devuelve vacío, no un error.
  const ninguna = await agente.get('/api/resultados?jornada=NoExiste');
  assert.equal(ninguna.status, 200);
  assert.deepEqual(ninguna.body, []);
});

test('acotar por jornada no debilita la privacidad de los pronósticos', async () => {
  const dueno = await cuentaNueva('m26_d');
  const miron = await cuentaNueva('m26_m');

  const quiniela = await quinielaNueva(dueno.agente, 'Privacidad Acotada');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await dueno.agente.post('/api/admin-mode/activar').send({ password: dueno.datos.password });

  const unirse = await miron.agente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigo });
  assert.equal(unirse.status, 202);

  const usuarioMiron = await srv.Usuario.findOne({ usernameNormalizado: miron.datos.username.toLowerCase() });
  const membresia = await srv.Membresia.findOne({ quinielaId: id, usuarioId: usuarioMiron._id });
  await dueno.agente.patch(`/api/quiniela-actual/miembros/${membresia._id}/aprobar`).send({});
  await miron.agente.post(`/api/quinielas/${quiniela.id}/seleccionar`).send({});

  const porJugar = { equipo1: 'Uno', equipo2: 'Dos', apiDate: '2099-01-01 15:00' };

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'Futura', partidos: [porJugar] });
    await srv.Resultado.create({
      jugador: dueno.datos.username,
      jornada: 'Futura',
      pronosticos: [{ equipo1: 'Uno', equipo2: 'Dos', marcador1: 4, marcador2: 2 }]
    });
  });

  /*
   * El filtro es una optimización de lectura, no una puerta: acotar a la
   * jornada no puede saltarse el tapado partido a partido.
   */
  const acotado = await miron.agente.get('/api/resultados?jornada=Futura');
  assert.equal(acotado.status, 200);
  assert.equal(acotado.body.length, 1);

  const [, pronosticos] = acotado.body[0];
  assert.equal(pronosticos[0].marcador1, null, 'El partido sin empezar sigue tapado');
  assert.equal(pronosticos[0].oculto, true);
});

/* ================= Fase B: cuál es "la jornada actual" ================= */

/*
 * La regla es "la última jornada que se creó", y lo que hay que probar de ella
 * no es el orden —eso lo hace Mongo— sino las dos cosas que se han roto de
 * verdad: que el orden exista (el `sort({ createdAt: -1 })` anterior ordenaba
 * por un campo que el esquema nunca declaró, así que no ordenaba nada), y que
 * las tres pantallas usen LA MISMA, que es lo que motivó la fase.
 */

test('Fase B: la jornada actual es la última que se creó', async () => {
  const dueno = await cuentaNueva('faseb');
  const quiniela = await quinielaNueva(dueno.agente, 'Jornada Actual');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  /*
   * Las fechas de los partidos van al revés del orden de creación a propósito:
   * la que se crea LA ÚLTIMA tiene los partidos MÁS VIEJOS. Así la prueba
   * distingue de verdad qué regla está aplicando el servidor, y no pasaría por
   * casualidad si alguien volviera a ordenar por fechas.
   */
  await enQuiniela(id, async () => {
    await srv.Jornada.create({
      nombre: 'Creada primero',
      partidos: [{ equipo1: 'Uno', equipo2: 'Dos', apiDate: '2026-12-01 15:00' }]
    });
    await srv.Jornada.create({
      nombre: 'Creada después',
      partidos: [{ equipo1: 'Tres', equipo2: 'Cuatro', apiDate: '2020-01-01 15:00' }]
    });
  });

  const actual = await dueno.agente.get('/api/jornada-actual');
  assert.equal(actual.status, 200);
  assert.equal(actual.body.sugerida, 'Creada después');

  // Y la lista viene con la más nueva primero, para llenar el desplegable.
  assert.deepEqual(
    actual.body.jornadas.map(j => j.nombre),
    ['Creada después', 'Creada primero']
  );
});

test('Fase B: el orden sale del _id, no de un createdAt que no existe', async () => {
  /*
   * El esquema de Jornada nunca declaró `timestamps`, así que sus documentos NO
   * tienen `createdAt`: el `sort({ createdAt: -1 })` que había ordenaba por un
   * campo ausente. Esta prueba fija las dos mitades del arreglo —que el campo
   * sigue sin existir, y que aun así el orden es el de creación— para que nadie
   * vuelva a ordenar por ahí creyendo que funciona.
   */
  const dueno = await cuentaNueva('fasebid');
  const quiniela = await quinielaNueva(dueno.agente, 'Orden Real');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const nombres = ['Primera', 'Segunda', 'Tercera'];

  await enQuiniela(id, async () => {
    for (const nombre of nombres) {
      await srv.Jornada.create({
        nombre,
        partidos: [{ equipo1: 'Uno', equipo2: 'Dos', apiDate: '2026-09-01 15:00' }]
      });
    }
  });

  const guardada = await enQuiniela(id, () => srv.Jornada.findOne({ nombre: 'Primera' }).lean());
  assert.equal(guardada.createdAt, undefined, 'Si esto falla, el esquema ganó timestamps y la regla puede simplificarse');

  const actual = await dueno.agente.get('/api/jornada-actual');
  assert.equal(actual.body.sugerida, 'Tercera');
});

test('Fase B: editar una jornada no la convierte en la más reciente', async () => {
  /*
   * La ruta que guarda jornadas hace `upsert` por nombre, así que editar una
   * conserva su `_id` y con él su puesto. Si en algún momento pasara a borrar y
   * recrear, corregir una falta de ortografía en una jornada vieja la
   * ascendería a jornada actual, y nadie relacionaría una cosa con la otra.
   */
  const dueno = await cuentaNueva('fasebedit');
  const quiniela = await quinielaNueva(dueno.agente, 'Editar No Asciende');
  await dueno.agente.post('/api/admin-mode/activar').send({ password: dueno.datos.password });

  const partido = [{ equipo1: 'Uno', equipo2: 'Dos', apiDate: '2026-09-01 15:00' }];

  await dueno.agente.post('/api/jornadas').send({ nombre: 'Vieja', partidos: partido });
  await dueno.agente.post('/api/jornadas').send({ nombre: 'Nueva', partidos: partido });

  assert.equal((await dueno.agente.get('/api/jornada-actual')).body.sugerida, 'Nueva');

  // Se reedita la vieja: cambia un partido, no su antigüedad.
  const editada = await dueno.agente.post('/api/jornadas').send({
    nombre: 'Vieja',
    partidos: [{ equipo1: 'Uno', equipo2: 'Dos corregido', apiDate: '2026-09-01 15:00' }]
  });
  assert.equal(editada.status, 200);

  assert.equal((await dueno.agente.get('/api/jornada-actual')).body.sugerida, 'Nueva');
});

test('Fase B: la tabla por jornada abre en la misma que el endpoint', async () => {
  const dueno = await cuentaNueva('fasebtabla');
  const quiniela = await quinielaNueva(dueno.agente, 'Tabla Coincide');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, async () => {
    await srv.Jornada.create({ nombre: 'Antigua', partidos: [{ equipo1: 'Uno', equipo2: 'Dos' }] });
    await srv.Jornada.create({ nombre: 'Reciente', partidos: [{ equipo1: 'Tres', equipo2: 'Cuatro' }] });
  });

  const tabla = await dueno.agente.get('/api/clasificacion-jornada');
  assert.equal(tabla.status, 200);
  assert.equal(tabla.body.jornada, 'Reciente');

  // Pedir otra explícitamente sigue funcionando: la regla sugiere, no impone.
  const otra = await dueno.agente.get('/api/clasificacion-jornada').query({ jornada: 'Antigua' });
  assert.equal(otra.status, 200);
  assert.equal(otra.body.jornada, 'Antigua');
});

test('Fase B: sin jornadas el endpoint responde vacío, no falla', async () => {
  const dueno = await cuentaNueva('fasebvacio');
  await quinielaNueva(dueno.agente, 'Sin Jornadas');

  const actual = await dueno.agente.get('/api/jornada-actual');
  assert.equal(actual.status, 200);
  assert.equal(actual.body.sugerida, null);
  assert.deepEqual(actual.body.jornadas, []);

  const tabla = await dueno.agente.get('/api/clasificacion-jornada');
  assert.equal(tabla.status, 200);
  assert.equal(tabla.body.jornada, null);
});

test('Fase B: la jornada actual no cruza entre quinielas', async () => {
  const uno = await cuentaNueva('fasebA');
  const dos = await cuentaNueva('fasebB');

  const quinielaUno = await quinielaNueva(uno.agente, 'Actual A');
  const quinielaDos = await quinielaNueva(dos.agente, 'Actual B');

  await enQuiniela(new mongoose.Types.ObjectId(quinielaUno.id), async () => {
    await srv.Jornada.create({ nombre: 'Solo de A', partidos: [{ equipo1: 'Uno', equipo2: 'Dos' }] });
  });

  await enQuiniela(new mongoose.Types.ObjectId(quinielaDos.id), async () => {
    await srv.Jornada.create({ nombre: 'Solo de B', partidos: [{ equipo1: 'Tres', equipo2: 'Cuatro' }] });
  });

  /*
   * El endpoint lee TODAS las jornadas para decidir. Si se le olvidara el
   * contexto de inquilino —que es el fallo C-02 y ya pasó una vez— cada quiniela
   * vería las jornadas de la otra, y aquí saldría 2 en vez de 1.
   */
  const desdeA = await uno.agente.get('/api/jornada-actual');
  const desdeB = await dos.agente.get('/api/jornada-actual');

  assert.equal(desdeA.body.sugerida, 'Solo de A');
  assert.equal(desdeA.body.jornadas.length, 1);
  assert.equal(desdeB.body.sugerida, 'Solo de B');
  assert.equal(desdeB.body.jornadas.length, 1);
});

/* ================================================================
 * Fase C — Buscador de ligas dinámico (petición 9)
 * ================================================================ */

/**
 * Sustituye la consulta por rango del proveedor por una lista fija.
 *
 * Es la misma costura que usa `proveedorFalso` para las consultas por id: lo
 * que se prueba es qué hace el servidor con la respuesta, no que sepa hablar
 * HTTP con nadie.
 */
function proveedorDeRangoFalso(partidos = []) {
  const original = srv.proveedorDeEventos.porRango;
  const llamadas = [];

  srv.proveedorDeEventos.porRango = async (argumentos) => {
    llamadas.push(argumentos);
    return partidos;
  };

  return {
    llamadas,
    restaurar() { srv.proveedorDeEventos.porRango = original; }
  };
}

/** Un evento ya traducido, como el que devuelve `porRango`. */
function partidoDeLiga(liga, pais, ligaId, equipos = ['Uno', 'Dos']) {
  return {
    apiFixtureId: Math.floor(Math.random() * 1e9),
    fecha: '2026-08-20 15:00',
    estado: 'NS',
    liga,
    pais,
    apiLeagueId: ligaId,
    equipo1: equipos[0],
    equipo2: equipos[1]
  };
}

test('Fase C: rangoDeBusqueda cuenta siete días incluyendo el primero', () => {
  const rango = srv.rangoDeBusqueda({ desde: '2026-08-19', dias: 7 });

  assert.equal(rango.desde, '2026-08-19');
  assert.equal(rango.hasta, '2026-08-25');
  assert.equal(rango.dias, 7);
});

test('Fase C: el rango cruza el fin de año sin descuadrarse', () => {
  /*
   * Sumar días a mano sobre el texto de la fecha es el error clásico aquí, y
   * solo se nota en diciembre. Se fija ahora y no cuando pase.
   */
  const rango = srv.rangoDeBusqueda({ desde: '2026-12-30', dias: 5 });

  assert.equal(rango.hasta, '2027-01-03');
});

test('Fase C: los días se acotan y nunca revientan la consulta', () => {
  // Un `dias` absurdo en la URL costaría un año de cuota del proveedor.
  assert.equal(srv.normalizarDias('999'), 30);
  assert.equal(srv.normalizarDias('abc'), 7);
  assert.equal(srv.normalizarDias(''), 7);
  assert.equal(srv.normalizarDias(0), 7);
  assert.equal(srv.normalizarDias(-3), 7);
  assert.equal(srv.normalizarDias('3'), 3);
});

test('Fase C: las ligas se agrupan por país y se cuentan sus partidos', () => {
  const paises = srv.agruparLigasPorPais([
    partidoDeLiga('Liga MX', 'Mexico', 1),
    partidoDeLiga('Liga MX', 'Mexico', 1),
    partidoDeLiga('Primera Division', 'Costa Rica', 3),
    partidoDeLiga('UEFA Champions League', '', 9)
  ]);

  const mexico = paises.find(p => p.pais === 'Mexico');
  assert.equal(mexico.ligas.length, 1);
  assert.equal(mexico.ligas[0].partidos, 2);
  assert.equal(mexico.ligas[0].id, '1');

  // Los internacionales van al final y bajo su propio rótulo.
  assert.equal(paises[paises.length - 1].pais, 'Internacional');
});

test('Fase C: las competiciones bloqueadas no llegan al desplegable', () => {
  const paises = srv.agruparLigasPorPais([
    partidoDeLiga('Liga MX', 'Mexico', 1),
    partidoDeLiga('Liga MX Femenil', 'Mexico', 2),
    partidoDeLiga('Primera Division U20', 'Costa Rica', 4),
    partidoDeLiga('Bundesliga Reserves', 'Germany', 5)
  ]);

  const nombres = paises.flatMap(p => p.ligas.map(l => l.nombre));
  assert.deepEqual(nombres, ['Liga MX']);
});

test('Fase C: el endpoint devuelve las ligas del rango, agrupadas', async () => {
  const { agente } = await cuentaNueva('ligasA');
  await quinielaNueva(agente, 'Quiniela Ligas');
  await conModoAdmin(agente);

  const proveedor = proveedorDeRangoFalso([
    partidoDeLiga('Liga MX', 'Mexico', 1),
    partidoDeLiga('Primera Division', 'Costa Rica', 3),
    partidoDeLiga('Primera Division Femenina', 'Costa Rica', 7)
  ]);

  try {
    const res = await agente.get('/api/football/ligas-disponibles?dias=7&desde=2026-08-19');

    assert.equal(res.status, 200);
    assert.equal(res.body.desde, '2026-08-19');
    assert.equal(res.body.hasta, '2026-08-25');
    assert.equal(res.body.dias, 7);

    // Se pidió al proveedor exactamente el rango calculado, ni un día más.
    assert.equal(proveedor.llamadas.length, 1);
    assert.equal(proveedor.llamadas[0].desde, '2026-08-19');
    assert.equal(proveedor.llamadas[0].hasta, '2026-08-25');

    const nombres = res.body.paises.flatMap(p => p.ligas.map(l => l.nombre));
    assert.deepEqual(nombres.sort(), ['Liga MX', 'Primera Division']);
  } finally {
    proveedor.restaurar();
  }
});

test('Fase C: un rango sin partidos responde vacío, no falla', async () => {
  const { agente } = await cuentaNueva('ligasB');
  await quinielaNueva(agente, 'Quiniela Sin Partidos');
  await conModoAdmin(agente);

  const proveedor = proveedorDeRangoFalso([]);

  try {
    /*
     * Fecha propia a propósito. La caché va por rango y NO por quiniela —una
     * liga tiene partidos o no los tiene, y eso no depende de quién pregunte—,
     * así que reutilizar el rango de otra prueba devolvería lo que aquélla dejó
     * guardado. Pasó al escribir esto.
     */
    const res = await agente.get('/api/football/ligas-disponibles?desde=2026-10-05');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.paises, []);
    assert.equal(res.body.partidos, 0);
  } finally {
    proveedor.restaurar();
  }
});

test('Fase C: la segunda consulta del mismo rango sale de la caché', async () => {
  const { agente } = await cuentaNueva('ligasC');
  await quinielaNueva(agente, 'Quiniela Cache');
  await conModoAdmin(agente);

  const proveedor = proveedorDeRangoFalso([partidoDeLiga('Liga MX', 'Mexico', 1)]);

  try {
    /*
     * Quien arma una jornada abre esta pantalla varias veces seguidas. Sin
     * caché, cada apertura sería otra consulta al proveedor por el mismo rango.
     * La fecha es distinta a la de las otras pruebas para no compartir entrada.
     */
    const primera = await agente.get('/api/football/ligas-disponibles?desde=2026-09-01');
    const segunda = await agente.get('/api/football/ligas-disponibles?desde=2026-09-01');

    assert.equal(primera.body.deCache, false);
    assert.equal(segunda.body.deCache, true);
    assert.equal(proveedor.llamadas.length, 1, 'El proveedor se consultó dos veces');
    assert.deepEqual(segunda.body.paises, primera.body.paises);
  } finally {
    proveedor.restaurar();
  }
});

test('Fase C: la lista de ligas exige ser administrador', async () => {
  const duena = await cuentaNueva('ligasDuena');
  const quiniela = await quinielaNueva(duena.agente, 'Quiniela Ajena');

  const miembro = await cuentaNueva('ligasMiembro');
  const unirse = await miembro.agente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigo });
  assert.equal(unirse.status, 202, JSON.stringify(unirse.body));

  // Unirse deja la membresía pendiente: sin aprobar no hay quiniela activa.
  await conModoAdmin(duena.agente);
  const usuarioMiembro = await srv.Usuario.findOne({ usernameNormalizado: miembro.datos.username.toLowerCase() });
  const membresia = await srv.Membresia.findOne({
    quinielaId: new mongoose.Types.ObjectId(quiniela.id),
    usuarioId: usuarioMiembro._id
  });
  await duena.agente.patch(`/api/quiniela-actual/miembros/${membresia._id}/aprobar`).send({});
  await miembro.agente.post(`/api/quinielas/${quiniela.id}/seleccionar`).send({});

  const proveedor = proveedorDeRangoFalso([partidoDeLiga('Liga MX', 'Mexico', 1)]);

  try {
    /*
     * Sin esta puerta, cualquier miembro podría gastar la cuota del proveedor
     * recargando la ruta. Y la dueña tampoco entra sin Admin Mode.
     */
    const comoMiembro = await miembro.agente.get('/api/football/ligas-disponibles');
    assert.equal(comoMiembro.status, 403);

    /*
     * Y sin Admin Mode tampoco entra quien sí es propietaria. Se comprueba con
     * una cuenta aparte porque la de arriba ya lo activó para aprobar.
     */
    const otra = await cuentaNueva('ligasSinModo');
    await quinielaNueva(otra.agente, 'Quiniela Sin Modo');
    const sinModoAdmin = await otra.agente.get('/api/football/ligas-disponibles');
    assert.equal(sinModoAdmin.status, 401);

    assert.equal(proveedor.llamadas.length, 0, 'Se consultó al proveedor sin permisos');
  } finally {
    proveedor.restaurar();
  }
});

test('Fase C: la búsqueda de partidos también descarta lo bloqueado', async () => {
  const { agente } = await cuentaNueva('fixturesA');
  await quinielaNueva(agente, 'Quiniela Fixtures');
  await conModoAdmin(agente);

  const proveedor = proveedorDeRangoFalso([
    partidoDeLiga('Liga MX', 'Mexico', 1),
    partidoDeLiga('Liga MX Femenil', 'Mexico', 2)
  ]);

  try {
    /*
     * Antes esta ruta devolvía todo y el filtro vivía en el navegador, donde
     * además solo se aplicaba si había un torneo elegido. Ahora la regla está
     * en un solo sitio y vale para las dos rutas que leen del proveedor.
     */
    const res = await agente.get('/api/football/fixtures?date=2026-08-19');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(p => p.liga), ['Liga MX']);
  } finally {
    proveedor.restaurar();
  }
});

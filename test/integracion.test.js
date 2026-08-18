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
const { MongoMemoryServer } = require('mongodb-memory-server');

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
  mongoEnMemoria = await MongoMemoryServer.create();

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

  //                        oficial      pronóstico    comodín  → puntos esperados
  const oficiales = [
    { ...partidos[0], marcador1: 2, marcador2: 1, comodin: false }, // exacto        → 5
    { ...partidos[1], marcador1: 0, marcador2: 0, comodin: false }, // solo signo    → 3
    { ...partidos[2], marcador1: 3, marcador2: 0, comodin: true },  // exacto comodín→ 7
    { ...partidos[3], marcador1: 1, marcador2: 2, comodin: true },  // signo comodín → 4
    { ...partidos[4], marcador1: 1, marcador2: 0, comodin: false }, // sin pronóstico→ 0
    { ...partidos[5], marcador1: 2, marcador2: 2, comodin: false }  // signo erróneo → 0
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
  assert.equal(mio['Campeón Mundial'], 0);
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

test('el campeón acertado suma, ignorando mayúsculas y espacios', async () => {
  const { agente, datos } = await cuentaNueva('campeon');
  const quiniela = await quinielaNueva(agente, 'Campeon Mundial');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  await enQuiniela(id, async () => {
    await srv.PronosticoCampeon.create({ jugador: datos.username, campeon: '  argentina  ' });
    await srv.CampeonOficial.create({ campeon: 'ARGENTINA', puntos: 20 });
  });

  const res = await agente.get('/api/resultados-totales');
  assert.equal(res.body[datos.username]['Campeón Mundial'], 20,
    'La comparación debe normalizar mayúsculas y espacios sobrantes');
  assert.equal(res.body[datos.username].total, 20);
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

test('M-03: cambiar la puntuación reescribe el histórico (comportamiento actual)', async () => {
  /*
   * Esto NO es una corrección: fija el comportamiento vigente para que quede
   * documentado y para que, cuando la Fase 5 decida congelar los puntos al
   * cerrar la jornada, el cambio sea deliberado y esta prueba falle a
   * propósito.
   *
   * Hoy los puntos de partido se recalculan con la configuración actual, así
   * que subir marcadorExacto a mitad de temporada reescribe las jornadas ya
   * jugadas. Los puntos de trivia, en cambio, sí quedan congelados en
   * RespuestaTrivia.puntos: dos criterios distintos conviviendo (M-04).
   */
  const { agente, datos } = await cuentaNueva('historico');
  const quiniela = await quinielaNueva(agente, 'Historico Movil');
  const id = new mongoose.Types.ObjectId(quiniela.id);

  const antes = await sembrarJornadaDePrueba(id, datos.username);

  const activar = await agente.post('/api/admin-mode/activar').send({ password: 'contrasena-larga-1' });
  assert.equal(activar.status, 200);

  const cambio = await agente.patch('/api/quiniela-actual/configuracion')
    .send({ puntuacion: { marcadorExacto: 50, resultadoCorrecto: 3, comodinExacto: 7, comodinResultado: 4, campeon: 20 } });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.body));

  const res = await agente.get('/api/resultados-totales');
  const despues = res.body[datos.username].Jornada1;

  assert.notEqual(despues, antes,
    'Con la configuración nueva, una jornada ya jugada cambia de puntuación');
  assert.equal(despues, 50 + 3 + 7 + 4,
    'El marcador exacto pasa a valer 50 también en el pasado');
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

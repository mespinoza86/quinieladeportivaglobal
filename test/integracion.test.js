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

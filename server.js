const express = require('express');
require('express-async-errors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcrypt');
const axios = require('axios');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

/*
 * Distingue "me están ejecutando" de "me están importando". Al importar —que es
 * lo que hacen las pruebas de integración— no se abre el puerto, no se conecta
 * a la base y no arrancan los trabajos periódicos: eso lo decide quien importa.
 *
 * Es el mínimo indispensable para poder probar el servidor de verdad sin
 * partirlo en módulos, que es trabajo de la Fase 6.
 */
const EJECUTADO_DIRECTAMENTE = require.main === module;
const ENTORNO_DE_PRUEBAS = process.env.NODE_ENV === 'test';
const SALT_ROUNDS = 10;
const tenantContext = new AsyncLocalStorage();
const INTERNAL_SYNC_TOKEN = crypto.randomBytes(32).toString('hex');

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

if (!process.env.MONGO_URI_MULTIQUINIELA) {
  console.error('Falta MONGO_URI_MULTIQUINIELA. Por seguridad no se utilizará MONGO_URI.');
  process.exit(1);
}

/* ================= Conexión a MongoDB con reintentos ================= */

/**
 * Traduce el error crudo del driver a una causa accionable. Las cuatro familias
 * de fallo —DNS, credenciales, lista de IPs y red— exigen soluciones distintas y
 * el mensaje del driver no las distingue.
 */
function diagnosticarErrorMongo(error) {
  const mensaje = String(error?.message || error);
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(mensaje)) {
    return 'No se pudo resolver el nombre del clúster por DNS. Causas típicas: el clúster está pausado o eliminado en Atlas, o el resolutor DNS de este equipo no atiende consultas SRV.';
  }
  if (/authentication failed|bad auth|SCRAM/i.test(mensaje)) {
    return 'Usuario o contraseña de la base de datos incorrectos, o el usuario ya no existe.';
  }
  if (/whitelist|not allowed to connect|IP address/i.test(mensaje)) {
    return 'La IP de este servidor no está autorizada en la lista de acceso de Atlas.';
  }
  if (/server selection timed out|ETIMEDOUT|timed out/i.test(mensaje)) {
    return 'Se agotó el tiempo de espera al contactar el clúster: red caída, cortafuegos, o el clúster todavía reanudándose.';
  }
  if (/ECONNREFUSED/i.test(mensaje)) {
    return 'La conexión fue rechazada: no hay nada aceptando conexiones en esa dirección.';
  }
  return 'Causa no reconocida. Revisa el mensaje del driver arriba.';
}

const MONGO_ESPERA_MAXIMA_MS = 60 * 1000;
let resolverConexionMongo;
const mongoConnectionPromise = new Promise(resolve => { resolverConexionMongo = resolve; });

/**
 * Reintenta indefinidamente con retroceso exponencial hasta un minuto entre
 * intentos. Antes el proceso terminaba al primer fallo, de modo que cualquier
 * indisponibilidad pasajera dejaba la aplicación caída de forma permanente
 * hasta que alguien la reiniciara a mano.
 */
async function conectarMongoConReintentos() {
  for (let intento = 1; ; intento++) {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
      await mongoose.connect(process.env.MONGO_URI_MULTIQUINIELA, { serverSelectionTimeoutMS: 10000 });
      console.log('✅ Conectado a la base multi-quiniela');
      resolverConexionMongo(mongoose.connection);
      return;
    } catch (error) {
      const espera = Math.min(2 ** (intento - 1) * 1000, MONGO_ESPERA_MAXIMA_MS);
      console.error(`❌ Intento ${intento} de conexión a MongoDB: ${error.message}`);
      console.error(`   Diagnóstico: ${diagnosticarErrorMongo(error)}`);
      console.error(`   Reintentando en ${Math.round(espera / 1000)} s.`);
      await new Promise(resolver => setTimeout(resolver, espera));
    }
  }
}

mongoose.connection.on('disconnected', () => {
  // En pruebas la desconexión es parte del cierre ordenado, no un incidente.
  if (ENTORNO_DE_PRUEBAS) return;
  console.warn('⚠️  Conexión con MongoDB perdida. El driver reintentará por su cuenta.');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ Conexión con MongoDB restablecida.');
});

function mongoListo() {
  return mongoose.connection.readyState === 1;
}

/* ================= Middleware ================= */

/* ================= Middleware ================= */

/*
 * CSP con 'unsafe-inline' a propósito: el frontend tiene 63 atributos onclick y
 * 19 style= en línea, así que una política estricta lo rompería entero. Quitarlo
 * exige migrar esos manejadores a addEventListener, tarea que va junto con el
 * escapado sistemático de innerHTML (hallazgo S-04). Aun con 'unsafe-inline',
 * la política sigue bloqueando scripts de terceros no declarados.
 */
const esProduccion = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      /*
       * IMPRESCINDIBLE. helmet trae por defecto script-src-attr 'none', que
       * bloquea los manejadores en atributo (onclick, onchange…). El frontend
       * tiene 63, así que con el valor por defecto la interfaz queda inerte:
       * los botones cargan pero no responden. 'unsafe-inline' en script-src NO
       * cubre este caso; son directivas independientes.
       */
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://apiv3.apifootball.com'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // null elimina la directiva que helmet añade por defecto. En desarrollo
      // sobra y solo estorba al servir por HTTP plano.
      upgradeInsecureRequests: esProduccion ? [] : null
    }
  },
  // Los escudos vienen de apiv3.apifootball.com; CORP estricta no los afecta,
  // pero COEP sí rompería la carga de recursos cruzados sin CORP explícita.
  crossOriginEmbedderPolicy: false,
  hsts: esProduccion ? { maxAge: 15552000, includeSubDomains: true } : false
}));

const ORIGENES_LOCALES = [
  'http://localhost',
  `http://localhost:${PORT}`,
  'http://localhost:3000',
  'http://127.0.0.1',
  `http://127.0.0.1:${PORT}`,
  'capacitor://localhost'
];

const ORIGENES_PERMITIDOS = [
  ...new Set([
    ...ORIGENES_LOCALES,
    ...String(process.env.ALLOWED_ORIGINS || 'https://quinieladeportivaglobal.onrender.com')
      .split(',')
      .map(origen => origen.trim())
      .filter(Boolean)
  ])
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === 'null') return callback(null, true);
    if (ORIGENES_PERMITIDOS.includes(origin)) return callback(null, true);
    return callback(new Error('No permitido por CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));

/*
 * Sondas de salud. Van deliberadamente ANTES de la sesión: si la base está caída,
 * el almacén de sesiones se bloquearía esperando, y una sonda que se cuelga no
 * sirve para diagnosticar nada.
 *
 *   /healthz  el proceso responde (liveness). No toca la base.
 *   /readyz   el proceso puede atender tráfico real (readiness). Exige base viva.
 */
app.get('/healthz', (req, res) => {
  res.json({ estado: 'vivo', tiempoActivoSegundos: Math.round(process.uptime()) });
});

app.get('/readyz', (req, res) => {
  const estados = ['desconectado', 'conectado', 'conectando', 'desconectando'];
  const listo = mongoListo();
  res.status(listo ? 200 : 503).json({
    estado: listo ? 'listo' : 'no-listo',
    mongo: estados[mongoose.connection.readyState] ?? 'desconocido',
    tiempoActivoSegundos: Math.round(process.uptime())
  });
});

app.use(session({
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('Falta SESSION_SECRET'); })() : 'solo-desarrollo-cambiar'),
  store: MongoStore.create({
    clientPromise: mongoConnectionPromise.then(connection => connection.getClient()),
    collectionName: 'sesiones',
    ttl: 60 * 60 * 24 * 14
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

/* ================= Limitación de intentos ================= */

const opcionesLimiteComunes = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  /*
   * Las pruebas de integración salen todas de la misma IP y crean varias
   * cuentas seguidas, así que el limitador de registro (5 por hora) las
   * bloquearía a la sexta. Se desactiva solo en el entorno de pruebas; las
   * pruebas que verifican el limitador en sí lo hacen contra el servidor real.
   */
  skip: () => ENTORNO_DE_PRUEBAS
};

/*
 * Login: solo cuentan los intentos FALLIDOS (skipSuccessfulRequests). Un usuario
 * legítimo que entra bien nunca consume cuota, mientras que la fuerza bruta se
 * frena a los 10 fallos por cuarto de hora.
 */
const limiteLogin = rateLimit({
  ...opcionesLimiteComunes,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.' }
});

// Registro: cuentan todos, para que nadie cree cuentas en masa desde una IP.
const limiteRegistro = rateLimit({
  ...opcionesLimiteComunes,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: { error: 'Se alcanzó el límite de cuentas creadas desde esta conexión. Inténtalo más tarde.' }
});

/*
 * Admin Mode: el más estricto de los tres. Quien llega aquí ya tiene sesión
 * válida y rol administrativo; lo único que lo separa de operar la quiniela es
 * la contraseña, así que es el punto más rentable para un ataque por fuerza bruta.
 */
const limiteAdminMode = rateLimit({
  ...opcionesLimiteComunes,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de confirmación. Espera unos minutos.' }
});

function requireLogin(req, res, next) {
  if (req.session?.usuarioId) return next();
  return res.status(401).json({ error: 'Debes iniciar sesión.' });
}

/*
 * Los endpoints /debug/* exponen respuestas crudas de APIFootball y volcados de
 * jornadas. Son útiles para diagnosticar, pero no tienen por qué existir en
 * producción. Con la bandera apagada devuelven 404, no 403: así ni siquiera
 * revelan que la ruta existe.
 */
const DEPURACION_HABILITADA = process.env.DEBUG_ENDPOINTS === 'true';

function requireDebug(req, res, next) {
  if (!DEPURACION_HABILITADA) return res.status(404).json({ error: 'No encontrado.' });
  return next();
}

function requireAdmin(req, res, next) {
  if (req.membership?.internal) return next();
  if (!req.membership || !['propietario', 'admin'].includes(req.membership.rol)) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador en esta quiniela.' });
  }

  const acceso = req.session?.adminMode;
  const vigente = acceso &&
    acceso.quinielaId === req.quiniela?._id.toString() &&
    Date.now() - acceso.verificadoEn < 1000 * 60 * 60;
  if (!vigente) {
    return res.status(401).json({ error: 'Confirma tu contraseña para entrar al modo administrador.', requiereAdminMode: true });
  }
  return next();
}

const paginasAdmin = [
  '/jugadores.html',
  '/jornadas.html',
  '/importar_partidos.html',
  '/resultados.html',
  '/agregar-resultados-oficiales.html',
  '/generar_reporte.html',
  '/enviarresultados.html',
  '/copiarresultadojugador.html',
  '/admin_trivias.html',
  '/enviarresultadostrivias.html',
  '/enviarresultadospartido.html',
  '/enviarresultadostriviaspartido.html',
  '/campeon-oficial.html',
  '/miembros.html',
  '/configuracion-quiniela.html'
];

/*
 * Antes esta guardia solo comprobaba que hubiera sesión, así que cualquier
 * usuario autenticado podía descargar el HTML administrativo. No era fuga de
 * datos —las APIs sí exigen requireAdmin— pero sí de superficie, y una mala
 * experiencia: la página cargaba y luego fallaba petición por petición.
 *
 * Se ejecuta antes del middleware de inquilino, así que req.membership todavía
 * no existe y hay que consultar la membresía a mano. El coste es una consulta
 * indexada, y solo en estas 15 rutas.
 */
app.use(async (req, res, next) => {
  if (!paginasAdmin.includes(req.path)) return next();
  if (!req.session?.usuarioId) return res.redirect('/login.html');
  if (!req.session?.quinielaActivaId) return res.redirect('/quinielas.html');

  try {
    const membresia = await Membresia.findOne({
      usuarioId: req.session.usuarioId,
      quinielaId: req.session.quinielaActivaId,
      estado: { $in: ['activo', 'pendiente_retiro'] }
    }).select('rol');

    if (!membresia || !['propietario', 'admin'].includes(membresia.rol)) {
      return res.redirect('/index.html');
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

/* ================= Auto Sync Global ================= */

let ultimaSyncGlobal = 0;
let syncEnProceso = false;

/*
 * La constante se llamaba CINCO_MINUTOS y valía 30 segundos. Ese desfase entre
 * el nombre y el valor es justo lo que hacía difícil ver el coste real del
 * auto-sync: son 10 disparos por cada cinco minutos, no uno.
 *
 * El rediseño de este mecanismo es la Fase 4 (hallazgo C-01); aquí solo se
 * corrige el nombre para que el código diga la verdad.
 */
const INTERVALO_MINIMO_ENTRE_SYNCS_MS = 30 * 1000;

app.use((req, res, next) => {
  // En pruebas jamás se dispara: golpearía el API externo de verdad y se
  // autollamaría por HTTP a un puerto que no está escuchando.
  if (ENTORNO_DE_PRUEBAS) return next();

  const ahora = Date.now();

  const esArchivoEstatico =
    req.path.startsWith('/js/') ||
    req.path.startsWith('/css/') ||
    req.path.includes('.png') ||
    req.path.includes('.jpg') ||
    req.path.includes('.jpeg') ||
    req.path.includes('.svg') ||
    req.path.includes('.ico');

  if (esArchivoEstatico) {
    return next();
  }

  if (!syncEnProceso && ahora - ultimaSyncGlobal > INTERVALO_MINIMO_ENTRE_SYNCS_MS) {
    syncEnProceso = true;
    ultimaSyncGlobal = ahora;

    sincronizarTodasLasJornadasDesdeApi()
      .catch(err => {
        console.error('Error auto-sync:', err.message);
      })
      .finally(() => {
        syncEnProceso = false;
      });
  }

  next();
});

/* ================= Auth ================= */

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/check-auth', (req, res) => {
  res.json({
    authenticated: Boolean(req.session.usuarioId),
    quinielaActivaId: req.session.quinielaActivaId || null
  });
});

/* ================= Static Files ================= */

app.use(express.static(path.join(__dirname, 'public')));

app.get('/js/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'private', 'js', req.params.filename);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).send('Archivo JS no encontrado');
});

app.get('/css/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'private', 'css', req.params.filename);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).send('Archivo CSS no encontrado');
});





/* ================= API-Football ================= */

/*
const footballApi = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': process.env.API_FOOTBALL_KEY
  }
});
*/

const apiFootballCom = axios.create({
  baseURL: 'https://apiv3.apifootball.com/'
});


/* ================= Schemas ================= */

const UsuarioSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  usernameNormalizado: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, trim: true },
  emailNormalizado: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  emailVerificado: { type: Boolean, default: false },
  tokenVerificacion: { type: String, default: null },
  expiracionTokenVerificacion: { type: Date, default: null },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

const puntuacionDefault = {
  marcadorExacto: 5,
  resultadoCorrecto: 3,
  comodinExacto: 7,
  comodinResultado: 4,
  campeon: 20,
  triviasHabilitadas: true,
  puntosTriviaDefault: 1
};

const QuinielaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  codigoIngreso: { type: String, required: true, unique: true, index: true },
  propietarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  estado: { type: String, enum: ['activa', 'archivada', 'eliminada'], default: 'activa' },
  eliminadaEn: Date,
  configuracion: {
    puntuacion: {
      marcadorExacto: { type: Number, default: 5, min: 0 },
      resultadoCorrecto: { type: Number, default: 3, min: 0 },
      comodinExacto: { type: Number, default: 7, min: 0 },
      comodinResultado: { type: Number, default: 4, min: 0 },
      campeon: { type: Number, default: 20, min: 0 },
      triviasHabilitadas: { type: Boolean, default: true },
      puntosTriviaDefault: { type: Number, default: 1, min: 0 }
    },
    incluirExpulsadosEnRanking: { type: Boolean, default: true }
  }
}, { timestamps: true });

const MembresiaSchema = new mongoose.Schema({
  quinielaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiniela', required: true, index: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  rol: { type: String, enum: ['propietario', 'admin', 'user'], default: 'user' },
  estado: {
    type: String,
    enum: ['pendiente_ingreso', 'activo', 'pendiente_retiro', 'rechazado', 'expulsado'],
    default: 'pendiente_ingreso'
  },
  solicitadoEn: { type: Date, default: Date.now },
  aprobadoEn: Date,
  retiradoEn: Date
}, { timestamps: true });
MembresiaSchema.index({ quinielaId: 1, usuarioId: 1 }, { unique: true });

const Usuario = mongoose.model('Usuario', UsuarioSchema);
const Quiniela = mongoose.model('Quiniela', QuinielaSchema);
const Membresia = mongoose.model('Membresia', MembresiaSchema);

function tenantPlugin(schema) {
  schema.add({
    quinielaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiniela', required: true, index: true }
  });

  const aplicarFiltro = function aplicarFiltroTenant(next) {
    const store = tenantContext.getStore();
    if (store?.quinielaId) this.where({ quinielaId: store.quinielaId });
    next();
  };

  schema.pre(/^find/, aplicarFiltro);
  schema.pre('countDocuments', aplicarFiltro);
  schema.pre('deleteMany', aplicarFiltro);
  schema.pre('deleteOne', aplicarFiltro);
  schema.pre('updateMany', aplicarFiltro);
  schema.pre('updateOne', aplicarFiltro);

  schema.pre('validate', function asignarTenant(next) {
    const store = tenantContext.getStore();
    if (!this.quinielaId && store?.quinielaId) this.quinielaId = store.quinielaId;
    next();
  });
}

const JugadorSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  password: { type: String }
});

const JornadaSchema = new mongoose.Schema({
  nombre: String,
  partidos: [{
    equipo1: String,
    equipo2: String,
    logoEquipo1: String,
    logoEquipo2: String,
    comodin: { type: Boolean, default: false },

    apiFixtureId: String,
    apiLeagueId: String,
    apiDate: String,
    apiStatus: String
  }],
  fechaCierre: { type: Date, required: false }
});

const ResultadoSchema = new mongoose.Schema({
  jugador: String,
  jornada: String,
  pronosticos: [{
    equipo1: String,
    equipo2: String,
    marcador1: Number,
    marcador2: Number
  }]
});


const ResultadoOficialSchema = new mongoose.Schema({
  jornada: String,
  resultados: [{
    equipo1: String,
    logoEquipo1: String,
    marcador1: Number,
    equipo2: String,
    logoEquipo2: String,
    marcador2: Number,
    comodin: { type: Boolean, default: false },

    estado: String,
    minuto: mongoose.Schema.Types.Mixed,
    fecha: String,

    origen: { type: String, default: 'api' },
    bloqueadoFinal: { type: Boolean, default: false },
    actualizadoEn: Date
  }]
});

const triviaSchema = new mongoose.Schema({
  jornadaNombre: String,
  partidoIndex: Number,
  apiFixtureId: String,
  equipo1: String,
  equipo2: String,
  tipo: String,
  pregunta: String,
  opciones: [String],
  puntos: { type: Number, default: 1 },
  fechaCierre: Date,
  respuestaCorrecta: String,
  resuelta: { type: Boolean, default: false },
  activa: { type: Boolean, default: true }
}, { timestamps: true });


const respuestaTriviaSchema = new mongoose.Schema({
  jugador: String,
  triviaId: String,
  respuesta: String,
  puntos: { type: Number, default: 0 },
  fechaRespuesta: { type: Date, default: Date.now }
});

const EquipoSchema = new mongoose.Schema({
  nombre: { type: String, required: true }
});

const PronosticoCampeonSchema = new mongoose.Schema({
  jugador: { type: String, required: true },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  campeon: { type: String, required: true },
  fechaRegistro: { type: Date, default: Date.now }
});

const CampeonOficialSchema = new mongoose.Schema({
  campeon: { type: String, required: true },
  puntos: { type: Number, default: 20 }
});

[
  JugadorSchema,
  JornadaSchema,
  ResultadoSchema,
  ResultadoOficialSchema,
  triviaSchema,
  respuestaTriviaSchema,
  EquipoSchema,
  PronosticoCampeonSchema,
  CampeonOficialSchema
].forEach(tenantPlugin);

JugadorSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
JornadaSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
ResultadoSchema.index({ quinielaId: 1, jugador: 1, jornada: 1 }, { unique: true });
ResultadoOficialSchema.index({ quinielaId: 1, jornada: 1 }, { unique: true });
EquipoSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
PronosticoCampeonSchema.index({ quinielaId: 1, jugador: 1 }, { unique: true });

/*
 * Único de verdad: sin él, dos envíos simultáneos de la misma respuesta hacían
 * que el findOneAndUpdate con upsert insertara dos documentos, y al resolver la
 * trivia el jugador cobraba los puntos DOS VECES. Es un fallo de puntuación
 * silencioso y difícil de detectar a posteriori.
 */
respuestaTriviaSchema.index({ quinielaId: 1, jugador: 1, triviaId: 1 }, { unique: true });

// Sostiene las búsquedas por jornada y partido, que hoy hacen recorrido completo.
triviaSchema.index({ quinielaId: 1, jornadaNombre: 1, partidoIndex: 1, tipo: 1 });

const Equipo = mongoose.model('Equipo', EquipoSchema);
const Jugador = mongoose.model('Jugador', JugadorSchema);
const Jornada = mongoose.model('Jornada', JornadaSchema);
const Resultado = mongoose.model('Resultado', ResultadoSchema);
const ResultadoOficial = mongoose.model('ResultadoOficial', ResultadoOficialSchema);
const Trivia = mongoose.model('Trivia', triviaSchema);
const RespuestaTrivia = mongoose.model('RespuestaTrivia', respuestaTriviaSchema);
const PronosticoCampeon = mongoose.model('PronosticoCampeon', PronosticoCampeonSchema);
const CampeonOficial = mongoose.model('CampeonOficial', CampeonOficialSchema);


const TIPOS_TRIVIA = {
  primer_gol: {
    pregunta: '¿Qué equipo anota primero?'
  },
  mas_amarillas: {
    pregunta: '¿Qué equipo tendrá más tarjetas amarillas?'
  },
  mas_rojas: {
    pregunta: '¿Qué equipo tendrá más tarjetas rojas?'
  },
  ambos_anotan: {
    pregunta: '¿Ambos equipos anotan?'
  },
  gol_primer_tiempo: {
    pregunta: '¿Habrá gol en el primer tiempo?'
  },
  gol_segundo_tiempo: {
    pregunta: '¿Habrá gol en el segundo tiempo?'
  },
  hubo_tiempo_extra: {
    pregunta: '¿Habrá tiempo extra?'
  },
  hubo_penales: {
    pregunta: '¿Habrá penales?'
  }
};



function opcionesTrivia(tipo, equipo1, equipo2) {
  if (tipo === 'primer_gol') {
    return [equipo1, equipo2, 'Nadie anotará'];
  }

  if (tipo === 'mas_amarillas') {
    return [equipo1, equipo2, 'Empate', 'No habrá tarjetas amarillas'];
  }

  if (tipo === 'mas_rojas') {
    return [equipo1, equipo2, 'Empate', 'No habrá tarjetas rojas'];
  }


  if (tipo === 'ambos_anotan') {
    return ['Sí', 'No'];
  }

  if (tipo === 'gol_primer_tiempo') {
    return ['Sí', 'No'];
  }

  if (tipo === 'gol_segundo_tiempo') {
    return ['Sí', 'No'];
  }

  if (tipo === 'hubo_tiempo_extra') {
    return ['Sí', 'No'];
  }

  if (tipo === 'hubo_penales') {
    return ['Sí', 'No'];
  }

  return [];
}

function triviaCerrada(trivia) {
  if (!trivia.fechaCierre) return false;
  return new Date(trivia.fechaCierre) <= new Date();
}

/* ================= Cuentas y multi-quiniela ================= */

function normalizarIdentidad(valor) {
  return String(valor || '').trim().toLowerCase();
}

function usuarioPublico(usuario) {
  return {
    id: usuario._id,
    username: usuario.username,
    email: usuario.email,
    emailVerificado: usuario.emailVerificado
  };
}

function generarCodigoIngreso() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function codigoIngresoUnico() {
  let codigo;
  do codigo = generarCodigoIngreso();
  while (await Quiniela.exists({ codigoIngreso: codigo }));
  return codigo;
}

app.post('/api/auth/registro', limiteRegistro, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const confirmarPassword = String(req.body.confirmarPassword || '');
    const usernameNormalizado = normalizarIdentidad(username);
    const emailNormalizado = normalizarIdentidad(email);

    if (!username || !email || !password || !confirmarPassword) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 30 caracteres y usar solamente letras, números, punto, guion o guion bajo.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'El correo electrónico no es válido.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    if (password !== confirmarPassword) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    const [usuarioExistente, correoExistente] = await Promise.all([
      Usuario.exists({ usernameNormalizado }),
      Usuario.exists({ emailNormalizado })
    ]);
    if (usuarioExistente || correoExistente) {
      const campos = [];
      if (usuarioExistente) campos.push('nombre de usuario');
      if (correoExistente) campos.push('correo electrónico');
      return res.status(409).json({
        error: `Ya existe una cuenta con ese ${campos.join(' y ese ')}. Debes cambiar ${campos.join(' y ')}.`,
        usernameEnUso: Boolean(usuarioExistente),
        emailEnUso: Boolean(correoExistente)
      });
    }

    const usuario = await Usuario.create({
      username,
      usernameNormalizado,
      email,
      emailNormalizado,
      password: await bcrypt.hash(password, SALT_ROUNDS)
    });
    // Se regenera la sesión igual que en el login: si un atacante consiguió
    // fijar un identificador de sesión antes del registro, aquí deja de servirle.
    req.session.regenerate(errorSesion => {
      if (errorSesion) {
        return res.status(500).json({ error: 'La cuenta se creó, pero no se pudo iniciar la sesión. Inicia sesión manualmente.' });
      }
      req.session.usuarioId = usuario._id.toString();
      res.status(201).json({ success: true, usuario: usuarioPublico(usuario) });
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'El usuario o el correo electrónico ya están registrados.' });
    }
    console.error('Error registrando usuario:', error);
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  }
});

async function iniciarSesion(req, res) {
  const identificador = normalizarIdentidad(req.body.identificador || req.body.username || req.body.email);
  const password = String(req.body.password || '');
  if (!identificador || !password) return res.status(400).json({ error: 'Usuario/correo y contraseña son obligatorios.' });

  const usuario = await Usuario.findOne({
    $or: [{ usernameNormalizado: identificador }, { emailNormalizado: identificador }],
    activo: true
  });
  if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
    return res.status(401).json({ error: 'Usuario, correo o contraseña incorrectos.' });
  }

  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'No se pudo iniciar la sesión.' });
    req.session.usuarioId = usuario._id.toString();
    res.json({ success: true, usuario: usuarioPublico(usuario) });
  });
}

app.post('/api/auth/login', limiteLogin, (req, res, next) => iniciarSesion(req, res).catch(next));
app.post('/login', limiteLogin, (req, res, next) => iniciarSesion(req, res).catch(next));

app.get('/api/auth/me', requireLogin, async (req, res) => {
  const usuario = await Usuario.findById(req.session.usuarioId);
  if (!usuario) return res.status(401).json({ error: 'La cuenta ya no existe.' });
  res.json({ usuario: usuarioPublico(usuario), quinielaActivaId: req.session.quinielaActivaId || null });
});

app.get('/api/quinielas', requireLogin, async (req, res) => {
  const membresias = await Membresia.find({ usuarioId: req.session.usuarioId })
    .populate('quinielaId')
    .sort({ updatedAt: -1 });
  res.json(membresias.filter(m => m.quinielaId && m.quinielaId.estado !== 'eliminada').map(m => ({
    id: m.quinielaId._id,
    nombre: m.quinielaId.nombre,
    codigoIngreso: ['propietario', 'admin'].includes(m.rol) ? m.quinielaId.codigoIngreso : undefined,
    estadoQuiniela: m.quinielaId.estado,
    rol: m.rol,
    estadoMembresia: m.estado
  })));
});

app.post('/api/quinielas', requireLogin, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  if (nombre.length < 3 || nombre.length > 80) return res.status(400).json({ error: 'El nombre debe tener entre 3 y 80 caracteres.' });

  const quiniela = await Quiniela.create({
    nombre,
    codigoIngreso: await codigoIngresoUnico(),
    propietarioId: req.session.usuarioId,
    configuracion: { puntuacion: puntuacionDefault }
  });
  await Membresia.create({
    quinielaId: quiniela._id,
    usuarioId: req.session.usuarioId,
    rol: 'propietario',
    estado: 'activo',
    aprobadoEn: new Date()
  });
  req.session.quinielaActivaId = quiniela._id.toString();
  res.status(201).json({ success: true, quiniela });
});

app.post('/api/quinielas/unirse', requireLogin, async (req, res) => {
  const codigoIngreso = String(req.body.codigoIngreso || '').trim().toUpperCase();
  const quiniela = await Quiniela.findOne({ codigoIngreso, estado: 'activa' });
  if (!quiniela) return res.status(404).json({ error: 'Código de quiniela inválido o quiniela no disponible.' });

  const existente = await Membresia.findOne({ quinielaId: quiniela._id, usuarioId: req.session.usuarioId });
  if (existente?.estado === 'activo' || existente?.estado === 'pendiente_retiro') {
    return res.status(409).json({ error: 'Ya perteneces a esta quiniela.' });
  }
  if (existente?.estado === 'pendiente_ingreso') return res.status(409).json({ error: 'Tu solicitud ya está pendiente de aprobación.' });

  await Membresia.findOneAndUpdate(
    { quinielaId: quiniela._id, usuarioId: req.session.usuarioId },
    { rol: 'user', estado: 'pendiente_ingreso', solicitadoEn: new Date(), $unset: { retiradoEn: 1 } },
    { upsert: true, new: true }
  );
  res.status(202).json({ success: true, message: 'Solicitud enviada. Un administrador debe aprobarla.' });
});

app.post('/api/quinielas/:id/seleccionar', requireLogin, async (req, res) => {
  const membresia = await Membresia.findOne({ quinielaId: req.params.id, usuarioId: req.session.usuarioId, estado: { $in: ['activo', 'pendiente_retiro'] } });
  if (!membresia) return res.status(403).json({ error: 'No tienes acceso activo a esta quiniela.' });
  const quiniela = await Quiniela.findOne({ _id: req.params.id, estado: { $ne: 'eliminada' } });
  if (!quiniela) return res.status(404).json({ error: 'Quiniela no encontrada.' });
  req.session.quinielaActivaId = quiniela._id.toString();
  delete req.session.adminMode;
  res.json({ success: true, quiniela: { id: quiniela._id, nombre: quiniela.nombre }, rol: membresia.rol });
});

app.use(async (req, res, next) => {
  try {
    if (
      req.get('x-internal-sync-token') === INTERNAL_SYNC_TOKEN &&
      mongoose.isValidObjectId(req.get('x-quiniela-id'))
    ) {
      const quiniela = await Quiniela.findOne({ _id: req.get('x-quiniela-id'), estado: 'activa' });
      if (!quiniela) return res.status(404).json({ error: 'Quiniela interna no encontrada.' });
      req.quiniela = quiniela;
      req.membership = { rol: 'admin', estado: 'activo', internal: true };
      return tenantContext.run({ quinielaId: quiniela._id }, next);
    }
    if (!req.session?.usuarioId || !req.session?.quinielaActivaId) return next();
    const [membership, quiniela] = await Promise.all([
      Membresia.findOne({
        usuarioId: req.session.usuarioId,
        quinielaId: req.session.quinielaActivaId,
        estado: { $in: ['activo', 'pendiente_retiro'] }
      }),
      Quiniela.findOne({ _id: req.session.quinielaActivaId, estado: { $ne: 'eliminada' } })
    ]);
    if (!membership || !quiniela) {
      delete req.session.quinielaActivaId;
      return next();
    }
    req.membership = membership;
    req.quiniela = quiniela;
    tenantContext.run({ quinielaId: quiniela._id }, next);
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res, next) => {
  if (req.membership?.internal) return next();
  if (!req.session?.usuarioId) return res.status(401).json({ error: 'Debes iniciar sesión.' });
  if (!req.quiniela || !req.membership) return res.status(409).json({ error: 'Debes seleccionar una quiniela activa.' });
  if (req.quiniela.estado === 'archivada' && !['GET', 'HEAD'].includes(req.method)) {
    const permitidas = ['/api/quiniela-actual/archivar', '/api/quiniela-actual'];
    if (!permitidas.includes(req.originalUrl.split('?')[0])) {
      return res.status(409).json({ error: 'La quiniela está archivada y es de solo lectura.' });
    }
  }
  next();
});

app.get('/api/quiniela-actual', (req, res) => {
  res.json({
    id: req.quiniela._id,
    nombre: req.quiniela.nombre,
    estado: req.quiniela.estado,
    rol: req.membership.rol,
    codigoIngreso: ['propietario', 'admin'].includes(req.membership.rol) ? req.quiniela.codigoIngreso : undefined,
    configuracion: req.quiniela.configuracion
  });
});

app.get('/api/admin-mode', (req, res) => {
  const autorizadoPorRol = ['propietario', 'admin'].includes(req.membership.rol);
  const acceso = req.session.adminMode;
  const activo = autorizadoPorRol && Boolean(
    acceso &&
    acceso.quinielaId === req.quiniela._id.toString() &&
    Date.now() - acceso.verificadoEn < 1000 * 60 * 60
  );
  res.json({ autorizadoPorRol, activo });
});

app.post('/api/admin-mode/activar', limiteAdminMode, async (req, res) => {
  if (!['propietario', 'admin'].includes(req.membership.rol)) {
    return res.status(403).json({ error: 'No tienes permisos administrativos en esta quiniela.' });
  }
  const password = String(req.body.password || '');
  const usuario = await Usuario.findById(req.session.usuarioId).select('password activo');
  if (!usuario?.activo || !password || !(await bcrypt.compare(password, usuario.password))) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  req.session.adminMode = {
    quinielaId: req.quiniela._id.toString(),
    verificadoEn: Date.now()
  };
  res.json({ success: true });
});

app.post('/api/admin-mode/desactivar', (req, res) => {
  delete req.session.adminMode;
  res.json({ success: true });
});

app.get('/api/quiniela-actual/miembros', requireAdmin, async (req, res) => {
  const membresias = await Membresia.find({ quinielaId: req.quiniela._id })
    .populate('usuarioId', 'username email emailVerificado')
    .sort({ estado: 1, rol: 1, createdAt: 1 });
  res.json(membresias.map(m => ({
    id: m._id,
    usuarioId: m.usuarioId?._id,
    username: m.usuarioId?.username,
    email: m.usuarioId?.email,
    rol: m.rol,
    estado: m.estado,
    solicitadoEn: m.solicitadoEn
  })));
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/aprobar', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id });
  if (!membresia || membresia.estado !== 'pendiente_ingreso') return res.status(404).json({ error: 'Solicitud pendiente no encontrada.' });
  membresia.estado = 'activo';
  membresia.rol = 'user';
  membresia.aprobadoEn = new Date();
  await membresia.save();
  const usuario = await Usuario.findById(membresia.usuarioId);
  await Jugador.findOneAndUpdate(
    { usuarioId: usuario._id },
    { usuarioId: usuario._id, nombre: usuario.username },
    { upsert: true, new: true }
  );
  res.json({ success: true });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/rechazar', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id });
  if (!membresia || !['pendiente_ingreso', 'pendiente_retiro'].includes(membresia.estado)) {
    return res.status(404).json({ error: 'Solicitud pendiente no encontrada.' });
  }
  membresia.estado = membresia.estado === 'pendiente_ingreso' ? 'rechazado' : 'activo';
  await membresia.save();
  res.json({ success: true });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/rol', requireAdmin, async (req, res) => {
  const nuevoRol = req.body.rol;
  if (!['admin', 'user'].includes(nuevoRol)) return res.status(400).json({ error: 'Rol inválido.' });
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id, estado: 'activo' });
  if (!membresia) return res.status(404).json({ error: 'Miembro activo no encontrado.' });
  if (membresia.rol === 'propietario') return res.status(400).json({ error: 'El rol del propietario solo cambia mediante una transferencia.' });
  if (membresia.rol === 'admin' && nuevoRol === 'user') {
    const administradores = await Membresia.countDocuments({ quinielaId: req.quiniela._id, rol: { $in: ['propietario', 'admin'] }, estado: 'activo' });
    if (administradores <= 1) return res.status(409).json({ error: 'La quiniela no puede quedar sin administrador.' });
  }
  membresia.rol = nuevoRol;
  await membresia.save();
  res.json({ success: true });
});

app.post('/api/quiniela-actual/solicitar-retiro', async (req, res) => {
  if (req.membership.rol === 'propietario') return res.status(409).json({ error: 'El propietario debe transferir la propiedad antes de solicitar retirarse.' });
  req.membership.estado = 'pendiente_retiro';
  await req.membership.save();
  res.json({ success: true, message: 'Solicitud de retiro enviada.' });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/aprobar-retiro', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id, estado: 'pendiente_retiro' });
  if (!membresia) return res.status(404).json({ error: 'Solicitud de retiro no encontrada.' });
  if (membresia.rol === 'propietario') return res.status(409).json({ error: 'No se puede retirar al propietario.' });
  membresia.estado = 'expulsado';
  membresia.retiradoEn = new Date();
  await membresia.save();
  res.json({ success: true });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/expulsar', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id, estado: { $in: ['activo', 'pendiente_retiro'] } });
  if (!membresia) return res.status(404).json({ error: 'Miembro no encontrado.' });
  if (membresia.rol === 'propietario') return res.status(409).json({ error: 'No se puede expulsar al propietario.' });
  if (membresia.usuarioId.equals(req.session.usuarioId)) return res.status(409).json({ error: 'No puedes expulsarte a ti mismo.' });
  membresia.estado = 'expulsado';
  membresia.retiradoEn = new Date();
  await membresia.save();
  res.json({ success: true });
});

app.post('/api/quiniela-actual/transferir-propiedad', requireAdmin, async (req, res) => {
  if (req.membership.rol !== 'propietario') return res.status(403).json({ error: 'Solo el propietario puede transferir la propiedad.' });
  const destino = await Membresia.findOne({ quinielaId: req.quiniela._id, usuarioId: req.body.usuarioId, estado: 'activo' });
  if (!destino || destino.rol !== 'admin') return res.status(400).json({ error: 'El nuevo propietario debe ser un administrador activo.' });
  destino.rol = 'propietario';
  req.membership.rol = 'admin';
  req.quiniela.propietarioId = destino.usuarioId;
  await Promise.all([destino.save(), req.membership.save(), req.quiniela.save()]);
  res.json({ success: true });
});

app.patch('/api/quiniela-actual/configuracion', requireAdmin, async (req, res) => {
  const entrada = req.body.puntuacion || {};
  const camposNumericos = ['marcadorExacto', 'resultadoCorrecto', 'comodinExacto', 'comodinResultado', 'campeon', 'puntosTriviaDefault'];
  for (const campo of camposNumericos) {
    if (entrada[campo] !== undefined && (!Number.isFinite(Number(entrada[campo])) || Number(entrada[campo]) < 0)) {
      return res.status(400).json({ error: `Puntuación inválida para ${campo}.` });
    }
  }
  camposNumericos.forEach(campo => {
    if (entrada[campo] !== undefined) req.quiniela.configuracion.puntuacion[campo] = Number(entrada[campo]);
  });
  if (entrada.triviasHabilitadas !== undefined) req.quiniela.configuracion.puntuacion.triviasHabilitadas = Boolean(entrada.triviasHabilitadas);
  if (req.body.incluirExpulsadosEnRanking !== undefined) req.quiniela.configuracion.incluirExpulsadosEnRanking = Boolean(req.body.incluirExpulsadosEnRanking);
  req.quiniela.markModified('configuracion');
  await req.quiniela.save();
  res.json({ success: true, configuracion: req.quiniela.configuracion });
});

app.patch('/api/quiniela-actual/archivar', requireAdmin, async (req, res) => {
  req.quiniela.estado = req.body.archivada === false ? 'activa' : 'archivada';
  await req.quiniela.save();
  res.json({ success: true, estado: req.quiniela.estado });
});

app.delete('/api/quiniela-actual', requireAdmin, async (req, res) => {
  if (req.membership.rol !== 'propietario') return res.status(403).json({ error: 'Solo el propietario puede eliminar la quiniela.' });
  if (String(req.body?.confirmacion || '') !== req.quiniela.nombre) {
    return res.status(400).json({ error: 'Escribe exactamente el nombre de la quiniela para confirmar.' });
  }
  req.quiniela.estado = 'eliminada';
  req.quiniela.eliminadaEn = new Date();
  await req.quiniela.save();
  delete req.session.quinielaActivaId;
  res.json({ success: true });
});


/* ================= HTML Routes ================= */

[
  '/',
  '/jugadores',
  '/jornada',
  '/ver-jugadores',
  '/resultados',
  '/ver-resultados',
  '/ver-jornadas',
  '/adminmode.html',
  '/ver_resultados_totales_de_jugadores',
  '/agregar-resultados-oficiales',
  '/generar_reporte',
  '/llenar_jornada',
  '/resultados-totales',
  '/ver-resultados-oficiales',
  '/verResultados',
  '/verResultados_puntos',
  '/campeon-oficial',
  '/pronostico-campeon',
  '/importar_partidos',
  '/ver_resultados_trivias'
].forEach(route => {
  app.get(route, (req, res) => {
    let nombreArchivo = route === '/' ? 'index.html' : route.replace('/', '');

    if (!nombreArchivo.endsWith('.html')) {
      nombreArchivo += '.html';
    }

    const filePath = path.join(__dirname, 'public', nombreArchivo);
    res.sendFile(filePath);
  });
});

/* ================= API: Jugadores ================= */

app.get('/api/jugadores', async (req, res) => {
  const membresias = await Membresia.find({ quinielaId: req.quiniela._id, estado: { $in: ['activo', 'pendiente_retiro'] } })
    .populate('usuarioId', 'username')
    .sort({ createdAt: 1 });
  const historicos = await Jugador.find({}).select('nombre').lean();
  const nombres = new Set([
    ...membresias.map(m => m.usuarioId?.username).filter(Boolean),
    ...historicos.map(j => j.nombre).filter(Boolean)
  ]);
  res.json(Array.from(nombres).sort((a, b) => a.localeCompare(b)));
});

app.post('/api/jugadores', requireAdmin, async (req, res) => {
  res.status(410).json({ error: 'Los jugadores ahora crean su cuenta y solicitan ingreso mediante el código de la quiniela.' });
});

app.delete('/api/jugadores/:nombre', requireAdmin, async (req, res) => {
  res.status(410).json({ error: 'Usa la administración de miembros para expulsar participantes.' });
});

app.get('/api/jugador/:nombre', async (req, res) => {
  const usuario = await Usuario.findById(req.session.usuarioId);
  if (!usuario || usuario.username !== req.params.nombre) return res.status(403).json({ error: 'Solo puedes utilizar tu propia cuenta.' });
  res.json({ nombre: usuario.username, password: true });
});

app.post('/api/jugadores/:nombre/verificar-password', async (req, res) => {
  const { password } = req.body;
  const jugador = await Usuario.findById(req.session.usuarioId);
  if (!jugador || jugador.username !== req.params.nombre) return res.status(403).json({ error: 'Solo puedes validar tu propia cuenta.' });
  const match = await bcrypt.compare(password, jugador.password);

  if (match) {
    return res.json({ success: true });
  }

  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.post('/api/jugadores/:nombre/cambiar-password', async (req, res) => {
  const { nombre } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (String(newPassword || '').length < 8) {
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  const jugador = await Usuario.findById(req.session.usuarioId);
  if (jugador?.username !== nombre) return res.status(403).json({ error: 'Solo puedes cambiar tu propia contraseña.' });
  if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });

  if (jugador.password) {
    const match = await bcrypt.compare(currentPassword, jugador.password);
    if (!match) return res.status(400).json({ message: 'Contraseña actual incorrecta' });
  }

  jugador.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await jugador.save();

  res.json({ message: 'Contraseña cambiada correctamente' });
});

/* ================= API: Jornadas ================= */

app.get('/api/jornadas', async (req, res) => {
  const jornadas = await Jornada.find({});
  res.json(jornadas.map(j => ({
    nombre: j.nombre,
    partidos: j.partidos,
    fechaCierre: j.fechaCierre || null
  })));
});

app.get('/api/jornadas/:nombre', async (req, res) => {
  const jornada = await Jornada.findOne({ nombre: req.params.nombre });
  if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada.' });

  res.json({
    nombre: jornada.nombre,
    partidos: jornada.partidos,
    fechaCierre: jornada.fechaCierre || null
  });
});

app.post('/api/jornadas', requireAdmin, async (req, res) => {
  const { nombre, partidos, fechaCierre } = req.body;

  await Jornada.findOneAndUpdate(
    { nombre },
    {
      nombre,
      partidos,
      ...(fechaCierre && { fechaCierre })
    },
    { upsert: true }
  );

  const jornadas = await Jornada.find({});
  res.json(jornadas.map(j => [j.nombre, j.partidos]));
});

app.post('/api/jornadas/importar-api', requireAdmin, async (req, res) => {
  try {
    const { nombre, fechaCierre, partidos } = req.body;

    if (!nombre || !Array.isArray(partidos) || partidos.length === 0) {
      return res.status(400).json({
        error: 'Nombre y partidos son obligatorios'
      });
    }

    const partidosFormateados = partidos.map(p => ({
      equipo1: p.equipo1,
      equipo2: p.equipo2,
       logoEquipo1: p.logoEquipo1 || '',
       logoEquipo2: p.logoEquipo2 || '',
      comodin: !!p.comodin,
      apiFixtureId: p.apiFixtureId ? String(p.apiFixtureId) : '',
      apiLeagueId: p.apiLeagueId ? String(p.apiLeagueId) : '',
      apiDate: p.fecha || '',
      apiStatus: p.estado || ''
    }));

    await Jornada.findOneAndUpdate(
      { nombre },
      {
        nombre,
        partidos: partidosFormateados,
        ...(fechaCierre && { fechaCierre })
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Jornada importada correctamente'
    });
  } catch (error) {
    console.error('Error importando jornada:', error);
    res.status(500).json({ error: 'Error al importar jornada' });
  }
});

app.post('/api/jornadas/agregar-partido', requireAdmin, async (req, res) => {
  const { jornada, partido } = req.body;
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).json({ error: 'Jornada no encontrada.' });

  doc.partidos.push(partido);
  await doc.save();

  res.json({ success: true });
});

app.post('/api/jornadas/eliminar-partidos',requireAdmin, async (req, res) => {
  const { jornada, indices } = req.body;
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).json({ error: 'Jornada no encontrada.' });

  indices.sort((a, b) => b - a).forEach(i => doc.partidos.splice(i, 1));
  await doc.save();

  res.json({ success: true });
});

app.post('/api/jornadas/comodin',requireAdmin, async (req, res) => {
  const { jornada, partidos } = req.body;
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).send('Jornada no encontrada');

  doc.partidos = partidos;
  await doc.save();

  res.send('Estado de comodín actualizado');
});

/* ================= API-Football ================= */

app.get('/api/football/fixtures', async (req, res) => {
  try {
    const { date, from, to, league } = req.query;

    if (!process.env.APIFOOTBALL_COM_KEY) {
      return res.status(500).json({
        error: 'Falta configurar APIFOOTBALL_COM_KEY en el .env'
      });
    }

    const fechaInicio = from || date;
    const fechaFin = to || date;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        error: 'Debe enviar date=YYYY-MM-DD o from/to'
      });
    }

    const params = {
      action: 'get_events',
      from: fechaInicio,
      to: fechaFin,
      APIkey: process.env.APIFOOTBALL_COM_KEY,
      timezone: 'America/Costa_Rica'
    };

    if (league) {
      params.league_id = league;
    }

    const response = await apiFootballCom.get('', { params });

    if (!Array.isArray(response.data)) {
      console.log('Respuesta APIfootball.com:', response.data);
      return res.json([]);
    }

    const partidos = response.data.map(item => ({
      apiFixtureId: Number(item.match_id),
      fecha: `${item.match_date} ${item.match_time}`,
      estado: item.match_status || 'NS',
      minuto: null,
      liga: item.league_name || '',
      pais: item.country_name || '',
      temporada: '',
      apiLeagueId: Number(item.league_id),
      equipo1: item.match_hometeam_name,
      equipo2: item.match_awayteam_name,
      logoEquipo1: item.team_home_badge || '',
      logoEquipo2: item.team_away_badge || '',      
      marcador1: item.match_hometeam_score !== '' ? Number(item.match_hometeam_score) : null,
      marcador2: item.match_awayteam_score !== '' ? Number(item.match_awayteam_score) : null
    }));

    res.json(partidos);

  } catch (error) {
    console.error('Error consultando APIfootball.com:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al consultar partidos externos' });
  }
});

app.get('/api/football/leagues', async (req, res) => {
  try {
    const response = await apiFootballCom.get('', {
      params: {
        action: 'get_leagues',
        APIkey: process.env.APIFOOTBALL_COM_KEY
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Error consultando ligas' });
  }
});

// Aquí estaba /api/football/leagues-test, copia literal de /api/football/leagues.
// No la usaba ningún archivo del frontend.

function obtenerNumeroSeguro(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  return Number.isNaN(numero) ? '' : numero;
}

/*
function obtenerMarcador90Minutos(fixture) {
  const posiblesLocal = [
    fixture.match_hometeam_ft_score,
    fixture.match_hometeam_fulltime_score,
    fixture.match_hometeam_score_ft,
    fixture.match_hometeam_score
  ];

  const posiblesVisitante = [
    fixture.match_awayteam_ft_score,
    fixture.match_awayteam_fulltime_score,
    fixture.match_awayteam_score_ft,
    fixture.match_awayteam_score
  ];

  return {
    marcador1: obtenerNumeroSeguro(posiblesLocal.find(v => v !== undefined && v !== null && v !== '')),
    marcador2: obtenerNumeroSeguro(posiblesVisitante.find(v => v !== undefined && v !== null && v !== ''))
  };
}
*/

function obtenerMarcador90Minutos(fixture, estadoPartido = null) {
  const estado = estadoPartido?.estado || '';

  // Mientras el partido está en vivo o en medio tiempo,
  // usamos el marcador vivo directo del API.
  if (estado === 'LIVE' || estado === 'MT') {
    return {
      marcador1: obtenerNumeroSeguro(fixture.match_hometeam_score),
      marcador2: obtenerNumeroSeguro(fixture.match_awayteam_score)
    };
  }

  const ftHome = obtenerNumeroSeguro(fixture.match_hometeam_ft_score);
  const ftAway = obtenerNumeroSeguro(fixture.match_awayteam_ft_score);

  if (ftHome !== '' && ftAway !== '') {
    return { marcador1: ftHome, marcador2: ftAway };
  }

  const goles = Array.isArray(fixture.goalscorer) ? fixture.goalscorer : [];

  const golesRegulares = goles.filter(gol => {
    const periodo = String(gol.score_info_time || '').toLowerCase();
    const info = String(gol.info || '').toLowerCase();

    if (periodo === 'penalty') return false;
    if (periodo.includes('extra time')) return false;
    if (info.includes('penalty')) return false;

    return gol.score && /^\d+\s*-\s*\d+$/.test(gol.score);
  });

  if (golesRegulares.length > 0) {
    const ultimoGol = golesRegulares[golesRegulares.length - 1];
    const [home, away] = ultimoGol.score.split('-').map(n => Number(n.trim()));

    return {
      marcador1: Number.isNaN(home) ? '' : home,
      marcador2: Number.isNaN(away) ? '' : away
    };
  }

  return {
    marcador1: obtenerNumeroSeguro(fixture.match_hometeam_score),
    marcador2: obtenerNumeroSeguro(fixture.match_awayteam_score)
  };
}

function normalizarEquipo(nombre) {
  return (nombre || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerFechaApi(apiDate) {
  if (!apiDate) return '';
  return String(apiDate).split(' ')[0].split('T')[0];
}

async function buscarEventoPorId(matchId) {
  if (!matchId) return null;

  const response = await apiFootballCom.get('', {
    params: {
      action: 'get_events',
      match_id: String(matchId),
      timezone: 'America/Costa_Rica',
      APIkey: process.env.APIFOOTBALL_COM_KEY
    }
  });

  return Array.isArray(response.data) ? response.data[0] : null;
}

async function buscarEventoPorFallback(partido) {
  const fecha = extraerFechaApi(partido.apiDate);
  if (!fecha) return null;

  const params = {
    action: 'get_events',
    from: fecha,
    to: fecha,
    APIkey: process.env.APIFOOTBALL_COM_KEY
  };

  if (partido.apiLeagueId) {
    params.league_id = partido.apiLeagueId;
  }

  const response = await apiFootballCom.get('', { params });
  const eventos = Array.isArray(response.data) ? response.data : [];

  const equipo1 = normalizarEquipo(partido.equipo1);
  const equipo2 = normalizarEquipo(partido.equipo2);

  return eventos.find(evento => {
    const local = normalizarEquipo(evento.match_hometeam_name);
    const visita = normalizarEquipo(evento.match_awayteam_name);

    return local === equipo1 && visita === equipo2;
  }) || null;
}


async function sincronizarTodasLasJornadasDesdeApi() {
  const jornadas = await Jornada.find({
    'partidos.apiFixtureId': { $exists: true, $ne: '' }
  });

  for (const jornada of jornadas) {
    try {
      await axios.post(
        `http://localhost:${PORT}/api/sync-resultados-oficiales/${encodeURIComponent(jornada.nombre)}`,
        {},
        {
          headers: {
            'x-internal-sync-token': INTERNAL_SYNC_TOKEN,
            'x-quiniela-id': jornada.quinielaId.toString()
          }
        }
      );
    } catch (err) {
      console.error(`Error sincronizando ${jornada.nombre}:`, err.message);
    }
  }
}


/*function obtenerMinutoPartido(fixture) {
  const estado = String(fixture?.match_status || '');

  if (fixture?.match_live === '1' && /^\d+$/.test(estado)) {
    return Number(estado);
  }

  return null;
}

function obtenerEstadoVisual(fixture, partido) {
  const estado = String(fixture?.match_status || partido?.apiStatus || '');

  const estadosFinalizados = [
    'Finished',
    'After Pen.',
    'After ET',
    'Awarded'
  ];

  if (estadosFinalizados.includes(estado)) {
    return 'TC';
  }

  if (fixture?.match_live === '1' && /^\d+$/.test(estado)) {
    return 'LIVE';
  }

  return 'PROGRAMADO';
}
*/

function obtenerEstadoPartido(fixture, partido) {
  const estadoRaw = String(fixture?.match_status || partido?.apiStatus || '').trim();

  const estadoLower = estadoRaw.toLowerCase();

  const estadosFinalizados = [
    'finished',
    'ft',
    'after pen.',
    'after et',
    'awarded',
    'penalties'
  ];

  // Partido terminado
  if (estadosFinalizados.includes(estadoLower)) {
    return {
      estado: 'TC',
      minuto: null
    };
  }

  // Medio tiempo
  if (
    estadoLower === 'half time' ||
    estadoLower === 'halftime' ||
    estadoLower === 'ht'
  ) {
    return {
      estado: 'MT',
      minuto: null
    };
  }

  // Tiempo agregado primer tiempo
  if (/^45\+/.test(estadoRaw)) {
    return {
      estado: 'LIVE',
      minuto: '45+'
    };
  }

  // Tiempo agregado segundo tiempo
  if (/^90\+/.test(estadoRaw)) {
    return {
      estado: 'LIVE',
      minuto: '90+'
    };
  }

  // Cualquier minuto numérico significa partido en vivo
  // Ej: "1", "34", "67", "89"
  if (/^\d+$/.test(estadoRaw)) {
    const minuto = Number(estadoRaw);

    if (minuto >= 90) {
      return {
        estado: 'LIVE',
        minuto: '90+'
      };
    }

    if (minuto >= 45 && minuto < 46) {
      return {
        estado: 'LIVE',
        minuto: '45+'
      };
    }

    return {
      estado: 'LIVE',
      minuto
    };
  }

  // Todavía no inicia
  return {
    estado: 'PROGRAMADO',
    minuto: null
  };
}


app.post('/api/sync-resultados-oficiales/:jornada', requireAdmin, async (req, res) => {
  try {
    const { jornada } = req.params;

    if (!process.env.APIFOOTBALL_COM_KEY) {
      return res.status(500).json({
        error: 'Falta configurar APIFOOTBALL_COM_KEY en el .env'
      });
    }

    const jornadaDoc = await Jornada.findOne({ nombre: jornada });

    if (!jornadaDoc) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    const oficialExistente = await ResultadoOficial.findOne({ jornada });
    const resultadosExistentes = oficialExistente ? oficialExistente.resultados : [];

    const resultadosActualizados = [];

    for (const partido of jornadaDoc.partidos) {
      const existente = buscarOficialCorrespondiente(resultadosExistentes, partido);

      let fixture = null;

      if (partido.apiFixtureId) {
        fixture = await buscarEventoPorId(partido.apiFixtureId);
      }

      if (!fixture) {
        fixture = await buscarEventoPorFallback(partido);
      }

      if (!fixture) {
        if (existente) {
          resultadosActualizados.push(existente);
        } else {
          resultadosActualizados.push({
            equipo1: partido.equipo1,
            logoEquipo1: partido.logoEquipo1 || '',
            marcador1: null,
            equipo2: partido.equipo2,
            logoEquipo2: partido.logoEquipo2 || '',
            marcador2: null,
            comodin: partido.comodin,

            estado: 'PROGRAMADO',
            minuto: null,
            fecha: partido.apiDate || '',

            origen: 'api',
            bloqueadoFinal: false,
            actualizadoEn: new Date()
          });
        }

        continue;
      }

      const home = normalizarEquipo(fixture.match_hometeam_name);
      const away = normalizarEquipo(fixture.match_awayteam_name);
      const eq1 = normalizarEquipo(partido.equipo1);
      const eq2 = normalizarEquipo(partido.equipo2);

      const vieneInvertido = home === eq2 && away === eq1;
      const estadoPartido = obtenerEstadoPartido(fixture, partido);
      const marcador90 = obtenerMarcador90Minutos(fixture, estadoPartido);

      const resultadoApi = {
        equipo1: partido.equipo1,
        logoEquipo1: partido.logoEquipo1 || '',
        marcador1: vieneInvertido ? marcador90.marcador2 : marcador90.marcador1,
        equipo2: partido.equipo2,
        logoEquipo2: partido.logoEquipo2 || '',
        marcador2: vieneInvertido ? marcador90.marcador1 : marcador90.marcador2,
        comodin: partido.comodin,

        estado: estadoPartido.estado,
        minuto: estadoPartido.minuto,
        fecha: partido.apiDate || '',

        origen: 'api',
        bloqueadoFinal: estadoPartido.estado === 'TC',
        actualizadoEn: new Date()
      };

      if (estadoPartido.estado === 'LIVE' || estadoPartido.estado === 'MT') {
        console.log('===== SYNC LIVE =====');
        console.log({
          horaCR: new Date().toLocaleString('es-CR', {
            timeZone: 'America/Costa_Rica'
          }),

          jornada,

          partido: `${partido.equipo1} vs ${partido.equipo2}`,

          apiFixtureId: partido.apiFixtureId,

          apiRaw: {
            match_status: fixture.match_status,
            match_live: fixture.match_live,
            score: `${fixture.match_hometeam_score}-${fixture.match_awayteam_score}`,
            ftScore: `${fixture.match_hometeam_ft_score}-${fixture.match_awayteam_ft_score}`
          },

          calculadoSistema: {
            estado: estadoPartido.estado,
            minuto: estadoPartido.minuto
          },

          existente: existente ? {
            marcador1: existente.marcador1,
            marcador2: existente.marcador2,
            estado: existente.estado,
            minuto: existente.minuto,
            origen: existente.origen
          } : null,

          decision: {
            marcador: `${resultadoApi.marcador1}-${resultadoApi.marcador2}`,
            accion: 'GUARDAR_API_LIVE'
          }
        });
        console.log('=====================');
      }

      if (estadoPartido.estado === 'LIVE' || estadoPartido.estado === 'MT') {
        resultadosActualizados.push(resultadoApi);
        continue;
      }

      if (estadoPartido.estado === 'TC' && existente?.origen === 'manual') {
        resultadosActualizados.push(existente);
        continue;
      }

      if (estadoPartido.estado === 'PROGRAMADO' && existente) {
        resultadosActualizados.push(existente);
        continue;
      }

      resultadosActualizados.push(resultadoApi);
    }

    await ResultadoOficial.findOneAndUpdate(
      { jornada },
      {
        jornada,
        resultados: resultadosActualizados
      },
      { upsert: true, new: true }
    );

    await resolverTriviasPendientes(jornada);

    res.json({
      success: true,
      jornada,
      resultados: resultadosActualizados
    });

  } catch (error) {
    console.error('Error sincronizando resultados oficiales:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error sincronizando resultados oficiales' });
  }
});

app.get('/api/admin/respuestas-trivias-jornada/:jornadaNombre', requireAdmin, async (req, res) => {
  try {
    const { jornadaNombre } = req.params;

    const trivias = await Trivia.find({
      jornadaNombre,
      activa: true
    }).sort({ partidoIndex: 1, tipo: 1 });

    const triviaIds = trivias.map(t => t._id.toString());

    const respuestas = await RespuestaTrivia.find({
      triviaId: { $in: triviaIds }
    }).sort({ jugador: 1 });

    res.json({
      jornadaNombre,
      trivias,
      respuestas
    });

  } catch (error) {
    console.error('Error obteniendo respuestas de trivias:', error);
    res.status(500).json({ error: 'Error obteniendo respuestas de trivias.' });
  }
});

/*
 * Aquí vivían una segunda `parseFechaPartido` y una segunda `partidoYaInicio`,
 * declaradas antes que las definitivas. Como las declaraciones de función se
 * elevan, la segunda definición ganaba siempre y estas nunca llegaban a
 * ejecutarse: eran código muerto que además engañaba al leer, porque
 * interpretaban `apiDate` en la zona horaria del servidor en lugar de la de
 * Costa Rica. Las versiones vigentes están más abajo.
 */

function buscarOficialCorrespondiente(resultadosOficiales, partido) {
  return resultadosOficiales.find(r =>
    (r.equipo1 === partido.equipo1 && r.equipo2 === partido.equipo2) ||
    (r.equipo1 === partido.equipo2 && r.equipo2 === partido.equipo1)
  );
}


/* ================= API: Resultados ================= */

app.get('/api/resultados', async (req, res) => {
  const usuario = await Usuario.findById(req.session.usuarioId);
  const esAdmin = ['propietario', 'admin'].includes(req.membership.rol);
  const jornadas = await Jornada.find({}).select('nombre fechaCierre').lean();
  const visibles = new Set(jornadas
    .filter(j => !j.fechaCierre || new Date(j.fechaCierre) <= new Date())
    .map(j => j.nombre));
  const todos = await Resultado.find({});
  const r = esAdmin ? todos : todos.filter(item => item.jugador === usuario.username || visibles.has(item.jornada));
  const resultMap = new Map();

  r.forEach(r => resultMap.set(`${r.jugador}_${r.jornada}`, r.pronosticos));

  res.json(Array.from(resultMap.entries()));
});



function parseFechaPartidoCostaRica(apiDate) {
  if (!apiDate) return null;

  const raw = String(apiDate).trim();

  // Formatos esperados:
  // "2026-07-04 13:00"
  // "2026-07-04T13:00"
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);

  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, year, month, day, hour, minute] = match.map(Number);

  // Costa Rica es UTC-6 todo el año
  return new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));
}

function partidoYaInicio(partido, oficial = null) {
  if (oficial && ['LIVE', 'MT', 'TC'].includes(oficial.estado)) {
    return true;
  }

  const fecha = parseFechaPartidoCostaRica(partido.apiDate);
  if (!fecha) return false;

  return fecha <= new Date();
}

app.post('/api/resultados', async (req, res) => {
  try {
    const { jugador, jornada, pronosticos } = req.body;

    const usuarioSesion = await Usuario.findById(req.session.usuarioId);
    if (!usuarioSesion || jugador !== usuarioSesion.username) {
      return res.status(403).json({ success: false, error: 'Solo puedes guardar tus propios pronósticos.' });
    }
    if (req.quiniela.estado !== 'activa' || req.membership.estado !== 'activo') {
      return res.status(409).json({ success: false, error: 'La quiniela o tu membresía no permiten nuevos pronósticos.' });
    }

    if (!jugador || !jornada || !Array.isArray(pronosticos)) {
      return res.status(400).json({ success: false, error: 'Datos inválidos.' });
    }

    const jornadaDoc = await Jornada.findOne({ nombre: jornada });

    if (!jornadaDoc) {
      return res.status(404).json({ success: false, error: 'Jornada no encontrada.' });
    }

    const oficialDoc = await ResultadoOficial.findOne({ jornada });
    const resultadosOficiales = oficialDoc ? oficialDoc.resultados : [];

    const resultadoExistente = await Resultado.findOne({ jugador, jornada });
    const pronosticosActuales = resultadoExistente ? resultadoExistente.pronosticos : [];

    let guardados = 0;
    let bloqueados = 0;

    const pronosticosFinales = jornadaDoc.partidos.map((partido, index) => {
      const oficial = buscarOficialCorrespondiente(resultadosOficiales, partido);
      const bloqueado = partidoYaInicio(partido, oficial);

      if (bloqueado) {
        bloqueados++;

        return pronosticosActuales[index] || {
          equipo1: partido.equipo1,
          equipo2: partido.equipo2,
          marcador1: null,
          marcador2: null
        };
      }

      const nuevo = pronosticos[index] || {};

      const marcador1 = nuevo.marcador1 === '' || nuevo.marcador1 === null || nuevo.marcador1 === undefined
        ? null
        : Number(nuevo.marcador1);

      const marcador2 = nuevo.marcador2 === '' || nuevo.marcador2 === null || nuevo.marcador2 === undefined
        ? null
        : Number(nuevo.marcador2);

      if (
        (marcador1 !== null && Number.isNaN(marcador1)) ||
        (marcador2 !== null && Number.isNaN(marcador2))
      ) {
        throw new Error(`Marcador inválido en partido ${index + 1}`);
      }

      guardados++;

      return {
        equipo1: partido.equipo1,
        equipo2: partido.equipo2,
        marcador1,
        marcador2
      };
    });

    await Resultado.findOneAndUpdate(
      { jugador, jornada },
      { jugador, jornada, pronosticos: pronosticosFinales },
      { upsert: true, new: true }
    );

    const all = await Resultado.find({});
    const resultMap = new Map();

    all.forEach(r => resultMap.set(`${r.jugador}_${r.jornada}`, r.pronosticos));

    res.json({
      success: true,
      mensaje: `Resultados guardados correctamente. Partidos actualizados: ${guardados}. Partidos bloqueados: ${bloqueados}.`,
      guardados,
      bloqueados,
      resultados: Array.from(resultMap.entries())
    });

  } catch (error) {
    console.error('Error guardando resultados:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error guardando resultados.'
    });
  }
});


app.post('/api/admin/resultados', requireAdmin, async (req, res) => {
  try {
    const { jugador, jornada, pronosticos } = req.body;

    if (!jugador || !jornada || !Array.isArray(pronosticos)) {
      return res.status(400).json({
        success: false,
        error: 'Datos inválidos.'
      });
    }

    const jornadaDoc = await Jornada.findOne({ nombre: jornada });

    if (!jornadaDoc) {
      return res.status(404).json({
        success: false,
        error: 'Jornada no encontrada.'
      });
    }

    const pronosticosFinales = jornadaDoc.partidos.map((partido, index) => {
      const nuevo = pronosticos[index] || {};

      return {
        equipo1: partido.equipo1,
        equipo2: partido.equipo2,
        marcador1: nuevo.marcador1 === '' || nuevo.marcador1 === null || nuevo.marcador1 === undefined
          ? null
          : Number(nuevo.marcador1),
        marcador2: nuevo.marcador2 === '' || nuevo.marcador2 === null || nuevo.marcador2 === undefined
          ? null
          : Number(nuevo.marcador2)
      };
    });

    await Resultado.findOneAndUpdate(
      { jugador, jornada },
      { jugador, jornada, pronosticos: pronosticosFinales },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      mensaje: 'Resultados guardados correctamente desde modo admin.'
    });

  } catch (error) {
    console.error('Error guardando resultados admin:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando resultados admin.'
    });
  }
});

app.get('/api/resultados/:jugador/:jornada', async (req, res) => {
  const { jugador, jornada } = req.params;
  const [usuario, jornadaDoc] = await Promise.all([
    Usuario.findById(req.session.usuarioId),
    Jornada.findOne({ nombre: jornada })
  ]);
  const cerrada = !jornadaDoc?.fechaCierre || new Date(jornadaDoc.fechaCierre) <= new Date();
  const esAdmin = ['propietario', 'admin'].includes(req.membership.rol);
  if (!cerrada && !esAdmin && usuario?.username !== jugador) {
    return res.status(403).json({ error: 'Los pronósticos de otros participantes permanecen privados hasta el cierre.' });
  }
  const r = await Resultado.findOne({ jugador, jornada });

  res.json(r ? r.pronosticos : []);
});

/* ================= API: Resultados Oficiales ================= */

app.get('/api/resultados-oficiales', async (req, res) => {
  const all = await ResultadoOficial.find({});
  const resultados = all.map(r => ({
    nombre: r.jornada,
    partidos: r.resultados
  }));

  res.json(resultados);
});

app.post('/api/resultados-oficiales', requireAdmin, async (req, res) => {
  const { jornada, resultados } = req.body;

  const jornadaDoc = await Jornada.findOne({ nombre: jornada });

  const resultadosConLogos = resultados.map((r, index) => {
    const partidoJornada = jornadaDoc?.partidos?.[index];

   return {
  equipo1: r.equipo1,
  logoEquipo1: r.logoEquipo1 || partidoJornada?.logoEquipo1 || '',
  marcador1: r.marcador1,
  equipo2: r.equipo2,
  logoEquipo2: r.logoEquipo2 || partidoJornada?.logoEquipo2 || '',
  marcador2: r.marcador2,
  comodin: r.comodin,

  estado: r.estado || 'TC',
  minuto: r.minuto ?? null,
  fecha: r.fecha || partidoJornada?.apiDate || '',

  origen: 'manual',
  bloqueadoFinal: true,
  actualizadoEn: new Date()
};
  });

  await ResultadoOficial.findOneAndUpdate(
    { jornada },
    { jornada, resultados: resultadosConLogos },
    { upsert: true }
  );

  const all = await ResultadoOficial.find({});
  const resultadosArray = all.map(r => ({
    nombre: r.jornada,
    partidos: r.resultados
  }));

  res.json(resultadosArray);
});


app.get('/api/resultados-oficiales/:jornada', async (req, res) => {
  try {
    const jornadaNombre = req.params.jornada;
    const jornadaDoc = await Jornada.findOne({ nombre: jornadaNombre });

    if (!jornadaDoc) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    const oficial = await ResultadoOficial.findOne({ jornada: jornadaNombre });
    const resultadosExistentes = oficial ? oficial.resultados : [];

    const partidosConResultados = jornadaDoc.partidos.map(p => {
    let invertido = false;

    let r = resultadosExistentes.find(r =>
        r.equipo1 === p.equipo1 && r.equipo2 === p.equipo2
      );

      if (!r) {
        r = resultadosExistentes.find(r =>
          r.equipo1 === p.equipo2 && r.equipo2 === p.equipo1
        );
        invertido = !!r;
      }

      return {
        equipo1: p.equipo1,
        equipo2: p.equipo2,
        marcador1: r ? (invertido ? r.marcador2 : r.marcador1) : '',
        marcador2: r ? (invertido ? r.marcador1 : r.marcador2) : '',
        comodin: p.comodin
      };
    });


    res.json({
      nombre: jornadaNombre,
      partidos: partidosConResultados
    });
  } catch (error) {
    console.error('Error al obtener resultados oficiales de la jornada:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/tipos-trivia', (req, res) => {
  res.json([
    { tipo: 'primer_gol', pregunta: TIPOS_TRIVIA.primer_gol.pregunta },
    { tipo: 'mas_amarillas', pregunta: TIPOS_TRIVIA.mas_amarillas.pregunta },
    { tipo: 'mas_rojas', pregunta: TIPOS_TRIVIA.mas_rojas.pregunta },
    { tipo: 'ambos_anotan', pregunta: TIPOS_TRIVIA.ambos_anotan.pregunta },
    { tipo: 'gol_primer_tiempo', pregunta: TIPOS_TRIVIA.gol_primer_tiempo.pregunta },
    { tipo: 'gol_segundo_tiempo', pregunta: TIPOS_TRIVIA.gol_segundo_tiempo.pregunta },
    { tipo: 'hubo_tiempo_extra', pregunta: TIPOS_TRIVIA.hubo_tiempo_extra.pregunta },
    { tipo: 'hubo_penales', pregunta: TIPOS_TRIVIA.hubo_penales.pregunta }
  ]);
});




app.post('/api/admin/trivias', requireAdmin, async (req, res) => {
  try {
    if (!req.quiniela.configuracion.puntuacion.triviasHabilitadas) {
      return res.status(409).json({ error: 'Habilita las trivias en la configuración de la quiniela.' });
    }
    const { jornadaNombre, partidoIndex, tipos, fechaCierre } = req.body;

    if (!jornadaNombre || partidoIndex === undefined || !Array.isArray(tipos) || tipos.length === 0 || !fechaCierre) {
      return res.status(400).json({ error: 'Faltan datos para crear las trivias.' });
    }

    const jornada = await Jornada.findOne({ nombre: jornadaNombre });

    if (!jornada) {
      return res.status(404).json({ error: 'Jornada no encontrada.' });
    }

    const partido = jornada.partidos[Number(partidoIndex)];

    if (!partido) {
      return res.status(404).json({ error: 'Partido no encontrado.' });
    }

    const creadas = [];

    for (const tipo of tipos) {
      if (!TIPOS_TRIVIA[tipo]) continue;

      const existe = await Trivia.findOne({
        jornadaNombre,
        partidoIndex: Number(partidoIndex),
        tipo,
        activa: true
      });

      if (existe) {
        existe.fechaCierre = new Date(fechaCierre);
        await existe.save();
        continue;
      }

      const trivia = new Trivia({
        jornadaNombre,
        partidoIndex: Number(partidoIndex),
        apiFixtureId: partido.apiFixtureId || partido.fixtureId || '',
        equipo1: partido.equipo1,
        equipo2: partido.equipo2,
        tipo,
        pregunta: TIPOS_TRIVIA[tipo].pregunta,
        opciones: opcionesTrivia(tipo, partido.equipo1, partido.equipo2),
        puntos: req.quiniela.configuracion.puntuacion.puntosTriviaDefault,
        fechaCierre: new Date(fechaCierre),
        respuestaCorrecta: '',
        resuelta: false,
        activa: true
      });

      await trivia.save();
      creadas.push(trivia);
    }

    res.json({
      mensaje: 'Trivias creadas correctamente.',
      creadas
    });

  } catch (error) {
    console.error('Error creando trivias:', error);
    res.status(500).json({ error: 'Error creando trivias.' });
  }
});

app.get('/api/admin/trivias/:jornadaNombre', requireAdmin, async (req, res) => {
  try {
    const trivias = await Trivia.find({
      jornadaNombre: req.params.jornadaNombre,
      activa: true
    }).sort({ partidoIndex: 1, tipo: 1 });

    res.json(trivias);

  } catch (error) {
    console.error('Error obteniendo trivias admin:', error);
    res.status(500).json({ error: 'Error obteniendo trivias.' });
  }
});


app.put('/api/admin/trivias/:jornadaNombre', requireAdmin, async (req, res) => {
  try {
    const { jornadaNombre } = req.params;
    const { fechaCierre, configuracion } = req.body;

    if (!jornadaNombre || !fechaCierre || !Array.isArray(configuracion)) {
      return res.status(400).json({ error: 'Datos inválidos para actualizar trivias.' });
    }

    const jornada = await Jornada.findOne({ nombre: jornadaNombre });

    if (!jornada) {
      return res.status(404).json({ error: 'Jornada no encontrada.' });
    }

    const fecha = new Date(fechaCierre);

    const existentes = await Trivia.find({
      jornadaNombre,
      activa: true
    });

    const seleccionadas = new Set();

    configuracion.forEach(item => {
      if (!Array.isArray(item.tipos)) return;

      item.tipos.forEach(tipo => {
        seleccionadas.add(`${Number(item.partidoIndex)}_${tipo}`);
      });
    });

    let creadas = 0;
    let actualizadas = 0;
    let eliminadas = 0;

    for (const trivia of existentes) {
      const clave = `${Number(trivia.partidoIndex)}_${trivia.tipo}`;

      if (!seleccionadas.has(clave)) {
        await RespuestaTrivia.deleteMany({
          triviaId: trivia._id.toString()
        });

        await Trivia.deleteOne({
          _id: trivia._id
        });

        eliminadas++;
        continue;
      }

      const fechaAnterior = trivia.fechaCierre ? new Date(trivia.fechaCierre).getTime() : null;
      const fechaNueva = fecha.getTime();

      trivia.fechaCierre = fecha;

      if (fechaAnterior !== fechaNueva) {
        trivia.resuelta = false;
        trivia.respuestaCorrecta = '';

        await RespuestaTrivia.updateMany(
          { triviaId: trivia._id.toString() },
          { $set: { puntos: 0 } }
        );
      }

      await trivia.save();
      actualizadas++;
    }

    for (const item of configuracion) {
      const partidoIndex = Number(item.partidoIndex);
      const partido = jornada.partidos[partidoIndex];

      if (!partido || !Array.isArray(item.tipos)) continue;

      for (const tipo of item.tipos) {
        if (!TIPOS_TRIVIA[tipo]) continue;

        const existe = await Trivia.findOne({
          jornadaNombre,
          partidoIndex,
          tipo,
          activa: true
        });

        if (existe) continue;

        const trivia = new Trivia({
          jornadaNombre,
          partidoIndex,
          apiFixtureId: partido.apiFixtureId || partido.fixtureId || '',
          equipo1: partido.equipo1,
          equipo2: partido.equipo2,
          tipo,
          pregunta: TIPOS_TRIVIA[tipo].pregunta,
          opciones: opcionesTrivia(tipo, partido.equipo1, partido.equipo2),
          puntos: req.quiniela.configuracion.puntuacion.puntosTriviaDefault,
          fechaCierre: fecha,
          respuestaCorrecta: '',
          resuelta: false,
          activa: true
        });

        await trivia.save();
        creadas++;
      }
    }

    res.json({
      mensaje: `Cambios guardados. Creadas: ${creadas}, actualizadas: ${actualizadas}, eliminadas: ${eliminadas}.`,
      creadas,
      actualizadas,
      eliminadas
    });

  } catch (error) {
    console.error('Error actualizando trivias:', error);
    res.status(500).json({ error: 'Error actualizando trivias.' });
  }
});


app.delete('/api/admin/trivias/:triviaId', requireAdmin, async (req, res) => {
  try {
    const { triviaId } = req.params;

    const trivia = await Trivia.findById(triviaId);

    if (!trivia) {
      return res.status(404).json({ error: 'Trivia no encontrada.' });
    }

    await RespuestaTrivia.deleteMany({
      triviaId: trivia._id.toString()
    });

    await Trivia.deleteOne({
      _id: trivia._id
    });

    res.json({
      mensaje: 'Trivia eliminada correctamente. También se eliminaron sus respuestas y puntos.'
    });

  } catch (error) {
    console.error('Error eliminando trivia:', error);
    res.status(500).json({ error: 'Error eliminando trivia.' });
  }
});


////////Starting trivias activas ////////////////

app.get('/api/trivias/activas', async (req, res) => {
  try {
    const trivias = await Trivia.find({ activa: true })
      .sort({ jornadaNombre: 1, partidoIndex: 1, tipo: 1 });

    const activas = [];

    for (const trivia of trivias) {
      const jornada = await Jornada.findOne({ nombre: trivia.jornadaNombre });
      const partido = jornada?.partidos?.[Number(trivia.partidoIndex)];

      if (!partido) continue;

      const oficialDoc = await ResultadoOficial.findOne({
        jornada: trivia.jornadaNombre
      });

      const resultadosOficiales = oficialDoc ? oficialDoc.resultados : [];
      const oficial = buscarOficialCorrespondiente(resultadosOficiales, partido);

      if (!partidoYaInicio(partido, oficial)) {
        activas.push(trivia);
      }
    }

    res.json(activas);

  } catch (error) {
    console.error('Error obteniendo trivias activas:', error);
    res.status(500).json({ error: 'Error obteniendo trivias activas.' });
  }
});




///////// Starting trivias latest ///////////////

app.get('/api/trivias/latest', async (req, res) => {
  try {
    const ultimaTrivia = await Trivia.findOne({ activa: true })
      .sort({ fechaCierre: -1, createdAt: -1 });

    if (!ultimaTrivia) {
      return res.json({
        jornadaNombre: null,
        fechaCierre: null,
        cerrada: false,
        trivias: []
      });
    }

    const trivias = await Trivia.find({
      activa: true,
      jornadaNombre: ultimaTrivia.jornadaNombre
    }).sort({ partidoIndex: 1, tipo: 1 });

    const fechaCierre = ultimaTrivia.fechaCierre;
    const cerrada = fechaCierre ? new Date(fechaCierre) <= new Date() : false;

    res.json({
      jornadaNombre: ultimaTrivia.jornadaNombre,
      fechaCierre,
      cerrada,
      trivias
    });

  } catch (error) {
    console.error('Error obteniendo última trivia:', error);
    res.status(500).json({ error: 'Error obteniendo última trivia.' });
  }
});


function tieneValorApi(valor) {
  return valor !== undefined && valor !== null && String(valor).trim() !== '';
}

function huboTiempoExtra(evento) {
  const estado = String(evento?.match_status || '').toLowerCase();

  if (estado.includes('after et')) return true;
  if (estado.includes('after pen')) return true;

  if (
    tieneValorApi(evento?.match_hometeam_extra_score) ||
    tieneValorApi(evento?.match_awayteam_extra_score)
  ) {
    return true;
  }

  const goles = Array.isArray(evento?.goalscorer) ? evento.goalscorer : [];
  const tarjetas = Array.isArray(evento?.cards) ? evento.cards : [];

  const huboEventoExtra = [...goles, ...tarjetas].some(item =>
    String(item.score_info_time || '').toLowerCase().includes('extra time')
  );

  return huboEventoExtra;
}

function huboPenales(evento) {
  const estado = String(evento?.match_status || '').toLowerCase();

  if (estado.includes('after pen')) return true;

  if (
    tieneValorApi(evento?.match_hometeam_penalty_score) ||
    tieneValorApi(evento?.match_awayteam_penalty_score)
  ) {
    return true;
  }

  const goles = Array.isArray(evento?.goalscorer) ? evento.goalscorer : [];

  return goles.some(gol =>
    String(gol.score_info_time || '').toLowerCase() === 'penalty'
  );
}


/////// api trivias ///////
app.get('/api/trivias', async (req, res) => {
  try {
    const trivias = await Trivia.find({ activa: true }).sort({ jornadaNombre: 1, partidoIndex: 1 });
    res.json(trivias);
  } catch (error) {
    console.error('Error obteniendo trivias:', error);
    res.status(500).json({ error: 'Error obteniendo trivias.' });
  }
});



////// End point trivia here /////////

app.get('/api/trivias/:jornadaNombre', async (req, res) => {
  try {
    const trivias = await Trivia.find({
      jornadaNombre: req.params.jornadaNombre,
      activa: true
    }).sort({ partidoIndex: 1 });

    res.json(trivias);
  } catch (error) {
    console.error('Error obteniendo trivias por jornada:', error);
    res.status(500).json({ error: 'Error obteniendo trivias por jornada.' });
  }
});

app.get('/api/respuestas-trivia/:jugador/:jornadaNombre', async (req, res) => {
  try {
    const { jugador, jornadaNombre } = req.params;

    const trivias = await Trivia.find({
      jornadaNombre,
      activa: true
    });

    const usuario = await Usuario.findById(req.session.usuarioId);
    const cerradas = trivias.every(t => !t.fechaCierre || new Date(t.fechaCierre) <= new Date());
    if (!cerradas && !['propietario', 'admin'].includes(req.membership.rol) && usuario?.username !== jugador) {
      return res.status(403).json({ error: 'Las respuestas de otros participantes permanecen privadas hasta el cierre.' });
    }

    const triviaIds = trivias.map(t => t._id.toString());

    const respuestas = await RespuestaTrivia.find({
      jugador,
      triviaId: { $in: triviaIds }
    });

    res.json(respuestas);
  } catch (error) {
    console.error('Error obteniendo respuestas de trivia:', error);
    res.status(500).json({ error: 'Error obteniendo respuestas de trivia.' });
  }
});

app.post('/api/respuestas-trivia', async (req, res) => {
  try {
    const { jugador, respuestas } = req.body;

    const usuarioSesion = await Usuario.findById(req.session.usuarioId);
    if (!usuarioSesion || jugador !== usuarioSesion.username) {
      return res.status(403).json({ error: 'Solo puedes guardar tus propias respuestas.' });
    }
    if (!req.quiniela.configuracion.puntuacion.triviasHabilitadas) {
      return res.status(409).json({ error: 'Las trivias están deshabilitadas en esta quiniela.' });
    }

    if (!jugador || !Array.isArray(respuestas)) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    for (const item of respuestas) {
      const trivia = await Trivia.findById(item.triviaId);

      if (!trivia) {
        return res.status(404).json({ error: 'Trivia no encontrada.' });
      }

      const jornadaDoc = await Jornada.findOne({ nombre: trivia.jornadaNombre });
const partido = jornadaDoc?.partidos?.[Number(trivia.partidoIndex)];

const oficialDoc = await ResultadoOficial.findOne({
  jornada: trivia.jornadaNombre
});

const resultadosOficiales = oficialDoc ? oficialDoc.resultados : [];
const oficial = partido ? buscarOficialCorrespondiente(resultadosOficiales, partido) : null;

if (partido && partidoYaInicio(partido, oficial)) {
  return res.status(403).json({
    error: `La trivia "${trivia.pregunta}" ya está cerrada porque el partido ya inició.`
  });
}


      await RespuestaTrivia.findOneAndUpdate(
        {
          jugador,
          triviaId: item.triviaId
        },
        {
          jugador,
          triviaId: item.triviaId,
          respuesta: item.respuesta,
          fechaRespuesta: new Date()
        },
        {
          upsert: true,
          new: true
        }
      );
    }

    res.json({ mensaje: 'Respuestas de trivia guardadas correctamente.' });

  } catch (error) {
    console.error('Error guardando respuestas de trivia:', error);
    res.status(500).json({ error: 'Error guardando respuestas de trivia.' });
  }
});


async function obtenerEventoTrivia(apiFixtureId) {
  if (!apiFixtureId) return null;

  const response = await apiFootballCom.get('', {
    params: {
      action: 'get_events',
      match_id: String(apiFixtureId),
      APIkey: process.env.APIFOOTBALL_COM_KEY,
      timezone: 'America/Costa_Rica'
    }
  });

  if (!Array.isArray(response.data) || response.data.length === 0) {
    console.log('APIfootball.com no devolvió evento para trivia:', apiFixtureId, response.data);
    return null;
  }

  return response.data[0];
}

function numeroDesdeTexto(valor) {
  const n = Number(String(valor || '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function minutoApiFootball(item) {
  const raw = String(item?.time || '').replace('+', '.');
  const n = Number(raw);
  return Number.isNaN(n) ? 999 : n;
}


function esGolApiFootball(gol) {
  const info = String(gol?.info || '').toLowerCase();
  const scoreInfoTime = String(gol?.score_info_time || '').toLowerCase();

  if (scoreInfoTime === 'penalty') return false;

  if (info.includes('cancel')) return false;
  if (info.includes('disallow')) return false;
  /*
   * Palabra completa, no subcadena. Antes era info.includes('var'), que anulaba
   * el gol de cualquier jugador apellidado Varela, Varane, Alvarez o Navarro:
   * el gol era legítimo y el jugador se quedaba sin sus puntos de trivia, sin
   * ningún error visible.
   */
  if (/\bvar\b/.test(info)) return false;

  return Boolean(gol?.home_scorer || gol?.away_scorer);
}


function obtenerGolesValidos(evento) {
  return Array.isArray(evento.goalscorer)
    ? evento.goalscorer.filter(esGolApiFootball)
    : [];
}


function obtenerEquipoPrimerGol(trivia, evento) {
  const goles = Array.isArray(evento.goalscorer) ? evento.goalscorer : [];

  const golesValidos = goles
    .filter(esGolApiFootball)
    .sort((a, b) => minutoApiFootball(a) - minutoApiFootball(b));

  if (golesValidos.length === 0) return 'Nadie anotará';

  const primerGol = golesValidos[0];

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  if (primerGol.home_scorer) {
    return apiInvertido ? trivia.equipo2 : trivia.equipo1;
  }

  if (primerGol.away_scorer) {
    return apiInvertido ? trivia.equipo1 : trivia.equipo2;
  }

  return '';
}

function contarTarjetasPorCards(evento, trivia, tipoTarjeta) {
  const cards = Array.isArray(evento.cards) ? evento.cards : [];

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  let home = 0;
  let away = 0;

  cards.forEach(card => {
    const tipo = String(card.card || '').toLowerCase();

    if (tipoTarjeta === 'amarilla') {
      if (!tipo.includes('yellow')) return;
    }

    if (tipoTarjeta === 'roja') {
      if (!tipo.includes('red')) return;
    }

    if (card.home_fault) home++;
    if (card.away_fault) away++;
  });

  return {
    equipo1: apiInvertido ? away : home,
    equipo2: apiInvertido ? home : away
  };
}

function contarAmarillasPorStatistics(evento, trivia) {
  const stats = Array.isArray(evento.statistics) ? evento.statistics : [];

  const stat = stats.find(s =>
    String(s.type || '').toLowerCase() === 'yellow cards'
  );

  if (!stat) return null;

  const home = numeroDesdeTexto(stat.home);
  const away = numeroDesdeTexto(stat.away);

  const homeApi = normalizarEquipo(evento.match_hometeam_name);
  const awayApi = normalizarEquipo(evento.match_awayteam_name);
  const equipo1 = normalizarEquipo(trivia.equipo1);
  const equipo2 = normalizarEquipo(trivia.equipo2);

  const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

  return {
    equipo1: apiInvertido ? away : home,
    equipo2: apiInvertido ? home : away
  };
}

function resolverRespuestaTrivia(trivia, evento) {
  if (!evento) return '';

  if (trivia.tipo === 'primer_gol') {
    return obtenerEquipoPrimerGol(trivia, evento);
  }

  if (trivia.tipo === 'mas_amarillas') {
    let conteo = contarTarjetasPorCards(evento, trivia, 'amarilla');

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) {
      const statsConteo = contarAmarillasPorStatistics(evento, trivia);
      if (statsConteo) conteo = statsConteo;
    }

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) return 'No habrá tarjetas amarillas';
    if (conteo.equipo1 > conteo.equipo2) return trivia.equipo1;
    if (conteo.equipo2 > conteo.equipo1) return trivia.equipo2;
    return 'Empate';
  }

  if (trivia.tipo === 'mas_rojas') {
    const conteo = contarTarjetasPorCards(evento, trivia, 'roja');

    if (conteo.equipo1 === 0 && conteo.equipo2 === 0) return 'No habrá tarjetas rojas';
    if (conteo.equipo1 > conteo.equipo2) return trivia.equipo1;
    if (conteo.equipo2 > conteo.equipo1) return trivia.equipo2;
    return 'Empate';
  }
  

  if (trivia.tipo === 'ambos_anotan') {
    const goles = Array.isArray(evento.goalscorer) ? evento.goalscorer.filter(esGolApiFootball) : [];

    const homeApi = normalizarEquipo(evento.match_hometeam_name);
    const awayApi = normalizarEquipo(evento.match_awayteam_name);
    const equipo1 = normalizarEquipo(trivia.equipo1);
    const equipo2 = normalizarEquipo(trivia.equipo2);

    const apiInvertido = homeApi === equipo2 && awayApi === equipo1;

    let homeAnoto = false;
    let awayAnoto = false;

    goles.forEach(gol => {
      if (gol.home_scorer) homeAnoto = true;
      if (gol.away_scorer) awayAnoto = true;
    });

    const equipo1Anoto = apiInvertido ? awayAnoto : homeAnoto;
    const equipo2Anoto = apiInvertido ? homeAnoto : awayAnoto;

    return equipo1Anoto && equipo2Anoto ? 'Sí' : 'No';
  }

  if (trivia.tipo === 'gol_primer_tiempo') {
  const goles = obtenerGolesValidos(evento);

  const hayGolPrimerTiempo = goles.some(gol => {
    const minuto = minutoApiFootball(gol);
    return minuto > 0 && minuto <= 45.99;
  });

  return hayGolPrimerTiempo ? 'Sí' : 'No';
}

if (trivia.tipo === 'gol_segundo_tiempo') {
  const goles = obtenerGolesValidos(evento);

  const hayGolSegundoTiempo = goles.some(gol => {
    const minuto = minutoApiFootball(gol);
    return minuto >= 46;
  });

  return hayGolSegundoTiempo ? 'Sí' : 'No';
}

if (trivia.tipo === 'hubo_tiempo_extra') {
  return huboTiempoExtra(evento) ? 'Sí' : 'No';
}

if (trivia.tipo === 'hubo_penales') {
  return huboPenales(evento) ? 'Sí' : 'No';
}



  return '';
}


/**
 * Resuelve las trivias vencidas de LA QUINIELA ACTIVA.
 *
 * Exige contexto de inquilino, y el requisito no es decorativo: la consulta de
 * ResultadoOficial de aquí abajo busca por nombre de jornada, y los nombres se
 * repiten entre quinielas —"Jornada1" será la norma—. Sin filtro por quiniela,
 * findOne devuelve el documento de la primera quiniela que MongoDB encuentre, y
 * la trivia de una quiniela se resuelve, o se queda sin resolver, según el
 * estado del partido de OTRA. Es un error de corrección silencioso: nadie ve un
 * fallo, simplemente los puntos salen mal.
 *
 * Para el barrido periódico usa resolverTriviasDeTodasLasQuinielas().
 */
async function resolverTriviasPendientes(jornadaNombre = null) {
  if (!tenantContext.getStore()?.quinielaId) {
    throw new Error(
      'resolverTriviasPendientes() requiere contexto de quiniela. ' +
      'Para el barrido global usa resolverTriviasDeTodasLasQuinielas().'
    );
  }

  const filtro = {
    activa: true,
    resuelta: false,
    fechaCierre: { $lte: new Date() }
  };

  if (jornadaNombre) {
    filtro.jornadaNombre = jornadaNombre;
  }

  const trivias = await Trivia.find(filtro);

  for (const trivia of trivias) {
    try {
      if (!trivia.apiFixtureId) continue;

      const oficial = await ResultadoOficial.findOne({
        jornada: trivia.jornadaNombre
      });

      const partidoOficial = oficial?.resultados?.find(p =>
        (p.equipo1 === trivia.equipo1 && p.equipo2 === trivia.equipo2) ||
        (p.equipo1 === trivia.equipo2 && p.equipo2 === trivia.equipo1)
      );

      if (!partidoOficial || partidoOficial.estado !== 'TC') {
        continue;
      }

      const evento = await obtenerEventoTrivia(trivia.apiFixtureId);
      const respuestaCorrecta = resolverRespuestaTrivia(trivia, evento);

      if (!respuestaCorrecta) continue;

      trivia.respuestaCorrecta = respuestaCorrecta;
      trivia.resuelta = true;
      await trivia.save();

      const respuestas = await RespuestaTrivia.find({
        triviaId: trivia._id.toString()
      });

      for (const respuesta of respuestas) {
        respuesta.puntos = respuesta.respuesta === respuestaCorrecta ? trivia.puntos : 0;
        await respuesta.save();
      }

    } catch (error) {
      console.error(`Error resolviendo trivia ${trivia._id}:`, error.message);
    }
  }
}


app.post('/api/admin/trivias/resolver', requireAdmin, async (req, res) => {
  try {
    await resolverTriviasPendientes();
    res.json({ mensaje: 'Trivias resueltas correctamente.' });
  } catch (error) {
    console.error('Error resolviendo trivias:', error);
    res.status(500).json({ error: 'Error resolviendo trivias.' });
  }
});

/**
 * Barrido periódico. Itera las quinielas ACTIVAS y resuelve las trivias de cada
 * una dentro de su propio contexto de inquilino, de modo que ninguna consulta
 * cruce de una quiniela a otra.
 *
 * Las archivadas y eliminadas quedan fuera a propósito: nadie va a puntuar ahí,
 * y recorrerlas solo gasta llamadas al API externo.
 *
 * El fallo de una quiniela no interrumpe el barrido de las demás.
 */
async function resolverTriviasDeTodasLasQuinielas() {
  const quinielas = await Quiniela.find({ estado: 'activa' }).select('_id nombre').lean();

  for (const quiniela of quinielas) {
    try {
      await tenantContext.run(
        { quinielaId: quiniela._id },
        () => resolverTriviasPendientes()
      );
    } catch (error) {
      console.error(`Error resolviendo trivias de "${quiniela.nombre}":`, error.message);
    }
  }
}

const INTERVALO_RESOLUCION_TRIVIAS_MS = 5 * 60 * 1000;

if (!ENTORNO_DE_PRUEBAS) {
  setInterval(() => {
    resolverTriviasDeTodasLasQuinielas().catch(error => {
      console.error('Error automático resolviendo trivias:', error.message);
    });
  }, INTERVALO_RESOLUCION_TRIVIAS_MS);
}



/* ================= API: Equipos ================= */

app.get('/api/equipos', async (req, res) => {
  try {
    const equipos = await Equipo.find({}, { _id: 0, __v: 0 }).lean();
    const nombresEquipos = equipos.map(e => e.nombre);
    res.json(nombresEquipos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener equipos' });
  }
});

app.post('/actualizar-equipos', requireAdmin, async (req, res) => {
  try {
    const { equipos } = req.body;

    if (!Array.isArray(equipos)) {
      return res.status(400).json({ error: 'Equipos inválidos' });
    }

    await Equipo.deleteMany({ nombre: { $nin: equipos } });

    for (const nombreEquipo of equipos) {
      await Equipo.updateOne(
        { nombre: nombreEquipo },
        { nombre: nombreEquipo },
        { upsert: true }
      );
    }

    res.json({ message: 'Equipos actualizados' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar equipos' });
  }
});

/* ================= Resultados con equipos ================= */

app.get('/api/resultados-con-equipos/:jugador/:jornada', async (req, res) => {
  const { jugador, jornada } = req.params;

  const usuario = await Usuario.findById(req.session.usuarioId);
  const jornadaAcceso = await Jornada.findOne({ nombre: jornada });
  const cerrada = !jornadaAcceso?.fechaCierre || new Date(jornadaAcceso.fechaCierre) <= new Date();
  if (!cerrada && !['propietario', 'admin'].includes(req.membership.rol) && usuario?.username !== jugador) {
    return res.status(403).json({ error: 'Los pronósticos de otros participantes permanecen privados hasta el cierre.' });
  }

  const resultado = await Resultado.findOne({ jugador, jornada });
  const jornadaDoc = jornadaAcceso;

  if (!resultado || !jornadaDoc) {
    return res.status(404).json({ error: 'Datos no encontrados' });
  }

  const pronosticos = resultado.pronosticos;
  const partidos = jornadaDoc.partidos;

  const resultadosConEquipos = partidos.map((p, i) => ({
    equipo1: p.equipo1,
    equipo2: p.equipo2,
    marcador1: pronosticos[i]?.marcador1 ?? '',
    marcador2: pronosticos[i]?.marcador2 ?? ''
  }));

  res.json(resultadosConEquipos);
});

app.get('/api/trivias-jornadas', async (req, res) => {
  try {
    const trivias = await Trivia.find({ activa: true }).sort({ fechaCierre: 1 });

    const mapa = new Map();

    trivias.forEach(t => {
      if (!mapa.has(t.jornadaNombre)) {
        mapa.set(t.jornadaNombre, {
          jornadaNombre: t.jornadaNombre,
          fechaCierre: t.fechaCierre,
          cerrada: t.fechaCierre ? new Date(t.fechaCierre) <= new Date() : false
        });
      }
    });

    res.json(Array.from(mapa.values()));
  } catch (error) {
    console.error('Error obteniendo jornadas de trivias:', error);
    res.status(500).json({ error: 'Error obteniendo jornadas de trivias.' });
  }
});


app.get('/api/resultados-trivias/:jornadaNombre', async (req, res) => {
  try {
    const { jornadaNombre } = req.params;

    const trivias = await Trivia.find({
      jornadaNombre,
      activa: true
    }).sort({ partidoIndex: 1, tipo: 1 });

    if (!trivias.length) {
      return res.json({
        jornadaNombre,
        cerrada: false,
        trivias: []
      });
    }

    const fechaCierre = trivias[0].fechaCierre;
    const cerrada = fechaCierre ? new Date(fechaCierre) <= new Date() : false;

    if (!cerrada && !['propietario', 'admin'].includes(req.membership.rol)) {
      return res.status(403).json({ error: 'Los resultados de trivias estarán disponibles después del cierre.' });
    }

  
    const triviaIds = trivias.map(t => t._id.toString());

    const respuestas = await RespuestaTrivia.find({
      triviaId: { $in: triviaIds }
    });

    const oficial = await ResultadoOficial.findOne({
      jornada: jornadaNombre
    });

    const resultadosOficiales = oficial ? oficial.resultados : [];

    const resultados = trivias.map(trivia => {
      const respuestasTrivia = respuestas
        .filter(r => String(r.triviaId) === String(trivia._id))
        .map(r => ({
          jugador: r.jugador,
          respuesta: r.respuesta,
          puntos: r.puntos || 0
        }))
        .sort((a, b) => a.jugador.localeCompare(b.jugador));

      const partidoOficial = resultadosOficiales.find(p =>
        (p.equipo1 === trivia.equipo1 && p.equipo2 === trivia.equipo2) ||
        (p.equipo1 === trivia.equipo2 && p.equipo2 === trivia.equipo1)
      );

      return {
        _id: trivia._id,
        jornadaNombre: trivia.jornadaNombre,
        partidoIndex: trivia.partidoIndex,
        equipo1: trivia.equipo1,
        equipo2: trivia.equipo2,
        pregunta: trivia.pregunta,
        tipo: trivia.tipo,
        respuestaCorrecta: trivia.respuestaCorrecta || 'Pendiente de calcular',
        resuelta: trivia.resuelta,
        puntos: trivia.puntos || 1,

        estado: partidoOficial?.estado || 'PROGRAMADO',
        minuto: partidoOficial?.minuto ?? null,
        fecha: partidoOficial?.fecha || '',
        marcador1: partidoOficial?.marcador1 ?? null,
        marcador2: partidoOficial?.marcador2 ?? null,

        respuestas: respuestasTrivia
      };
    });

    res.json({
      jornadaNombre,
      fechaCierre,
      cerrada,
      trivias: resultados
    });

  } catch (error) {
    console.error('Error obteniendo resultados de trivias:', error);
    res.status(500).json({ error: 'Error obteniendo resultados de trivias.' });
  }
});


app.post('/api/resultados-seguros/:jugador/:jornada', async (req, res) => {
  try {
    const { jugador, jornada } = req.params;
    const { password } = req.body || {};

    const jornadaDoc = await Jornada.findOne({ nombre: jornada });
    if (!jornadaDoc) return res.status(404).json({ error: 'Jornada no encontrada' });

    const resultado = await Resultado.findOne({ jugador, jornada });
    if (!resultado) return res.status(404).json({ error: 'Resultados no encontrados' });

    const jugadorDoc = await Usuario.findOne({ usernameNormalizado: normalizarIdentidad(jugador) });
    if (!jugadorDoc) return res.status(404).json({ error: 'Jugador no encontrado' });

    const ahora = new Date();
    const jornadaCerrada = jornadaDoc.fechaCierre && new Date(jornadaDoc.fechaCierre) <= ahora;
    const jornadaSinFecha = !jornadaDoc.fechaCierre;

    if (!jornadaCerrada && !jornadaSinFecha) {
      if (jugadorDoc._id.toString() !== req.session.usuarioId) {
        return res.status(403).json({ error: 'Los pronósticos de otros participantes permanecen privados hasta el cierre.' });
      }
      if (jugadorDoc.password) {
        if (!password) {
          return res.json({ success: false, error: 'Contraseña requerida' });
        }

        const match = await bcrypt.compare(password, jugadorDoc.password);

        if (!match) {
          return res.status(401).json({
            success: false,
            error: 'Contraseña incorrecta'
          });
        }
      }
    }

    const partidos = jornadaDoc.partidos.map((p, i) => ({
      equipo1: p.equipo1,
      equipo2: p.equipo2,
      logoEquipo1: p.logoEquipo1 || '',
      logoEquipo2: p.logoEquipo2 || '',      
      marcador1: resultado.pronosticos[i]?.marcador1 ?? '',
      marcador2: resultado.pronosticos[i]?.marcador2 ?? ''
    }));

    res.json({ success: true, partidos });
  } catch (error) {
    console.error('Error en /api/resultados-seguros:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/* ================= API: Resultados Totales ================= */
app.delete('/api/jornadas/:nombre', requireAdmin, async (req, res) => {
  try {
    const nombreJornada = req.params.nombre;

    const jornadaEliminada = await Jornada.findOneAndDelete({
      nombre: nombreJornada
    });

    if (!jornadaEliminada) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    await Resultado.deleteMany({ jornada: nombreJornada });
    await ResultadoOficial.deleteMany({ jornada: nombreJornada });

    res.json({
      success: true,
      message: 'Jornada, pronósticos y resultados oficiales eliminados'
    });

  } catch (error) {
    console.error('Error eliminando jornada:', error);
    res.status(500).json({ error: 'Error eliminando jornada' });
  }
});

const EQUIPOS_MUNDIAL_2026 = [
  'México',
  'Sudáfrica',
  'República de Corea',
  'Chequia',
  'Canadá',
  'Bosnia y Herzegovina',
  'Catar',
  'Suiza',
  'Brasil',
  'Marruecos',
  'Haití',
  'Escocia',
  'EE. UU.',
  'Paraguay',
  'Australia',
  'Turquía',
  'Alemania',
  'Curazao',
  'Costa de Marfil',
  'Ecuador',
  'Países Bajos',
  'Japón',
  'Suecia',
  'Túnez',
  'Bélgica',
  'Egipto',
  'RI de Irán',
  'Nueva Zelanda',
  'España',
  'Islas de Cabo Verde',
  'Arabia Saudí',
  'Uruguay',
  'Francia',
  'Senegal',
  'Irak',
  'Noruega',
  'Argentina',
  'Argelia',
  'Austria',
  'Jordania',
  'Portugal',
  'RD Congo',
  'Uzbekistán',
  'Colombia',
  'Inglaterra',
  'Croacia',
  'Ghana',
  'Panamá'
];



app.get('/api/equipos-mundial', (req, res) => {
  res.json(EQUIPOS_MUNDIAL_2026.sort());
});

app.get('/api/pronostico-campeon/:jugador', async (req, res) => {
  const doc = await PronosticoCampeon.findOne({ jugador: req.params.jugador });
  res.json(doc || null);
});


app.post('/api/pronostico-campeon', async (req, res) => {
  try {
    const { jugador, password, campeon } = req.body;

    const usuarioSesion = await Usuario.findById(req.session.usuarioId);
    if (!usuarioSesion || jugador !== usuarioSesion.username) {
      return res.status(403).json({ error: 'Solo puedes guardar tu propio pronóstico de campeón.' });
    }

    if (!jugador || !password || !campeon) {
      return res.status(400).json({ error: 'Jugador, contraseña y campeón son obligatorios' });
    }

    const jornada1 = await Jornada.findOne({ nombre: 'Jornada1' });

    if (jornada1 && jornada1.fechaCierre) {
      const ahora = new Date();
      const fechaCierre = new Date(jornada1.fechaCierre);

      if (ahora > fechaCierre) {
        return res.status(403).json({
          error: 'El pronóstico del campeón mundial ya está cerrado porque la Jornada1 ya cerró.'
        });
      }
    }

    const jugadorEncontrado = usuarioSesion;

    if (!jugadorEncontrado) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    const passwordCorrecto = await bcrypt.compare(
      String(password).trim(),
      String(jugadorEncontrado.password || '').trim()
    );

    if (!passwordCorrecto) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await PronosticoCampeon.findOneAndUpdate(
      { jugador },
      { jugador, campeon, fechaRegistro: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Campeón guardado correctamente' });

  } catch (error) {
    console.error('Error guardando campeón:', error);
    res.status(500).json({ error: 'Error interno guardando campeón' });
  }
});


app.get('/api/pronosticos-campeon-publicos', async (req, res) => {
  try {
    const miembros = await Membresia.find({
      quinielaId: req.quiniela._id,
      estado: { $in: ['activo', 'pendiente_retiro'] }
    }).populate('usuarioId', 'username');
    const historicos = await Jugador.find({}).select('nombre').lean();
    const pronosticos = await PronosticoCampeon.find({});
    const jornada1 = await Jornada.findOne({ nombre: 'Jornada1' });
    const cerrada = !jornada1?.fechaCierre || new Date(jornada1.fechaCierre) <= new Date();
    const usuario = await Usuario.findById(req.session.usuarioId);

    const mapaPronosticos = new Map();

    pronosticos.forEach(p => {
      mapaPronosticos.set(p.jugador, p.campeon);
    });

    const nombres = new Set([
      ...miembros.filter(m => m.usuarioId).map(m => m.usuarioId.username),
      ...historicos.map(j => j.nombre)
    ]);
    const resultado = Array.from(nombres).sort((a, b) => a.localeCompare(b)).map(nombre => ({
      jugador: nombre,
      campeon: cerrada || nombre === usuario.username
        ? (mapaPronosticos.get(nombre) || null)
        : null
    }));

    res.json(resultado);

  } catch (error) {
    console.error('Error obteniendo pronósticos públicos de campeón:', error);
    res.status(500).json({ error: 'Error obteniendo pronósticos de campeón' });
  }
});


app.get('/api/pronosticos-campeon', requireAdmin, async (req, res) => {
  const docs = await PronosticoCampeon.find({}).sort({ jugador: 1 });
  res.json(docs);
});

app.get('/api/campeon-oficial', async (req, res) => {
  const doc = await CampeonOficial.findOne({});
  res.json(doc || null);
});

app.post('/api/campeon-oficial', requireAdmin, async (req, res) => {
  const { campeon } = req.body;

  if (!campeon) {
    return res.status(400).json({ error: 'Debe seleccionar el campeón oficial' });
  }

  await CampeonOficial.findOneAndUpdate(
    {},
    { campeon, puntos: req.quiniela.configuracion.puntuacion.campeon },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Campeón oficial guardado correctamente' });
});


app.get('/api/resultados-totales', async (req, res) => {
  try {
    const miembrosRanking = await Membresia.find({
      quinielaId: req.quiniela._id,
      estado: req.quiniela.configuracion.incluirExpulsadosEnRanking
        ? { $in: ['activo', 'pendiente_retiro', 'expulsado'] }
        : { $in: ['activo', 'pendiente_retiro'] }
    }).populate('usuarioId', 'username');
    const jugadoresHistoricos = await Jugador.find({}).select('nombre').lean();
    const nombresJugadores = new Set([
      ...miembrosRanking.filter(m => m.usuarioId).map(m => m.usuarioId.username),
      ...jugadoresHistoricos.map(j => j.nombre).filter(Boolean)
    ]);
    const jugadores = Array.from(nombresJugadores).map(nombre => ({ nombre }));
    const jornadas = await Jornada.find({});
    const resultados = await Resultado.find({});
    const oficiales = await ResultadoOficial.find({});
    const pronosticosCampeon = await PronosticoCampeon.find({});
    const campeonOficial = await CampeonOficial.findOne({});
    const respuestasTrivia = await RespuestaTrivia.find({});

    const mapCampeon = new Map();

    pronosticosCampeon.forEach(p => {
      mapCampeon.set(p.jugador, p.campeon);
    });

    const mapRes = new Map();
    resultados.forEach(r => mapRes.set(`${r.jugador}_${r.jornada}`, r.pronosticos));

    const mapOficial = new Map();
    oficiales.forEach(r => mapOficial.set(r.jornada, r.resultados));

    const mapTrivias = new Map();

    respuestasTrivia.forEach(r => {
      const puntosActuales = mapTrivias.get(r.jugador) || 0;
      mapTrivias.set(r.jugador, puntosActuales + (r.puntos || 0));
    });

    const resultadosTotales = {};

    const resultado = (m1, m2) => {
      if (m1 > m2) return 'gano';
      if (m1 < m2) return 'perdio';
      return 'empato';
    };

    for (let j of jugadores) {
      let totalPuntos = 0;
      resultadosTotales[j.nombre] = {};

      let puntosCampeon = 0;

      const campeonJugador = mapCampeon.get(j.nombre);

      if (
        campeonOficial &&
        campeonJugador &&
        String(campeonJugador).trim().toLowerCase() ===
        String(campeonOficial.campeon).trim().toLowerCase()
      ) {
        puntosCampeon = campeonOficial.puntos ?? req.quiniela.configuracion.puntuacion.campeon;
      }

      resultadosTotales[j.nombre]['Campeón Mundial'] = puntosCampeon;
      totalPuntos += puntosCampeon;

      const puntosTrivias = mapTrivias.get(j.nombre) || 0;
      resultadosTotales[j.nombre]['Trivias'] = puntosTrivias;
      totalPuntos += puntosTrivias;

      for (let jornada of jornadas) {
        const key = `${j.nombre}_${jornada.nombre}`;
        const pronosticos = mapRes.get(key) || [];
        const oficialesJornada = mapOficial.get(jornada.nombre) || [];

        let puntosJornada = 0;

        jornada.partidos.forEach((partido, index) => {
          const p = pronosticos[index];
          const o = oficialesJornada[index];

          if (!p || !o) return;

          const valores = [o.marcador1, o.marcador2, p.marcador1, p.marcador2];
          const sonNumerosValidos = valores.every(val =>
            typeof val === 'number' && !isNaN(val)
          );

          if (!sonNumerosValidos) return;

          const esComodin = o.comodin;

          if (o.marcador1 === p.marcador1 && o.marcador2 === p.marcador2) {
            puntosJornada += esComodin
              ? req.quiniela.configuracion.puntuacion.comodinExacto
              : req.quiniela.configuracion.puntuacion.marcadorExacto;
          } else {
            const rOf = resultado(o.marcador1, o.marcador2);
            const rPr = resultado(p.marcador1, p.marcador2);

            if (rOf === rPr) {
              puntosJornada += esComodin
                ? req.quiniela.configuracion.puntuacion.comodinResultado
                : req.quiniela.configuracion.puntuacion.resultadoCorrecto;
            }
          }
        });

        resultadosTotales[j.nombre][jornada.nombre] = puntosJornada;
        totalPuntos += puntosJornada;
      }

      resultadosTotales[j.nombre].total = totalPuntos;
    }

    res.json(resultadosTotales);

  } catch (error) {
    console.error('Error calculando resultados totales:', error);
    res.status(500).json({ error: 'Error calculando resultados totales.' });
  }
});

////////////borrar borrar

app.get('/api/debug/estado-partido/:status', requireDebug, requireAdmin, (req, res) => {
  const fixture = {
    match_status: req.params.status,
    match_live: req.query.live || ''
  };

  res.json({
    fixture,
    resultado: obtenerEstadoPartido(fixture, {})
  });
});

app.get('/api/debug/api-football-match/:matchId', requireDebug, requireAdmin, async (req, res) => {
  try {
    const { matchId } = req.params;

    const response = await apiFootballCom.get('', {
      params: {
        action: 'get_events',
        match_id: String(matchId),
        APIkey: process.env.APIFOOTBALL_COM_KEY,
        timezone: 'America/Costa_Rica'
      }
    });

    res.json({
      matchId,
      tipoRespuesta: typeof response.data,
      esArray: Array.isArray(response.data),
      cantidad: Array.isArray(response.data) ? response.data.length : null,
      data: response.data
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
      apiError: error.response?.data || null
    });
  }
});

app.get('/debug/trivia-goles/:matchId', requireDebug, requireAdmin, async (req, res) => {
  try {
    const evento = await obtenerEventoTrivia(req.params.matchId);

    if (!evento) {
      return res.json({
        mensaje: 'No se encontró el partido.'
      });
    }

    res.json({
      goles: evento.goalscorer || [],
      estado: evento.match_status,
      home: evento.match_hometeam_name,
      away: evento.match_awayteam_name
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get('/api/debug/jornadas', requireDebug, requireAdmin, async (req, res) => {
  const jornadas = await Jornada.find({});
  res.json(jornadas);
});

app.get('/api/admin/debug-partido-api/:matchId', requireDebug, requireAdmin, async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!process.env.APIFOOTBALL_COM_KEY) {
      return res.status(500).json({
        error: 'Falta configurar APIFOOTBALL_COM_KEY en el .env'
      });
    }

    const evento = await buscarEventoPorId(matchId);

    if (!evento) {
      return res.status(404).json({
        error: 'APIFootball no devolvió evento para ese matchId.',
        matchId
      });
    }

    const estadoCalculado = obtenerEstadoPartido(evento, {
      apiStatus: evento.match_status
    });

    res.json({
      matchId,
      ahoraServidor: new Date(),
      partido: {
        local: evento.match_hometeam_name,
        visitante: evento.match_awayteam_name,
        marcador: `${evento.match_hometeam_score} - ${evento.match_awayteam_score}`,
        match_status_api: evento.match_status,
        match_live_api: evento.match_live,
        estadoCalculado
      },
      camposImportantes: {
        match_date: evento.match_date,
        match_time: evento.match_time,
        match_hometeam_score: evento.match_hometeam_score,
        match_awayteam_score: evento.match_awayteam_score,
        match_hometeam_ft_score: evento.match_hometeam_ft_score,
        match_awayteam_ft_score: evento.match_awayteam_ft_score,
        match_hometeam_extra_score: evento.match_hometeam_extra_score,
        match_awayteam_extra_score: evento.match_awayteam_extra_score,
        match_hometeam_penalty_score: evento.match_hometeam_penalty_score,
        match_awayteam_penalty_score: evento.match_awayteam_penalty_score
      },
      raw: evento
    });

  } catch (error) {
    console.error('Error debug partido API:', error.response?.data || error.message);

    res.status(500).json({
      error: 'Error consultando partido en APIFootball.',
      detalle: error.response?.data || error.message
    });
  }
});



//////////////////////


// Aquí estaba un segundo registro de GET /generar_reporte. La ruta ya se
// registra en el bloque de rutas HTML de más arriba, que gana por llegar antes,
// así que este nunca se ejecutaba.

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error?.code === 11000) {
    console.warn('Conflicto de clave única:', error.message);
    return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  }

  /*
   * body-parser y otros middlewares marcan los errores del cliente con un
   * status 4xx propio. Antes se ignoraba y todo acababa en 500: un JSON mal
   * formado o un cuerpo por encima del límite se reportaban como fallo del
   * servidor, lo que ensucia los registros y despista al diagnosticar.
   */
  const estado = error?.status ?? error?.statusCode;
  if (Number.isInteger(estado) && estado >= 400 && estado < 500) {
    console.warn(`Petición inválida (${estado}):`, error.type || error.message);
    return res.status(estado).json({
      error: estado === 413
        ? 'El contenido enviado es demasiado grande.'
        : 'La petición no es válida.'
    });
  }

  console.error('Error no controlado:', error);
  res.status(500).json({ error: 'Ocurrió un error interno.' });
});

/* ================= Start Server ================= */

/*
 * El servidor escucha de inmediato, sin esperar a MongoDB. Antes hacía lo
 * contrario —y moría si la base no respondía— con dos consecuencias malas:
 * un despliegue fallaba entero por una base momentáneamente indispuesta, y las
 * sondas de salud nunca llegaban a responder, que es justo cuando más se
 * necesitan. Ahora /healthz responde siempre y /readyz devuelve 503 hasta que
 * la base esté disponible.
 */
if (EJECUTADO_DIRECTAMENTE) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    if (!mongoListo()) console.log('   Esperando conexión con MongoDB. /readyz devolverá 503 hasta entonces.');
  });

  conectarMongoConReintentos();
}

/*
 * Superficie pública para las pruebas de integración. No la usa nada del código
 * de producción: al ejecutarse como programa, este módulo no se importa desde
 * ningún sitio.
 */
module.exports = {
  app,
  tenantContext,
  conectarMongoConReintentos,
  diagnosticarErrorMongo,
  // Modelos de plataforma
  Usuario, Quiniela, Membresia,
  // Modelos de dominio, todos con aislamiento por quiniela
  Jugador, Jornada, Resultado, ResultadoOficial,
  Trivia, RespuestaTrivia, Equipo, PronosticoCampeon, CampeonOficial,
  // Lógica de dominio bajo prueba
  resolverTriviasPendientes,
  resolverTriviasDeTodasLasQuinielas,
  resolverRespuestaTrivia,
  esGolApiFootball,
  obtenerEstadoPartido,
  obtenerMarcador90Minutos,
  minutoApiFootball,
  partidoYaInicio,
  TIPOS_TRIVIA
};

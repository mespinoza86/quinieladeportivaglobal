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
      /*
       * Sin 'unsafe-inline' desde la Entrada 024: el marcado ya no contiene
       * código. Los 22 manejadores de navegación pasaron a un atributo de datos
       * y los cuatro bloques <script> del HTML, a archivos propios.
       *
       * Esto es lo que convierte el escapado de S-04 en defensa en profundidad:
       * hasta ahora era la única línea, porque cualquier marcado que se colara
       * en el DOM podía ejecutarse.
       */
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],

      /*
       * 'none' es el valor por defecto de helmet y ahora se puede sostener.
       * OJO: 'unsafe-inline' en script-src NO cubre los manejadores en
       * atributo; son directivas independientes, y por eso hay que declararla.
       */
      scriptSrcAttr: ["'none'"],
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

/*
 * Aquí vivía el disparador del auto-sync: un middleware en CADA petición que,
 * cada treinta segundos, lanzaba una sincronización de todo el sistema. Ataba
 * el ritmo de consumo del API externo al tráfico de los usuarios y guardaba su
 * estado en variables de módulo —`ultimaSyncGlobal`, `syncEnProceso`—, que no
 * se comparten entre instancias: dos procesos web significaban dos syncs
 * simultáneos (C-05).
 *
 * Lo sustituye el planificador de la Fase 4, más abajo: intervalo propio,
 * cerrojo distribuido y ventanas por partido. Ver `ejecutarCicloDeSincronizacion`.
 */

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

/*
 * `timeout` no es decorativo. El valor por defecto de axios es 0 —esperar para
 * siempre—, y una petición que se queda colgada deja sin resolver la promesa
 * del ciclo de sincronización. Como `cicloEnCurso` solo se libera en el
 * `finally` de ese ciclo, el auto-sync del proceso se apaga en silencio hasta
 * el siguiente reinicio: nadie ve un error, simplemente `ultimoCiclo` deja de
 * moverse en /api/admin/sync-metricas.
 */
const TIMEOUT_APIFOOTBALL_MS = Number(process.env.APIFOOTBALL_TIMEOUT_MS || 15_000);

const apiFootballCom = axios.create({
  baseURL: 'https://apiv3.apifootball.com/',
  timeout: TIMEOUT_APIFOOTBALL_MS
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

/* ========== Modelos globales del sincronizador — Fase 4 ==========
 *
 * Ninguno lleva `quinielaId`, y no es un descuido: son justo la parte del
 * sistema que DEBE compartirse entre quinielas.
 *
 * `Fixture` es la caché del estado real de un partido según APIFootball. Si
 * cuarenta quinielas siguen el mismo partido del Mundial, el partido sigue
 * siendo uno solo y al proveedor se le pregunta UNA vez, no cuarenta. Antes de
 * la Fase 4 se preguntaba una vez por partido y por quiniela cada treinta
 * segundos, que es el hallazgo C-01.
 *
 * `JobLock` es el cerrojo distribuido que impide que N instancias del proceso
 * web ejecuten N sincronizaciones a la vez (hallazgo C-05). El estado del
 * planificador vivía en variables de módulo —`ultimaSyncGlobal`,
 * `syncEnProceso`—, que no se comparten entre procesos; ahora vive en la base,
 * que sí.
 */
const FixtureSchema = new mongoose.Schema({
  /*
   * Identidad compartida del partido. Es el `apiFixtureId` cuando existe y, si
   * no, una clave sintética de fecha y equipos, para que dos quinielas que
   * importaron el mismo partido sin id tampoco lo consulten por separado.
   */
  clave: { type: String, required: true, unique: true, index: true },
  apiFixtureId: { type: String, default: '' },
  // Lo mínimo para volver a buscar el partido si el id no da resultado.
  busqueda: {
    fecha: String,
    ligaId: String,
    equipo1: String,
    equipo2: String
  },
  evento: { type: mongoose.Schema.Types.Mixed, default: null },
  estado: { type: String, default: 'DESCONOCIDO' },
  apiDate: String,
  consultadoEn: Date,
  /*
   * Cuándo vuelve a tocar preguntar. `null` significa "nunca más": el partido
   * terminó y su resultado ya no puede cambiar.
   */
  proximaConsulta: { type: Date, default: null },
  fallosConsecutivos: { type: Number, default: 0 },
  ultimoError: { type: String, default: '' }
}, { timestamps: true });

// Sostiene la consulta del planificador: "dame lo que ya toca refrescar".
FixtureSchema.index({ proximaConsulta: 1 });

const JobLockSchema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  instancia: String,
  tomadoEn: Date,
  expiraEn: { type: Date, required: true }
});

const Fixture = mongoose.model('Fixture', FixtureSchema);
const JobLock = mongoose.model('JobLock', JobLockSchema);

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
  }]
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

/*
 * Puntos ya calculados de una jornada terminada (Fase 5).
 *
 * Un documento por jornada, con la lista de jugadores dentro, en vez de uno por
 * jugador y jornada: la tabla de posiciones se arma leyendo tantos documentos
 * como jornadas, no como jugadores por jornadas.
 *
 * `puntuacion` guarda las reglas con las que se calcularon. Es lo que hace que
 * corregir un resultado años después no arrastre los cambios de configuración
 * ocurridos desde entonces.
 */
const PuntosJornadaSchema = new mongoose.Schema({
  jornada: { type: String, required: true },
  puntos: [{
    jugador: String,
    puntos: Number,
    _id: false
  }],
  puntuacion: {
    marcadorExacto: Number,
    resultadoCorrecto: Number,
    comodinExacto: Number,
    comodinResultado: Number
  },
  congeladoEn: Date
}, { timestamps: true });

[
  JugadorSchema,
  JornadaSchema,
  ResultadoSchema,
  ResultadoOficialSchema,
  triviaSchema,
  respuestaTriviaSchema,
  EquipoSchema,
  PuntosJornadaSchema
].forEach(tenantPlugin);

JugadorSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
JornadaSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
ResultadoSchema.index({ quinielaId: 1, jugador: 1, jornada: 1 }, { unique: true });
ResultadoOficialSchema.index({ quinielaId: 1, jornada: 1 }, { unique: true });
EquipoSchema.index({ quinielaId: 1, nombre: 1 }, { unique: true });
PuntosJornadaSchema.index({ quinielaId: 1, jornada: 1 }, { unique: true });

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
const PuntosJornada = mongoose.model('PuntosJornada', PuntosJornadaSchema);

/*
 * Caché por instancia de la tabla de posiciones. Es una optimización de lectura,
 * no una fuente de verdad: toda escritura que pueda mover el ranking la invalida
 * y el TTL evita servir datos viejos si una vía futura olvidara hacerlo.
 */
const TTL_CACHE_RANKING_MS = Number(process.env.RANKING_CACHE_TTL_MS || 60_000);
const cacheRanking = new Map();

function claveCacheRanking(quinielaId) {
  return quinielaId ? String(quinielaId) : null;
}

function invalidarCacheRanking(quinielaId = tenantContext.getStore()?.quinielaId) {
  const clave = claveCacheRanking(quinielaId);
  if (clave) cacheRanking.delete(clave);
}

function leerCacheRanking(quinielaId) {
  const clave = claveCacheRanking(quinielaId);
  const entrada = clave && cacheRanking.get(clave);
  if (!entrada) return null;
  if (Date.now() - entrada.creadoEn > TTL_CACHE_RANKING_MS) {
    cacheRanking.delete(clave);
    return null;
  }
  return entrada.resultados;
}

function guardarCacheRanking(quinielaId, resultados) {
  const clave = claveCacheRanking(quinielaId);
  if (clave) cacheRanking.set(clave, { creadoEn: Date.now(), resultados });
}

function responderRanking(res, req, resultados) {
  const paginaSolicitada = req.query.pagina !== undefined || req.query.limite !== undefined;
  if (!paginaSolicitada) return res.json(resultados); // Compatibilidad con consumidores existentes.

  const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const limite = Math.min(100, Math.max(1, Number.parseInt(req.query.limite, 10) || 25));
  const jugadores = Object.entries(resultados)
    .map(([jugador, puntos]) => ({ jugador, ...puntos }))
    .sort((a, b) => b.total - a.total || a.jugador.localeCompare(b.jugador));
  const totalJugadores = jugadores.length;
  const totalPaginas = Math.max(1, Math.ceil(totalJugadores / limite));
  const paginaFinal = Math.min(pagina, totalPaginas);
  const inicio = (paginaFinal - 1) * limite;

  return res.json({
    jugadores: jugadores.slice(inicio, inicio + limite),
    pagina: paginaFinal,
    limite,
    totalJugadores,
    totalPaginas
  });
}


/* ================= Transacciones ================= */

/*
 * Varias operaciones del sistema son secuencias de escrituras que solo tienen
 * sentido completas. Si falla la de en medio, lo que queda no es "menos datos":
 * es un estado que el resto del código no sabe interpretar.
 *
 *   - Crear quiniela son dos escrituras. Sin la segunda queda una quiniela
 *     cuyo propietario no es miembro de ella: nadie puede entrar, ni siquiera
 *     quien la creó, y la pantalla de quinielas ni la lista.
 *   - Transferir la propiedad son tres. A medias deja la quiniela con dos
 *     propietarios o con ninguno.
 *   - Borrar una jornada son cuatro. A medias deja pronósticos y puntos
 *     congelados de una jornada que ya no existe, que luego aparecen sumados
 *     en la tabla general sin columna a la que pertenecer.
 *   - Reconciliar las trivias de una jornada son muchas. A medias deja
 *     respuestas huérfanas de trivias borradas, que siguen contando puntos.
 */

let avisoSinTransaccionesDado = false;

/**
 * ¿Este error es "el servidor no sabe hacer transacciones"?
 *
 * MongoDB solo las admite sobre un conjunto de réplicas. Atlas lo es —también
 * el plan gratuito—, así que en producción no se da; un `mongod` suelto de
 * desarrollo, sí.
 */
function esFaltaDeSoporteDeTransacciones(error) {
  const mensaje = String(error?.message || '');

  return error?.code === 20 ||
    error?.codeName === 'IllegalOperation' ||
    /Transaction numbers are only allowed on a replica set/i.test(mensaje) ||
    /transactions are not supported/i.test(mensaje);
}

/**
 * Ejecuta una secuencia de escrituras como una sola operación atómica.
 *
 * La función recibe la sesión y DEBE pasarla a cada escritura: una consulta que
 * se olvide de `{ session }` queda fuera de la transacción y no se revierte,
 * que es el fallo silencioso típico de esto.
 *
 * OJO con `Promise.all`: una sesión no admite operaciones en paralelo. Las
 * escrituras de dentro van en secuencia aunque sean independientes.
 *
 * Si el servidor no admite transacciones se ejecuta igualmente, sin
 * atomicidad, avisando una vez. Es preferible a dejar la aplicación inservible
 * contra un mongod suelto, pero conviene saber que ahí la garantía no está.
 */
async function enTransaccion(operacion) {
  const sesion = await mongoose.startSession();

  try {
    let resultado;

    await sesion.withTransaction(async () => {
      resultado = await operacion(sesion);
    });

    return resultado;
  } catch (error) {
    if (!esFaltaDeSoporteDeTransacciones(error)) throw error;

    if (!avisoSinTransaccionesDado) {
      avisoSinTransaccionesDado = true;
      console.warn(
        '⚠️  Esta base de datos no admite transacciones (no es un conjunto de réplicas). ' +
        'Las operaciones de varias escrituras se ejecutarán SIN atomicidad: un fallo a ' +
        'mitad puede dejar datos inconsistentes. En Atlas esto no ocurre.'
      );
    }

    return await operacion(undefined);
  } finally {
    await sesion.endSession();
  }
}


/* ================= Validación de dominio ================= */

/**
 * Error de datos del cliente.
 *
 * El manejador global lo convierte en un 400 conservando el mensaje, en vez del
 * "La petición no es válida." genérico. Quien está cargando una jornada
 * necesita saber QUÉ campo se rechazó; un 400 mudo obliga a adivinar.
 */
function errorDeValidacion(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  error.esValidacion = true;
  return error;
}

const MAX_GOLES = 99;
const MAX_PARTIDOS_POR_JORNADA = 50;
const MAX_LARGO_NOMBRE_JORNADA = 80;

/**
 * Un marcador es un entero de 0 a MAX_GOLES, o `null` si se dejó en blanco.
 *
 * `Number()` a secas no bastaba, y ahí estaba el agujero: acepta '-3', acepta
 * '2.5' y acepta '1e999', que no da NaN sino Infinity. Ninguno de los tres
 * rompe nada de forma visible; los tres corrompen el motor de puntuación en
 * silencio, porque `puntosDePartido` compara números sin volver a mirarlos.
 */
function normalizarMarcador(valor, etiqueta) {
  if (valor === null || valor === undefined) return null;

  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw errorDeValidacion(`${etiqueta} no es un marcador válido.`);
  }

  const bruto = typeof valor === 'string' ? valor.trim() : valor;
  if (bruto === '') return null;

  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero < 0 || numero > MAX_GOLES) {
    throw errorDeValidacion(`${etiqueta} debe ser un número entero entre 0 y ${MAX_GOLES}.`);
  }

  return numero;
}

/** Nombre de jornada: obligatorio, recortado y acotado. */
function normalizarNombreDeJornada(valor) {
  const nombre = typeof valor === 'string' ? valor.trim() : '';

  /*
   * Sin esta comprobación, un POST sin `nombre` no fallaba: Mongoose casteaba
   * el filtro a `nombre: null`, el upsert insertaba una jornada sin nombre y
   * esa jornada fantasma aparecía después como columna en la tabla general y
   * como opción en el desplegable de la tabla por jornada.
   */
  if (!nombre) throw errorDeValidacion('El nombre de la jornada es obligatorio.');
  if (nombre.length > MAX_LARGO_NOMBRE_JORNADA) {
    throw errorDeValidacion(`El nombre de la jornada admite hasta ${MAX_LARGO_NOMBRE_JORNADA} caracteres.`);
  }

  return nombre;
}

/** Un partido necesita dos equipos; el resto de campos se normalizan a texto. */
function normalizarPartido(valor, indice = 0) {
  const posicion = `El partido ${indice + 1}`;

  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw errorDeValidacion(`${posicion} no es válido.`);
  }

  const equipo1 = typeof valor.equipo1 === 'string' ? valor.equipo1.trim() : '';
  const equipo2 = typeof valor.equipo2 === 'string' ? valor.equipo2.trim() : '';
  if (!equipo1 || !equipo2) throw errorDeValidacion(`${posicion} necesita los dos equipos.`);

  const texto = campo => (valor[campo] === null || valor[campo] === undefined ? '' : String(valor[campo]));

  return {
    equipo1,
    equipo2,
    logoEquipo1: texto('logoEquipo1'),
    logoEquipo2: texto('logoEquipo2'),
    comodin: Boolean(valor.comodin),
    apiFixtureId: texto('apiFixtureId'),
    apiLeagueId: texto('apiLeagueId'),
    apiDate: texto('apiDate'),
    apiStatus: texto('apiStatus')
  };
}

/** Una jornada sin partidos no es una jornada. */
function normalizarPartidos(valor) {
  if (!Array.isArray(valor) || !valor.length) {
    throw errorDeValidacion('La jornada debe tener al menos un partido.');
  }
  if (valor.length > MAX_PARTIDOS_POR_JORNADA) {
    throw errorDeValidacion(`Una jornada admite como máximo ${MAX_PARTIDOS_POR_JORNADA} partidos.`);
  }

  return valor.map((partido, indice) => normalizarPartido(partido, indice));
}

/**
 * Índices de partido a borrar: enteros, dentro del rango y sin repetir.
 *
 * El duplicado importaba: la ruta hace `splice` por cada índice, así que un
 * mismo número repetido borraba dos partidos, el señalado y su vecino.
 */
function normalizarIndicesDePartido(valor, total) {
  if (!Array.isArray(valor) || !valor.length) {
    throw errorDeValidacion('Debes indicar qué partidos eliminar.');
  }

  const indices = valor.map(item => {
    const numero = typeof item === 'number' ? item : Number(String(item).trim());
    if (!Number.isInteger(numero) || numero < 0 || numero >= total) {
      throw errorDeValidacion('Alguno de los partidos indicados no existe en la jornada.');
    }
    return numero;
  });

  return [...new Set(indices)];
}

/**
 * Qué partidos de una jornada tienen ya el pronóstico a la vista, uno por
 * partido y en el mismo orden.
 *
 * El cierre es POR PARTIDO, no por jornada: un partido se destapa en cuanto
 * empieza, porque a partir de ese momento su pronóstico ya no se puede cambiar
 * y no queda nada que proteger. Es la misma señal que `partidoYaInicio()` ya
 * usaba para bloquear la edición, de modo que no hay dos reglas que puedan
 * discrepar: lo que no se puede editar es exactamente lo que se puede ver.
 *
 * Antes esto dependía de una `fechaCierre` de jornada que había que acordarse
 * de poner y cuyo olvido publicaba la jornada entera de golpe.
 */
function partidosDestapados(jornadaDoc, oficiales = []) {
  return (jornadaDoc?.partidos || []).map(
    (partido, indice) => partidoYaInicio(partido, oficiales[indice] || null)
  );
}

/**
 * Tapa los marcadores de los partidos que todavía no han empezado.
 *
 * Se conservan los equipos y la posición: la fila sigue estando, simplemente no
 * dice qué pronosticó el jugador. Así el frontend no tiene que adivinar si un
 * hueco es "no pronosticó" o "no puedes verlo": los marcadores vienen en
 * `null`, que es lo que esas pantallas ya pintan como "-".
 */
function taparPronosticosNoDestapados(pronosticos = [], destapados = []) {
  return (pronosticos || []).map((pronostico, indice) => {
    if (destapados[indice]) return pronostico;

    return {
      equipo1: pronostico?.equipo1,
      equipo2: pronostico?.equipo2,
      marcador1: null,
      marcador2: null,
      oculto: true
    };
  });
}


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

  const codigoIngreso = await codigoIngresoUnico();

  /*
   * Las dos escrituras van juntas o no van. Sin la membresía, el propietario no
   * es miembro de su propia quiniela: no aparece en su lista y no puede entrar.
   *
   * `create` recibe un ARREGLO a propósito: con un solo documento, Mongoose
   * interpreta el segundo argumento como otro documento y la sesión se pierde
   * sin decir nada.
   */
  const quiniela = await enTransaccion(async sesion => {
    const [creada] = await Quiniela.create([{
      nombre,
      codigoIngreso,
      propietarioId: req.session.usuarioId,
      configuracion: { puntuacion: puntuacionDefault }
    }], { session: sesion });

    await Membresia.create([{
      quinielaId: creada._id,
      usuarioId: req.session.usuarioId,
      rol: 'propietario',
      estado: 'activo',
      aprobadoEn: new Date()
    }], { session: sesion });

    return creada;
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
    /*
     * Aquí había una puerta trasera: un token interno que dejaba entrar a
     * cualquiera que lo presentara como administrador de la quiniela indicada
     * en una cabecera. Existía solo porque el sincronizador se llamaba a sí
     * mismo por HTTP y necesitaba saltarse su propia autenticación.
     *
     * Desde la Fase 4 el sincronizador invoca la función directamente dentro
     * de `tenantContext.run`, así que la puerta sobraba. Un camino que concede
     * permisos de administrador sin sesión es superficie de ataque que ya no
     * hace falta mantener.
     */
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
  invalidarCacheRanking(req.quiniela._id);
  res.json({ success: true });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/rechazar', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id });
  if (!membresia || !['pendiente_ingreso', 'pendiente_retiro'].includes(membresia.estado)) {
    return res.status(404).json({ error: 'Solicitud pendiente no encontrada.' });
  }
  membresia.estado = membresia.estado === 'pendiente_ingreso' ? 'rechazado' : 'activo';
  await membresia.save();
  invalidarCacheRanking(req.quiniela._id);
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
  invalidarCacheRanking(req.quiniela._id);
  res.json({ success: true });
});

app.post('/api/quiniela-actual/solicitar-retiro', async (req, res) => {
  if (req.membership.rol === 'propietario') return res.status(409).json({ error: 'El propietario debe transferir la propiedad antes de solicitar retirarse.' });
  req.membership.estado = 'pendiente_retiro';
  await req.membership.save();
  invalidarCacheRanking(req.quiniela._id);
  res.json({ success: true, message: 'Solicitud de retiro enviada.' });
});

app.patch('/api/quiniela-actual/miembros/:membresiaId/aprobar-retiro', requireAdmin, async (req, res) => {
  const membresia = await Membresia.findOne({ _id: req.params.membresiaId, quinielaId: req.quiniela._id, estado: 'pendiente_retiro' });
  if (!membresia) return res.status(404).json({ error: 'Solicitud de retiro no encontrada.' });
  if (membresia.rol === 'propietario') return res.status(409).json({ error: 'No se puede retirar al propietario.' });
  membresia.estado = 'expulsado';
  membresia.retiradoEn = new Date();
  await membresia.save();
  invalidarCacheRanking(req.quiniela._id);
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
  invalidarCacheRanking(req.quiniela._id);
  res.json({ success: true });
});

app.post('/api/quiniela-actual/transferir-propiedad', requireAdmin, async (req, res) => {
  if (req.membership.rol !== 'propietario') return res.status(403).json({ error: 'Solo el propietario puede transferir la propiedad.' });
  const destino = await Membresia.findOne({ quinielaId: req.quiniela._id, usuarioId: req.body.usuarioId, estado: 'activo' });
  if (!destino || destino.rol !== 'admin') return res.status(400).json({ error: 'El nuevo propietario debe ser un administrador activo.' });
  destino.rol = 'propietario';
  req.membership.rol = 'admin';
  req.quiniela.propietarioId = destino.usuarioId;

  /*
   * Antes eran tres `save` en `Promise.all`. Además de no ser atómico —a
   * medias, la quiniela se quedaba con dos propietarios o con ninguno—, una
   * sesión no admite operaciones en paralelo, así que dentro de la transacción
   * tienen que ir en secuencia.
   */
  await enTransaccion(async sesion => {
    await destino.save({ session: sesion });
    await req.membership.save({ session: sesion });
    await req.quiniela.save({ session: sesion });
  });

  res.json({ success: true });
});

app.patch('/api/quiniela-actual/configuracion', requireAdmin, async (req, res) => {
  const entrada = req.body.puntuacion || {};
  const camposNumericos = ['marcadorExacto', 'resultadoCorrecto', 'comodinExacto', 'comodinResultado', 'puntosTriviaDefault'];
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
  invalidarCacheRanking(req.quiniela._id);
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

  res.status(401).json({ error: 'Contraseña incorrecta.' });
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
    if (!match) return res.status(400).json({ message: 'Contraseña actual incorrecta.' });
  }

  jugador.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await jugador.save();

  res.json({ message: 'Contraseña cambiada correctamente' });
});

/* ================= API: Jornadas ================= */

/*
 * M-26. La mayoría de pantallas que piden esto solo quieren los NOMBRES, para
 * llenar un desplegable, y se llevaban la temporada entera con sus partidos:
 * con cuarenta jornadas de diez partidos son cuatrocientos subdocumentos por
 * carga de pantalla.
 *
 * `?resumen=1` devuelve solo los nombres. Sin el parámetro, la respuesta es la
 * de siempre: hay pantallas que sí necesitan los partidos y no se pueden
 * romper.
 */
app.get('/api/jornadas', async (req, res) => {
  if (req.query.resumen === '1') {
    const jornadas = await Jornada.find({}).select('nombre').lean();
    return res.json(jornadas.map(j => ({ nombre: j.nombre })));
  }

  const jornadas = await Jornada.find({});
  res.json(jornadas.map(j => ({
    nombre: j.nombre,
    partidos: j.partidos,
  })));
});

app.get('/api/jornadas/:nombre', async (req, res) => {
  const jornada = await Jornada.findOne({ nombre: req.params.nombre });
  if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada.' });

  res.json({
    nombre: jornada.nombre,
    partidos: jornada.partidos
  });
});

app.post('/api/jornadas', requireAdmin, async (req, res) => {
  const nombre = normalizarNombreDeJornada(req.body?.nombre);
  const partidos = normalizarPartidos(req.body?.partidos);

  await Jornada.findOneAndUpdate(
    { nombre },
    { nombre, partidos },
    { upsert: true }
  );
  await actualizarPuntosDeJornada(nombre, req.quiniela.configuracion.puntuacion);

  const jornadas = await Jornada.find({});
  res.json(jornadas.map(j => [j.nombre, j.partidos]));
});

app.post('/api/jornadas/importar-api', requireAdmin, async (req, res) => {
  try {
    const nombre = normalizarNombreDeJornada(req.body?.nombre);

    /*
     * El importador llama `fecha` y `estado` a lo que la jornada guarda como
     * `apiDate` y `apiStatus`. Se traduce antes de validar para que el
     * normalizador vea siempre la misma forma de partido que el resto de rutas.
     */
    const partidosFormateados = normalizarPartidos(
      (Array.isArray(req.body?.partidos) ? req.body.partidos : []).map(p => ({
        ...p,
        apiDate: p?.apiDate ?? p?.fecha ?? '',
        apiStatus: p?.apiStatus ?? p?.estado ?? ''
      }))
    );

    await Jornada.findOneAndUpdate(
      { nombre },
      { nombre, partidos: partidosFormateados },
      { upsert: true, new: true }
    );
    await actualizarPuntosDeJornada(nombre, req.quiniela.configuracion.puntuacion);

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
  const jornada = normalizarNombreDeJornada(req.body?.jornada);
  const partido = normalizarPartido(req.body?.partido);
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).json({ error: 'Jornada no encontrada.' });

  if (doc.partidos.length >= MAX_PARTIDOS_POR_JORNADA) {
    throw errorDeValidacion(`Una jornada admite como máximo ${MAX_PARTIDOS_POR_JORNADA} partidos.`);
  }

  doc.partidos.push(partido);
  await doc.save();
  await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

  res.json({ success: true });
});

app.post('/api/jornadas/eliminar-partidos',requireAdmin, async (req, res) => {
  const jornada = normalizarNombreDeJornada(req.body?.jornada);
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).json({ error: 'Jornada no encontrada.' });

  const indices = normalizarIndicesDePartido(req.body?.indices, doc.partidos.length);
  indices.sort((a, b) => b - a).forEach(i => doc.partidos.splice(i, 1));
  await doc.save();
  await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

  res.json({ success: true });
});

app.post('/api/jornadas/comodin',requireAdmin, async (req, res) => {
  const jornada = normalizarNombreDeJornada(req.body?.jornada);
  const partidos = normalizarPartidos(req.body?.partidos);
  const doc = await Jornada.findOne({ nombre: jornada });

  if (!doc) return res.status(404).send('Jornada no encontrada');

  /*
   * Esta ruta reemplaza la lista entera para cambiar una casilla. Si el número
   * de partidos no coincide, lo que llega no es "la misma jornada con otro
   * comodín" sino otra cosa, y aplicarla borraría partidos sin querer.
   */
  if (partidos.length !== doc.partidos.length) {
    throw errorDeValidacion('La lista de partidos no coincide con la jornada.');
  }

  doc.partidos = partidos;
  await doc.save();
  await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

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


/* ================= Sincronizador — Fase 4 (C-01, C-05) =================
 *
 * Lo que había antes, y por qué se cambió:
 *
 *   Un middleware colgado de CADA petición disparaba, cada treinta segundos,
 *   una función que recorría las jornadas de TODO el sistema y se autollamaba
 *   por HTTP a `localhost` una vez por jornada. Cada una de esas llamadas
 *   preguntaba al proveedor una vez por partido. El coste crecía con el número
 *   de quinielas aunque todas siguieran exactamente los mismos partidos: con
 *   veinte quinielas se agota una cuota mensual típica en media hora.
 *
 * Lo que hay ahora:
 *
 *   1. Un planificador propio, no el tráfico de los usuarios, marca el ritmo.
 *   2. Un cerrojo en la base impide que dos instancias sincronicen a la vez.
 *   3. Los partidos se deduplican por clave compartida: un partido, una
 *      consulta, sin importar cuántas quinielas lo sigan.
 *   4. Cada partido tiene su ventana según su estado real: terminado no se
 *      vuelve a consultar nunca, en vivo cada minuto, lejano cada seis horas.
 *   5. La escritura de resultados es una llamada de función dentro del contexto
 *      de inquilino, no una petición HTTP a uno mismo.
 */

const CERROJO_SYNC = 'sincronizacion-global';
const ID_INSTANCIA = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

const INTERVALO_CICLO_SYNC_MS = Number(process.env.SYNC_INTERVALO_MS || 60 * 1000);
const CONCURRENCIA_MAXIMA_API = Number(process.env.SYNC_CONCURRENCIA || 4);

/*
 * El cerrojo caduca solo. Si la instancia que lo tomó muere a mitad de ciclo,
 * nadie lo suelta, y sin caducidad la sincronización quedaría parada para
 * siempre. Cinco minutos es holgado para un ciclo normal y corto para no dejar
 * el sistema mudo si algo se cae.
 */
const TTL_CERROJO_SYNC_MS = 5 * 60 * 1000;

/*
 * Segundo cinturón, por debajo del timeout del proveedor: si un ciclo no
 * termina en este plazo se deja de esperarlo y el planificador queda libre.
 * El timeout de axios cubre el caso conocido —una petición HTTP colgada—; esto
 * cubre cualquier otra promesa que no resuelva, que tendría el mismo efecto de
 * apagar la sincronización del proceso para siempre.
 *
 * Es menor que el TTL del cerrojo a propósito: cuando el siguiente ciclo llegue
 * a pedirlo, el del ciclo abandonado ya estará caducado o a punto.
 */
const TIMEOUT_CICLO_SYNC_MS = Number(process.env.SYNC_TIMEOUT_CICLO_MS || 4 * 60 * 1000);

const VENTANAS_SYNC_MS = {
  enVivo: 60 * 1000,
  inminente: 15 * 60 * 1000,
  lejano: 6 * 60 * 60 * 1000,
  desconocido: 30 * 60 * 1000,
  error: 10 * 60 * 1000
};

const UMBRAL_INMINENTE_MS = 2 * 60 * 60 * 1000;

/*
 * Un partido cuya hora de inicio pasó hace rato y que el proveedor sigue sin
 * dar por empezado casi siempre está aplazado, cancelado o mal enlazado. Sin
 * este umbral se quedaría consultándose cada minuto para siempre.
 */
const UMBRAL_ABANDONO_MS = 4 * 60 * 60 * 1000;

/*
 * Los campos de un resultado oficial de los que dependen los PUNTOS.
 *
 * `minuto` queda fuera a propósito, y es la clave de todo esto: cambia en cada
 * ciclo de un partido en vivo y no mueve la puntuación de nadie. Incluirlo
 * significaba invalidar la caché del ranking cada minuto durante los noventa
 * del partido —el rato de más tráfico de la semana y el peor momento para
 * recalcular la tabla entera en cada petición—.
 *
 * `estado` sí cuenta: el paso a `TC` es lo que congela la jornada.
 */
const CAMPOS_QUE_MUEVEN_PUNTOS = ['marcador1', 'marcador2', 'comodin', 'estado', 'bloqueadoFinal'];

/**
 * ¿Este sync puede haber movido la tabla de posiciones?
 *
 * Se compara por partido y no por posición, con el mismo emparejamiento por
 * equipos que usa el resto del sincronizador: el proveedor a veces devuelve
 * local y visitante al revés, y ahí los marcadores sí cambian de significado.
 */
function puntosPuedenHaberCambiado(anteriores, nuevos) {
  const previos = anteriores || [];
  if (previos.length !== nuevos.length) return true;

  const igual = (uno, otro) => (uno ?? null) === (otro ?? null);

  return nuevos.some(nuevo => {
    const anterior = buscarOficialCorrespondiente(previos, nuevo);
    if (!anterior) return true;

    return CAMPOS_QUE_MUEVEN_PUNTOS.some(campo => !igual(anterior[campo], nuevo[campo]));
  });
}

const metricasSync = {
  ciclos: 0,
  ciclosOmitidosPorCerrojo: 0,
  ciclosAbandonadosPorTiempo: 0,
  llamadasApi: 0,
  erroresApi: 0,
  partidosSeguidos: 0,
  fixturesUnicos: 0,
  consultasEvitadasPorVentana: 0,
  jornadasReescritas: 0,
  syncsSinCambioDePuntos: 0,
  ultimoCiclo: null,
  duracionUltimoCicloMs: null,
  ultimoError: null
};

/**
 * Identidad compartida de un partido, que es la pieza sobre la que descansa
 * toda la deduplicación. Dos quinielas que siguen el mismo partido producen la
 * misma clave, así que comparten la misma entrada de caché.
 */
function claveDeFixture(partido) {
  if (partido?.apiFixtureId) return String(partido.apiFixtureId);

  // Sin id del proveedor, la fecha y los dos equipos identifican el partido.
  const fecha = extraerFechaApi(partido?.apiDate);
  if (!fecha || !partido?.equipo1 || !partido?.equipo2) return null;

  return `sin-id:${fecha}:${normalizarEquipo(partido.equipo1)}|${normalizarEquipo(partido.equipo2)}`;
}

function descriptorDeFixture(clave, partido) {
  return {
    clave,
    apiFixtureId: partido.apiFixtureId ? String(partido.apiFixtureId) : '',
    apiDate: partido.apiDate || '',
    busqueda: {
      fecha: extraerFechaApi(partido.apiDate),
      ligaId: partido.apiLeagueId ? String(partido.apiLeagueId) : '',
      equipo1: partido.equipo1 || '',
      equipo2: partido.equipo2 || ''
    }
  };
}

/**
 * Cuándo volver a preguntar por un partido.
 *
 * El detalle que no es obvio: la próxima consulta nunca se pospone más allá
 * del pitido inicial. Un partido que empieza en tres horas cae en la ventana
 * "lejano" de seis, y sin este tope se consultaría por primera vez tres horas
 * después de haber empezado.
 */
function calcularProximaConsulta(estado, apiDate, ahora = new Date(), hayError = false) {
  // Terminado: el resultado ya no puede cambiar y no se vuelve a consultar.
  if (estado === 'TC') return null;

  const base = ahora.getTime();
  const inicio = parseFechaPartidoCostaRica(apiDate);
  const faltan = inicio ? inicio.getTime() - base : null;

  let ventana;

  if (hayError) {
    ventana = VENTANAS_SYNC_MS.error;
  } else if (estado === 'LIVE' || estado === 'MT') {
    ventana = VENTANAS_SYNC_MS.enVivo;
  } else if (faltan === null) {
    ventana = VENTANAS_SYNC_MS.desconocido;
  } else if (faltan <= -UMBRAL_ABANDONO_MS) {
    ventana = VENTANAS_SYNC_MS.lejano;
  } else if (faltan <= 0) {
    // Ya debería haber empezado: el proveedor está a punto de darlo por vivo.
    ventana = VENTANAS_SYNC_MS.enVivo;
  } else if (faltan <= UMBRAL_INMINENTE_MS) {
    ventana = VENTANAS_SYNC_MS.inminente;
  } else {
    ventana = VENTANAS_SYNC_MS.lejano;
  }

  let proxima = base + ventana;

  if (faltan !== null && faltan > 0) {
    proxima = Math.min(proxima, inicio.getTime());
  }

  return new Date(proxima);
}

/**
 * Deja de esperar una promesa pasado un plazo.
 *
 * No la cancela —en JavaScript no se puede— y no hace falta: lo que importa es
 * que quien esperaba recupere el control. La promesa original sigue teniendo
 * un manejador puesto por `Promise.race`, así que un fallo tardío no se
 * convierte en un rechazo sin gestionar.
 */
function conVigilante(promesa, ms, mensaje) {
  let temporizador;

  const vigilante = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => {
      const error = new Error(mensaje);
      error.esTiempoAgotado = true;
      rechazar(error);
    }, ms);

    // Un temporizador pendiente no debe impedir que el proceso termine.
    temporizador.unref?.();
  });

  return Promise.race([promesa, vigilante]).finally(() => clearTimeout(temporizador));
}

/**
 * Recorre `items` con un tope de tareas simultáneas. Es un limitador mínimo
 * para no añadir una dependencia por diez líneas: sin él, un ciclo con
 * doscientos partidos abriría doscientas peticiones a la vez contra el
 * proveedor, que responde con limitación de tasa.
 */
async function conLimiteDeConcurrencia(items, limite, tarea) {
  const pendientes = [...items];
  const trabajadores = [];

  for (let i = 0; i < Math.max(1, limite); i += 1) {
    trabajadores.push((async () => {
      while (pendientes.length) {
        const item = pendientes.shift();
        await tarea(item);
      }
    })());
  }

  await Promise.all(trabajadores);
}

/*
 * Único punto por el que el sincronizador habla con el proveedor, y a la vez
 * la costura por la que las pruebas lo sustituyen por eventos sintéticos. Sin
 * ella, ejercitar el ciclo completo exigiría red y cuota real, así que en la
 * práctica no se probaría.
 */
const proveedorDeEventos = {
  porId: (id) => buscarEventoPorId(id),
  porFecha: (partido) => buscarEventoPorFallback(partido)
};

/** Pregunta al proveedor por un partido: primero por id, y si no, por fecha. */
async function consultarProveedor(descriptor) {
  if (descriptor.apiFixtureId) {
    metricasSync.llamadasApi += 1;
    const evento = await proveedorDeEventos.porId(descriptor.apiFixtureId);
    if (evento) return evento;
  }

  const busqueda = descriptor.busqueda || {};
  if (!busqueda.fecha) return null;

  metricasSync.llamadasApi += 1;

  return await proveedorDeEventos.porFecha({
    apiDate: busqueda.fecha,
    apiLeagueId: busqueda.ligaId,
    equipo1: busqueda.equipo1,
    equipo2: busqueda.equipo2
  });
}

/**
 * Consulta un partido y guarda lo que devuelva el proveedor en la caché
 * compartida. Devuelve `true` solo si trajo datos nuevos, que es lo que decide
 * si vale la pena reescribir los resultados oficiales de las quinielas.
 */
async function refrescarFixture(descriptor, ahora = new Date()) {
  const previo = descriptor.previo || null;

  let evento = null;
  let error = null;

  try {
    evento = await consultarProveedor(descriptor);
  } catch (err) {
    error = err?.message || String(err);
    metricasSync.erroresApi += 1;
  }

  const cambios = {
    apiFixtureId: descriptor.apiFixtureId,
    busqueda: descriptor.busqueda,
    apiDate: descriptor.apiDate,
    consultadoEn: ahora,
    fallosConsecutivos: error ? (previo?.fallosConsecutivos || 0) + 1 : 0,
    ultimoError: error || ''
  };

  /*
   * Ante un fallo, o ante un proveedor que no conoce el partido, se conserva lo
   * último que sí se supo. Sobrescribir con vacío borraría un marcador bueno
   * por un error de red.
   */
  const estadoBase = previo?.estado || 'DESCONOCIDO';
  const estado = evento ? obtenerEstadoPartido(evento, null).estado : estadoBase;

  cambios.estado = estado;
  if (evento) cambios.evento = evento;

  cambios.proximaConsulta = calcularProximaConsulta(
    estado,
    descriptor.apiDate,
    ahora,
    Boolean(error)
  );

  await Fixture.findOneAndUpdate(
    { clave: descriptor.clave },
    { $set: cambios, $setOnInsert: { clave: descriptor.clave } },
    { upsert: true }
  );

  return Boolean(evento);
}

/**
 * Refresca solo los partidos a los que ya les toca, una vez cada uno.
 *
 * `catalogo` es un mapa de clave compartida a descriptor: ahí es donde han
 * colapsado ya los partidos repetidos entre quinielas. Devuelve el conjunto de
 * claves que trajeron datos nuevos.
 */
async function refrescarFixturesPendientes(catalogo, { ahora = new Date(), forzar = false } = {}) {
  const claves = [...catalogo.keys()];
  if (!claves.length) return new Set();

  const existentes = await Fixture.find({ clave: { $in: claves } }).lean();
  const porClave = new Map(existentes.map(doc => [doc.clave, doc]));

  const pendientes = [];

  for (const clave of claves) {
    const previo = porClave.get(clave);
    const descriptor = { ...catalogo.get(clave), previo: previo || null };

    if (!previo) {
      pendientes.push(descriptor);
      continue;
    }

    if (!forzar && previo.estado === 'TC') {
      // Terminado y bloqueado: no se vuelve a gastar una llamada en él jamás.
      metricasSync.consultasEvitadasPorVentana += 1;
      continue;
    }

    if (!forzar && previo.proximaConsulta && new Date(previo.proximaConsulta) > ahora) {
      metricasSync.consultasEvitadasPorVentana += 1;
      continue;
    }

    pendientes.push(descriptor);
  }

  const refrescadas = new Set();

  await conLimiteDeConcurrencia(pendientes, CONCURRENCIA_MAXIMA_API, async descriptor => {
    try {
      const huboDatos = await refrescarFixture(descriptor, ahora);
      if (huboDatos) refrescadas.add(descriptor.clave);
    } catch (error) {
      console.error(`Error refrescando el partido ${descriptor.clave}:`, error.message);
    }
  });

  return refrescadas;
}

/** Construye el catálogo deduplicado de los partidos de una jornada. */
function catalogoDeJornada(jornadaDoc) {
  const catalogo = new Map();

  for (const partido of jornadaDoc.partidos || []) {
    const clave = claveDeFixture(partido);
    if (!clave || catalogo.has(clave)) continue;
    catalogo.set(clave, descriptorDeFixture(clave, partido));
  }

  return catalogo;
}

/* ---------- Cerrojo distribuido ---------- */

/**
 * Toma el cerrojo si está libre o caducado.
 *
 * El filtro por `expiraEn` vencido junto al `upsert` es lo que hace la
 * operación atómica: si otra instancia tiene el cerrojo vivo, el filtro no
 * encuentra nada, el upsert intenta insertar y choca contra el índice único
 * por nombre. Ese choque —código 11000— es exactamente la respuesta "lo tiene
 * otro", no un error que haya que propagar.
 */
async function tomarCerrojo(nombre, ttlMs, ahora = new Date(), titular = ID_INSTANCIA) {
  try {
    const resultado = await JobLock.findOneAndUpdate(
      { nombre, expiraEn: { $lte: ahora } },
      {
        $set: {
          instancia: titular,
          tomadoEn: ahora,
          expiraEn: new Date(ahora.getTime() + ttlMs)
        },
        $setOnInsert: { nombre }
      },
      { upsert: true, new: true }
    );

    return Boolean(resultado);
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

/**
 * Suelta el cerrojo, pero solo si sigue siendo nuestro.
 *
 * "Nuestro" es el testigo del ciclo concreto, no el del proceso. La diferencia
 * importa cuando el vigilante abandona un ciclo lento: ese ciclo puede terminar
 * más tarde y llegar aquí cuando el cerrojo ya lo tiene un ciclo posterior del
 * MISMO proceso. Con el identificador de proceso lo soltaría, dejando a dos
 * ciclos sincronizando a la vez; con el testigo del ciclo, el filtro no
 * encuentra nada y la llamada no hace daño.
 */
async function soltarCerrojo(nombre, titular = ID_INSTANCIA) {
  await JobLock.updateOne(
    { nombre, instancia: titular },
    { $set: { expiraEn: new Date(0) } }
  );
}

/* ---------- El ciclo ---------- */

/**
 * Un ciclo completo de sincronización.
 *
 * El censo de jornadas se hace quiniela por quiniela, cada una dentro de su
 * propio contexto de inquilino. Podría leerse todo de una vez sin contexto
 * —sería más corto— pero esa es justo la forma del hallazgo C-02: una consulta
 * global sobre una colección con `quinielaId` que parece inocente hasta que dos
 * quinielas coinciden en el nombre de una jornada.
 */
async function ejecutarCicloDeSincronizacion({ ahora = new Date() } = {}) {
  const arranque = Date.now();

  /*
   * Testigo propio de este ciclo. Ver soltarCerrojo(): sin él, un ciclo que el
   * vigilante dio por perdido podría soltar, al terminar tarde, el cerrojo que
   * ya tiene el ciclo siguiente.
   */
  const titular = `${ID_INSTANCIA}#${++contadorDeCiclos}`;

  if (!(await tomarCerrojo(CERROJO_SYNC, TTL_CERROJO_SYNC_MS, ahora, titular))) {
    metricasSync.ciclosOmitidosPorCerrojo += 1;
    return { omitido: true, motivo: 'cerrojo en poder de otra instancia' };
  }

  try {
    const quinielas = await Quiniela.find({ estado: 'activa' }).select('_id nombre').lean();

    const catalogo = new Map();
    const trabajo = [];
    let partidosSeguidos = 0;

    for (const quiniela of quinielas) {
      await tenantContext.run({ quinielaId: quiniela._id }, async () => {
        const jornadas = await Jornada.find({
          'partidos.apiFixtureId': { $exists: true, $ne: '' }
        }).lean();

        for (const jornada of jornadas) {
          const claves = [];

          for (const partido of jornada.partidos || []) {
            const clave = claveDeFixture(partido);
            if (!clave) continue;

            partidosSeguidos += 1;
            claves.push(clave);

            if (!catalogo.has(clave)) {
              catalogo.set(clave, descriptorDeFixture(clave, partido));
            }
          }

          if (claves.length) {
            trabajo.push({
              quinielaId: quiniela._id,
              nombreQuiniela: quiniela.nombre,
              jornada: jornada.nombre,
              claves
            });
          }
        }
      });
    }

    const refrescadas = await refrescarFixturesPendientes(catalogo, { ahora });

    let jornadasReescritas = 0;

    for (const item of trabajo) {
      // Sin datos nuevos no hay nada que reescribir: el resultado sería idéntico.
      if (!item.claves.some(clave => refrescadas.has(clave))) continue;

      try {
        await tenantContext.run(
          { quinielaId: item.quinielaId },
          async () => await sincronizarJornadaDesdeApi(item.jornada)
        );
        jornadasReescritas += 1;
      } catch (error) {
        console.error(
          `Error sincronizando "${item.jornada}" de "${item.nombreQuiniela}":`,
          error.message
        );
      }
    }

    metricasSync.ciclos += 1;
    metricasSync.partidosSeguidos = partidosSeguidos;
    metricasSync.fixturesUnicos = catalogo.size;
    metricasSync.jornadasReescritas += jornadasReescritas;
    metricasSync.ultimoCiclo = new Date().toISOString();
    metricasSync.duracionUltimoCicloMs = Date.now() - arranque;

    return {
      omitido: false,
      quinielas: quinielas.length,
      partidosSeguidos,
      fixturesUnicos: catalogo.size,
      fixturesRefrescados: refrescadas.size,
      jornadasReescritas,
      duracionMs: metricasSync.duracionUltimoCicloMs
    };
  } finally {
    await soltarCerrojo(CERROJO_SYNC, titular).catch(error => {
      console.error('Error soltando el cerrojo de sincronización:', error.message);
    });
  }
}

let cicloEnCurso = false;
let contadorDeCiclos = 0;

/*
 * Guarda local además del cerrojo distribuido. El cerrojo evita que dos
 * procesos coincidan; esto evita que un ciclo lento se solape consigo mismo
 * dentro del mismo proceso, que era el papel de `syncEnProceso`.
 */
async function tickDeSincronizacion() {
  if (cicloEnCurso) return;
  if (!mongoListo()) return;

  cicloEnCurso = true;

  try {
    await conVigilante(
      ejecutarCicloDeSincronizacion(),
      TIMEOUT_CICLO_SYNC_MS,
      `El ciclo de sincronización superó ${TIMEOUT_CICLO_SYNC_MS} ms y se abandonó.`
    );
  } catch (error) {
    if (error?.esTiempoAgotado) metricasSync.ciclosAbandonadosPorTiempo += 1;
    metricasSync.ultimoError = error.message;
    console.error('Error en el ciclo de sincronización:', error.message);
  } finally {
    cicloEnCurso = false;
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


/**
 * Reescribe los resultados oficiales de una jornada a partir de la caché de
 * partidos, y resuelve sus trivias pendientes.
 *
 * Exige contexto de inquilino por la misma razón que
 * `resolverTriviasPendientes()`: busca la jornada por nombre, y los nombres se
 * repiten entre quinielas. Sin filtro por quiniela escribiría los resultados de
 * una en la otra.
 *
 * Antes esto era el cuerpo de la ruta HTTP, y el planificador se llamaba a sí
 * mismo por la red para ejecutarlo —con un token interno inventado para poder
 * saltarse su propia autenticación—. Ahora es una función, y la ruta es una
 * envoltura fina sobre ella.
 *
 * `forzar` distingue las dos formas de llegar aquí: el planificador ya refrescó
 * lo que tocaba y solo quiere volcar la caché, mientras que un administrador
 * que pulsa "sincronizar" espera datos frescos aunque la ventana no haya
 * vencido.
 */
async function sincronizarJornadaDesdeApi(jornadaNombre, { forzar = false } = {}) {
  if (!tenantContext.getStore()?.quinielaId) {
    throw new Error(
      'sincronizarJornadaDesdeApi() requiere contexto de quiniela. ' +
      'Para el barrido global usa ejecutarCicloDeSincronizacion().'
    );
  }

  if (!process.env.APIFOOTBALL_COM_KEY) {
    const error = new Error('Falta configurar APIFOOTBALL_COM_KEY en el .env');
    error.status = 500;
    throw error;
  }

  const jornadaDoc = await Jornada.findOne({ nombre: jornadaNombre });

  if (!jornadaDoc) {
    const error = new Error('Jornada no encontrada');
    error.status = 404;
    throw error;
  }

  const catalogo = catalogoDeJornada(jornadaDoc);

  if (forzar) {
    await refrescarFixturesPendientes(catalogo, { forzar: true });
  }

  /*
   * Una sola lectura para toda la jornada. Antes era una llamada al proveedor
   * por partido —y por quiniela—; ahora es una consulta a la caché compartida.
   */
  const cacheados = await Fixture.find({ clave: { $in: [...catalogo.keys()] } })
    .select('clave evento')
    .lean();

  const eventosPorClave = new Map(cacheados.map(doc => [doc.clave, doc.evento]));

  const oficialExistente = await ResultadoOficial.findOne({ jornada: jornadaNombre });
  const resultadosExistentes = oficialExistente ? oficialExistente.resultados : [];

  const resultadosActualizados = [];

  for (const partido of jornadaDoc.partidos) {
    const existente = buscarOficialCorrespondiente(resultadosExistentes, partido);

    const clave = claveDeFixture(partido);
    const fixture = clave ? eventosPorClave.get(clave) || null : null;

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

        jornada: jornadaNombre,

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
    { jornada: jornadaNombre },
    {
      jornada: jornadaNombre,
      resultados: resultadosActualizados
    },
    { upsert: true, new: true }
  );

  await resolverTriviasPendientes(jornadaNombre);

  /*
   * Si este sync fue el que dio el último partido por terminado, la jornada
   * queda congelada aquí, con la configuración vigente en ese momento. Es el
   * momento natural: el que cierra la jornada es el que fija sus puntos.
   *
   * Pero solo si algo que afecta a los puntos cambió de verdad. El documento se
   * reescribe siempre —el minuto en vivo tiene que llegar a las pantallas—; lo
   * que no puede hacerse siempre es tirar la caché del ranking, porque
   * `actualizarPuntosDeJornada()` la invalida en su primera línea. Un 0-0 que
   * sigue 0-0 llamaba noventa veces seguidas a recalcular una tabla idéntica.
   */
  if (puntosPuedenHaberCambiado(resultadosExistentes, resultadosActualizados)) {
    await actualizarPuntosDeJornada(jornadaNombre, await puntuacionDeLaQuinielaActual());
  } else {
    metricasSync.syncsSinCambioDePuntos += 1;
  }

  return resultadosActualizados;
}

app.post('/api/sync-resultados-oficiales/:jornada', requireAdmin, async (req, res) => {
  try {
    const { jornada } = req.params;

    // Petición manual de un administrador: se salta las ventanas a propósito.
    const resultados = await sincronizarJornadaDesdeApi(jornada, { forzar: true });

    res.json({
      success: true,
      jornada,
      resultados
    });

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

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

/*
 * El caso de manual de M-26: sin filtro devuelve TODOS los pronósticos de
 * TODAS las jornadas de todos los jugadores. Con una temporada larga y veinte
 * participantes son miles de subdocumentos en cada carga, y encima la
 * privacidad obliga a leer también las jornadas y los resultados oficiales
 * para saber qué se puede enseñar.
 *
 * `?jornada=…` acota las tres lecturas a una jornada. Sin el parámetro la
 * respuesta es la de siempre, porque hay pantallas —el reporte, la vista de
 * totales— que sí necesitan el conjunto completo.
 */
app.get('/api/resultados', async (req, res) => {
  const usuario = await Usuario.findById(req.session.usuarioId);
  const esAdmin = ['propietario', 'admin'].includes(req.membership.rol);

  const soloJornada = req.query.jornada ? String(req.query.jornada) : null;
  const filtroJornada = soloJornada ? { jornada: soloJornada } : {};
  const filtroNombre = soloJornada ? { nombre: soloJornada } : {};

  const [jornadas, oficiales, todos] = await Promise.all([
    Jornada.find(filtroNombre).select('nombre partidos').lean(),
    ResultadoOficial.find(filtroJornada).select('jornada resultados').lean(),
    Resultado.find(filtroJornada).lean()
  ]);

  const oficialesPorJornada = new Map(oficiales.map(doc => [doc.jornada, doc.resultados || []]));
  const destapadosPorJornada = new Map(jornadas.map(jornada =>
    [jornada.nombre, partidosDestapados(jornada, oficialesPorJornada.get(jornada.nombre) || [])]
  ));

  /*
   * Antes se omitía la fila entera de las jornadas no cerradas. Ahora la fila
   * viaja siempre y lo que se tapa son los partidos que aún no han empezado:
   * de otro modo, en una jornada a medias no se podría ver NADA, ni siquiera
   * los partidos ya jugados, que es precisamente lo que se quería arreglar.
   */
  const resultMap = new Map();

  todos.forEach(registro => {
    const propio = esAdmin || registro.jugador === usuario?.username;

    resultMap.set(
      `${registro.jugador}_${registro.jornada}`,
      propio
        ? registro.pronosticos
        : taparPronosticosNoDestapados(registro.pronosticos, destapadosPorJornada.get(registro.jornada) || [])
    );
  });

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

      const marcador1 = normalizarMarcador(nuevo.marcador1, `El marcador local del partido ${index + 1}`);
      const marcador2 = normalizarMarcador(nuevo.marcador2, `El marcador visitante del partido ${index + 1}`);

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

    // Si la jornada ya estaba congelada, este pronóstico la obliga a recalcular.
    await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

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
    // Un dato inválido es culpa de la petición, no del servidor.
    if (error?.esValidacion) {
      return res.status(400).json({ success: false, error: error.message });
    }

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
        marcador1: normalizarMarcador(nuevo.marcador1, `El marcador local del partido ${index + 1}`),
        marcador2: normalizarMarcador(nuevo.marcador2, `El marcador visitante del partido ${index + 1}`)
      };
    });

    await Resultado.findOneAndUpdate(
      { jugador, jornada },
      { jugador, jornada, pronosticos: pronosticosFinales },
      { upsert: true, new: true }
    );

    // Si la jornada ya estaba congelada, este pronóstico la obliga a recalcular.
    await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

    res.json({
      success: true,
      mensaje: 'Resultados guardados correctamente desde modo admin.'
    });

  } catch (error) {
    if (error?.esValidacion) {
      return res.status(400).json({ success: false, error: error.message });
    }

    console.error('Error guardando resultados admin:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando resultados admin.'
    });
  }
});

app.get('/api/resultados/:jugador/:jornada', async (req, res) => {
  const { jugador, jornada } = req.params;
  const [usuario, jornadaDoc, oficialDoc, r] = await Promise.all([
    Usuario.findById(req.session.usuarioId),
    Jornada.findOne({ nombre: jornada }).lean(),
    ResultadoOficial.findOne({ jornada }).select('resultados').lean(),
    Resultado.findOne({ jugador, jornada }).lean()
  ]);

  if (!r) return res.json([]);

  const esAdmin = ['propietario', 'admin'].includes(req.membership.rol);
  if (esAdmin || usuario?.username === jugador) return res.json(r.pronosticos);

  /*
   * De otro participante solo se ven los partidos que ya empezaron. No es un
   * 403: la respuesta llega con los marcadores pendientes en `null`, para que
   * la pantalla pueda mostrar la jornada a medias en vez de quedarse en blanco.
   */
  const destapados = partidosDestapados(jornadaDoc, oficialDoc?.resultados || []);

  res.json(taparPronosticosNoDestapados(r.pronosticos, destapados));
});

/* ================= API: Resultados Oficiales ================= */

/*
 * M-26. `?jornada=…` acota a una. Quien pide esto casi siempre está mirando una
 * jornada concreta y luego filtra en el navegador, después de haberse traído
 * todas las demás por la red.
 */
app.get('/api/resultados-oficiales', async (req, res) => {
  const filtro = req.query.jornada ? { jornada: String(req.query.jornada) } : {};

  const all = await ResultadoOficial.find(filtro);
  const resultados = all.map(r => ({
    nombre: r.jornada,
    partidos: r.resultados
  }));

  res.json(resultados);
});

app.post('/api/resultados-oficiales', requireAdmin, async (req, res) => {
  const jornada = normalizarNombreDeJornada(req.body?.jornada);
  const resultados = req.body?.resultados;

  if (!Array.isArray(resultados) || !resultados.length) {
    throw errorDeValidacion('Debes enviar los resultados de la jornada.');
  }

  const jornadaDoc = await Jornada.findOne({ nombre: jornada });

  const resultadosConLogos = resultados.map((r, index) => {
    const partidoJornada = jornadaDoc?.partidos?.[index];

   return {
  equipo1: r.equipo1,
  logoEquipo1: r.logoEquipo1 || partidoJornada?.logoEquipo1 || '',
  marcador1: normalizarMarcador(r.marcador1, `El marcador local del partido ${index + 1}`),
  equipo2: r.equipo2,
  logoEquipo2: r.logoEquipo2 || partidoJornada?.logoEquipo2 || '',
  marcador2: normalizarMarcador(r.marcador2, `El marcador visitante del partido ${index + 1}`),
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

  // Carga manual: bloquea los partidos, así que suele cerrar la jornada.
  await actualizarPuntosDeJornada(jornada, req.quiniela.configuracion.puntuacion);

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

    /*
     * Toda la reconciliación va dentro de una transacción. Un fallo a mitad
     * dejaba lo peor de los dos mundos: respuestas de jugadores huérfanas de
     * trivias ya borradas, que seguían sumando puntos en el ranking sin
     * pregunta a la que corresponder, y trivias reabiertas a medias.
     */
    await enTransaccion(async sesion => {
      creadas = 0;
      actualizadas = 0;
      eliminadas = 0;

      const existentes = await Trivia.find({
        jornadaNombre,
        activa: true
      }).session(sesion);

      for (const trivia of existentes) {
        const clave = `${Number(trivia.partidoIndex)}_${trivia.tipo}`;

        if (!seleccionadas.has(clave)) {
          await RespuestaTrivia.deleteMany({
            triviaId: trivia._id.toString()
          }, { session: sesion });

          await Trivia.deleteOne({
            _id: trivia._id
          }, { session: sesion });

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
            { $set: { puntos: 0 } },
            { session: sesion }
          );
        }

        await trivia.save({ session: sesion });
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
          }).session(sesion);

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

          await trivia.save({ session: sesion });
          creadas++;
        }
      }
    });

    /*
     * Los puntos de las trivias entran en el ranking, y esta ruta acaba de
     * borrarlos o ponerlos a cero.
     */
    invalidarCacheRanking(req.quiniela._id);

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

    invalidarCacheRanking(req.quiniela._id);
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
  let puntosActualizados = false;

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
        puntosActualizados = true;
      }

    } catch (error) {
      console.error(`Error resolviendo trivia ${trivia._id}:`, error.message);
    }
  }

  if (puntosActualizados) invalidarCacheRanking();
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

/*
 * Interruptor de los trabajos periódicos.
 *
 * Hoy corren dentro del proceso web y el cerrojo distribuido evita que varias
 * instancias los dupliquen. La bandera existe para el día en que convenga
 * moverlos a un proceso aparte: se despliega el mismo código con
 * `JOBS_HABILITADOS=false` en las instancias que solo atienden peticiones, y
 * `true` en la que hace de trabajador. Sin ella habría que partir el código
 * antes de poder partir el despliegue.
 */
const JOBS_HABILITADOS = process.env.JOBS_HABILITADOS !== 'false';

if (!ENTORNO_DE_PRUEBAS && JOBS_HABILITADOS) {
  setInterval(() => {
    resolverTriviasDeTodasLasQuinielas().catch(error => {
      console.error('Error automático resolviendo trivias:', error.message);
    });
  }, INTERVALO_RESOLUCION_TRIVIAS_MS);

  setInterval(() => {
    tickDeSincronizacion();
  }, INTERVALO_CICLO_SYNC_MS);
}

/*
 * Consumo del proveedor y salud del planificador.
 *
 * `consultasAhorradasPorDeduplicacion` es la medida directa del hallazgo C-01:
 * cuántas llamadas al API se habrían hecho de más por seguir el mismo partido
 * desde varias quinielas. Los contadores son por instancia y se reinician con
 * el proceso; para un consumo consolidado haría falta persistirlos, que es
 * trabajo de la observabilidad (M-24).
 */
app.get('/api/admin/sync-metricas', requireAdmin, (req, res) => {
  res.json({
    ...metricasSync,
    consultasAhorradasPorDeduplicacion: Math.max(
      0,
      metricasSync.partidosSeguidos - metricasSync.fixturesUnicos
    ),
    configuracion: {
      intervaloCicloMs: INTERVALO_CICLO_SYNC_MS,
      concurrenciaMaxima: CONCURRENCIA_MAXIMA_API,
      ttlCerrojoMs: TTL_CERROJO_SYNC_MS,
      timeoutCicloMs: TIMEOUT_CICLO_SYNC_MS,
      timeoutProveedorMs: TIMEOUT_APIFOOTBALL_MS,
      ventanasMs: VENTANAS_SYNC_MS,
      trabajosHabilitados: JOBS_HABILITADOS
    },
    instancia: ID_INSTANCIA
  });
});



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

  /*
   * Esta ruta se quedó fuera del repaso de privacidad porque llamaba
   * `jornadaAcceso` a lo que las otras tres llaman `jornadaDoc`, y la prueba
   * que buscaba el patrón viejo no la vio. De ahí que ahora la comprobación
   * sea una función compartida y no una expresión copiada en cada sitio: una
   * regla en un solo lugar no se puede quedar a medio cambiar.
   */
  const [usuario, jornadaDoc, oficialDoc, resultado] = await Promise.all([
    Usuario.findById(req.session.usuarioId),
    Jornada.findOne({ nombre: jornada }).lean(),
    ResultadoOficial.findOne({ jornada }).select('resultados').lean(),
    Resultado.findOne({ jugador, jornada }).lean()
  ]);

  if (!resultado || !jornadaDoc) {
    return res.status(404).json({ error: 'Datos no encontrados' });
  }

  const puedeVerloTodo = ['propietario', 'admin'].includes(req.membership.rol) ||
    usuario?.username === jugador;

  const destapados = partidosDestapados(jornadaDoc, oficialDoc?.resultados || []);
  const pronosticos = resultado.pronosticos;

  const resultadosConEquipos = jornadaDoc.partidos.map((p, i) => {
    const visible = puedeVerloTodo || destapados[i];

    return {
      equipo1: p.equipo1,
      equipo2: p.equipo2,
      marcador1: visible ? (pronosticos[i]?.marcador1 ?? '') : '',
      marcador2: visible ? (pronosticos[i]?.marcador2 ?? '') : '',
      oculto: !visible
    };
  });

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

    /*
     * Aquí vivía la puerta abierta: la rama `jornadaSinFecha` saltaba a la vez
     * la comprobación de identidad Y la de contraseña, así que una jornada a la
     * que se le olvidó la fecha dejaba a cualquiera leer los pronósticos de
     * cualquiera. Ahora el permiso no depende de un campo que se puede olvidar
     * poner, sino de si el partido ya empezó.
     */
    const esElPropio = jugadorDoc._id.toString() === req.session.usuarioId;

    const oficialDoc = await ResultadoOficial.findOne({ jornada }).select('resultados').lean();
    const destapados = partidosDestapados(jornadaDoc, oficialDoc?.resultados || []);

    /*
     * La contraseña sigue protegiendo lo PROPIO, que es para lo que estaba: la
     * pantalla se usa en el móvil de uno delante de los demás. Para lo ajeno ya
     * no hace falta pedir nada, porque solo se entrega lo que se puede ver.
     */
    if (esElPropio && jugadorDoc.password) {
      if (!password) {
        return res.json({ success: false, error: 'Contraseña requerida' });
      }

      const match = await bcrypt.compare(password, jugadorDoc.password);

      if (!match) {
        return res.status(401).json({
          success: false,
          error: 'Contraseña incorrecta.'
        });
      }
    }

    const partidos = jornadaDoc.partidos.map((p, i) => {
      const pronostico = resultado.pronosticos[i];
      const visible = esElPropio || destapados[i];

      return {
        equipo1: p.equipo1,
        equipo2: p.equipo2,
        logoEquipo1: p.logoEquipo1 || '',
        logoEquipo2: p.logoEquipo2 || '',
        marcador1: visible ? (pronostico?.marcador1 ?? '') : '',
        marcador2: visible ? (pronostico?.marcador2 ?? '') : '',
        oculto: !visible
      };
    });

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

    /*
     * Los cuatro borrados van juntos. A medias quedaban pronósticos y puntos
     * congelados de una jornada que ya no existe: la tabla general los seguía
     * sumando al total sin una columna a la que pertenecer, así que los puntos
     * de todos salían mal y nada indicaba por qué.
     */
    const jornadaEliminada = await enTransaccion(async sesion => {
      const jornada = await Jornada.findOneAndDelete(
        { nombre: nombreJornada },
        { session: sesion }
      );

      if (!jornada) return null;

      await Resultado.deleteMany({ jornada: nombreJornada }, { session: sesion });
      await ResultadoOficial.deleteMany({ jornada: nombreJornada }, { session: sesion });
      await PuntosJornada.deleteMany({ jornada: nombreJornada }, { session: sesion });

      return jornada;
    });

    if (!jornadaEliminada) {
      return res.status(404).json({ error: 'Jornada no encontrada' });
    }

    invalidarCacheRanking(req.quiniela._id);

    res.json({
      success: true,
      message: 'Jornada, pronósticos y resultados oficiales eliminados'
    });

  } catch (error) {
    console.error('Error eliminando jornada:', error);
    res.status(500).json({ error: 'Error eliminando jornada' });
  }
});

/* ================= Puntos por jornada — Fase 5 (C-03, M-03, M-04) =================
 *
 * El problema que resuelve, que eran dos a la vez:
 *
 *   1. `/api/resultados-totales` leía seis colecciones completas y recalculaba
 *      todo el histórico en CADA petición. Veinte personas abriendo la tabla al
 *      terminar una jornada eran veinte recálculos completos simultáneos.
 *
 *   2. Ese recálculo usaba la configuración de puntuación VIGENTE, no la que
 *      regía cuando se jugó. Subir el marcador exacto de 5 a 10 en marzo
 *      reescribía las jornadas de enero y con ellas la clasificación de un
 *      campeonato ya jugado (M-03), mientras las trivias ya guardaban sus puntos
 *      resueltos en `RespuestaTrivia.puntos` (M-04).
 *
 * La regla, decidida el 17 de agosto de 2026:
 *
 *   **Una jornada se congela cuando todos sus partidos tienen resultado
 *   definitivo.** A partir de ahí sus puntos no vuelven a moverse por un cambio
 *   de configuración; solo se recalculan si un administrador corrige un
 *   resultado oficial —porque ahí sí cambió un hecho del juego— y en ese caso
 *   se recalculan con la configuración que la jornada tenía guardada, no con la
 *   de hoy.
 *
 * Los dos problemas se resuelven con lo mismo, y no por casualidad: para poder
 * guardar los puntos calculados hay que decidir cuándo dejan de valer, y esa
 * pregunta ES la del congelamiento.
 */

/** Puntos de un solo partido. Es la regla de puntuación, en un único sitio. */
function puntosDePartido(pronostico, oficial, puntuacion) {
  if (!pronostico || !oficial) return 0;

  const valores = [oficial.marcador1, oficial.marcador2, pronostico.marcador1, pronostico.marcador2];
  const sonNumerosValidos = valores.every(valor => typeof valor === 'number' && !Number.isNaN(valor));

  if (!sonNumerosValidos) return 0;

  const esComodin = oficial.comodin;

  if (oficial.marcador1 === pronostico.marcador1 && oficial.marcador2 === pronostico.marcador2) {
    return esComodin ? puntuacion.comodinExacto : puntuacion.marcadorExacto;
  }

  const signo = (uno, dos) => (uno > dos ? 'gano' : uno < dos ? 'perdio' : 'empato');

  if (signo(oficial.marcador1, oficial.marcador2) === signo(pronostico.marcador1, pronostico.marcador2)) {
    return esComodin ? puntuacion.comodinResultado : puntuacion.resultadoCorrecto;
  }

  return 0;
}

/**
 * Puntos de un jugador en una jornada.
 *
 * El vínculo partido↔pronóstico es **por posición en el array**, que es una
 * deuda conocida (M-02) y se conserva tal cual: cambiarla aquí alteraría
 * puntuaciones ya emitidas. Migrar a un `partidoId` estable es la Fase 7.
 */
function puntosDeJornada(partidos, pronosticos, oficiales, puntuacion) {
  let total = 0;

  (partidos || []).forEach((partido, indice) => {
    total += puntosDePartido((pronosticos || [])[indice], (oficiales || [])[indice], puntuacion);
  });

  return total;
}

/**
 * Estadísticas para ordenar una clasificación por jornada. No cambian los
 * puntos: solo ordenan visualmente a quienes empataron en el marcador total.
 */
function estadisticasDeJornada(partidos, pronosticos, oficiales, puntuacion) {
  let puntos = 0;
  let marcadoresExactos = 0;
  let resultadosCorrectos = 0;
  let diferenciaTotalGoles = 0;

  (partidos || []).forEach((partido, indice) => {
    const pronostico = (pronosticos || [])[indice];
    const oficial = (oficiales || [])[indice];
    puntos += puntosDePartido(pronostico, oficial, puntuacion);

    if (!pronostico || !oficial) return;
    const valores = [oficial.marcador1, oficial.marcador2, pronostico.marcador1, pronostico.marcador2];
    if (!valores.every(valor => typeof valor === 'number' && !Number.isNaN(valor))) return;

    const exacto = oficial.marcador1 === pronostico.marcador1 && oficial.marcador2 === pronostico.marcador2;
    if (exacto) marcadoresExactos += 1;

    const signo = (uno, dos) => (uno > dos ? 1 : uno < dos ? -1 : 0);
    if (signo(oficial.marcador1, oficial.marcador2) === signo(pronostico.marcador1, pronostico.marcador2)) {
      resultadosCorrectos += 1;
    }

    diferenciaTotalGoles +=
      Math.abs(oficial.marcador1 - pronostico.marcador1) +
      Math.abs(oficial.marcador2 - pronostico.marcador2);
  });

  return { puntos, marcadoresExactos, resultadosCorrectos, diferenciaTotalGoles };
}

/**
 * Una jornada está terminada cuando **todos** sus partidos tienen un resultado
 * oficial definitivo: el sincronizador lo dio por terminado (`TC`) o un
 * administrador lo bloqueó al cargarlo a mano.
 *
 * Si falta el resultado de un solo partido, la jornada sigue viva y sus puntos
 * se calculan al vuelo, como siempre. Esto es lo que hace que la tabla siga
 * moviéndose durante la jornada en curso.
 */
function jornadaEstaFinalizada(partidos, oficiales) {
  if (!partidos?.length) return false;
  if (!oficiales || oficiales.length < partidos.length) return false;

  return partidos.every((partido, indice) => {
    const oficial = oficiales[indice];
    if (!oficial) return false;
    return oficial.bloqueadoFinal === true || oficial.estado === 'TC';
  });
}

/**
 * Calcula y graba los puntos de una jornada terminada.
 *
 * Devuelve `null` si la jornada todavía no está terminada, que es la señal de
 * "esta aún se calcula al vuelo".
 */
async function congelarPuntosDeJornada(jornadaNombre, puntuacion) {
  const jornadaDoc = await Jornada.findOne({ nombre: jornadaNombre }).lean();
  if (!jornadaDoc) return null;

  const oficial = await ResultadoOficial.findOne({ jornada: jornadaNombre }).lean();
  if (!oficial) return null;

  if (!jornadaEstaFinalizada(jornadaDoc.partidos, oficial.resultados)) return null;

  const pronosticos = await Resultado.find({ jornada: jornadaNombre }).lean();

  const puntos = pronosticos.map(registro => ({
    jugador: registro.jugador,
    puntos: puntosDeJornada(jornadaDoc.partidos, registro.pronosticos, oficial.resultados, puntuacion)
  }));

  /*
   * Se guarda la configuración usada junto a los puntos. Sin ella, corregir un
   * resultado meses después recalcularía la jornada con las reglas de hoy, que
   * es exactamente el problema que se quería quitar.
   */
  await PuntosJornada.findOneAndUpdate(
    { jornada: jornadaNombre },
    {
      jornada: jornadaNombre,
      puntos,
      puntuacion: {
        marcadorExacto: puntuacion.marcadorExacto,
        resultadoCorrecto: puntuacion.resultadoCorrecto,
        comodinExacto: puntuacion.comodinExacto,
        comodinResultado: puntuacion.comodinResultado
      },
      congeladoEn: new Date()
    },
    { upsert: true }
  );

  return puntos;
}

/**
 * Punto único de entrada tras cualquier escritura que pueda alterar los puntos
 * de una jornada: resultados oficiales, pronósticos, o borrado de la jornada.
 *
 * Congela si acaba de terminar, recalcula si ya estaba congelada, y descongela
 * si dejó de estar terminada —por ejemplo si un administrador reabre un partido—.
 */
async function actualizarPuntosDeJornada(jornadaNombre, puntuacionActual) {
  if (!jornadaNombre) return null;

  // Toda alteración de una jornada puede cambiar su fila y el total del ranking.
  invalidarCacheRanking();

  const existente = await PuntosJornada.findOne({ jornada: jornadaNombre })
    .select('puntuacion')
    .lean();

  /*
   * Si ya estaba congelada se recalcula con SU configuración, no con la de hoy.
   * De lo contrario, corregir un marcador equivocado colaría de tapadillo todos
   * los cambios de puntuación ocurridos desde que la jornada terminó.
   */
  const puntuacion = existente?.puntuacion || puntuacionActual;

  const congelado = await congelarPuntosDeJornada(jornadaNombre, puntuacion);

  if (!congelado && existente) {
    await PuntosJornada.deleteOne({ jornada: jornadaNombre });
  }

  return congelado;
}

/** La puntuación vigente de la quiniela del contexto actual. */
async function puntuacionDeLaQuinielaActual() {
  const quinielaId = tenantContext.getStore()?.quinielaId;
  if (!quinielaId) return puntuacionDefault;

  const quiniela = await Quiniela.findById(quinielaId).select('configuracion').lean();

  return quiniela?.configuracion?.puntuacion || puntuacionDefault;
}

/* ================= Clasificación por jornada ================= */
app.get('/api/clasificacion-jornada', async (req, res) => {
  try {
    /*
     * Solo los nombres. Antes se traía la temporada entera —cada jornada con
     * todos sus partidos— para dos cosas que no lo necesitan: llenar el
     * desplegable y localizar una jornada. Con cuarenta jornadas de diez
     * partidos eso son cuatrocientos subdocumentos en cada carga de pantalla,
     * que es justo la clase de lectura que la Fase 5 quitó de la tabla general.
     */
    const jornadas = await Jornada.find({}).select('nombre').sort({ createdAt: -1 }).lean();
    if (!jornadas.length) return res.json({ jornadas: [], jornada: null, estado: null, clasificacion: [] });

    const jornadaNombre = String(req.query.jornada || jornadas[0].nombre);
    if (!jornadas.some(item => item.nombre === jornadaNombre)) {
      return res.status(404).json({ error: 'Jornada no encontrada.' });
    }

    let [jornada, oficial, pronosticos, materializada, miembrosRanking, jugadoresHistoricos] = await Promise.all([
      Jornada.findOne({ nombre: jornadaNombre }).lean(),
      ResultadoOficial.findOne({ jornada: jornadaNombre }).lean(),
      Resultado.find({ jornada: jornadaNombre }).lean(),
      PuntosJornada.findOne({ jornada: jornadaNombre }).lean(),
      Membresia.find({
        quinielaId: req.quiniela._id,
        estado: req.quiniela.configuracion.incluirExpulsadosEnRanking
          ? { $in: ['activo', 'pendiente_retiro', 'expulsado'] }
          : { $in: ['activo', 'pendiente_retiro'] }
      }).populate('usuarioId', 'username'),
      Jugador.find({}).select('nombre').lean()
    ]);

    if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada.' });

    const oficiales = oficial?.resultados || [];
    const confirmada = jornadaEstaFinalizada(jornada.partidos, oficiales);

    /*
     * Materializar dentro de un GET es una red de seguridad, no el camino
     * normal: lo habitual es que la jornada se congele en el momento en que
     * termina. Por eso un fallo aquí no puede tumbar la consulta.
     *
     * El caso concreto: dos peticiones simultáneas sobre una jornada recién
     * confirmada hacen el mismo upsert y chocan contra el índice único
     * {quinielaId, jornada}; MongoDB responde 11000 y, sin este try, la tabla
     * devolvía un 500 por una carrera que además ya dejó el trabajo hecho. Se
     * relee después: casi siempre estará el documento que grabó la otra.
     * Si aun así no está, los puntos calculados al vuelo dan el mismo número.
     */
    if (confirmada && !materializada) {
      try {
        await actualizarPuntosDeJornada(jornadaNombre, req.quiniela.configuracion.puntuacion);
      } catch (error) {
        console.error(`No se pudo congelar "${jornadaNombre}" al consultarla:`, error.message);
      }
      materializada = await PuntosJornada.findOne({ jornada: jornadaNombre }).lean();
    }
    const puntuacion = materializada?.puntuacion || req.quiniela.configuracion.puntuacion;
    const puntosMaterializados = new Map((materializada?.puntos || []).map(item => [item.jugador, item.puntos || 0]));
    const pronosticosPorJugador = new Map(pronosticos.map(item => [item.jugador, item.pronosticos]));
    const nombres = new Set([
      ...miembrosRanking.filter(item => item.usuarioId).map(item => item.usuarioId.username),
      ...jugadoresHistoricos.map(item => item.nombre).filter(Boolean)
    ]);

    const clasificacion = Array.from(nombres).map(jugador => {
      const estadisticas = estadisticasDeJornada(
        jornada.partidos,
        pronosticosPorJugador.get(jugador),
        oficiales,
        puntuacion
      );
      return {
        jugador,
        puntos: confirmada && materializada ? (puntosMaterializados.get(jugador) || 0) : estadisticas.puntos,
        marcadoresExactos: estadisticas.marcadoresExactos,
        resultadosCorrectos: estadisticas.resultadosCorrectos,
        diferenciaTotalGoles: estadisticas.diferenciaTotalGoles
      };
    }).sort((a, b) =>
      b.puntos - a.puntos ||
      b.marcadoresExactos - a.marcadoresExactos ||
      b.resultadosCorrectos - a.resultadosCorrectos ||
      a.diferenciaTotalGoles - b.diferenciaTotalGoles ||
      a.jugador.localeCompare(b.jugador)
    );

    const empatesPorPuntos = new Map();
    clasificacion.forEach(fila => {
      empatesPorPuntos.set(fila.puntos, (empatesPorPuntos.get(fila.puntos) || 0) + 1);
    });

    let puesto = 0;
    let puntosAnteriores = null;
    clasificacion.forEach((fila, indice) => {
      if (fila.puntos !== puntosAnteriores) puesto = indice + 1;
      fila.puesto = puesto;
      fila.empate = empatesPorPuntos.get(fila.puntos) > 1;
      puntosAnteriores = fila.puntos;
    });

    res.json({
      jornadas: jornadas.map(item => ({ nombre: item.nombre })),
      jornada: jornada.nombre,
      estado: confirmada ? 'confirmada' : 'provisional',
      clasificacion
    });
  } catch (error) {
    console.error('Error calculando clasificación por jornada:', error);
    res.status(500).json({ error: 'Error calculando la clasificación por jornada.' });
  }
});

/*
 * La tabla de posiciones.
 *
 * Antes leía seis colecciones completas y recalculaba todo el histórico en cada
 * petición (C-03). Ahora las jornadas terminadas aportan un número ya guardado,
 * y solo las que siguen vivas se calculan al vuelo. Cuando toda la temporada
 * está cerrada, ni `Resultado` ni `ResultadoOficial` llegan a leerse.
 */
app.get('/api/resultados-totales', async (req, res) => {
  try {
    const cacheado = leerCacheRanking(req.quiniela._id);
    if (cacheado) return responderRanking(res, req, cacheado);

    const puntuacionActual = req.quiniela.configuracion.puntuacion;

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

    const jornadas = await Jornada.find({}).lean();

    /* ---------- Lo ya congelado: una consulta, un documento por jornada ---------- */

    const congeladas = await PuntosJornada.find({}).lean();

    const puntosCongelados = new Map();
    const jornadasCongeladas = new Set();

    for (const doc of congeladas) {
      jornadasCongeladas.add(doc.jornada);
      for (const entrada of doc.puntos || []) {
        puntosCongelados.set(`${entrada.jugador}_${doc.jornada}`, entrada.puntos || 0);
      }
    }

    /* ---------- Lo que sigue vivo: solo eso se lee y se calcula ---------- */

    const jornadasVivas = jornadas.filter(j => !jornadasCongeladas.has(j.nombre));
    const nombresVivos = jornadasVivas.map(j => j.nombre);

    const [resultados, oficiales] = nombresVivos.length
      ? await Promise.all([
          Resultado.find({ jornada: { $in: nombresVivos } }).lean(),
          ResultadoOficial.find({ jornada: { $in: nombresVivos } }).lean()
        ])
      : [[], []];

    const mapRes = new Map();
    resultados.forEach(r => mapRes.set(`${r.jugador}_${r.jornada}`, r.pronosticos));

    const mapOficial = new Map();
    oficiales.forEach(r => mapOficial.set(r.jornada, r.resultados));

    /* ---------- Trivias ---------- */

    const respuestasTrivia = await RespuestaTrivia.find({}).select('jugador puntos').lean();

    const mapTrivias = new Map();
    respuestasTrivia.forEach(r => {
      mapTrivias.set(r.jugador, (mapTrivias.get(r.jugador) || 0) + (r.puntos || 0));
    });

    /* ---------- Armado de la tabla ---------- */

    const resultadosTotales = {};

    for (const jugador of jugadores) {
      let totalPuntos = 0;
      resultadosTotales[jugador.nombre] = {};

      const puntosTrivias = mapTrivias.get(jugador.nombre) || 0;
      resultadosTotales[jugador.nombre]['Trivias'] = puntosTrivias;
      totalPuntos += puntosTrivias;

      for (const jornada of jornadas) {
        const clave = `${jugador.nombre}_${jornada.nombre}`;

        const puntosJornada = jornadasCongeladas.has(jornada.nombre)
          // Terminada: el número que se grabó cuando cerró. No se recalcula.
          ? (puntosCongelados.get(clave) || 0)
          // Viva: se calcula al vuelo con la configuración de hoy.
          : puntosDeJornada(
              jornada.partidos,
              mapRes.get(clave),
              mapOficial.get(jornada.nombre),
              puntuacionActual
            );

        resultadosTotales[jugador.nombre][jornada.nombre] = puntosJornada;
        totalPuntos += puntosJornada;
      }

      resultadosTotales[jugador.nombre].total = totalPuntos;
    }

    /*
     * Red de seguridad: una jornada que ya terminó pero que nadie congeló al
     * cerrarse —datos migrados, o resultados escritos antes de la Fase 5— se
     * congela aquí. En condiciones normales no hace nada, porque el
     * congelamiento ocurre en el momento en que la jornada termina.
     *
     * Va ANTES de responder a propósito. Hacerlo después dejaba el endpoint sin
     * determinar: quien leyera la tabla y consultara acto seguido si la jornada
     * estaba congelada podía encontrarse con que todavía no, según hubiera
     * terminado o no una escritura que ya nadie estaba esperando. El coste es
     * una escritura, y solo la primera vez.
     */
    for (const jornada of jornadasVivas) {
      const oficialJornada = mapOficial.get(jornada.nombre);
      if (!jornadaEstaFinalizada(jornada.partidos, oficialJornada)) continue;

      try {
        await congelarPuntosDeJornada(jornada.nombre, puntuacionActual);
      } catch (error) {
        // Que no se pueda congelar no debe impedir ver la tabla.
        console.error(`Error congelando "${jornada.nombre}":`, error.message);
      }
    }

    guardarCacheRanking(req.quiniela._id, resultadosTotales);
    return responderRanking(res, req, resultadosTotales);

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
  /*
   * Los errores de los validadores de dominio llevan su propio mensaje y sí se
   * devuelve: es información que el administrador necesita para corregir el
   * dato, no detalle interno del servidor.
   */
  if (error?.esValidacion) {
    return res.status(error.status || 400).json({ error: error.message });
  }

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
  // Modelos globales del sincronizador, deliberadamente sin quinielaId
  Fixture, JobLock,
  // Modelos de dominio, todos con aislamiento por quiniela
  Jugador, Jornada, Resultado, ResultadoOficial,
  Trivia, RespuestaTrivia, Equipo,
  PuntosJornada,
  // Lógica de dominio bajo prueba
  resolverTriviasPendientes,
  resolverTriviasDeTodasLasQuinielas,
  resolverRespuestaTrivia,
  esGolApiFootball,
  obtenerEstadoPartido,
  obtenerMarcador90Minutos,
  minutoApiFootball,
  partidoYaInicio,
  TIPOS_TRIVIA,
  // Sincronizador (Fase 4)
  sincronizarJornadaDesdeApi,
  ejecutarCicloDeSincronizacion,
  refrescarFixturesPendientes,
  calcularProximaConsulta,
  claveDeFixture,
  catalogoDeJornada,
  conLimiteDeConcurrencia,
  tomarCerrojo,
  soltarCerrojo,
  conVigilante,
  enTransaccion,
  puntosPuedenHaberCambiado,
  normalizarMarcador,
  normalizarNombreDeJornada,
  normalizarPartido,
  normalizarPartidos,
  normalizarIndicesDePartido,
  partidosDestapados,
  taparPronosticosNoDestapados,
  proveedorDeEventos,
  metricasSync,
  VENTANAS_SYNC_MS,
  CERROJO_SYNC,
  // Puntos por jornada (Fase 5)
  puntosDePartido,
  puntosDeJornada,
  estadisticasDeJornada,
  jornadaEstaFinalizada,
  congelarPuntosDeJornada,
  actualizarPuntosDeJornada
};

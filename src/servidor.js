/*
 * La aplicación Express sobre PostgreSQL.
 *
 * ============================================================================
 * POR QUÉ ESTE ARCHIVO EXISTE AL LADO DE `server.js` Y NO EN SU LUGAR
 * ============================================================================
 *
 * Portar 81 rutas modificando `server.js` en sitio habría tumbado sus 83
 * pruebas de integración con el primer grupo, y no habrían vuelto a pasar hasta
 * el final: varios días trabajando a ciegas sobre lo único que demuestra que la
 * aplicación funciona.
 *
 * Así, `server.js` sigue verde mientras esto crece a su lado. El cambio de
 * verdad —el momento en que la aplicación se apaga y vuelve— se reduce a una
 * línea de `package.json` en la tajada 7.7, cuando todo esto ya esté probado.
 *
 * ============================================================================
 * ⚠️ DÓNDE SE ABRE LA TRANSACCIÓN, Y POR QUÉ NO EN EL MIDDLEWARE
 * ============================================================================
 *
 * En `server.js` el contexto de quiniela se fijaba con
 * `tenantContext.run({ quinielaId }, next)`. Traducir eso a
 * `db.enQuiniela(id, next)` sería un error grave y silencioso:
 *
 *   `enQuiniela` toma una conexión del pool y abre una transacción, pero
 *   `next()` de Express **retorna antes de que el manejador async termine**.
 *   Se haría COMMIT y se soltaría la conexión con la ruta todavía corriendo,
 *   y a partir de ahí las consultas irían por una conexión ajena o cerrada.
 *
 * La alternativa —mantener la transacción abierta hasta que la respuesta
 * termine— es correcta pero retiene una conexión durante la serialización y
 * mientras un cliente lento lee. Con el plan gratuito de Neon eso agota el pool.
 *
 * Así que el middleware **sólo guarda el `quinielaId` en `req`**, y cada ruta
 * envuelve su propio cuerpo en un `db.enQuiniela`. Eso da una transacción por
 * petición —la regla 1 de §21.2— y suelta la conexión antes de escribir la
 * respuesta. `enQuiniela` es reentrante, así que una ruta que llame a tres
 * módulos sigue usando una sola.
 *
 * El ayudante `enQuiniela(req, fn)` de abajo es la forma corta de hacerlo.
 */
'use strict';

const express = require('express');
require('express-async-errors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const ConnectPgSimple = require('connect-pg-simple');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const db = require('./db');
const usuariosMod = require('./usuarios');
const quinielasMod = require('./quinielas');
const membresiasMod = require('./membresias');

const RAIZ = path.join(__dirname, '..');

/* ==================== Guardias ==================== */

function requireLogin(req, res, next) {
  if (req.session?.usuarioId) return next();
  return res.status(401).json({ error: 'Debes iniciar sesión.' });
}

/**
 * Administrador de la quiniela activa **y** con el Admin Mode vigente.
 *
 * Son dos cosas distintas y hacen falta las dos: el rol dice quién puedes ser,
 * el Admin Mode dice que has confirmado tu contraseña hace menos de una hora.
 */
function requireAdmin(req, res, next) {
  if (!req.membresia || !['propietario', 'admin'].includes(req.membresia.rol)) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador en esta quiniela.' });
  }

  const acceso = req.session?.adminMode;
  const vigente = acceso &&
    acceso.quinielaId === String(req.quiniela?.id) &&
    Date.now() - acceso.verificadoEn < 1000 * 60 * 60;

  if (!vigente) {
    return res.status(401).json({
      error: 'Confirma tu contraseña para entrar al modo administrador.',
      requiereAdminMode: true
    });
  }
  return next();
}

/**
 * La forma corta de «esta ruta trabaja dentro de la quiniela activa».
 *
 * Ver la cabecera: es aquí, y no en el middleware, donde se abre la transacción.
 */
function enQuiniela(req, fn) {
  return db.enQuiniela(req.quiniela.id, fn);
}

/* ==================== La aplicación ==================== */

/**
 * Construye la aplicación. No abre el puerto ni conecta con nada: eso lo decide
 * quien la construye. Es lo que permite que las pruebas la levanten en memoria.
 */
function crearApp({ pool = null, secretoSesion = process.env.SESSION_SECRET } = {}) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const esProduccion = process.env.NODE_ENV === 'production';
  const enPruebas = process.env.NODE_ENV === 'test';

  if (esProduccion) app.set('trust proxy', 1);

  /* ---------- Cabeceras de seguridad ---------- */

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        /*
         * Sin 'unsafe-inline' desde la Entrada 024: el marcado ya no contiene
         * código. Es lo que convierte el escapado de S-04 en defensa en
         * profundidad en vez de en la única línea.
         */
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        /*
         * OJO: 'unsafe-inline' en script-src NO cubre los manejadores en
         * atributo; son directivas independientes y hay que declararla.
         */
        scriptSrcAttr: ["'none'"],
        // Sigue con 'unsafe-inline': quedan 19 style= en línea en el frontend.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://apiv3.apifootball.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: esProduccion ? [] : null
      }
    },
    // Los escudos vienen de apiv3.apifootball.com: COEP rompería su carga.
    crossOriginEmbedderPolicy: false,
    hsts: esProduccion ? { maxAge: 15552000, includeSubDomains: true } : false
  }));

  const ORIGENES_PERMITIDOS = [...new Set([
    'http://localhost', `http://localhost:${PORT}`, 'http://localhost:3000',
    'http://127.0.0.1', `http://127.0.0.1:${PORT}`, 'capacitor://localhost',
    ...String(process.env.ALLOWED_ORIGINS || 'https://quinieladeportivaglobal.onrender.com')
      .split(',').map(o => o.trim()).filter(Boolean)
  ])];

  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === 'null') return callback(null, true);
      if (ORIGENES_PERMITIDOS.includes(origin)) return callback(null, true);
      return callback(new Error('No permitido por CORS'));
    },
    credentials: true
  }));

  app.use(express.json({ limit: '10kb' }));

  /* ---------- Sondas de salud ---------- */

  /*
   * ⚠️ Van ANTES de la sesión a propósito. Si la base está caída, el almacén de
   * sesiones se bloquearía esperando, y una sonda que se cuelga no sirve para
   * diagnosticar nada — que es justo cuando más falta hace.
   */
  app.get('/healthz', (req, res) => {
    res.json({ estado: 'vivo', tiempoActivoSegundos: Math.round(process.uptime()) });
  });

  app.get('/readyz', async (req, res) => {
    try {
      await db.consulta('SELECT 1');
      res.json({ estado: 'listo', base: 'conectada', tiempoActivoSegundos: Math.round(process.uptime()) });
    } catch (error) {
      res.status(503).json({ estado: 'no-listo', base: 'sin conexión', detalle: error.message });
    }
  });

  /* ---------- Sesiones ---------- */

  if (!secretoSesion && esProduccion) throw new Error('Falta SESSION_SECRET');

  const AlmacenPg = ConnectPgSimple(session);

  app.use(session({
    secret: secretoSesion || 'solo-desarrollo-cambiar',
    /*
     * El almacén habla con la base por su cuenta, así que necesita un pool
     * propio o uno prestado. En pruebas se le pasa el adaptador de PGlite.
     */
    store: new AlmacenPg({
      pool: pool || db.fuenteActual(),
      tableName: 'sesiones',
      createTableIfMissing: false,   // la tabla vive en db/esquema.sql
      pruneSessionInterval: enPruebas ? false : 60 * 15
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: esProduccion,
      sameSite: 'strict',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  }));

  /* ---------- Limitación de intentos ---------- */

  const comunes = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    /*
     * Las pruebas de integración salen todas de la misma IP y crean varias
     * cuentas seguidas: el limitador de registro las bloquearía a la sexta.
     */
    skip: () => enPruebas
  };

  // Login: sólo cuentan los intentos FALLIDOS. Quien entra bien no gasta cuota.
  const limiteLogin = rateLimit({
    ...comunes, windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.' }
  });

  // Registro: cuentan todos, para que nadie cree cuentas en masa desde una IP.
  const limiteRegistro = rateLimit({
    ...comunes, windowMs: 60 * 60 * 1000, limit: 5,
    message: { error: 'Se alcanzó el límite de cuentas creadas desde esta conexión. Inténtalo más tarde.' }
  });

  /*
   * El más estricto de los tres: quien llega aquí ya tiene sesión y rol, y lo
   * único que lo separa de operar la quiniela es la contraseña.
   */
  const limiteAdminMode = rateLimit({
    ...comunes, windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos de confirmación. Espera unos minutos.' }
  });

  /* ---------- Autenticación ---------- */

  app.post('/api/auth/registro', limiteRegistro, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const confirmarPassword = String(req.body.confirmarPassword || '');

    const error = usuariosMod.validarRegistro({ username, email, password, confirmarPassword });
    if (error) return res.status(400).json({ error });

    const cogido = await usuariosMod.enUso(
      usuariosMod.normalizarIdentidad(username), usuariosMod.normalizarIdentidad(email));

    if (cogido.username || cogido.email) {
      const campos = [];
      if (cogido.username) campos.push('nombre de usuario');
      if (cogido.email) campos.push('correo electrónico');
      return res.status(409).json({
        error: `Ya existe una cuenta con ese ${campos.join(' y ese ')}. Debes cambiar ${campos.join(' y ')}.`,
        usernameEnUso: cogido.username,
        emailEnUso: cogido.email
      });
    }

    let usuario;
    try {
      usuario = await usuariosMod.crear({ username, email, password });
    } catch (e) {
      if (e.duplicado) return res.status(409).json({ error: e.message });
      throw e;
    }

    /*
     * Se regenera la sesión igual que en el login: si alguien consiguió fijar
     * un identificador de sesión antes del registro, aquí deja de servirle.
     */
    req.session.regenerate(errorSesion => {
      if (errorSesion) {
        return res.status(500).json({
          error: 'La cuenta se creó, pero no se pudo iniciar la sesión. Inicia sesión manualmente.'
        });
      }
      req.session.usuarioId = usuario.id;
      res.status(201).json({ success: true, usuario: usuariosMod.publico(usuario) });
    });
  });

  async function iniciarSesion(req, res) {
    const identificador = req.body.identificador || req.body.username || req.body.email;
    const password = String(req.body.password || '');

    if (!identificador || !password) {
      return res.status(400).json({ error: 'Usuario/correo y contraseña son obligatorios.' });
    }

    const usuario = await usuariosMod.autenticar(identificador, password);
    // Un solo mensaje para las tres formas de fallar: no existe, inactiva, o
    // la contraseña no es. Distinguirlas diría qué cuentas existen.
    if (!usuario) return res.status(401).json({ error: 'Usuario, correo o contraseña incorrectos.' });

    req.session.regenerate(error => {
      if (error) return res.status(500).json({ error: 'No se pudo iniciar la sesión.' });
      req.session.usuarioId = usuario.id;
      res.json({ success: true, usuario: usuariosMod.publico(usuario) });
    });
  }

  app.post('/api/auth/login', limiteLogin, (req, res, next) => iniciarSesion(req, res).catch(next));
  app.post('/login', limiteLogin, (req, res, next) => iniciarSesion(req, res).catch(next));

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get('/check-auth', (req, res) => {
    res.json({
      authenticated: Boolean(req.session.usuarioId),
      quinielaActivaId: req.session.quinielaActivaId || null
    });
  });

  app.get('/api/auth/me', requireLogin, async (req, res) => {
    const usuario = await usuariosMod.porId(req.session.usuarioId);
    if (!usuario) return res.status(401).json({ error: 'La cuenta ya no existe.' });
    res.json({
      usuario: usuariosMod.publico(usuario),
      quinielaActivaId: req.session.quinielaActivaId || null
    });
  });

  /*
   * ⚠️ ORDEN. Estas rutas van ANTES del middleware de quiniela activa porque
   * son las que sirven para elegirla: exigir una quiniela seleccionada para
   * poder seleccionar quiniela dejaría a una cuenta nueva sin forma de entrar.
   */
  const ctx = {
    requireLogin, requireAdmin, enQuiniela,
    limiteLogin, limiteRegistro, limiteAdminMode
  };

  require('./rutas/plataforma').sinQuiniela(app, ctx);

  /* ---------- Las páginas de administración ---------- */

  const PAGINAS_ADMIN = [
    '/jugadores.html', '/jornadas.html', '/resultados.html',
    '/agregar-resultados-oficiales.html', '/generar_reporte.html',
    '/enviarresultados.html', '/copiarresultadojugador.html', '/admin_trivias.html',
    '/enviarresultadostrivias.html', '/enviarresultadospartido.html',
    '/enviarresultadostriviaspartido.html', '/miembros.html',
    '/configuracion-quiniela.html'
  ];

  /*
   * Antes esta guardia sólo comprobaba que hubiera sesión, así que cualquier
   * usuario podía descargar el HTML administrativo. No era fuga de datos —las
   * APIs sí exigen `requireAdmin`— pero sí de superficie, y una mala
   * experiencia: la página cargaba y luego fallaba petición por petición.
   */
  app.use(async (req, res, next) => {
    if (!PAGINAS_ADMIN.includes(req.path)) return next();
    if (!req.session?.usuarioId) return res.redirect('/login.html');
    if (!req.session?.quinielaActivaId) return res.redirect('/quinielas.html');

    const membresia = await membresiasMod.de(req.session.quinielaActivaId, req.session.usuarioId);
    if (!membresia || !['propietario', 'admin'].includes(membresia.rol)) {
      return res.redirect('/index.html');
    }
    return next();
  });

  /* ---------- La quiniela activa ---------- */

  /*
   * ⚠️ Aquí NO se abre transacción. Ver la cabecera del módulo: sólo se deja
   * resuelto en `req` a qué quiniela pertenece esta petición, y cada ruta abre
   * la suya alrededor de su propio cuerpo.
   */
  app.use(async (req, res, next) => {
    if (!req.session?.usuarioId || !req.session?.quinielaActivaId) return next();

    const [membresia, quiniela] = await Promise.all([
      membresiasMod.de(req.session.quinielaActivaId, req.session.usuarioId),
      quinielasMod.porId(req.session.quinielaActivaId)
    ]);

    if (!membresia || !quiniela || quiniela.estado === 'eliminada') {
      delete req.session.quinielaActivaId;
      return next();
    }

    req.membresia = membresia;
    req.quiniela = quiniela;
    req.puntuacion = quiniela.configuracion?.puntuacion || quinielasMod.PUNTUACION_POR_DEFECTO;
    return next();
  });

  /*
   * Todo lo que cuelgue de /api exige sesión y quiniela seleccionada. Las
   * excepciones —registro, login, lo de elegir quiniela— se declaran arriba y
   * por eso pasan antes de llegar aquí.
   */
  app.use('/api', (req, res, next) => {
    if (!req.session?.usuarioId) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    if (!req.quiniela || !req.membresia) {
      return res.status(409).json({ error: 'Debes seleccionar una quiniela activa.' });
    }

    /*
     * Una quiniela archivada es de sólo lectura, con dos excepciones: volver a
     * activarla y eliminarla. Sin ellas quedaría archivada para siempre.
     */
    if (req.quiniela.estado === 'archivada' && !['GET', 'HEAD'].includes(req.method)) {
      /*
       * ⚠️ `originalUrl`, no `req.path`. Dentro de un `app.use('/api', …)` el
       * `path` viene relativo al punto de montaje —`/quiniela-actual/archivar`—
       * así que compararlo con la ruta completa no casa nunca y la quiniela se
       * quedaba archivada para siempre. Lo cazó una prueba.
       */
      const permitidas = ['/api/quiniela-actual/archivar', '/api/quiniela-actual'];
      if (!permitidas.includes(req.originalUrl.split('?')[0])) {
        return res.status(409).json({ error: 'La quiniela está archivada: no admite cambios.' });
      }
    }
    return next();
  });

  /* ---------- Las rutas de dentro de una quiniela ---------- */

  require('./rutas/plataforma').conQuiniela(app, ctx);
  require('./rutas/dominio')(app, ctx);

  /* ---------- Archivos ---------- */

  app.use(express.static(path.join(RAIZ, 'public')));

  const servirDe = carpeta => (req, res) => {
    /*
     * `path.basename` es lo que impide que `..%2f..%2f.env` salga de la carpeta.
     * Sin él, esto sería un salto de directorio de manual.
     */
    const archivo = path.basename(req.params.filename);
    const ruta = path.join(RAIZ, 'private', carpeta, archivo);
    if (fs.existsSync(ruta)) return res.sendFile(ruta);
    res.status(404).send('Archivo no encontrado');
  };

  app.get('/js/:filename', servirDe('js'));
  app.get('/css/:filename', servirDe('css'));

  /*
   * Rutas bonitas: `/jornada` sirve `jornada.html`. Van al final porque son las
   * más generales y taparían a cualquier ruta declarada después.
   */
  const PAGINAS = [
    '/', '/jugadores', '/jornada', '/ver-jugadores', '/resultados', '/ver-resultados',
    '/ver-jornadas', '/adminmode.html', '/ver_resultados_totales_de_jugadores',
    '/agregar-resultados-oficiales', '/generar_reporte', '/llenar_jornada',
    '/resultados-totales', '/ver-resultados-oficiales', '/verResultados',
    '/verResultados_puntos', '/ver_resultados_trivias'
  ];

  for (const ruta of PAGINAS) {
    app.get(ruta, (req, res) => {
      let archivo = ruta === '/' ? 'index.html' : ruta.replace('/', '');
      if (!archivo.endsWith('.html')) archivo += '.html';
      res.sendFile(path.join(RAIZ, 'public', archivo));
    });
  }

  /* ---------- El manejador de errores, siempre el último ---------- */

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    /*
     * 23505 es el choque contra un índice único. Los módulos de `src/` traducen
     * los suyos con un mensaje propio; éste es la red por si alguno se escapa.
     */
    if (error?.code === '23505') {
      console.warn('Conflicto de clave única:', error.detail || error.message);
      return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
    }

    /*
     * Los errores de los validadores de dominio llevan su propio mensaje y sí
     * se devuelve: es información que el administrador necesita para corregir
     * el dato, no detalle interno del servidor.
     */
    if (error?.esValidacion) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    /*
     * body-parser y otros marcan los errores del cliente con su propio 4xx.
     * Antes se ignoraba y todo acababa en 500: un JSON mal formado se
     * reportaba como fallo del servidor, lo que ensucia los registros y
     * despista al diagnosticar.
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

  return {
    app,
    requireLogin, requireAdmin, enQuiniela,
    limitadores: { limiteLogin, limiteRegistro, limiteAdminMode }
  };
}

module.exports = { crearApp, requireLogin, requireAdmin, enQuiniela };

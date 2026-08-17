'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-legacy.js'), 'utf8');

test('el servidor solo acepta la URI multi-quiniela', () => {
  assert.match(server, /process\.env\.MONGO_URI_MULTIQUINIELA/);
  assert.doesNotMatch(server, /mongoose\.connect\(process\.env\.MONGO_URI\)/);
  assert.match(server, /Por seguridad no se utilizará MONGO_URI/);
});

test('los modelos deportivos reciben aislamiento por quiniela', () => {
  for (const schema of [
    'JugadorSchema', 'JornadaSchema', 'ResultadoSchema', 'ResultadoOficialSchema',
    'triviaSchema', 'respuestaTriviaSchema', 'EquipoSchema',
    'PronosticoCampeonSchema', 'CampeonOficialSchema'
  ]) {
    assert.match(server, new RegExp(`\\b${schema}\\b`));
  }
  assert.match(server, /\.forEach\(tenantPlugin\)/);
  assert.match(server, /this\.where\(\{ quinielaId: store\.quinielaId \}\)/);
});

test('existen las rutas principales de cuenta y membresía', () => {
  for (const route of [
    '/api/auth/registro', '/api/auth/login', '/api/quinielas',
    '/api/quinielas/unirse', '/api/quiniela-actual/miembros',
    '/api/quiniela-actual/transferir-propiedad', '/api/quiniela-actual/configuracion'
  ]) assert.ok(server.includes(route), `Falta ${route}`);
});

test('el modo administrador exige rol y confirmación de contraseña', () => {
  assert.match(server, /app\.post\('\/api\/admin-mode\/activar'/);
  assert.match(server, /bcrypt\.compare\(password, usuario\.password\)/);
  assert.match(server, /requiereAdminMode: true/);
  assert.match(server, /acceso\.quinielaId === req\.quiniela\?\._id\.toString\(\)/);
});

test('las cabeceras de seguridad están activas y la CSP declara sus orígenes', () => {
  assert.match(server, /require\('helmet'\)/);
  assert.match(server, /app\.use\(helmet\(/);
  assert.match(server, /contentSecurityPolicy/);
  // Los dos únicos orígenes externos legítimos: jsPDF y los escudos de los equipos.
  assert.match(server, /https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(server, /https:\/\/apiv3\.apifootball\.com/);
  assert.match(server, /frameAncestors: \["'none'"\]/);
  // HSTS solo en producción: en local rompería el acceso por HTTP.
  assert.match(server, /hsts: esProduccion/);
  /*
   * El valor por defecto de helmet para script-src-attr es 'none', que deja
   * inertes los 63 manejadores onclick del frontend: la interfaz carga pero
   * no responde a los clics. Esta invariante evita que alguien lo revierta
   * creyendo que endurece la política.
   */
  assert.match(server, /scriptSrcAttr: \["'unsafe-inline'"\]/);
});

test('las rutas de autenticación tienen limitación de intentos', () => {
  assert.match(server, /require\('express-rate-limit'\)/);
  assert.match(server, /app\.post\('\/api\/auth\/registro', limiteRegistro/);
  assert.match(server, /app\.post\('\/api\/auth\/login', limiteLogin/);
  assert.match(server, /app\.post\('\/login', limiteLogin/);
  assert.match(server, /app\.post\('\/api\/admin-mode\/activar', limiteAdminMode/);
  // En login y admin mode solo cuentan los intentos fallidos.
  assert.match(server, /skipSuccessfulRequests: true/);
});

test('el registro regenera la sesión igual que el login', () => {
  const registro = server.slice(
    server.indexOf("app.post('/api/auth/registro'"),
    server.indexOf('async function iniciarSesion')
  );
  assert.ok(registro.length > 0, 'No se localizó el bloque de registro');
  assert.match(registro, /req\.session\.regenerate\(/);
});

test('las trivias tienen los índices que evitan puntos duplicados', () => {
  assert.match(
    server,
    /respuestaTriviaSchema\.index\(\{ quinielaId: 1, jugador: 1, triviaId: 1 \}, \{ unique: true \}\)/
  );
  assert.match(
    server,
    /triviaSchema\.index\(\{ quinielaId: 1, jornadaNombre: 1, partidoIndex: 1, tipo: 1 \}\)/
  );
});

test('los endpoints de depuración dependen de una bandera de entorno', () => {
  assert.match(server, /DEBUG_ENDPOINTS === 'true'/);
  assert.match(server, /function requireDebug/);
  // Responden 404, no 403: no revelan que la ruta exista.
  assert.match(server, /if \(!DEPURACION_HABILITADA\) return res\.status\(404\)/);
  const rutasDebug = server.match(/app\.get\('\/(?:api\/)?(?:admin\/)?debug[^']*'/g) || [];
  assert.ok(rutasDebug.length >= 5, `Se esperaban al menos 5 rutas de depuración, hay ${rutasDebug.length}`);
  for (const ruta of rutasDebug) {
    const linea = server.slice(server.indexOf(ruta));
    assert.match(
      linea.slice(0, 200),
      /requireDebug/,
      `La ruta ${ruta} no está protegida por requireDebug`
    );
  }
});

test('la conexión a MongoDB reintenta en vez de matar el proceso', () => {
  assert.match(server, /async function conectarMongoConReintentos/);
  assert.match(server, /function diagnosticarErrorMongo/);
  // Retroceso exponencial con techo.
  assert.match(server, /Math\.min\(2 \*\* \(intento - 1\) \* 1000, MONGO_ESPERA_MAXIMA_MS\)/);
  // El único exit(1) que queda es el de la URI ausente, que sí es irrecuperable.
  const salidas = server.match(/process\.exit\(1\)/g) || [];
  assert.equal(salidas.length, 1, `Se esperaba un solo process.exit(1), hay ${salidas.length}`);
  assert.match(server, /Por seguridad no se utilizará MONGO_URI/);
});

test('existen las sondas de salud y no dependen de la sesión', () => {
  assert.match(server, /app\.get\('\/healthz'/);
  assert.match(server, /app\.get\('\/readyz'/);
  // Deben declararse antes del middleware de sesión, o se colgarían con la base caída.
  assert.ok(
    server.indexOf("app.get('/healthz'") < server.indexOf('app.use(session('),
    '/healthz debe declararse antes de express-session'
  );
  assert.ok(
    server.indexOf("app.get('/readyz'") < server.indexOf('app.use(session('),
    '/readyz debe declararse antes de express-session'
  );
  // El servidor escucha sin esperar a la base.
  assert.doesNotMatch(server, /mongoConnectionPromise\s*\.then\(\(\) => \{\s*app\.listen/);
});

test('la migración es simulación por defecto y separa origen de destino', () => {
  assert.match(migrator, /process\.argv\.includes\('--execute'\)/);
  assert.match(migrator, /MONGO_URI_LEGACY_READONLY/);
  assert.match(migrator, /LEGACY_DB_NAME y TARGET_DB_NAME deben ser diferentes/);
  assert.match(migrator, /No se escribió ningún documento/);
});

test('todas las referencias locales JS y CSS de HTML existen', () => {
  const pages = fs.readdirSync(path.join(root, 'public')).filter(file => file.endsWith('.html'));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)) {
      const url = match[1];
      if (/^https?:/.test(url)) continue;
      const relative = url.replace(/^\//, '');
      const file = relative.startsWith('js/') || relative.startsWith('css/')
        ? path.join(root, 'private', relative)
        : path.join(root, 'public', relative);
      assert.ok(fs.existsSync(file), `${page} referencia un archivo ausente: ${url}`);
    }
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-legacy.js'), 'utf8');

/*
 * Versión sin comentarios, para las comprobaciones de tipo "esto ya no está en
 * el código". Los comentarios explican a menudo qué había antes y por qué se
 * cambió —"antes era info.includes('var')"—, y esas menciones hacían fallar a
 * las pruebas contra su propia documentación.
 *
 * Solo se eliminan bloques /* *\/ y líneas que son íntegramente comentario, de
 * modo que nunca se descarta código real y las comprobaciones no se ablandan.
 */
const serverSinComentarios = server
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter(linea => !/^\s*(\/\/|\*)/.test(linea))
  .join('\n');

test('el servidor solo acepta la URI multi-quiniela', () => {
  assert.match(server, /process\.env\.MONGO_URI_MULTIQUINIELA/);
  assert.doesNotMatch(server, /mongoose\.connect\(process\.env\.MONGO_URI\)/);
  assert.match(server, /Por seguridad no se utilizará MONGO_URI/);
});

test('los modelos deportivos reciben aislamiento por quiniela', () => {
  for (const schema of [
    'JugadorSchema', 'JornadaSchema', 'ResultadoSchema', 'ResultadoOficialSchema',
    'triviaSchema', 'respuestaTriviaSchema', 'EquipoSchema', 'PuntosJornadaSchema'
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

test('la resolución de trivias no cruza entre quinielas', () => {
  /*
   * El barrido periódico corría sin contexto de inquilino, así que la consulta
   * de ResultadoOficial por nombre de jornada devolvía el documento de
   * cualquier quiniela. Como los nombres se repiten ("Jornada1"), la trivia de
   * una quiniela se resolvía con el partido de otra.
   */
  assert.match(server, /async function resolverTriviasDeTodasLasQuinielas/);
  assert.match(server, /tenantContext\.run\(\s*\{ quinielaId: quiniela\._id \}/);
  // El barrido solo recorre quinielas activas.
  assert.match(server, /Quiniela\.find\(\{ estado: 'activa' \}\)/);

  // La función por quiniela debe rechazar ser invocada sin contexto.
  assert.match(server, /resolverTriviasPendientes\(\) requiere contexto de quiniela/);

  // El setInterval debe llamar al barrido global, nunca a la función por quiniela.
  assert.match(
    serverSinComentarios,
    /setInterval\(\(\) => \{\s*resolverTriviasDeTodasLasQuinielas\(\)/
  );
});

test('no hay funciones ni rutas duplicadas que se pisen entre sí', () => {
  for (const [nombre, esperado] of [
    ['function partidoYaInicio', 1],
    ['function parseFechaPartidoCostaRica', 1],
    ["app.get('/generar_reporte'", 0],
    ["app.get('/api/football/leagues-test'", 0]
  ]) {
    const veces = serverSinComentarios.split(nombre).length - 1;
    assert.equal(veces, esperado, `Se esperaban ${esperado} apariciones de "${nombre}", hay ${veces}`);
  }
  // La versión ingenua, que ignoraba la zona horaria de Costa Rica, ya no existe.
  assert.doesNotMatch(serverSinComentarios, /function parseFechaPartido\(/);
});

test('los goles anulados por VAR se detectan por palabra completa', () => {
  /*
   * info.includes('var') anulaba los goles de Varela, Varane, Álvarez o
   * Navarro: gol legítimo, jugador sin sus puntos, y ningún error visible.
   */
  assert.doesNotMatch(serverSinComentarios, /info\.includes\('var'\)/);
  assert.match(serverSinComentarios, /\/\\bvar\\b\/\.test\(info\)/);
});

test('el sincronizador no se dispara desde el tráfico de los usuarios', () => {
  // El middleware por petición y su estado en variables de módulo ya no están.
  assert.doesNotMatch(serverSinComentarios, /CINCO_MINUTOS/);
  assert.doesNotMatch(serverSinComentarios, /INTERVALO_MINIMO_ENTRE_SYNCS_MS/);
  assert.doesNotMatch(serverSinComentarios, /syncEnProceso/);
  assert.doesNotMatch(serverSinComentarios, /sincronizarTodasLasJornadasDesdeApi/);

  // Ahora el ritmo lo marca un planificador propio.
  assert.match(serverSinComentarios, /const INTERVALO_CICLO_SYNC_MS/);
  assert.match(serverSinComentarios, /setInterval\(\(\) => \{\s*tickDeSincronizacion\(\);/);
});

test('el sincronizador no se autollama por HTTP ni conserva la puerta interna', () => {
  /*
   * La autollamada obligaba a existir un token que concedía permisos de
   * administrador sin sesión. Al pasar a llamada de función directa, la puerta
   * dejó de hacer falta, y una puerta que no hace falta no debe seguir abierta.
   */
  assert.doesNotMatch(serverSinComentarios, /INTERNAL_SYNC_TOKEN/);
  assert.doesNotMatch(serverSinComentarios, /x-internal-sync-token/);
  assert.doesNotMatch(serverSinComentarios, /membership\?\.internal/);
  assert.doesNotMatch(serverSinComentarios, /axios\.post\(\s*`http:\/\/localhost/);

  // La ruta manual y el planificador comparten la misma función de dominio.
  assert.match(serverSinComentarios, /async function sincronizarJornadaDesdeApi/);
  assert.match(serverSinComentarios, /await sincronizarJornadaDesdeApi\(item\.jornada\)/);
});

test('la caché de partidos y el cerrojo son globales, sin quinielaId', () => {
  assert.match(server, /const FixtureSchema/);
  assert.match(server, /const JobLockSchema/);

  /*
   * Si alguien los pasara por tenantPlugin dejarían de compartirse entre
   * quinielas y volvería C-01 por la puerta de atrás: cada quiniela tendría su
   * propia caché y consultaría el mismo partido por separado.
   */
  // Solo la lista de identificadores, no cualquier corchete que haya antes.
  const listaConAislamiento = serverSinComentarios.match(
    /\[\s*((?:[A-Za-z_$][\w$]*\s*,\s*)*[A-Za-z_$][\w$]*)\s*,?\s*\]\.forEach\(tenantPlugin\)/
  );
  assert.ok(listaConAislamiento, 'no se encontró la lista de esquemas con aislamiento');
  assert.doesNotMatch(listaConAislamiento[1], /FixtureSchema|JobLockSchema/);
});

test('cada partido tiene ventana de consulta según su estado real', () => {
  assert.match(serverSinComentarios, /function calcularProximaConsulta/);
  // Terminado es terminado: no se vuelve a gastar una llamada en él.
  assert.match(serverSinComentarios, /if \(estado === 'TC'\) return null;/);
  assert.match(serverSinComentarios, /enVivo: 60 \* 1000/);
  assert.match(serverSinComentarios, /inminente: 15 \* 60 \* 1000/);
  assert.match(serverSinComentarios, /lejano: 6 \* 60 \* 60 \* 1000/);
});

test('el cerrojo de sincronización caduca solo', () => {
  /*
   * Sin caducidad, una instancia que muere a mitad de ciclo deja el cerrojo
   * tomado para siempre y la sincronización no vuelve a correr nunca.
   */
  assert.match(serverSinComentarios, /const TTL_CERROJO_SYNC_MS/);
  assert.match(serverSinComentarios, /expiraEn: \{ \$lte: ahora \}/);
  assert.match(serverSinComentarios, /if \(error\?\.code === 11000\) return false;/);
});

test('una jornada terminada congela sus puntos con su propia configuración', () => {
  assert.match(server, /const PuntosJornadaSchema/);
  assert.match(serverSinComentarios, /function jornadaEstaFinalizada/);

  // Qué cuenta como terminado, que es la regla que decide si se congela.
  assert.match(
    serverSinComentarios,
    /oficial\.bloqueadoFinal === true \|\| oficial\.estado === 'TC'/
  );

  /*
   * Lo que impide que corregir un marcador equivocado arrastre todos los
   * cambios de puntuación ocurridos desde que la jornada cerró: al recalcular
   * se usa la configuración guardada, y solo se cae a la actual si la jornada
   * no estaba congelada todavía.
   */
  assert.match(
    serverSinComentarios,
    /const puntuacion = existente\?\.puntuacion \|\| puntuacionActual;/
  );

  // La tabla ya no recalcula el histórico: lo lee.
  assert.match(serverSinComentarios, /jornadasCongeladas\.has\(jornada\.nombre\)/);
});

test('toda escritura de resultados oficiales actualiza los puntos', () => {
  /*
   * Tripwire deliberado. Si alguien añade una ruta que escribe
   * `ResultadoOficial` y olvida actualizar los puntos, una jornada congelada se
   * quedaría enseñando el número viejo para siempre, sin que nada falle a la
   * vista. Esta prueba no puede comprobar la correspondencia una a una, así que
   * cuenta: al cambiar el número, hay que mirar el sitio nuevo y decidir.
   */
  const escrituras = serverSinComentarios.match(
    /ResultadoOficial\.(findOneAndUpdate|deleteMany|updateOne|updateMany)\(/g
  ) || [];

  assert.equal(escrituras.length, 3,
    'Cambió el número de sitios que escriben resultados oficiales (eran 3: sync, ' +
    'carga manual y borrado de jornada). Comprueba que el nuevo llame a ' +
    'actualizarPuntosDeJornada o borre PuntosJornada.');

  const actualizaciones = serverSinComentarios.match(/await actualizarPuntosDeJornada\(/g) || [];
  assert.ok(actualizaciones.length >= 3,
    'Faltan llamadas a actualizarPuntosDeJornada tras las escrituras');

  // Desde la Entrada 022 el borrado lleva sesión: la ruta entera es atómica.
  assert.match(
    serverSinComentarios,
    /await PuntosJornada\.deleteMany\(\{ jornada: nombreJornada \}, \{ session: sesion \}\)/
  );
});

test('toda edición de una jornada invalida o recalcula sus puntos materializados', () => {
  /*
   * La puntuación depende de la composición y el orden de `partidos`. Una
   * jornada congelada no puede conservar su número viejo si se importa de nuevo,
   * se añade/elimina un partido o se cambia el comodín.
   */
  const escrituras = serverSinComentarios.match(
    /\bJornada\.(findOneAndUpdate|findOneAndDelete)\(/g
  ) || [];

  assert.equal(escrituras.length, 3,
    'Cambió el número de escrituras directas de Jornada; comprueba su invalidación');

  const edicionesPorDocumento = serverSinComentarios.match(/await doc\.save\(\);/g) || [];
  assert.equal(edicionesPorDocumento.length, 3,
    'Cambió el número de ediciones de Jornada por documento; comprueba su invalidación');

  const actualizaciones = serverSinComentarios.match(/await actualizarPuntosDeJornada\(/g) || [];
  assert.ok(actualizaciones.length >= 8,
    'Cada edición de Jornada y Resultado debe actualizar PuntosJornada');

  /*
   * Antes se exigía que el borrado y la invalidación fueran líneas contiguas.
   * Desde la Entrada 022 el borrado ocurre DENTRO de la transacción y la
   * invalidación después de confirmarla —invalidar antes sería mentir si la
   * transacción se revierte—, así que se comprueba la intención, que la ruta
   * haga ambas cosas, y no su adyacencia.
   */
  const rutaBorrado = serverSinComentarios.slice(
    serverSinComentarios.indexOf("app.delete('/api/jornadas/:nombre'"),
    serverSinComentarios.indexOf('/* ================= Puntos por jornada')
  );

  assert.ok(rutaBorrado.length > 0, 'No se localizó la ruta de borrado de jornada');
  assert.match(rutaBorrado, /await PuntosJornada\.deleteMany\(/);
  assert.match(rutaBorrado, /invalidarCacheRanking\(req\.quiniela\._id\)/);
});

test('el ranking tiene caché por quiniela y paginación opcional compatible', () => {
  assert.match(serverSinComentarios, /const cacheRanking = new Map\(\)/);
  assert.match(serverSinComentarios, /function invalidarCacheRanking/);
  assert.match(serverSinComentarios, /function responderRanking/);
  assert.match(serverSinComentarios, /req\.query\.pagina !== undefined \|\| req\.query\.limite !== undefined/);
  assert.match(serverSinComentarios, /Math\.min\(100, Math\.max\(1,/);
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

test('el proveedor externo tiene un plazo máximo de espera', () => {
  /*
   * El valor por defecto de axios es 0, que significa esperar para siempre. Una
   * petición colgada dejaba sin resolver la promesa del ciclo, y como
   * `cicloEnCurso` solo se libera en su `finally`, el auto-sync del proceso se
   * apagaba en silencio hasta el siguiente reinicio.
   */
  assert.match(serverSinComentarios, /const TIMEOUT_APIFOOTBALL_MS = Number\(process\.env\.APIFOOTBALL_TIMEOUT_MS/);
  assert.match(
    serverSinComentarios,
    /axios\.create\(\{\s*baseURL: 'https:\/\/apiv3\.apifootball\.com\/',\s*timeout: TIMEOUT_APIFOOTBALL_MS\s*\}\)/
  );
});

test('un ciclo de sincronización que no termina no bloquea al planificador', () => {
  // El vigilante libera `cicloEnCurso` aunque el ciclo no llegue a resolverse.
  assert.match(serverSinComentarios, /const TIMEOUT_CICLO_SYNC_MS = Number\(process\.env\.SYNC_TIMEOUT_CICLO_MS/);
  assert.match(serverSinComentarios, /await conVigilante\(\s*ejecutarCicloDeSincronizacion\(\)/);
  assert.match(serverSinComentarios, /metricasSync\.ciclosAbandonadosPorTiempo \+= 1/);

  /*
   * El cerrojo se suelta por el testigo del ciclo, no por el del proceso. Con
   * el del proceso, un ciclo abandonado que terminara tarde soltaría el
   * cerrojo del ciclo siguiente y dejaría dos sincronizando a la vez.
   */
  assert.match(serverSinComentarios, /async function soltarCerrojo\(nombre, titular = ID_INSTANCIA\)/);
  assert.match(serverSinComentarios, /\{ nombre, instancia: titular \}/);
  assert.match(serverSinComentarios, /await soltarCerrojo\(CERROJO_SYNC, titular\)/);
});

test('la clasificación por jornada no lee la temporada entera para elegir una', () => {
  // Los partidos de todas las jornadas no hacen falta para llenar un desplegable.
  assert.match(
    serverSinComentarios,
    /const jornadas = await Jornada\.find\(\{\}\)\.select\('nombre'\)\.sort\(\{ createdAt: -1 \}\)/
  );

  // Y congelar dentro de un GET es una red de seguridad: no puede tumbar la consulta.
  assert.match(
    serverSinComentarios,
    /try \{\s*await actualizarPuntosDeJornada\(jornadaNombre, req\.quiniela\.configuracion\.puntuacion\);\s*\} catch/
  );
});

test('la portada pide solo el podio, no la tabla completa', () => {
  const portada = fs.readFileSync(path.join(root, 'private', 'js', 'index-ranking.js'), 'utf8');
  assert.match(portada, /\/api\/resultados-totales\?pagina=1&limite=3/);
  assert.doesNotMatch(portada, /fetch\('\/api\/resultados-totales'\)/);
});

test('las escrituras de dominio pasan por los validadores', () => {
  for (const validador of [
    'function normalizarMarcador', 'function normalizarNombreDeJornada',
    'function normalizarPartido',
    'function normalizarPartidos', 'function normalizarIndicesDePartido'
  ]) {
    assert.match(serverSinComentarios, new RegExp(validador.replace(/ /g, '\\s+')));
  }

  /*
   * `Number()` a secas era el agujero: acepta '-3', '2.5' y '1e999', que no da
   * NaN sino Infinity. Ninguna ruta de marcadores debe volver a usarlo.
   */
  assert.doesNotMatch(serverSinComentarios, /Number\(nuevo\.marcador[12]\)/);
  assert.doesNotMatch(serverSinComentarios, /Marcador inválido en partido/);

  // Y las rutas que escriben jornadas normalizan antes de tocar la base.
  assert.match(serverSinComentarios, /const nombre = normalizarNombreDeJornada\(req\.body\?\.nombre\)/);
  assert.match(serverSinComentarios, /const partidos = normalizarPartidos\(req\.body\?\.partidos\)/);
  assert.match(serverSinComentarios, /normalizarIndicesDePartido\(req\.body\?\.indices, doc\.partidos\.length\)/);
});

test('la privacidad de los pronósticos se decide partido a partido', () => {
  assert.match(serverSinComentarios, /function partidosDestapados/);
  assert.match(serverSinComentarios, /function taparPronosticosNoDestapados/);

  /*
   * La jornada ya no tiene fecha de cierre: el cierre es de cada partido.
   */
  assert.doesNotMatch(serverSinComentarios, /fechaCierre: \{ type: Date/);
  assert.doesNotMatch(serverSinComentarios, /normalizarFechaDeCierre/);
  assert.doesNotMatch(serverSinComentarios, /jornadaEstaCerradaParaPronosticos/);

  /*
   * Esta es la comprobación que faltaba y por la que /api/resultados-con-equipos
   * se quedó fuera del cambio anterior: llamaba `jornadaAcceso` a lo que las
   * demás llamaban `jornadaDoc`, así que buscar el patrón con un nombre de
   * variable concreto no lo encontró. Ahora se busca la FORMA del patrón, sea
   * cual sea el nombre de la variable.
   *
   * Las trivias quedan fuera a propósito: ellas SÍ conservan una fecha de
   * cierre propia, que es un campo distinto y una regla que no ha cambiado.
   */
  const tratanFaltaDeFechaComoCierre = serverSinComentarios
    .split('\n')
    .filter(linea => /!\s*\w+\??\.fechaCierre\s*\|\|\s*new Date\(/.test(linea))
    .filter(linea => !/trivia/i.test(linea));

  assert.deepEqual(
    tratanFaltaDeFechaComoCierre,
    [],
    'Queda una vía de jornada que trata "sin fecha de cierre" como cerrada'
  );

  /*
   * Y las cuatro vías que entregan pronósticos ajenos usan la misma función.
   * Si alguien añade una quinta y se le olvida, este número no cuadra.
   */
  const usos = serverSinComentarios.match(/partidosDestapados\(/g) || [];
  assert.ok(usos.length >= 5, `Se esperaban la definición y sus cuatro usos, hubo ${usos.length}`);
});

test('toda pantalla con campo de contraseña carga el ojo para mostrarla', () => {
  /*
   * El botón lo monta un script compartido, no el marcado de cada página. Esta
   * prueba es la que impide que una pantalla nueva con contraseña se quede sin
   * él: es justo el tipo de detalle que se olvida al añadir la décima pantalla.
   */
  const conPassword = fs.readdirSync(path.join(root, 'public'))
    .filter(archivo => archivo.endsWith('.html'))
    .filter(archivo => /type=["']password["']/.test(
      fs.readFileSync(path.join(root, 'public', archivo), 'utf8')
    ));

  assert.ok(conPassword.length >= 9, `Se esperaban al menos 9 pantallas, hubo ${conPassword.length}`);

  for (const archivo of conPassword) {
    const html = fs.readFileSync(path.join(root, 'public', archivo), 'utf8');
    assert.match(html, /password-visible\.js/, `${archivo} no carga password-visible.js`);
  }
});

test('el ojo no usa innerHTML ni manejadores en atributo', () => {
  const script = fs.readFileSync(path.join(root, 'private', 'js', 'password-visible.js'), 'utf8');

  /*
   * El icono se dibuja con createElementNS: no se añade deuda de S-04.
   *
   * Se busca la ASIGNACIÓN, no la palabra: el propio script explica en un
   * comentario por qué no usa innerHTML, y buscar la palabra suelta hacía
   * fallar a la prueba contra su propia documentación.
   */
  assert.doesNotMatch(script, /innerHTML\s*(=|\+=)/);
  assert.doesNotMatch(script, /insertAdjacentHTML/);
  assert.match(script, /createElementNS/);

  // Dentro de un <form>, un botón sin type explícito lo enviaría al pulsarlo.
  assert.match(script, /boton\.type = 'button'/);
});

test('el sincronizador no tira la caché del ranking por el minuto en vivo', () => {
  assert.match(serverSinComentarios, /const CAMPOS_QUE_MUEVEN_PUNTOS = \[/);
  assert.match(serverSinComentarios, /function puntosPuedenHaberCambiado/);

  /*
   * El minuto cambia en cada ciclo de un partido en vivo y no mueve la
   * puntuación de nadie. Si entrara en la lista, la caché se vaciaría cada
   * minuto durante los noventa del partido, que es el rato de más tráfico.
   */
  const lista = serverSinComentarios.match(/const CAMPOS_QUE_MUEVEN_PUNTOS = \[([^\]]*)\]/);
  assert.ok(lista, 'No se encontró la lista de campos');
  assert.doesNotMatch(lista[1], /'minuto'/);
  for (const campo of ['marcador1', 'marcador2', 'estado']) {
    assert.match(lista[1], new RegExp(`'${campo}'`), `Falta ${campo} en la lista`);
  }

  // Y el congelamiento tras el sync pasa por esa comprobación.
  assert.match(
    serverSinComentarios,
    /if \(puntosPuedenHaberCambiado\(resultadosExistentes, resultadosActualizados\)\)/
  );
  assert.match(serverSinComentarios, /metricasSync\.syncsSinCambioDePuntos \+= 1/);
});

/* ================================================================
 * S-04: construcción de HTML sin agujeros de inyección
 * ================================================================ */

const { plantillasDeRiesgo } = require('./plantillas.js');

/** Carga html-seguro.js en este proceso: el archivo se adapta a Node a propósito. */
function cargarAyudante() {
  const codigo = fs.readFileSync(path.join(root, 'private', 'js', 'html-seguro.js'), 'utf8');
  const ambito = {};
  new Function('window', codigo).call(ambito, ambito);
  return ambito;
}

test('escapar neutraliza el marcado y las comillas', () => {
  const { escapar } = cargarAyudante();

  assert.equal(escapar('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

  /*
   * Las comillas importan tanto como los ángulos: sin escaparlas, un valor
   * dentro de un atributo —title="${nombre}"— cierra el atributo y añade otro,
   * que es la mitad de los casos reales de inyección.
   */
  assert.equal(escapar('x" onmouseover="alert(1)'), 'x&quot; onmouseover=&quot;alert(1)');
  assert.equal(escapar("x' onfocus='alert(1)"), 'x&#39; onfocus=&#39;alert(1)');

  // Y el ampersand primero, o se escaparían dos veces los ya escapados.
  assert.equal(escapar('A&B'), 'A&amp;B');

  // Sin texto es cadena vacía, no las palabras "null" o "undefined".
  assert.equal(escapar(null), '');
  assert.equal(escapar(undefined), '');
  assert.equal(escapar(0), '0');
});

test('la plantilla html escapa los datos y deja pasar el marcado', () => {
  const { html, crudo } = cargarAyudante();
  const ataque = '<img src=x onerror=alert(1)>';

  assert.equal(
    String(html`<h3>${ataque}</h3>`),
    '<h3>&lt;img src=x onerror=alert(1)&gt;</h3>'
  );

  // Una plantilla dentro de otra no se escapa dos veces.
  assert.equal(String(html`<p>${html`<i>${'A&B'}</i>`}</p>`), '<p><i>A&amp;B</i></p>');

  // Un arreglo se une sin separador: es el caso de componer una lista.
  const filas = [html`<li>${'<b>'}</li>`, html`<li>${'&'}</li>`];
  assert.equal(String(html`<ul>${filas}</ul>`), '<ul><li>&lt;b&gt;</li><li>&amp;</li></ul>');

  // Y `crudo` es la única salida para meter HTML ya construido.
  assert.equal(String(html`<div>${crudo('<b>ok</b>')}</div>`), '<div><b>ok</b></div>');

  /*
   * Un objeto que traiga puesto el campo `texto` NO puede hacerse pasar por
   * HTML seguro: la marca es la clase, no una bandera que el servidor pueda
   * incluir en su respuesta.
   */
  assert.equal(
    String(html`<div>${{ texto: '<b>no</b>' }}</div>`),
    '<div>[object Object]</div>'
  );
});

test('S-04: ninguna plantilla que produzca HTML con datos queda sin etiquetar', () => {
  const dir = path.join(root, 'private', 'js');
  const sinEtiquetar = [];
  let total = 0;

  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    // El propio ayudante define la etiqueta; no puede usarse a sí mismo.
    if (archivo === 'html-seguro.js') continue;

    const codigo = fs.readFileSync(path.join(dir, archivo), 'utf8');

    for (const plantilla of plantillasDeRiesgo(codigo)) {
      total += 1;
      if (plantilla.etiqueta !== 'html') {
        const linea = codigo.slice(0, plantilla.inicio).split(/\r?\n/).length;
        sinEtiquetar.push(`${archivo}:${linea}`);
      }
    }
  }

  assert.ok(total >= 60, `Se esperaban al menos 60 plantillas de riesgo, se hallaron ${total}`);
  assert.deepEqual(
    sinEtiquetar,
    [],
    'Estas plantillas meten datos en HTML sin escaparlos: anteponles `html`'
  );
});

test('toda pantalla que use la etiqueta html carga el ayudante antes', () => {
  const dirJs = path.join(root, 'private', 'js');

  const usanEtiqueta = fs.readdirSync(dirJs)
    .filter(f => f.endsWith('.js') && f !== 'html-seguro.js')
    .filter(f => /\bhtml`/.test(fs.readFileSync(path.join(dirJs, f), 'utf8')));

  assert.ok(usanEtiqueta.length >= 18, `Se esperaban al menos 18 scripts, hay ${usanEtiqueta.length}`);

  for (const pagina of fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html'))) {
    const marcado = fs.readFileSync(path.join(root, 'public', pagina), 'utf8');
    const cargados = [...marcado.matchAll(/<script[^>]*src=["']\/?js\/([^"']+)["'][^>]*>/g)];

    const propios = cargados.filter(m => usanEtiqueta.includes(m[1]));
    if (!propios.length) continue;

    const ayudante = cargados.find(m => m[1] === 'html-seguro.js');
    assert.ok(ayudante, `${pagina} usa la etiqueta html pero no carga html-seguro.js`);

    /*
     * El orden no basta con mirarlo en el documento: un script con `defer` se
     * ejecuta DESPUÉS de todos los que no lo llevan. Si el ayudante fuera
     * diferido y el de la página no, `html` sería undefined al ejecutarse.
     */
    const ayudanteDiferido = /\bdefer\b/.test(ayudante[0]);

    for (const propio of propios) {
      const propioDiferido = /\bdefer\b/.test(propio[0]);
      assert.ok(
        !(ayudanteDiferido && !propioDiferido),
        `${pagina}: html-seguro.js está diferido y ${propio[1]} no, así que se ejecutaría después`
      );
      if (ayudanteDiferido === propioDiferido) {
        assert.ok(
          ayudante.index < propio.index,
          `${pagina}: html-seguro.js debe cargarse antes que ${propio[1]}`
        );
      }
    }
  }
});

test('las secuencias de varias escrituras son atómicas', () => {
  assert.match(serverSinComentarios, /async function enTransaccion/);
  assert.match(serverSinComentarios, /sesion\.withTransaction\(/);
  assert.match(serverSinComentarios, /function esFaltaDeSoporteDeTransacciones/);

  // Las cuatro secuencias que lo necesitan pasan por el ayudante.
  const usos = serverSinComentarios.match(/enTransaccion\(/g) || [];
  assert.ok(usos.length >= 5, `Se esperaban la definición y sus cuatro usos, hubo ${usos.length}`);

  /*
   * Una sesión no admite operaciones en paralelo, así que dentro de una
   * transacción no puede haber `Promise.all` de escrituras. La transferencia de
   * propiedad lo hacía y por eso se convirtió en secuencia.
   */
  assert.doesNotMatch(
    serverSinComentarios,
    /await Promise\.all\(\[destino\.save\(\)/,
    'La transferencia de propiedad no puede volver a guardar en paralelo'
  );

  /*
   * `Model.create` con sesión EXIGE un arreglo: con un documento suelto,
   * Mongoose toma el segundo argumento por otro documento y la sesión se pierde
   * sin avisar, de modo que esa escritura quedaría fuera de la transacción.
   */
  assert.match(serverSinComentarios, /Quiniela\.create\(\[\{/);
  assert.match(serverSinComentarios, /Membresia\.create\(\[\{/);
});

test('las pruebas de integración corren sobre un conjunto de réplicas', () => {
  /*
   * MongoDB solo admite transacciones sobre un conjunto de réplicas. Con un
   * mongod suelto, las pruebas de atomicidad se ejercitarían contra la rama de
   * respaldo de enTransaccion() y pasarían sin comprobar nada.
   */
  const integracion = fs.readFileSync(path.join(root, 'test', 'integracion.test.js'), 'utf8');
  assert.match(integracion, /MongoMemoryReplSet/);
  assert.doesNotMatch(integracion, /MongoMemoryServer\.create\(/);
});

test('componer HTML dentro de una plantilla no pierde la marca de crudo', () => {
  /*
   * El fallo que motiva esta prueba, encontrado por las pruebas de navegador:
   *
   *   html`<div>${lista.map(x => html`<p>${x}</p>`).join('')}</div>`
   *
   * `.join('')` convierte el arreglo de HtmlCrudo en una CADENA y con ello se
   * pierde la marca de "esto ya es HTML". La plantilla de fuera lo trata como
   * dato y lo escapa, así que el marcado sale COMO TEXTO en pantalla.
   *
   * No hace falta unir nada: `html` ya recorre los arreglos y los une sin
   * separador respetando la marca de cada elemento. El `.join('')` solo es
   * correcto cuando el resultado va directo a `innerHTML`, fuera de toda
   * plantilla.
   *
   * La prueba de S-04 no lo detectaba: comprueba que las plantillas van
   * etiquetadas, no que la composición conserve la marca.
   */
  const dir = path.join(root, 'private', 'js');
  const culpables = [];

  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    if (archivo === 'html-seguro.js') continue;

    const codigo = fs.readFileSync(path.join(dir, archivo), 'utf8');

    for (const plantilla of plantillasDeRiesgo(codigo)) {
      if (plantilla.etiqueta !== 'html') continue;
      if (!/=>\s*html`[\s\S]*?`\s*\)\s*\.join\(''\)/.test(plantilla.texto)) continue;

      culpables.push(`${archivo}:${codigo.slice(0, plantilla.inicio).split(/\r?\n/).length}`);
    }
  }

  assert.deepEqual(
    culpables,
    [],
    'Hay un .join(\'\') sobre plantillas etiquetadas DENTRO de otra plantilla: ' +
    'quítalo y deja que `html` una el arreglo, o el marcado saldrá como texto'
  );
});

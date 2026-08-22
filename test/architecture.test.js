'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/*
 * ============================================================================
 * DE DONDE SALE EL CODIGO QUE VIGILAN ESTOS GUARDIANES (paso 7.7)
 * ============================================================================
 *
 * Hasta el 21 de agosto todo vivia en `server.js` y este arnes lo leia entero.
 * Ese archivo ya no existe: la aplicacion son `arrancar.js`, `src/servidor.js`,
 * `src/rutas/` y los modulos de `src/`.
 *
 * Se conservan las dos vistas que ya habia, con el mismo criterio:
 *
 *   - `servidor`  donde viven las RUTAS y el armado de Express. Lo miran las
 *                 comprobaciones de USO: "esta ruta existe", "esta guardia se
 *                 aplica", "esto ya no se llama desde aqui".
 *   - `fuente`    todo el codigo. Lo miran las comprobaciones de DEFINICION:
 *                 "esta funcion existe una sola vez", "este valor se calcula
 *                 asi".
 *
 * Confundirlas cuesta un guardian roto por una mudanza en vez de por un
 * problema, y durante la migracion paso TRES veces: con `partidoYaInicio`, con
 * el del VAR y con el plazo de espera del proveedor.
 */

const leer = p => fs.readFileSync(path.join(root, p), 'utf8');

const listar = carpeta => fs.existsSync(path.join(root, carpeta))
  ? fs.readdirSync(path.join(root, carpeta))
      .filter(f => f.endsWith('.js'))
      .map(f => leer(path.join(carpeta, f)))
  : [];

const modulos = listar('src');
const rutas = listar(path.join('src', 'rutas'));

/* Las rutas y el armado de Express: lo que antes era la mitad de server.js. */
const server = [leer('arrancar.js'), leer(path.join('src', 'servidor.js')), ...rutas].join('\n');

const migrator = leer(path.join('scripts', 'migrate-legacy.js'));

const fuente = [server, ...modulos].join('\n');

/*
 * Version sin comentarios, para las comprobaciones de tipo "esto ya no esta en
 * el codigo". Los comentarios explican a menudo que habia antes y por que se
 * cambio, y esas menciones hacian fallar a las pruebas contra su propia
 * documentacion.
 *
 * Solo se eliminan bloques y lineas que son integramente comentario, de modo
 * que nunca se descarta codigo real y las comprobaciones no se ablandan.
 */
function quitarComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(linea => !/^\s*(\/\/|\*)/.test(linea))
    .join('\n');
}

const fuenteSinComentarios = quitarComentarios(fuente);
const serverSinComentarios = quitarComentarios(server);


test('la aplicacion exige DATABASE_URL y no arranca con un rol peligroso', () => {
  /*
   * Antes esto vigilaba que solo se aceptara la URI multi-quiniela de Mongo. El
   * riesgo equivalente hoy es otro y es peor: conectarse con el rol DUENO de
   * las tablas, que puede APAGAR RLS con un ALTER TABLE. Si eso pasara, el
   * aislamiento entre quinielas dejaria de existir sin que nada fallara.
   *
   * Por eso `comprobarRol()` no avisa: se planta. Un aviso al arrancar no lo
   * lee nadie.
   */
  assert.match(server, /process\.env\.DATABASE_URL/);
  assert.match(server, /db\.comprobarRol\(\)/);
  assert.match(server, /ARRANQUE ABORTADO/);
  assert.match(server, /process\.exit\(1\)/);

  // Y nada de Mongo debe quedar en pie.
  assert.doesNotMatch(fuenteSinComentarios, /require\('mongoose'\)/);
  assert.doesNotMatch(fuenteSinComentarios, /MONGO_URI/);
});

test('las tablas de dominio llevan RLS, y la base lo impone', () => {
  /*
   * El equivalente del `tenantPlugin` de Mongoose, pero aplicado por la base.
   * La diferencia que importa: el plugin enganchaba find*, update* y delete*,
   * pero NO aggregate, insertMany ni bulkWrite. Eso era M-33, y una consulta
   * escrita con cualquiera de los tres salia sin filtro y en silencio.
   *
   * Con RLS no hay hueco: la politica la aplica PostgreSQL a toda sentencia.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));

  const bloque = esquema.slice(esquema.indexOf('FOREACH t IN ARRAY ARRAY['), esquema.indexOf('END LOOP;'));
  assert.ok(bloque.length > 0, 'no se encontro el bloque que aplica RLS');

  for (const tabla of [
    'jugadores', 'jornadas', 'partidos', 'resultados', 'pronosticos',
    'resultados_oficiales', 'resultados_oficiales_partidos', 'trivias',
    'respuestas_trivia', 'equipos', 'puntos_jornada', 'puntos_jornada_jugador'
  ]) {
    assert.ok(bloque.includes(`'${tabla}'`), `${tabla} se quedo fuera del aislamiento`);
  }

  assert.match(bloque, /ENABLE ROW LEVEL SECURITY/);
  /*
   * FORCE ademas de ENABLE: sin el, el DUENO de la tabla se salta su propia
   * politica, y las migraciones y los arreglos a mano irian sin filtro.
   */
  assert.match(bloque, /FORCE ROW LEVEL SECURITY/);
  assert.match(bloque, /quiniela_id = quiniela_actual\(\)/);
  // WITH CHECK ademas de USING: sin el se podria INSERTAR en otra quiniela.
  assert.match(bloque, /WITH CHECK \(quiniela_id = quiniela_actual\(\)\)/);
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
  assert.match(server, /bcrypt\.compare\(password, fila\.password\)/);
  assert.match(server, /requiereAdminMode: true/);
  // Atado a UNA quiniela: arrastrarlo daria permisos en otra sin confirmar nada.
  assert.match(server, /acceso\.quinielaId === String\(req\.quiniela\?\.id\)/);
  assert.match(server, /delete req\.session\.adminMode/);
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
   * Hasta la Entrada 024 esto tenía que ser 'unsafe-inline': el frontend
   * llevaba los manejadores en atributo y con 'none' la interfaz cargaba pero
   * no respondía a los clics. Ya no: el marcado no contiene código.
   *
   * Cerrar la política es lo que convierte el escapado de S-04 en defensa en
   * profundidad; antes era la única línea, porque cualquier marcado que se
   * colara en el DOM podía ejecutarse.
   */
  assert.match(server, /scriptSrcAttr: \["'none'"\]/);
  assert.doesNotMatch(
    serverSinComentarios,
    /scriptSrc: \[[^\]]*'unsafe-inline'/,
    'script-src no puede volver a admitir código inline'
  );
});

test('el marcado no contiene código: ni manejadores en atributo ni <script> inline', () => {
  /*
   * Es el requisito de la CSP cerrada. Si alguien añade un `onclick="…"` la
   * política lo bloqueará en silencio —el botón cargará y no hará nada—, que es
   * el tipo de fallo más difícil de diagnosticar. Mejor que falle aquí.
   */
  const conManejador = [];
  const conScriptInline = [];

  for (const pagina of fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html'))) {
    const marcado = fs.readFileSync(path.join(root, 'public', pagina), 'utf8');

    if (/\son[a-z]+\s*=\s*["']/i.test(marcado)) conManejador.push(pagina);
    if (/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/.test(marcado)) conScriptInline.push(pagina);
  }

  assert.deepEqual(conManejador, [], 'Usa data-ir-a o addEventListener, no atributos on*');
  assert.deepEqual(conScriptInline, [], 'Saca el script a private/js/ y cárgalo con src');
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
  const esquema = leer(path.join('db', 'esquema.sql'));

  /*
   * S-10: sin el unico, dos envios simultaneos de la misma respuesta insertaban
   * los dos y al resolverse la trivia las dos filas cobraban.
   */
  assert.match(esquema, /UNIQUE \(quiniela_id, jugador_id, trivia_id\)/);

  // M-25: el indice de busqueda que en Mongo seguia pendiente.
  assert.match(esquema, /CREATE INDEX ON trivias \(quiniela_id, jornada_id, partido_id, tipo\)/);

  /*
   * Y el unico parcial que cierra la carrera de la reconciliacion: mirar si
   * existe y luego crearla dejaba hueco para dos preguntas identicas.
   */
  assert.match(esquema, /CREATE UNIQUE INDEX trivias_partido_tipo_activa/);
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

test('el servidor escucha sin esperar a la base', () => {
  /*
   * Antes moria si la base no respondia, con dos consecuencias malas: un
   * despliegue fallaba entero por una base momentaneamente indispuesta, y las
   * sondas de salud nunca llegaban a responder, que es justo cuando mas se
   * necesitan.
   *
   * Con Neon importa mas que con Atlas: el plan gratuito suspende el computo
   * por inactividad, asi que la primera conexion tras un rato tarda unos
   * segundos. No es un fallo, es el plan.
   */
  const arranque = leer('arrancar.js');

  assert.ok(
    arranque.indexOf('app.listen') < arranque.indexOf('db.comprobarRol'),
    'el puerto se abre antes de comprobar el rol'
  );

  // Y se cierra ordenadamente: Render manda SIGTERM antes de reemplazar.
  assert.match(arranque, /SIGTERM/);
  assert.match(arranque, /servidor\.close\(/);
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
   * El barrido corria sin contexto de inquilino, asi que la consulta por nombre
   * de jornada devolvia el documento de cualquier quiniela. Como los nombres se
   * repiten ("Jornada 1"), la trivia de una se resolvia con el partido de otra.
   */
  const planificador = leer(path.join('src', 'planificador.js'));

  assert.match(planificador, /async function resolverTriviasDeTodas/);
  // Quiniela por quiniela, cada una en su propio contexto.
  assert.match(planificador, /for \(const quiniela of quinielas\)/);
  assert.match(planificador, /trivias\.resolverPendientes\(quiniela\.id/);
  // Solo las activas: nadie va a puntuar en una archivada.
  assert.match(planificador, /WHERE estado = 'activa'/);
  // El fallo de una no interrumpe el barrido de las demas.
  assert.match(planificador, /catch \(error\)/);
});

test('no hay funciones ni rutas duplicadas que se pisen entre sí', () => {
  /*
   * Las definiciones se cuentan contra el conjunto: `parseFechaPartidoCostaRica`
   * y `extraerFechaApi` viven en src/fechas.js desde la Fase B, y buscarlas solo
   * en server.js daría cero. Lo que este guardián vigila no es dónde está cada
   * función, sino que haya UNA: la vez que hubo dos, la de arriba nunca llegaba
   * a ejecutarse por la elevación de declaraciones y engañaba al leer.
   */
  for (const [nombre, esperado] of [
    ['function partidoYaInicio', 1],
    ['function parseFechaPartidoCostaRica', 1],
    ['function extraerFechaApi', 1]
  ]) {
    const veces = fuenteSinComentarios.split(nombre).length - 1;
    assert.equal(veces, esperado, `Se esperaban ${esperado} apariciones de "${nombre}", hay ${veces}`);
  }

  // Las rutas retiradas se buscan en server.js, que es donde viven las rutas.
  for (const [nombre, esperado] of [
    ["app.get('/generar_reporte'", 0],
    ["app.get('/api/football/leagues-test'", 0]
  ]) {
    const veces = serverSinComentarios.split(nombre).length - 1;
    assert.equal(veces, esperado, `Se esperaban ${esperado} apariciones de "${nombre}", hay ${veces}`);
  }

  /*
   * Y ninguna de las dos puede reaparecer en server.js: reexportarlas está
   * bien, redefinirlas es volver a tener dos verdades.
   */
  assert.doesNotMatch(serverSinComentarios, /function parseFechaPartidoCostaRica\(/);
  assert.doesNotMatch(serverSinComentarios, /function extraerFechaApi\(/);

  // La versión ingenua, que ignoraba la zona horaria de Costa Rica, ya no existe.
  assert.doesNotMatch(fuenteSinComentarios, /function parseFechaPartido\(/);
});

test('los goles anulados por VAR se detectan por palabra completa', () => {
  /*
   * info.includes('var') anulaba los goles de Varela, Varane, Álvarez o
   * Navarro: gol legítimo, jugador sin sus puntos, y ningún error visible.
   */
  /*
   * Se mira el conjunto, no solo server.js: `esGolApiFootball` vive en
   * src/eventos.js desde la tajada 6, y buscarla aqui daria cero. Es la regla
   * de la cabecera de este archivo: las DEFINICIONES se buscan en `fuente`.
   */
  assert.doesNotMatch(fuenteSinComentarios, /info\.includes\('var'\)/);
  assert.match(fuenteSinComentarios, /\/\\bvar\\b\/\.test\(info\)/);
});

test('el sincronizador no se dispara desde el tráfico de los usuarios', () => {
  // El middleware por peticion y su estado en variables de modulo ya no estan.
  for (const muerto of [/CINCO_MINUTOS/, /INTERVALO_MINIMO_ENTRE_SYNCS_MS/, /syncEnProceso/, /sincronizarTodasLasJornadasDesdeApi/]) {
    assert.doesNotMatch(fuenteSinComentarios, muerto);
  }

  // Ahora el ritmo lo marca un planificador propio, con su reloj.
  const planificador = quitarComentarios(leer(path.join('src', 'planificador.js')));
  assert.match(planificador, /const INTERVALO_CICLO_SYNC_MS/);
  assert.match(planificador, /setInterval\(/);
  assert.match(planificador, /unCiclo\(\)/);
});

test('el sincronizador no se autollama por HTTP ni conserva la puerta interna', () => {
  /*
   * Habia un token interno que dejaba entrar como administrador a quien lo
   * presentara en una cabecera. Existia solo porque el sincronizador se llamaba
   * a si mismo por HTTP. Desde la Fase 4 invoca la funcion directamente, asi que
   * la puerta sobraba: un camino que concede permisos sin sesion es superficie
   * de ataque que no hace falta mantener.
   */
  for (const muerto of [/INTERNAL_SYNC_TOKEN/, /x-internal-token/i, /axios\.post\(/]) {
    assert.doesNotMatch(fuenteSinComentarios, muerto);
  }
});

test('la caché de partidos y el cerrojo son globales, sin quiniela_id', () => {
  /*
   * Son justo la parte que TODAS las quinielas comparten. Meterlas en el
   * aislamiento devolveria C-01 por la puerta de atras: cada quiniela con su
   * propia cache, consultando el mismo partido por separado.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));
  const bloque = esquema.slice(esquema.indexOf('FOREACH t IN ARRAY ARRAY['), esquema.indexOf('END LOOP;'));

  for (const tabla of ['fixtures', 'job_locks', 'usuarios', 'quinielas', 'membresias', 'sesiones']) {
    assert.ok(!bloque.includes(`'${tabla}'`), `${tabla} no deberia llevar RLS`);
  }

  // Y `fixtures` no lleva quiniela_id, que es lo que la hace compartida.
  const fixtures = esquema.slice(
    esquema.indexOf('CREATE TABLE fixtures ('),
    esquema.indexOf('CREATE TABLE job_locks')
  );
  assert.ok(fixtures.length > 0, 'no se encontro la tabla fixtures');
  assert.doesNotMatch(fixtures, /quiniela_id/);
});

test('cada partido tiene ventana de consulta según su estado real', () => {
  const mod = quitarComentarios(leer(path.join('src', 'fixtures.js')));

  assert.match(mod, /function calcularProximaConsulta/);
  // Terminado es terminado: no se vuelve a gastar una llamada en el.
  assert.match(mod, /if \(estado === 'TC'\) return null;/);
  assert.match(mod, /enVivo: 60 \* 1000/);
  assert.match(mod, /inminente: 15 \* 60 \* 1000/);
  assert.match(mod, /lejano: 6 \* 60 \* 60 \* 1000/);

  /*
   * Y el tope que no es obvio: la proxima consulta nunca se pospone mas alla
   * del pitido inicial. Un partido que empieza en tres horas cae en la ventana
   * "lejano" de seis, y sin esto se consultaria por primera vez tres horas
   * DESPUES de haber empezado.
   */
  assert.match(mod, /Math\.min\(proxima, inicio\.getTime\(\)\)/);
});

test('el cerrojo de sincronización caduca solo, y solo lo suelta su dueño', () => {
  /*
   * Sin caducidad, una instancia que muere a mitad de ciclo deja el cerrojo
   * tomado para siempre y la sincronizacion no vuelve a correr nunca.
   */
  const mod = quitarComentarios(leer(path.join('src', 'cerrojos.js')));

  assert.match(mod, /expira_en/);
  assert.match(mod, /WHERE job_locks\.expira_en <= \$3/);

  /*
   * Y al soltarlo se comprueba el titular. "Nuestro" es el testigo del CICLO,
   * no el del proceso: un ciclo abandonado que termina tarde no debe soltar el
   * cerrojo que ya tiene el ciclo siguiente del mismo proceso.
   */
  assert.match(mod, /WHERE nombre = \$1 AND instancia = \$2/);

  // En PostgreSQL esto es una sentencia, no un error que haya que interpretar.
  assert.doesNotMatch(fuenteSinComentarios, /code === 11000/);
});

test('una jornada terminada congela sus puntos con su propia configuración', () => {
  const motor = quitarComentarios(leer(path.join('src', 'puntuacion.js')));
  const ranking = quitarComentarios(leer(path.join('src', 'ranking.js')));

  assert.match(motor, /function jornadaEstaFinalizada/);

  // Que cuenta como terminado, que es la regla que decide si se congela.
  assert.match(motor, /oficial\.bloqueadoFinal === true \|\| oficial\.estado === 'TC'/);

  /*
   * M-03: si ya estaba congelada se recalcula con SU foto, no con la de hoy. De
   * lo contrario, corregir un marcador equivocado colaria de tapadillo todos los
   * cambios de puntuacion ocurridos desde que la jornada termino.
   */
  assert.match(ranking, /const puntuacion = existente\?\.puntuacion \|\| puntuacionActual;/);

  /*
   * Y la foto se SUSTITUYE, no se funde: es una fotografia, no un ajuste.
   * Fundirla dejaria sobrevivir una clave del congelado anterior.
   */
  assert.match(ranking, /puntuacion   = EXCLUDED\.puntuacion/);
  assert.doesNotMatch(ranking, /puntuacion = puntos_jornada\.puntuacion \|\|/);

  // La tabla ya no recalcula el historico: lo lee.
  assert.match(ranking, /congeladas\.get\(jornada\.id\)/);
});

test('toda escritura de resultados oficiales actualiza los puntos', () => {
  /*
   * Escribir un resultado oficial puede mover la clasificacion. Si alguna via
   * se olvidara de avisar, la tabla seguiria respondiendo con un numero viejo y
   * nada fallaria.
   *
   * Se cuentan los sitios que llaman a `oficiales.escribir` o a
   * `guardarManual`, y se exige que cada uno recalcule.
   */
  const escrituras = (fuenteSinComentarios.match(/oficialesMod\.escribir\(|oficiales\.guardarManual\(|oficialesMod\.guardarManual\(/g) || []).length;
  assert.ok(escrituras >= 2, `Esperaba al menos 2 vias de escritura, hay ${escrituras}`);

  const recalculos = (fuenteSinComentarios.match(/rankingMod\.actualizar\(|ranking\.actualizar\(/g) || []).length;
  assert.ok(recalculos >= 5,
    `Cada escritura que mueve puntos debe recalcular; solo hay ${recalculos} llamadas`);

  /*
   * Y borrar una jornada se lleva sus puntos congelados. Antes eran cuatro
   * borrados en una transaccion; ahora lo hace la clave ajena en cascada, que
   * no puede quedarse a medias.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));
  const puntos = esquema.slice(
    esquema.indexOf('CREATE TABLE puntos_jornada ('),
    esquema.indexOf('CREATE TABLE puntos_jornada_jugador')
  );
  assert.match(puntos, /REFERENCES jornadas\(id\) ON DELETE CASCADE/);
});

test('toda edición de una jornada invalida o recalcula sus puntos materializados', () => {
  /*
   * Guardar, agregar un partido, borrar partidos o cambiar un comodin pueden
   * cambiar la clasificacion. Olvidarlo en UNA sola de las cuatro no romperia
   * nada visible: la tabla seguiria respondiendo, con un numero viejo.
   */
  const dominio = quitarComentarios(leer(path.join('src', 'rutas', 'dominio.js')));

  for (const ruta of [
    "app.post('/api/jornadas'",
    "app.post('/api/jornadas/agregar-partido'",
    "app.post('/api/jornadas/eliminar-partidos'",
    "app.post('/api/jornadas/comodin'"
  ]) {
    assert.ok(dominio.includes(ruta), `Falta ${ruta}`);
  }

  const recalculos = (dominio.match(/rankingMod\.actualizar\(/g) || []).length;
  assert.equal(recalculos, 4,
    'Las cuatro escrituras de jornada deben recalcular sus puntos');

  /*
   * Y borrar la jornada entera se lleva pronosticos, resultados oficiales y
   * puntos congelados por clave ajena. A medias quedaban puntos de una jornada
   * que ya no existe, sumando al total sin columna a la que pertenecer.
   */
  assert.match(dominio, /app\.delete\('\/api\/jornadas\/:nombre'/);
});

test('el ranking tiene caché por quiniela y paginación opcional compatible', () => {
  const mod = quitarComentarios(leer(path.join('src', 'rutas', 'puntuacion.js')));

  assert.match(mod, /const cacheRanking = new Map\(\)/);
  assert.match(mod, /function invalidarCacheRanking/);
  assert.match(mod, /function responderRanking/);

  /*
   * Por QUINIELA. Una cache global seria C-02 otra vez, y esta vez en memoria,
   * donde RLS no llega: la base no puede salvarnos de un Map mal indexado.
   */
  assert.match(mod, /cacheRanking\.get\(String\(quinielaId\)\)/);
  assert.match(mod, /cacheRanking\.delete\(String\(quinielaId\)\)/);

  // Sin ?pagina ni ?limite responde el objeto de siempre.
  assert.match(mod, /req\.query\.pagina === undefined && req\.query\.limite === undefined/);
  assert.match(mod, /Math\.min\(100, Math\.max\(1,/);
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
  /*
   * Se mira el conjunto: el cliente vive en src/proveedor.js desde la tajada
   * 7.6. Es la regla de la cabecera de este archivo —las DEFINICIONES se buscan
   * en `fuente`— y es el tercer centinela que la aprende durante la migracion,
   * despues de partidoYaInicio y del VAR.
   */
  assert.match(fuenteSinComentarios, /const TIMEOUT_MS = Number\(process\.env\.APIFOOTBALL_TIMEOUT_MS/);
  assert.match(
    fuenteSinComentarios,
    /axios\.create\(\{\s*baseURL: 'https:\/\/apiv3\.apifootball\.com\/',\s*timeout: TIMEOUT_MS\s*\}\)/
  );

  // Y una sola puerta al exterior: dos clientes serian dos plazos de espera.
  assert.equal(fuenteSinComentarios.split('axios.create(').length - 1, 1);
});

test('un ciclo de sincronización que no termina no bloquea al planificador', () => {
  /*
   * El vigilante libera `cicloEnCurso` aunque el ciclo no llegue a resolverse.
   * Sin el, una peticion colgada al proveedor apagaba la sincronizacion del
   * proceso hasta el siguiente reinicio, y nadie veia un error.
   */
  const mod = quitarComentarios(leer(path.join('src', 'sincronizador.js')));

  assert.match(mod, /const TIMEOUT_CICLO_SYNC_MS = Number\(process\.env\.SYNC_TIMEOUT_CICLO_MS/);
  assert.match(mod, /conVigilante\(\s*ejecutarCiclo\(opciones\)/);
  assert.match(mod, /metricas\.ciclosAbandonadosPorTiempo \+= 1/);

  /*
   * Y el cerrojo se suelta con el testigo del CICLO, no con el del proceso: un
   * ciclo abandonado que termina tarde no debe soltar el cerrojo que ya tiene
   * el ciclo siguiente del mismo proceso.
   */
  assert.match(mod, /const titular = `\$\{cerrojos\.ID_INSTANCIA\}#\$\{\+\+contadorDeCiclos\}`/);
  assert.match(mod, /cerrojos\.soltar\(CERROJO_SYNC, titular\)/);

  // El `finally` es lo que garantiza que se suelte aunque el ciclo reviente.
  assert.match(mod, /\} finally \{\s*await cerrojos\.soltar/);
});

test('la clasificación por jornada no lee la temporada entera para elegir una', () => {
  /*
   * Antes se traia la temporada entera -cada jornada con todos sus partidos-
   * para dos cosas que no lo necesitan: llenar el desplegable y localizar una
   * jornada. Con cuarenta jornadas de diez partidos son cuatrocientos de mas en
   * cada carga de pantalla.
   */
  const jornadas = quitarComentarios(leer(path.join('src', 'jornadas.js')));
  const rutas = quitarComentarios(leer(path.join('src', 'rutas', 'puntuacion.js')));

  // `actual` trae SOLO los nombres.
  assert.match(jornadas, /SELECT nombre FROM jornadas ORDER BY secuencia DESC/);

  /*
   * Y ordena por `secuencia`, no por `id`. Un ObjectId llevaba la fecha dentro,
   * asi que `sort({_id:-1})` era "la ultima creada"; un uuid es aleatorio y
   * ordenar por el daria un orden arbitrario SIN FALLAR: seguiria devolviendo
   * una jornada, solo que la que no es.
   */
  assert.doesNotMatch(jornadas, /ORDER BY id DESC/);

  // La sugerida va delante del primer elemento.
  assert.match(rutas, /req\.query\.jornada \|\| sugerida \|\| jornadas\[0\]\.nombre/);

  // Y congelar dentro de un GET es una red de seguridad: no puede tumbar la consulta.
  const ranking = quitarComentarios(leer(path.join('src', 'ranking.js')));
  assert.match(ranking, /try \{\s*await congelar\(/);
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
    // Definiciones: viven en src/validacion.js desde la Fase 6.
    assert.match(fuente, new RegExp(validador.replace(/ /g, '\\s+')));
  }

  /*
   * `Number()` a secas no bastaba, y ahi estaba el agujero: acepta '-3', acepta
   * '2.5' y acepta '1e999', que no da NaN sino Infinity. Ninguno rompe nada
   * visible; los tres corrompen el motor de puntuacion en silencio.
   */
  assert.doesNotMatch(fuenteSinComentarios, /Number\(nuevo\.marcador[12]\)/);
  assert.doesNotMatch(fuenteSinComentarios, /Marcador inválido en partido/);

  // Y las rutas que escriben jornadas normalizan antes de tocar la base.
  const dominio = quitarComentarios(leer(path.join('src', 'rutas', 'dominio.js')));
  assert.match(dominio, /normalizarNombreDeJornada\(req\.body\?\.nombre\)/);
  assert.match(dominio, /normalizarPartidos\(req\.body\?\.partidos\)/);
  assert.match(dominio, /normalizarIndicesDePartido\(req\.body\?\.indices, jornada\.partidos\.length\)/);

  // Y los marcadores, vengan por donde vengan.
  assert.match(fuenteSinComentarios, /normalizarMarcador\(enviado\.marcador1/);
});

test('la privacidad de los pronósticos se decide partido a partido', () => {
  /*
   * Cuatro rutas entregan pronosticos ajenos y las cuatro aplican la MISMA
   * regla: de otro participante solo se ve lo de los partidos que ya empezaron.
   *
   * Es una regla compartida y no una expresion copiada en cada sitio, y eso
   * tiene una historia: /api/resultados-con-equipos se quedo fuera del repaso
   * de privacidad porque llamaba `jornadaAcceso` a lo que las otras llamaban
   * `jornadaDoc`, y la prueba que buscaba el patron viejo no la vio.
   *
   * Lo que se vigila NO es que las cuatro llamen a la misma funcion -dos
   * devuelven '' y dos null, asi que no pueden- sino que las cuatro decidan por
   * el mismo dato: el `bloqueado` que calcula `partidoYaInicio`.
   */
  const rutas = quitarComentarios(leer(path.join('src', 'rutas', 'puntuacion.js')));

  assert.match(rutas, /function taparAjenos/);

  /*
   * Cuatro rutas, TRES sitios donde se decide: `taparAjenos` sirve a dos de
   * ellas, y las otras dos lo hacen en linea porque devuelven '' en vez de null
   * -sus pantallas escriben el valor directo en una casilla-.
   *
   * Si aparece un cuarto sitio, o desaparece uno, alguien ha tocado la regla.
   */
  const decisiones = (rutas.match(/\.bloqueado\b/g) || []).length;
  assert.equal(decisiones, 3,
    `Cambio el numero de sitios que deciden la visibilidad (eran 3): hay ${decisiones}`);

  // Y las dos rutas que no pasan por `taparAjenos` siguen siendo esas dos.
  assert.match(rutas, /app\.get\('\/api\/resultados-con-equipos\/:jugador\/:jornada'/);
  assert.match(rutas, /app\.post\('\/api\/resultados-seguros\/:jugador\/:jornada'/);

  /*
   * Y el cierre lo calcula `partidoYaInicio`, que vive en UN solo sitio. Dos
   * copias de esa regla serian dos respuestas distintas a "puedo cambiar mi
   * pronostico?", y ya paso una vez.
   */
  assert.equal(
    (fuenteSinComentarios.match(/function partidoYaInicio/g) || []).length, 1,
    'partidoYaInicio debe existir una sola vez'
  );

  // Y nada de tratar "sin fecha de cierre" como cerrada: eso abrio una puerta.
  assert.doesNotMatch(fuenteSinComentarios, /jornadaSinFecha/);
  assert.doesNotMatch(fuenteSinComentarios, /jornadaEstaCerradaParaPronosticos/);
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
  /*
   * `minuto` cambia en cada ciclo de un partido en vivo y no mueve la
   * puntuacion de nadie. Incluirlo significaba invalidar la cache del ranking
   * cada minuto durante los noventa del partido: el rato de mas trafico de la
   * semana y el peor momento para recalcular la tabla entera.
   */
  const mod = quitarComentarios(leer(path.join('src', 'oficiales.js')));

  assert.match(mod, /const CAMPOS_QUE_MUEVEN_PUNTOS = \[/);
  assert.match(mod, /function puntosPuedenHaberCambiado/);

  const lista = mod.match(/const CAMPOS_QUE_MUEVEN_PUNTOS = \[([^\]]*)\]/);
  assert.ok(lista, 'No se encontro la lista de campos');
  assert.doesNotMatch(lista[1], /'minuto'/);

  // `estado` si cuenta: el paso a TC es lo que congela la jornada.
  for (const campo of ['marcador1', 'marcador2', 'estado']) {
    assert.match(lista[1], new RegExp(`'${campo}'`), `Falta ${campo} en la lista`);
  }

  /*
   * `comodin` ya NO esta: dejo de copiarse dentro del resultado oficial. Era la
   * fuga por la que marcar un comodin tarde no movia los puntos (M-34).
   */
  assert.doesNotMatch(lista[1], /'comodin'/);

  // Y el recalculo tras el sync pasa por esa comprobacion.
  const sinc = quitarComentarios(leer(path.join('src', 'sincronizador.js')));
  assert.match(sinc, /oficialesMod\.puntosPuedenHaberCambiado\(anteriores, nuevos\)/);
  assert.match(sinc, /metricas\.syncsSinCambioDePuntos \+= 1/);
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

  /*
   * El número es un SUELO, no un objetivo: está para que el rastreador no pase
   * en verde por no encontrar nada -si alguien rompe `plantillasDeRiesgo`, el
   * recuento cae a cero y esto lo caza-. Baja legítimamente cuando se retira una
   * pantalla: en la Fase D desapareció importar_partidos.js y con él sus
   * plantillas. Lo que de verdad se comprueba es la lista de abajo.
   */
  assert.ok(total >= 50, `Se esperaban al menos 50 plantillas de riesgo, se hallaron ${total}`);
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
  /*
   * En PostgreSQL las transacciones son de serie y sin condiciones: se acabo el
   * baile de "MongoDB solo hace transacciones sobre un conjunto de replicas" y
   * su rama de respaldo sin atomicidad, que era la que corria en desarrollo.
   */
  const db = quitarComentarios(leer(path.join('src', 'db.js')));

  assert.match(db, /async function enTransaccion/);
  assert.match(db, /async function enQuiniela/);
  assert.match(db, /await cliente\.query\('COMMIT'\)/);
  assert.match(db, /await cliente\.query\('ROLLBACK'\)/);

  /*
   * REGLA 2 de §21.2: el contexto se fija con SET LOCAL -aqui, `set_config`
   * con el tercer argumento en `true`-, DENTRO de la transaccion. Es TODA la
   * defensa: el pooler de Neon trabaja en modo transaccion y un SET de sesion
   * se colaria en la peticion siguiente que reutilice la conexion.
   */
  assert.match(db, /set_config\('app\.quiniela_id', '\$\{id\}', true\)/);

  // Y la vieja capa de transacciones de Mongo ya no existe.
  assert.equal(fs.existsSync(path.join(root, 'src', 'transacciones.js')), false);
  assert.doesNotMatch(fuenteSinComentarios, /withTransaction\(/);

  // La transferencia de propiedad no puede volver a guardar en paralelo.
  assert.doesNotMatch(fuenteSinComentarios, /Promise\.all\(\[destino\.save\(\)/);
});

test('el arnés de pruebas corre con los MISMOS permisos que producción', () => {
  /*
   * Antes esto vigilaba que las pruebas usaran un conjunto de replicas, porque
   * MongoDB solo admite transacciones sobre uno. El riesgo equivalente hoy es
   * otro y es peor.
   *
   * PGlite conecta como `postgres`, que es SUPERUSUARIO, y los superusuarios se
   * saltan RLS entero. Sin ponerse en la piel de `app_quiniela`, las pruebas de
   * aislamiento pasan siempre: ven todas las quinielas y no se quejan, porque
   * no hay politica que aplicar.
   *
   * Es el mismo error que costo cuatro vueltas montando el Anexo C: un banco de
   * pruebas con mas privilegios que el entorno real no prueba lo que dice.
   */
  const arnes = fs.readFileSync(path.join(root, 'test', 'postgres-en-memoria.js'), 'utf8');

  assert.match(arnes, /CREATE ROLE app_quiniela NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/);
  assert.match(arnes, /SET ROLE app_quiniela/);

  // Y se NIEGA a arrancar si detecta privilegios de mas.
  assert.match(arnes, /se saltaría RLS/);
  assert.match(arnes, /throw new Error/);

  // El de produccion hace lo mismo: se planta, no avisa.
  const db = fs.readFileSync(path.join(root, 'src', 'db.js'), 'utf8');
  assert.match(db, /async function comprobarRol/);
  assert.match(db, /r\.superusuario \|\| r\.bypassrls \|\| r\.propias > 0/);
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

test('la integración continua ejecuta lo que hay que ejecutar', () => {
  /*
   * Un pipeline que existe pero no corre las pruebas da una falsa sensación de
   * red. Esta invariante fija QUÉ tiene que ejecutar, no cómo.
   */
  const ruta = path.join(root, '.github', 'workflows', 'pruebas.yml');
  assert.ok(fs.existsSync(ruta), 'Falta el flujo de integración continua');

  const flujo = fs.readFileSync(ruta, 'utf8');

  for (const comando of ['npm ci', 'npm run check', 'npm test', 'npm audit --omit=dev', 'npm run test:e2e']) {
    assert.ok(flujo.includes(comando), `La integración continua no ejecuta "${comando}"`);
  }

  /*
   * `npm ci` y no `npm install`: instala exactamente lo del lockfile y falla si
   * se desincronizó, que es parte de lo que se quiere detectar.
   */
  assert.doesNotMatch(flujo, /run: npm install/);

  // Sin los navegadores, las pruebas de navegador no arrancan en un runner limpio.
  assert.match(flujo, /playwright install --with-deps chromium/);
});

test('server.js ya no existe: la aplicación es src/ y arrancar.js', () => {
  /*
   * El monolito era C-04. Al cerrar el paso 7.7 desaparece: lo que hacia esta
   * repartido en modulos que se prueban por separado.
   *
   * Este guardian existe para que nadie lo resucite "temporalmente".
   */
  assert.equal(fs.existsSync(path.join(root, 'server.js')), false, 'server.js volvio');

  const paquete = JSON.parse(leer('package.json'));
  assert.equal(paquete.main, 'arrancar.js');
  assert.match(paquete.scripts.start, /arrancar\.js/);

  // Y las dependencias de Mongo se fueron con el.
  for (const muerta of ['mongoose', 'connect-mongo']) {
    assert.ok(!paquete.dependencies[muerta], `${muerta} sigue en dependencies`);
  }
  assert.ok(!paquete.devDependencies['mongodb-memory-server'], 'mongodb-memory-server sigue ahi');
});

test('no queda el código muerto ya identificado', () => {
  // Marcadores y bloques comentados que se venían arrastrando.
  assert.doesNotMatch(server, /borrar borrar/);
  assert.doesNotMatch(server, /v3\.football\.api-sports\.io/);

  /*
   * Y ningún script del frontend puede quedar sin pantalla que lo cargue:
   * llenar_jornada.js llevaba tiempo así, duplicando a llenar_jornada_user.js.
   */
  const paginas = fs.readdirSync(path.join(root, 'public'))
    .filter(f => f.endsWith('.html'))
    .map(f => fs.readFileSync(path.join(root, 'public', f), 'utf8'))
    .join('\n');

  const huerfanos = fs.readdirSync(path.join(root, 'private', 'js'))
    .filter(archivo => !paginas.includes(archivo));

  assert.deepEqual(huerfanos, [], 'Estos scripts no los carga ninguna pantalla');
});

test('npm test ejecuta todos los archivos de prueba, y sin comodines', () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const comando = paquete.scripts.test;

  /*
   * `node --test` solo expande comodines desde Node 22, y `engines` admite
   * >=20. El comodín funcionaba en la máquina de desarrollo y fallaba en el CI
   * con "Could not find test/**\/*.test.js": el peor sitio donde descubrirlo,
   * porque el trabajo se marca en rojo sin haber ejecutado una sola prueba.
   */
  assert.doesNotMatch(comando, /\*/, 'Lista los archivos: el comodín no funciona en toda versión soportada');

  /*
   * Con rutas explícitas aparece el riesgo contrario: añadir un archivo de
   * pruebas y olvidar listarlo. Entonces el CI pasa en verde sin ejecutarlo,
   * que es peor que fallar. Esto lo impide.
   */
  const archivos = fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js'));
  assert.ok(archivos.length > 0, 'No se encontró ningún archivo de pruebas');

  for (const archivo of archivos) {
    assert.ok(
      comando.includes(`test/${archivo}`),
      `npm test no ejecuta test/${archivo}: añádelo al script`
    );
  }
});

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

  /*
   * ⚠️ EL LIMITADOR DE REGISTRO NO PUEDE SER MEZQUINO. Una IP publica no es una
   * persona: los operadores moviles agrupan a muchos clientes bajo una misma
   * (CGNAT), asi que desconocidos comparten contador. Con 5 por hora, en un
   * estreno la sexta persona veia "se alcanzo el limite" sin haber hecho nada
   * mal (Entrada 067).
   *
   * Y sigue sirviendo para lo que se puso, porque **una cuenta sin confirmar no
   * da acceso a nada**: registrar en masa no abre ninguna puerta.
   */
  const registro = server.match(/const limiteRegistro = rateLimit\(\{[^}]*limit:\s*(\d+)/);
  assert.ok(registro, 'no se encontro el limitador de registro');
  assert.ok(Number(registro[1]) >= 20,
    `el registro admite ${registro[1]} por IP y hora: con IP compartida bloquea a gente inocente`);
});

test('el registro NO abre sesión, y el login la regenera', () => {
  /*
   * Antes esto vigilaba que el registro regenerara la sesion, contra fijacion:
   * si alguien conseguia fijar un identificador antes del alta, se quedaba
   * dentro de la cuenta nueva.
   *
   * Desde la Fase E la proteccion es mas fuerte: el registro NO abre sesion
   * ninguna, porque la cuenta nace sin confirmar y sin confirmar no se entra.
   * No hay sesion que fijar.
   */
  const registro = server.slice(
    server.indexOf("app.post('/api/auth/registro'"),
    server.indexOf('async function enviarConfirmacion')
  );
  assert.ok(registro.length > 0, 'No se localizo el bloque de registro');
  assert.doesNotMatch(registro, /req\.session\.usuarioId =/,
    'registrarse no puede dejar la sesion iniciada');

  // El login si la regenera, y ahi la fijacion sigue siendo un riesgo real.
  const login = server.slice(
    server.indexOf('async function iniciarSesion'),
    server.indexOf("app.post('/api/auth/login'")
  );
  assert.match(login, /req\.session\.regenerate\(/);

  /*
   * Y la comprobacion de "esta confirmado" va DESPUES de validar la
   * contrasena. El orden es la mitad de la proteccion: avisar de que una
   * cuenta existe pero no esta confirmada antes de comprobar la clave
   * revelaria que correos estan registrados.
   */
  assert.ok(
    login.indexOf('Usuario, correo o contraseña incorrectos') < login.indexOf('email_verificado'),
    'la contrasena se comprueba antes que la verificacion'
  );
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

test('⚠️ los enlaces se aclaran al pasar el ratón, y el foco conserva su anillo', () => {
  /*
   * Dos decisiones distintas que hasta la Entrada 065 compartian regla:
   *
   *   - HOVER: se aclara, NO se subraya. El subrayado es la convencion de las
   *     paginas de hace veinte anos y desentona con esta interfaz, que no
   *     subraya nada. Ademas el color iba a `--primary-dark`, que sobre fondo
   *     oscuro resalta MENOS: el enlace se apagaba al apuntarlo.
   *
   *   - FOCO: si se marca, y con un anillo. Quien navega con el teclado no
   *     tiene raton que seguir, asi que un cambio de color no basta. Es lo que
   *     se pierde en silencio cuando alguien "limpia" los estilos de foco.
   */
  const css = leer(path.join('private', 'css', 'styles.css'));

  assert.doesNotMatch(css, /a:hover[^{]*\{[^}]*text-decoration:\s*underline/,
    'el subrayado al pasar el raton se retiro a proposito');

  assert.match(css, /a:focus-visible\s*\{[^}]*outline:/,
    'sin anillo de foco, quien navega con teclado avanza a ciegas');
});

test('⚠️ ninguna casilla de verificación se queda sin su clase de fila', () => {
  /*
   * La hoja de estilos tiene una regla global que alcanza a TODOS los input:
   *
   *     input, select, button, textarea { width: 100%; padding: 13px 14px; }
   *
   * Una casilla de verificacion no debe medir el ancho de la fila. Cuando lo
   * mide, en el movil ocupa la linea entera y empuja el texto abajo, y en el
   * escritorio se estira hasta dejar el rotulo lejos de su propia casilla. Se
   * marca la que no era, y no da ningun error: la pantalla simplemente miente
   * sobre que va con que.
   *
   * `.checkbox-card` (una suelta) y `.checkbox-fila` (listas largas) deshacen
   * esa regla. Una casilla sin ninguna de las dos vuelve al problema.
   */
  const paginas = fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html'));

  for (const pagina of paginas) {
    const html = leer(path.join('public', pagina));
    for (const etiqueta of html.match(/<label[^>]*>\s*<input type="checkbox"/g) || []) {
      assert.match(etiqueta, /checkbox-(card|fila)/,
        `${pagina}: una casilla sin clase mide el ancho de la fila y despega el texto de su casilla`);
    }
  }

  // Y la regla que lo deshace tiene que seguir ahi.
  const css = leer(path.join('private', 'css', 'styles.css'));
  assert.match(css, /\.checkbox-fila input\[type="checkbox"\]\s*\{[^}]*width:\s*auto/);
  assert.match(css, /\.checkbox-fila\s*\{[^}]*align-items:\s*flex-start/);
});

test('⛔ ningún panel del rotador se muestra con un estilo en línea', () => {
  /*
   * El hueco de la portada, medido: el rotador ocupaba 426 px para enseñar 189.
   *
   * Los scripts que llenan los paneles hacian `panel.style.display = 'block'`
   * al tener contenido. **Un estilo en linea gana sobre una clase**, asi que el
   * panel quedaba visible para siempre aunque no tuviera el turno; y como
   * `.rotator-panel` sin `.active` solo le pone `opacity: 0`, el resultado era
   * un panel INVISIBLE QUE SEGUIA OCUPANDO SU ALTO.
   *
   * ⚠️ El fallo no daba ningun error y la pantalla parecia correcta: solo se
   * veia como "sobra mucho espacio antes del boton".
   *
   * La regla: «tener contenido» y «estar visible» son cosas distintas. Un panel
   * sin nada que enseñar se marca con `display: none` en linea; uno con
   * contenido QUITA el estilo en linea y deja que mande la clase `.active`, que
   * la pone y la quita `index-rotador.js`.
   */
  /*
   * ⚠️ Los paneles se sacan del HTML, no de una lista escrita a mano: uno
   * nuevo entra solo en la comprobacion. Y el filtro va por ESOS ids, no por
   * nombres de variable — la primera version miraba cualquier `tarjeta.style` y
   * acusaba a `index-contexto.js`, que enciende la tarjeta del
   * superadministrador y no tiene nada que ver con el rotador.
   *
   * ⛔ Un centinela que acusa al codigo correcto se acaba desactivando, y
   * entonces deja de vigilar tambien lo que si importa.
   */
  const portada = leer(path.join('public', 'index.html'));

  const idsDePaneles = [...portada.matchAll(/id="([^"]+)"[^>]*class="[^"]*rotator-panel/g)]
    .map(m => m[1])
    .concat([...portada.matchAll(/class="[^"]*rotator-panel[^"]*"[^>]*id="([^"]+)"/g)].map(m => m[1]));

  assert.ok(idsDePaneles.length >= 2,
    `esperaba encontrar los paneles del rotador en index.html, hallados: ${idsDePaneles.length}`);

  const dir = path.join(root, 'private', 'js');

  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const codigo = quitarComentarios(fs.readFileSync(path.join(dir, archivo), 'utf8'));

    // Solo los archivos que manejan un panel del rotador.
    if (!idsDePaneles.some(id => codigo.includes(id))) continue;

    const encendidos = codigo.match(/\.style\.display\s*=\s*'(block|flex)'/g) || [];

    assert.deepEqual(encendidos, [],
      `${archivo}: maneja un panel del rotador y lo enciende con estilo en linea, `
      + 'que gana sobre la clase y lo deja ocupando sitio sin verse. '
      + 'Usa `style.removeProperty("display")` y deja que mande `.active`');
  }

  // Y el rotador recuerda el PANEL, no su posicion: la lista cambia sola.
  const rotador = quitarComentarios(leer(path.join('private', 'js', 'index-rotador.js')));

  assert.match(rotador, /paneles\.indexOf\(ultimo\)/,
    'con un indice guardado, un panel que se llena tarde hace repetir el anterior');
});

test('⛔ las dos casillas de cobro nacen COBRANDO, no perdonando', () => {
  /*
   * `juega_torneo` y `juega_jornadas` deciden a quien se le cobra cada cuota.
   *
   * ⛔ Las dos tienen que ser `NOT NULL DEFAULT true`, y no es un detalle de
   * estilo: con `DEFAULT false`, una columna anadida sobre datos existentes
   * dejaria exenta a TODA la quiniela y la deuda desapareceria de golpe.
   *
   * Y no fallaria: las cuentas saldrian en cero y todo el mundo apareceria al
   * dia. Un fallo que borra dinero sin dar ningun error no se descubre hasta
   * que alguien reclama — y para entonces no hay forma de saber cual era el
   * numero bueno, porque las cuentas se CALCULAN y no se guardan.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));

  for (const columna of ['juega_torneo', 'juega_jornadas']) {
    assert.match(esquema, new RegExp(`${columna}\\s+boolean NOT NULL DEFAULT true`),
      `${columna} tiene que nacer en true: en false perdonaria la deuda de todos`);
  }

  const migracion = leer(path.join('db', 'migraciones', '005-cobro-por-jugador.sql'));
  assert.match(migracion, /juega_jornadas boolean NOT NULL DEFAULT true/,
    'la migracion tambien: es la que corre sobre los datos que ya existen');

  /*
   * Y la aritmetica pregunta con `!== false`, no con `=== true`: un jugador que
   * llegue sin el campo -de una consulta a la que se le olvido la columna- tiene
   * que PAGAR. El valor por defecto de una duda sobre dinero es cobrar.
   */
  const cobrosMod = quitarComentarios(leer(path.join('src', 'cobros.js')));

  assert.match(cobrosMod, /juegaJornadas\s*=\s*jugador\?\.juegaJornadas\s*!==\s*false/);
  assert.match(cobrosMod, /juegaTorneo\s*=\s*jugador\?\.juegaTorneo\s*!==\s*false/);
});

test('⛔ un resultado definitivo no lo reescribe el proveedor, y no se empeora ninguno', () => {
  /*
   * La regla decidida el 25 de agosto: en cuanto un partido termina y su
   * resultado queda fijado, esa fila es historia de la quiniela y deja de
   * depender del proveedor. Asi una caida o una respuesta mala solo pueden
   * afectar a lo que esta por jugarse o jugandose.
   *
   * Tres condiciones, y las tres se rompen en silencio si alguien las quita:
   * el marcador seguiria cambiando y nadie veria un error.
   */
  const sinc = quitarComentarios(leer(path.join('src', 'sincronizador.js')));

  /*
   * ⚠️ La condicion es `bloqueadoFinal` A SECAS. Antes era
   * `bloqueadoFinal && origen === 'manual'`, y por eso un partido terminado con
   * resultado del proveedor se seguia reescribiendo en cada ciclo — que es por
   * donde una respuesta degradada borraba el marcador bueno.
   */
  assert.match(sinc, /if \(previo\?\.bloqueadoFinal\) continue/,
    'lo definitivo no se toca, venga del proveedor o del administrador');

  assert.doesNotMatch(sinc, /bloqueadoFinal\s*&&\s*previo\.origen\s*===\s*'manual'/,
    'esa condicion dejaba fuera los partidos terminados por el proveedor');

  // Y el sincronizador puede mejorar un dato, nunca empeorarlo.
  assert.match(sinc, /previoTeniaMarcador/,
    'un evento sin marcador no puede borrar uno que si lo tiene');

  /*
   * En la carga manual, «terminado» y «definitivo» son DOS COSAS. Mezclarlas
   * rompio el cierre de los pronosticos (Entrada 019) en el primer intento:
   * sin `estado: 'TC'` el partido seguia admitiendo pronosticos despues de
   * cargarle el resultado.
   */
  const oficiales = quitarComentarios(leer(path.join('src', 'oficiales.js')));

  assert.match(oficiales, /const jugado =/, 'hace falta saber si el partido se jugo');
  assert.match(oficiales, /const definitivo =/, 'y aparte, si su resultado esta fijado');
  assert.match(oficiales, /estado: jugado \? 'TC'/,
    'un partido con marcador cargado tiene que cerrar los pronosticos');
  assert.match(oficiales, /bloqueadoFinal: definitivo/);

  /*
   * ⛔ Y `bloqueadoFinal: true` a secas no puede volver: era lo que congelaba la
   * jornada ENTERA al guardarla una vez, incluidos los partidos sin jugar.
   */
  assert.doesNotMatch(oficiales, /bloqueadoFinal:\s*true/,
    'congelar es por partido y solo si termino, nunca la jornada entera');
});

test('⛔ ningún marcador llega a una columna integer como cadena vacía', () => {
  /*
   * El fallo que congelo los resultados oficiales el 25 de agosto, y que se vio
   * en el registro de Render repetido cada minuto:
   *
   *     invalid input syntax for type integer: ""
   *
   * `eventos.obtenerNumeroSeguro` devolvia `''` para "no hay dato" -la
   * convencion de Mongo, donde el campo lo aceptaba- y `oficiales.escribir`
   * lo pasaba con `?? null`, que **solo convierte null y undefined**. Un
   * partido programado, que es el estado normal antes de jugarse, llega sin
   * marcador y reventaba al guardarse.
   *
   * Dos condiciones, y las dos importan: el origen no produce cadenas vacias,
   * y la puerta de la base no las deja pasar aunque alguien las produzca.
   */
  const eventosMod = quitarComentarios(leer(path.join('src', 'eventos.js')));

  const numeroSeguro = eventosMod.match(/function obtenerNumeroSeguro[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(numeroSeguro, 'no se encontro obtenerNumeroSeguro');

  assert.doesNotMatch(numeroSeguro, /return\s*''/,
    'un marcador ausente tiene que ser null: una cadena vacia no cabe en una columna integer');

  const oficialesMod = quitarComentarios(leer(path.join('src', 'oficiales.js')));

  assert.doesNotMatch(oficialesMod, /fila\.marcador1\s*\?\?\s*null/,
    '`?? null` no convierte la cadena vacia: usa una conversion que la contemple');

  assert.match(oficialesMod, /function comoEntero[\s\S]*?trim\(\)\s*===\s*''/,
    'la puerta de la base tiene que descartar la cadena vacia explicitamente');

  /*
   * Y el aislamiento por fila. En PostgreSQL una sentencia que falla aborta la
   * transaccion ENTERA: un `try/catch` a secas no salva las filas siguientes,
   * solo recoge el eco del primer error (§C, Entrada 035). Hace falta SAVEPOINT.
   */
  assert.match(oficialesMod, /SAVEPOINT/,
    'sin SAVEPOINT, un partido que falla se lleva por delante los demas de la jornada');
  assert.match(oficialesMod, /ROLLBACK TO SAVEPOINT/);
});

test('⛔ TODA ruta de superadministrador lleva su guardia', () => {
  /*
   * Es la unica pantalla del sistema que enseña **los correos de todo el
   * mundo**. Una ruta que se quede sin `requireSuperadmin` no fallaria: dejaria
   * pasar, y seria una fuga de datos personales de todos los usuarios de todas
   * las quinielas de una sola vez.
   *
   * Es exactamente la forma del hallazgo de la Entrada 064 -`/api/football/fixtures`
   * sin `requireAdmin` mientras su ruta hermana si la tenia-, y por eso se
   * cuenta en vez de buscar: comprobar que "alguna" la lleva es lo que dejo
   * pasar aquella.
   */
  const mod = quitarComentarios(leer(path.join('src', 'rutas', 'superadmin.js')));

  const declaraciones = mod.match(/app\.(get|post|delete|put|patch)\([^)]*/g) || [];
  assert.ok(declaraciones.length >= 7, 'esperaba al menos 7 rutas de superadministrador');

  /*
   * Las tres publicas son a proposito y estan enumeradas: `quien-soy` responde
   * si tienes acceso o no -si exigiera acceso, nadie podria preguntarlo-,
   * `confirmar` ES la puerta, y `salir` no da nada.
   */
  const SIN_GUARDIA = ['/api/superadmin/quien-soy', '/api/superadmin/confirmar', '/api/superadmin/salir'];

  for (const declaracion of declaraciones) {
    const ruta = (declaracion.match(/'([^']+)'/) || [])[1] || '';
    if (SIN_GUARDIA.includes(ruta)) continue;

    assert.match(declaracion, /requireSuperadmin/,
      `${ruta} no lleva requireSuperadmin: enseñaria los correos de todo el sistema`);
  }

  // Y las tres publicas exigen al menos sesion: no son anonimas.
  for (const declaracion of declaraciones) {
    const ruta = (declaracion.match(/'([^']+)'/) || [])[1] || '';
    if (!SIN_GUARDIA.includes(ruta)) continue;
    assert.match(declaracion, /requireLogin/, `${ruta} tiene que exigir sesion`);
  }
});

test('⛔ quién es superadministrador sale del entorno, nunca de la base', () => {
  /*
   * La mitad de la seguridad de esto. Con una columna `es_superadmin`,
   * cualquiera que llegue a serlo puede nombrar a otro desde la propia
   * pantalla, y una cuenta comprometida se vuelve permanente. Con la variable
   * hace falta entrar al panel de Render.
   *
   * Es la misma logica que impide que la aplicacion se conecte con el rol dueño
   * de la base: el poder total no se concede desde dentro de la aplicacion.
   */
  const mod = quitarComentarios(leer(path.join('src', 'superadmin.js')));

  assert.match(mod, /process\.env\.SUPERADMIN_EMAILS/, 'el poder sale de la variable');

  /*
   * ⚠️ `\b` a los dos lados, y no es un detalle de estilo: sin el limite de
   * palabra, `es_superadmin` casa DENTRO de `accione|s_superadmin`, que es el
   * nombre de la tabla del registro. La primera version de esta prueba fallaba
   * acusando al archivo de tener una columna que no tiene.
   *
   * Es la misma trampa de las Entradas 055 y 062 -un centinela engañado por el
   * texto que el mismo busca-, esta vez por el nombre de una tabla en vez de
   * por un comentario. Tercera vez que muerde.
   */
  assert.doesNotMatch(mod, /\bes_superadmin\b/,
    'no puede haber una columna de superadministrador: se concederia desde dentro');

  const esquema = leer(path.join('db', 'esquema.sql'));
  assert.doesNotMatch(esquema, /\bes_superadmin\b/,
    'la base no debe tener columna de superadministrador');

  /*
   * Y las cuatro condiciones de la guardia. Se comprueban una a una porque cada
   * una tapa un agujero distinto, y quitar cualquiera deja la puerta abierta de
   * una forma que no falla.
   */
  const guardia = quitarComentarios(leer(path.join('src', 'servidor.js')))
    .match(/async function requireSuperadmin[\s\S]*?\n\}/)?.[0] || '';

  assert.ok(guardia, 'no se encontro requireSuperadmin');
  assert.match(guardia, /usuariosMod\.porId/, 'el usuario se lee de la BASE, no de la sesion');
  assert.match(guardia, /superadminMod\.esSuperadmin/, 'tiene que preguntar por la lista');
  assert.match(guardia, /superadminMode/, 'tiene que exigir la contraseña confirmada');
  assert.match(guardia, /1000 \* 60 \* 60/, 'la confirmacion tiene que caducar');
});

test('⛔ el registro del superadministrador no puede borrarse ni perderse', () => {
  /*
   * Dos cosas que se romperian sin fallar:
   *
   * 1. Si `objetivo_usuario_id` tuviera clave ajena con CASCADE, borrar una
   *    cuenta se llevaria por delante el registro de que la borraste -el unico
   *    caso en el que esta tabla hace falta de verdad-.
   * 2. Si la aplicacion tuviera DELETE sobre la tabla, podria borrar su propio
   *    rastro. Un registro que el actor puede limpiar no es un registro.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));
  const tabla = esquema.match(/CREATE TABLE acciones_superadmin[\s\S]*?\n\);/)?.[0] || '';

  assert.ok(tabla, 'no se encontro la tabla acciones_superadmin');

  assert.match(tabla, /objetivo_usuario_id\s+uuid,/,
    'objetivo_usuario_id NO puede llevar REFERENCES: el asiento tiene que sobrevivir al borrado');
  assert.match(tabla, /objetivo_email\s+text NOT NULL/, 'el correo se copia, porque la fila puede irse');
  assert.match(tabla, /motivo\s+text NOT NULL CHECK/, 'el motivo es obligatorio de verdad');

  const migracion = leer(path.join('db', 'migraciones', '002-superadmin.sql'));
  assert.match(migracion, /GRANT SELECT, INSERT ON acciones_superadmin/);

  /*
   * ⛔ Y el REVOKE, que es lo que de verdad lo impide.
   *
   * El GRANT de la 002 no bastaba: **un GRANT solo suma**. Neon deja
   * privilegios por defecto que conceden los cuatro permisos sobre toda tabla
   * nueva, asi que `acciones_superadmin` nacio con DELETE y la aplicacion podia
   * borrar su propio rastro. Se descubrio comprobandolo contra la base de
   * verdad DESPUES de correr la migracion; leyendo el SQL parecia correcto.
   *
   * ⚠️ Y el patron va ANCLADO A INICIO DE LINEA (`^` con `m`), no suelto: en
   * SQL un comentario es `--` al principio, asi que buscar el REVOKE por el
   * medio lo encuentra igual dentro de una linea comentada. Se descubrio
   * rompiendo esta prueba a proposito, que es para lo que sirve romperlas.
   * **Cuarta vez esta semana** que un centinela mio se deja engañar por texto
   * que no se ejecuta -las Entradas 055, 062 y la del nombre de la tabla-.
   */
  const revoke = leer(path.join('db', 'migraciones', '003-auditoria-solo-lectura.sql'));
  assert.match(revoke, /^\s*REVOKE\s+UPDATE,\s*DELETE\s+ON\s+acciones_superadmin\s+FROM\s+app_quiniela/m,
    'sin el REVOKE, la aplicacion hereda DELETE y puede borrar su propio rastro');
});

test('⛔ las acciones del superadministrador caben en el CHECK de la base', () => {
  /*
   * `acciones_superadmin.accion` tiene una lista CERRADA. Añadir una accion en
   * JavaScript y olvidar la migracion **no falla al arrancar ni en ninguna
   * prueba de modulo**: falla en produccion, la primera vez que alguien usa esa
   * accion, con un error de restriccion que no dice nada util.
   *
   * Estuvo a punto de pasar al anadir "verificar": el array de JS se amplio y
   * el CHECK seguia con cuatro valores. Lo pillo mirar el esquema, no una
   * prueba — asi que ahora hay prueba.
   *
   * ⚠️ Y se comprueba contra `db/esquema.sql`, que es la verdad de una base
   * nueva. La migracion que lo puso al dia se comprueba aparte.
   */
  const mod = quitarComentarios(leer(path.join('src', 'superadmin.js')));

  const declaradas = (mod.match(/const ACCIONES = \[([^\]]*)\]/) || [])[1] || '';
  const enCodigo = [...declaradas.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

  assert.ok(enCodigo.length >= 4, 'no se encontro la lista de acciones');

  const esquema = leer(path.join('db', 'esquema.sql'));
  const check = (esquema.match(/CHECK \(accion IN \(([^)]*)\)\)/) || [])[1] || '';
  const enBase = [...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

  for (const accion of enCodigo) {
    assert.ok(enBase.includes(accion),
      `la accion "${accion}" no esta en el CHECK de db/esquema.sql: el INSERT `
      + 'lo rechazaria la base. Hace falta una migracion que amplie la restriccion');
  }

  // Y al reves: un valor en la base que el codigo ya no usa es basura acumulada.
  for (const accion of enBase) {
    assert.ok(enCodigo.includes(accion),
      `el CHECK admite "${accion}" y el codigo ya no la usa`);
  }
});

test('⚠️ nadie consulta tablas con RLS fuera del contexto de quiniela', () => {
  /*
   * ⛔ ESTO YA MORDIO, y el fallo no se veia leyendo el codigo.
   *
   * `ataduras()` preguntaba por los `jugadores` de una cuenta con un JOIN a
   * pelo. `jugadores` lleva RLS, asi que sin contexto de quiniela devolvia
   * CERO FILAS -no fallaba, devolvia vacio-: decia "no juega en ninguna parte",
   * el borrado seguia adelante y reventaba contra la clave ajena. Justo el
   * error criptico que este modulo promete evitar.
   *
   * La regla: toda consulta a una tabla de dominio va dentro de `enQuiniela`.
   * Las de plataforma -usuarios, quinielas, membresias- no llevan RLS y pueden
   * ir sueltas.
   *
   * ⚠️ Y el barrido va sobre TODOS los modulos, no solo sobre superadmin.js.
   * Vigilar un archivo protege de lo que ese archivo haga hoy, no de lo que se
   * escriba manana en el de al lado: cuando entro `src/compartir.js` -que
   * escribe en `partidos`- este guardian no lo miraba siquiera.
   */
  const mod = quitarComentarios(leer(path.join('src', 'superadmin.js')));

  const modulosYRutas = [
    ...fs.readdirSync(path.join(root, 'src'))
      .filter(f => f.endsWith('.js')).map(f => path.join('src', f)),
    ...fs.readdirSync(path.join(root, 'src', 'rutas'))
      .filter(f => f.endsWith('.js')).map(f => path.join('src', 'rutas', f))
  ];

  const CON_RLS = [
    'jugadores', 'jornadas', 'partidos', 'resultados', 'pronosticos',
    'resultados_oficiales', 'trivias', 'respuestas_trivia', 'equipos',
    'puntos_jornada', 'pagos'
  ];

  // Las llamadas a `db.consulta(...)`: las que van FUERA de un contexto.
  for (const relativo of modulosYRutas) {
    const codigo = quitarComentarios(leer(relativo));

    for (const llamada of codigo.match(/db\.consulta\(\s*`[^`]*`/g) || []) {
      for (const tabla of CON_RLS) {
        assert.doesNotMatch(llamada, new RegExp(`\\b(FROM|UPDATE|INTO|JOIN)\\s+${tabla}\\b`, 'i'),
          `${relativo}: db.consulta() toca "${tabla}", que lleva RLS: sin contexto `
          + 'devuelve cero filas en silencio. Tiene que ir dentro de db.enQuiniela()');
      }
    }
  }

  // Y la vuelta: si se tocan, es dentro de un contexto.
  assert.match(mod, /db\.enQuiniela\([\s\S]*?FROM jugadores/,
    'los jugadores se consultan quiniela por quiniela');
});

test('⛔ ningún marcador en blanco se enseña como un cero', () => {
  /*
   * Cinco sitios del frontend hacian `p.marcador1 || '0'`. Con eso, un partido
   * que la persona NO pronostico salia impreso como **0**, y ese texto es el
   * que se copia al portapapeles y se manda por WhatsApp: quedaba escrito que
   * habia pronosticado 0-0 cuando no habia puesto nada (Entrada 068).
   *
   * ⚠️ Y el mismo `||` al reves seria igual de malo: `0 || '-'` da "-", asi que
   * un 0-0 de verdad desapareceria. Por eso la regla no es "usa otro valor por
   * defecto" sino **no uses `||` sobre un marcador**: hay que comprobar null y
   * cadena vacia por separado, que es lo que hace `marcadorVisible`.
   *
   * ⛔ Y `??` TAMBIEN, desde el 3 de septiembre, pero NO con la misma lista.
   *
   * Hasta entonces esto solo miraba `||`, asi que `p.marcador1 ?? 0` pasaba en
   * verde haciendo exactamente el dano que la prueba dice impedir. Se descubrio
   * rompiendolo a proposito al escribir la pantalla de compartir: el centinela
   * no se movio y quien lo cazo fue la prueba de navegador.
   *
   * ⚠️ Las dos listas son distintas porque los dos operadores lo son:
   *
   *   - `||` se dispara con el 0 y con la cadena vacia, asi que le hacen dano
   *     los DOS valores por defecto: `|| '0'` convierte un blanco en cero, y
   *     `|| '-'` hace desaparecer un 0-0 de verdad.
   *   - `??` solo se dispara con null y undefined, asi que `?? '-'` no puede
   *     comerse un cero: es aceptable, y `ver-resultados.js` lo usa. El unico
   *     que miente es `?? 0`, que convierte "no pronostico" en "pronostico 0".
   *
   * Meter `?? '-'` en la lista fue el primer intento y flagueaba codigo
   * correcto. Un centinela que acusa al inocente se acaba desactivando, y
   * entonces deja de vigilar tambien lo que si importaba.
   */
  const scripts = listar(path.join('private', 'js'));
  const nombres = fs.readdirSync(path.join(root, 'private', 'js')).filter(f => f.endsWith('.js'));

  nombres.forEach((nombre, i) => {
    const codigo = quitarComentarios(scripts[i]);

    const sospechosas = [
      ...(codigo.match(/marcador\w*\s*\|\|\s*(['"]?)[-0–]\1/gi) || []),
      ...(codigo.match(/marcador\w*\s*\?\?\s*(['"]?)0\1/gi) || [])
    ];

    assert.deepEqual(sospechosas, [],
      `${nombre}: un marcador no se resuelve con "||", ni con "?? 0". Un blanco `
      + 'saldria como 0 (o un 0 real desapareceria). Usa marcadorVisible() de '
      + 'marcador-visible.js');
  });

  // Y el ayudante tiene que seguir distinguiendo los tres estados.
  const ayudante = leer(path.join('private', 'js', 'marcador-visible.js'));
  assert.match(ayudante, /if \(oculto\) return NO_VISIBLE/);
  assert.match(ayudante, /valor === null \|\| valor === undefined/);
  assert.match(ayudante, /valor\.trim\(\) === ''/);
});

test('⛔ quien imprime pronósticos ajenos mira si todavía son secretos', () => {
  /*
   * `/api/resultados-con-equipos` devuelve `oculto: true` para los pronosticos
   * de partidos que aun no empiezan -la privacidad se decide partido a partido,
   * Entrada 019- y manda el marcador vacio.
   *
   * ⛔ Ningun script miraba ese campo. Con el `|| '0'` de antes, el
   * administrador que copiaba la jornada ANTES de que arrancara obtenia un
   * texto en el que los treinta jugadores habian pronosticado 0-0: el dato
   * secreto no se filtraba, pero se sustituia por uno inventado y creible.
   */
  /*
   * Cada uno con la ruta de la que saca los pronosticos ajenos. La ruta se
   * comprueba para que el guardian se entere si la pantalla deja de leerla:
   * sin eso seguiria en verde vigilando un archivo que ya no hace lo que dice.
   *
   * `compartir.js` entro el 3 de septiembre. Es la unica que no lee
   * `resultados-con-equipos`: los pronosticos le llegan ya cruzados desde
   * `src/compartir.js`, pero imprime exactamente lo mismo y por el mismo
   * WhatsApp, asi que le toca la misma regla.
   */
  const consumidores = {
    'enviarresultados.js': 'resultados-con-equipos',
    'copiarresultadojugador.js': 'resultados-con-equipos',
    'enviarresultadospartido.js': 'resultados-con-equipos',
    'compartir.js': 'compartir/pendientes'
  };

  for (const [nombre, ruta] of Object.entries(consumidores)) {
    const codigo = quitarComentarios(leer(path.join('private', 'js', nombre)));

    assert.ok(codigo.includes(ruta),
      `${nombre}: si dejo de leer ${ruta}, revisa esta prueba`);

    /*
     * ⚠️ Se cuentan TODAS las llamadas, no se busca una.
     *
     * La primera version de esta prueba hacia un `match` de
     * `marcadorVisible(... oculto`, y con eso bastaba que UNA de las dos
     * llamadas lo llevara: quitarselo al marcador local pasaba desapercibido
     * porque el visitante seguia teniendolo. Se descubrio rompiendola a
     * proposito, que es justo para lo que sirve romperlas. Es la leccion de la
     * Entrada 067 -comprobar que algo existe no comprueba que este bien-.
     */
    const todas = codigo.match(/marcadorVisible\(/g) || [];
    const conOculto = codigo.match(/marcadorVisible\([^()]*\.oculto\s*\)/g) || [];

    assert.ok(todas.length > 0, `${nombre}: ya no usa marcadorVisible; revisa esta prueba`);

    assert.equal(conOculto.length, todas.length,
      `${nombre}: ${todas.length - conOculto.length} de ${todas.length} llamadas a `
      + 'marcadorVisible() no pasan "oculto", asi que los pronosticos que todavia '
      + 'no son publicos saldran como si fueran un marcador');
  }
});

test('⛔ guardar distingue «no vino» de «vino vacío»', () => {
  /*
   * Es lo que impedia perder pronosticos. La pantalla, al dejar un partido a
   * medias, mandaba los DOS marcadores en blanco y `guardar` lo tomaba como
   * "ponlo todo a nulo": borraba lo que la persona ya tenia guardado, sin error
   * y con un "guardado correctamente" en pantalla (Entrada 068).
   *
   * ⚠️ El `|| {}` de antes es exactamente lo que no puede volver: convierte un
   * hueco del arreglo en un objeto vacio, y ahi las dos cosas se dicen igual.
   */
  const mod = quitarComentarios(leer(path.join('src', 'pronosticos.js')));

  assert.doesNotMatch(mod, /pronosticos\?\.\[i\]\s*\|\|\s*\{\}/,
    'un hueco del arreglo volveria a leerse como "dejalo todo en blanco"');

  assert.match(mod, /enviado === null \|\| enviado === undefined/,
    'lo que no viene tiene que dejarse sin tocar');

  assert.match(mod, /marcador1 === null && marcador2 === null[\s\S]{0,400}DELETE FROM pronosticos/,
    'los dos vacios quitan el pronostico, en vez de dejar una fila de nulos');

  // Y la pantalla tiene que enterarse de lo que paso de verdad.
  const ruta = quitarComentarios(leer(path.join('src', 'rutas', 'puntuacion.js')));
  for (const contador of ['guardados', 'bloqueados', 'sinTocar', 'borrados']) {
    assert.match(ruta, new RegExp(`${contador}:\\s*r\\.${contador}`),
      `la ruta calcula "${contador}" y no lo devuelve: un numero bien calculado y tirado`);
  }
});

test('⚠️ el precio de una jornada se fija al crearla y guardar no lo cambia', () => {
  /*
   * Es la decision que sostiene todos los cobros. El administrador puede subir
   * el precio -"esta jornada vale 5000 porque el premio esta grande"- y eso
   * debe afectar SOLO A LO QUE VIENE.
   *
   * Si `precio` entrara en el DO UPDATE, volver a guardar los partidos de una
   * jornada vieja la reprecificaria con la tarifa de hoy, y la cuenta de todo
   * el mundo cambiaria hacia atras SIN QUE NADA FALLARA.
   */
  const mod = quitarComentarios(leer(path.join('src', 'jornadas.js')));

  /*
   * ⚠️ Las DOS cuotas entran en el INSERT desde la migración 006: el total y la
   * parte que va al bote acumulado. Las dos se congelan al crear la jornada,
   * por la misma razón que el precio — cambiar el reparto mañana no puede
   * reinterpretar lo que ya se jugó.
   */
  assert.match(mod, /INSERT INTO jornadas \(quiniela_id, nombre, precio, al_acumulado\)/);
  assert.match(mod, /DO UPDATE SET nombre = EXCLUDED\.nombre\s*\n?\s*RETURNING id/,
    'el DO UPDATE no puede tocar el precio');
  assert.doesNotMatch(mod, /DO UPDATE SET[^`]*precio/,
    'reprecificar al guardar cambiaria hacia atras lo que la gente ya debia');
});

test('⚠️ los abonos no se editan ni se borran: se corrigen con un asiento inverso', () => {
  /*
   * Es lo primero del sistema que cuenta dinero. El dia que alguien diga "yo si
   * pague", la discusion se resuelve mirando el historial, no la palabra de
   * quien pudo reescribirlo.
   */
  const mod = quitarComentarios(leer(path.join('src', 'pagos.js')));

  assert.doesNotMatch(mod, /UPDATE pagos/, 'un abono no se edita');
  assert.doesNotMatch(mod, /DELETE FROM pagos/, 'un abono no se borra');
  assert.match(mod, /anula_a/);

  // Y el indice que impide anular dos veces, que restaria el doble en silencio.
  const esquema = leer(path.join('db', 'esquema.sql'));
  assert.match(esquema, /CREATE UNIQUE INDEX pagos_una_anulacion_por_abono/);
});

test('⛔ toda ruta que salga a la red del proveedor exige requireAdmin', () => {
  /*
   * La cuota de APIFootball es UNA SOLA para todas las quinielas. Una ruta de
   * `/api/football/*` sin guardia deja que cualquier miembro de cualquier
   * quiniela pida rangos de fechas en bucle y agote la cuota de TODAS.
   *
   * No es fuga de datos y por eso se coló: `ligas-disponibles` llevaba la
   * guardia desde el principio y `fixtures` no, sin que nada lo delatara
   * (Entrada 064). Esto lo delata.
   */
  const admin = quitarComentarios(leer(path.join('src', 'rutas', 'admin.js')));

  const rutasFootball = [...admin.matchAll(
    /app\.(get|post|patch|delete)\('(\/api\/football\/[^']+)'\s*,\s*([^,)]+)/g)];

  assert.ok(rutasFootball.length >= 3,
    `Se esperaban al menos 3 rutas de proveedor, hay ${rutasFootball.length}`);

  for (const [, , ruta, siguiente] of rutasFootball) {
    assert.equal(siguiente.trim(), 'requireAdmin',
      `${ruta} sale a la red y gasta cuota compartida: necesita requireAdmin`);
  }
});

test('lo que se guarda en la cache de ligas es lo del proveedor, sin favoritas', () => {
  /*
   * La cache de ligas tiene por clave el rango de fechas y NADA MAS, para que
   * dos quinielas que sigan los mismos dias compartan la consulta al proveedor:
   * ahi esta el ahorro de cuota que prometia C-01.
   *
   * Por eso lo que se guarda tiene que ser lo que dijo el proveedor. Guardar la
   * version ya ordenada le serviria a la quiniela siguiente los favoritos de la
   * anterior, con las ligas arrancadas de sus paises. Se aplica DESPUES de leer
   * la cache, en las dos salidas de la ruta.
   */
  const admin = quitarComentarios(leer(path.join('src', 'rutas', 'admin.js')));

  assert.match(admin, /guardarCacheLigas\(clave, respuesta\)/);
  assert.doesNotMatch(admin, /guardarCacheLigas\([^)]*aplicarFavoritas/,
    'guardar lo ya ordenado envenena una cache que se comparte entre quinielas');

  // Y las dos salidas —la de cache y la fresca— tienen que aplicarlas.
  assert.equal((admin.match(/ligas\.aplicarFavoritas\(/g) || []).length, 2);

  /*
   * Y la funcion que las aplica no puede modificar lo que recibe, porque lo que
   * recibe es la propia entrada de la cache.
   */
  const mod = quitarComentarios(leer(path.join('src', 'ligas.js')));
  assert.match(mod, /return \{\s*\.\.\.agrupado/);
  assert.doesNotMatch(mod, /agrupado\.paises\s*=/);
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

  /*
   * ⚠️ SIN COMENTARIOS. Un comentario que mencione `/index.html` entre comillas
   * invertidas termina en "html`" y hace creer que el script usa la etiqueta.
   * Pasó de verdad (Entrada 062), y es la MISMA trampa que ya había mordido en
   * la Entrada 055: buscar sobre el texto crudo encuentra la prosa, no el
   * código.
   */
  const usanEtiqueta = fs.readdirSync(dirJs)
    .filter(f => f.endsWith('.js') && f !== 'html-seguro.js')
    .filter(f => /\bhtml`/.test(quitarComentarios(fs.readFileSync(path.join(dirJs, f), 'utf8'))));

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

test('⛔ una cadena con etiquetas dentro de una plantilla sale como texto', () => {
  /*
   * El hermano del `.join('')`, y no tenía centinela ninguno.
   *
   *     html`<div>${cerrado ? '<span class="pill">Cerrado</span>' : ''}</div>`
   *
   * Esa cadena es un DATO para `html`, así que la escapa —correctamente, es su
   * trabajo— y en pantalla se lee `&lt;span class=&quot;pill&quot;&gt;…`. El
   * arreglo es escribirla como `html\`…\``, que la marca como marcado.
   *
   * Salió de que el usuario viera código HTML en cuatro pantallas. Tres eran
   * cadenas así, en `ver-resultados_puntos.js` y `ver_jornadas.js`.
   *
   * ⚠️ Sólo se miran las cadenas DENTRO de una plantilla `html`. Una asignación
   * directa —`nodo.innerHTML = '<p>Sin datos</p>'`— es correcta y frecuente: el
   * navegador la interpreta, no pasa por el escapado.
   */
  const dir = path.join(root, 'private', 'js');
  const culpables = [];

  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    if (archivo === 'html-seguro.js') continue;

    const codigo = fs.readFileSync(path.join(dir, archivo), 'utf8');

    for (const plantilla of plantillasDeRiesgo(codigo)) {
      if (plantilla.etiqueta !== 'html') continue;

      /*
       * Una cadena entre comillas que abre una etiqueta. Se piden las comillas
       * a los dos lados para no confundirse con el marcado de la propia
       * plantilla, que no va entrecomillado.
       */
      const sospechosas = plantilla.texto.match(/'<\/?[a-z][^']*'|"<\/?[a-z][^"]*"/gi) || [];

      for (const cadena of sospechosas) {
        culpables.push(
          `${archivo}:${codigo.slice(0, plantilla.inicio).split(/\r?\n/).length} → ${cadena.slice(0, 45)}`);
      }
    }
  }

  assert.deepEqual(culpables, [],
    'Hay cadenas con etiquetas HTML dentro de una plantilla `html`: se escapan y '
    + 'salen como texto en pantalla. Escríbelas como html`…`');
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

      /*
       * ⛔ SE BUSCA EL `.join('')`, NO LA FORMA DEL `map`.
       *
       * El patrón anterior era `=>\s*html`…`\)\s*\.join\('')`, que sólo
       * reconoce la forma corta `x => html`…``. Los dos archivos que de verdad
       * estaban rotos usaban la forma con bloque:
       *
       *     x => { const y = …; return html`…`; }
       *
       * …así que el `=>` no iba seguido de `html` y **el centinela pasaba en
       * verde con el fallo delante**. Se descubrió porque el usuario vio el
       * marcado como texto en cuatro pantallas, no porque fallara nada.
       *
       * Es la cuarta vez esta semana que un centinela comprueba una FORMA
       * concreta en vez de la CONDICIÓN.
       *
       * Y la condición exacta es: **el resultado del `.join('')` se interpola
       * tal cual**, sin volver a marcarlo. Eso se reconoce por el `}` que viene
       * justo detrás:
       *
       *     ${ ….join('') }        ⛔ se escapa: la marca se perdió
       *     ${ crudo(x.join('')) } ✅ correcto: `crudo` la devuelve
       *
       * Buscar todo `.join('')` a secas acusaba a `cobros.js`, que hace lo
       * segundo y está bien. Un centinela que acusa al código correcto se acaba
       * desactivando, y entonces deja de vigilar también lo que sí importa.
       */
      if (!/\.join\(\s*''\s*\)\s*\}/.test(plantilla.texto)) continue;

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

test('⛔ una entrega del acumulado no se edita ni se borra desde la aplicacion', () => {
  /*
   * Entregar el bote es mover dinero de verdad. Si la aplicacion pudiera borrar
   * la fila, el bote volveria a mostrarse lleno y alguien lo entregaria dos
   * veces -y no quedaria rastro de la primera-.
   *
   * ⚠️ El REVOKE, no el GRANT: **un GRANT solo suma**. Neon tiene privilegios
   * por defecto que conceden los cuatro permisos sobre toda tabla nueva, asi
   * que `entregas_acumulado` nace con UPDATE y DELETE y hay que quitarlos a
   * mano. Es exactamente lo que paso con `acciones_superadmin` y costo una
   * migracion aparte (la 003); aqui va en la misma.
   *
   * Y anclado a inicio de linea (`^` con `m`) para que un REVOKE comentado con
   * `--` no lo de por bueno.
   */
  const migracion = leer(path.join('db', 'migraciones', '006-acumulado.sql'));

  assert.match(migracion, /^\s*GRANT SELECT, INSERT ON entregas_acumulado TO app_quiniela/m);
  assert.match(migracion, /^\s*REVOKE\s+UPDATE,\s*DELETE\s+ON\s+entregas_acumulado\s+FROM\s+app_quiniela/m,
    'sin el REVOKE la aplicacion hereda DELETE y puede borrar una entrega de dinero');
});

test('⛔ la base impide que la cuota del acumulado se pase de la cuota total', () => {
  /*
   * `al_acumulado > precio` daria un premio de jornada NEGATIVO, y de ahi
   * saldrian botes y deudas descuadradas sin que nada fallara. Se recorta en
   * `cobros.js` al normalizar, pero el CHECK es lo que lo impide de verdad:
   * `jornadas` tambien se escribe desde `cambiarPrecio`, que no pasa por ahi.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));
  const migracion = leer(path.join('db', 'migraciones', '006-acumulado.sql'));

  for (const [nombre, sql] of [['esquema.sql', esquema], ['006-acumulado.sql', migracion]]) {
    assert.match(sql, /CHECK\s*\(\s*al_acumulado\s*<=\s*precio\s*\)/,
      `${nombre}: falta el CHECK que impide un premio de jornada negativo`);
    assert.match(sql, /al_acumulado[\s\S]{0,120}?CHECK\s*\(\s*al_acumulado\s*>=\s*0\s*\)/,
      `${nombre}: falta el CHECK de que la cuota del acumulado no sea negativa`);
  }
});

test('⚠️ el acumulado nace apagado y todo el mundo participa', () => {
  /*
   * Los dos valores por defecto, que van en direcciones distintas a proposito:
   *
   *   - `jornadas.al_acumulado` a CERO: una quiniela que hoy funciona no puede
   *     empezar a apartar dinero para un bote porque se desplego una version.
   *   - `jugadores.juega_acumulado` a TRUE: si el administrador enciende el
   *     bote, participan todos salvo a quien el saque. Lo contrario -nadie
   *     participa hasta que los marques uno a uno- deja un bote vacio sin que
   *     nadie entienda por que.
   */
  const esquema = leer(path.join('db', 'esquema.sql'));

  assert.match(esquema, /al_acumulado\s+numeric\(12,2\)\s+NOT NULL DEFAULT 0/,
    'sin DEFAULT 0 una quiniela vieja empezaria a apartar dinero sola');
  assert.match(esquema, /juega_acumulado\s+boolean\s+NOT NULL DEFAULT true/,
    'sin DEFAULT true el bote de una quiniela que lo enciende saldria vacio');
});

test('⛔ las tablas de solo-escritura estan cerradas en las migraciones Y en el arnes', () => {
  /*
   * Tres tablas guardan hechos que no se pueden reescribir: dinero cobrado
   * (`pagos`), dinero entregado (`entregas_acumulado`) y quien borro que cuenta
   * (`acciones_superadmin`). Un asiento que el propio actor puede quitar no es
   * un asiento.
   *
   * ⚠️ Esa regla vive en DOS SITIOS y hay que cerrar los dos:
   *
   *   1. Las migraciones, que es lo que hay puesto en Neon.
   *   2. `SOLO_ESCRITURA` del arnes, que es lo que hay puesto en las pruebas.
   *
   * ⛔ Olvidarse de cualquiera de las dos mitades **no falla**. Si falta en las
   * migraciones, produccion concede DELETE y ninguna prueba lo nota. Si falta
   * en el arnes, las pruebas conceden DELETE y tampoco lo notan: una ruta que
   * borrara dinero pasaria entera en verde.
   *
   * Y paso de verdad. Durante meses el arnes concedio los cuatro permisos sobre
   * TODAS las tablas —con la advertencia de "un banco de pruebas con mas
   * privilegios que el entorno real no prueba lo que dice probar" escrita tres
   * lineas encima— mientras produccion tenia dos de ellas cerradas.
   */
  const { SOLO_ESCRITURA } = require('./postgres-en-memoria');

  const dir = path.join('db', 'migraciones');
  const sql = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .map(f => leer(path.join(dir, f)))
    .join('\n');

  /*
   * ⚠️ Anclado a inicio de linea (`^` con `m`): en SQL un comentario es `--` al
   * principio, asi que buscar el REVOKE suelto lo encuentra igual dentro de una
   * linea comentada. Es la leccion de la Entrada 069, y romper esta prueba
   * comentando un REVOKE es la forma de comprobar que sigue puesta.
   */
  const cerradasEnMigraciones = new Set();
  for (const linea of sql.split('\n')) {
    const m = /^\s*REVOKE\s+UPDATE,\s*DELETE\s+ON\s+([a-z_,\s]+?)\s+FROM\s+app_quiniela/i.exec(linea);
    if (m) for (const t of m[1].split(',')) cerradasEnMigraciones.add(t.trim());
  }

  assert.deepEqual(
    [...SOLO_ESCRITURA].sort(),
    [...cerradasEnMigraciones].sort(),
    'las dos listas tienen que decir lo mismo: lo que se cierra en Neon y lo que se cierra en las pruebas');
});

test('⛔ el hueco que pasa a ser otro partido pierde su marca de compartido', () => {
  /*
   * En el camino de reconciliacion POR POSICION, la fila conserva su `id`
   * aunque ya sea otro partido -por eso sus pronosticos se borran ahi mismo,
   * que es el arreglo de M-02-. La marca `compartido_en` tiene que irse con
   * ellos por la misma razon.
   *
   * ⛔ Si se quedara, el partido nuevo naceria con "ya se compartio" puesto y
   * la pantalla de compartir NO LO PROPONDRIA NUNCA: el grupo se quedaria sin
   * sus pronosticos y no habria error, ni aviso, ni forma de notarlo.
   *
   * ⚠️ Es una condicion que vive en DOS sitios -el borrado de pronosticos y la
   * limpieza de la marca- y las dos tienen que moverse juntas. Comprobar solo
   * una deja la otra libre para desincronizarse, y la desincronizacion no
   * falla: deja todo verde con el agujero abierto (Entrada 079).
   */
  const mod = quitarComentarios(leer(path.join('src', 'jornadas.js')));

  assert.match(mod, /borrarDePartidos\(c, cambiaronDePartido\)/,
    'si el borrado por posicion cambio de forma, revisa esta prueba entera');

  /*
   * ⚠️ ESTA MITAD ES UN CABLE, NO UNA RED, y conviene tenerlo escrito.
   *
   * Comprueba que la linea SIGUE ESCRITA, asi que caza el refactor que se la
   * lleva por delante -que es la regresion probable- pero NO caza que deje de
   * ejecutarse: se rompio a proposito metiendola dentro de un `if (false)` y
   * esta prueba paso en verde.
   *
   * La conducta la cubre "si el hueco pasa a ser OTRO partido, la marca no se
   * hereda", en test/rutas.test.js, que si cae con esa misma mutacion. Se deja
   * dicho porque creer que esto vigila la conducta seria peor que no tenerlo:
   * es la clase de centinela decorativo que la Entrada 072 encontro a montones.
   */
  /*
   * ⚠️ LAS DOS MARCAS, no una. `compartido_en` (008) y `avisado_en` (009) son
   * hechos distintos y las dos cuelgan de esa fila, asi que las dos dejan de ser
   * ciertas cuando la fila pasa a ser otro partido. Limpiar solo una deja el
   * caso a medias: el partido nuevo se propondria pero nadie avisaria de el.
   */
  assert.match(mod, /UPDATE partidos SET compartido_en = NULL, avisado_en = NULL[\s\S]{0,120}cambiaronDePartido/,
    'los partidos sustituidos pierden sus pronosticos pero conservan las marcas '
    + 'de compartido y avisado: el partido nuevo no se propondria ni se avisaria');

  /*
   * Y la vuelta: el camino por IDENTIDAD no debe limpiarla. Alli la fila que se
   * reutiliza es el mismo partido -se emparejo por api_fixture_id- asi que su
   * marca sigue siendo cierta, y borrarla haria repetir mensajes ya mandados.
   */
  /*
   * ⚠️ El corte se ancla a CODIGO, no a un comentario: `quitarComentarios` los
   * borra, asi que un `indexOf` sobre el rotulo del camino devolvia -1 y el
   * trozo examinado pasaba a ser el archivo entero. La prueba fallaba senalando
   * al inocente, que es como se descubrio.
   */
  const porIdentidad = mod.slice(
    mod.indexOf('if (hayIdentidad)'),
    mod.indexOf('const cambiaronDePartido = []'));

  assert.ok(porIdentidad.length > 200, 'el corte del camino por identidad se quedo vacio');
  assert.doesNotMatch(porIdentidad, /compartido_en/,
    'el camino por identidad reutiliza el MISMO partido: limpiar su marca haria '
    + 'que se volviera a proponer un mensaje ya mandado');
});

test('⛔ el aviso por correo toma el cerrojo antes de mandar nada', () => {
  /*
   * ============================================================
   * POR QUE ESTE TRABAJO SI NECESITA CERROJO Y LAS TRIVIAS NO
   * ============================================================
   *
   * `resolverTriviasDeTodas` corre sin cerrojo y no pasa nada: resolver dos
   * veces la misma trivia da el mismo resultado. Un correo NO es idempotente.
   *
   * Con dos instancias en Render -que es un estado normal, no una averia- las
   * dos leerian "sin avisar", las dos mandarian, y solo despues una marcaria:
   * dos correos por partido, y nadie sabria por que.
   *
   * ⛔ Y el `AND avisado_en IS NULL` de `marcarAvisados` NO cierra esa carrera:
   * protege de marcar dos veces, no de ENVIAR dos veces, y el envio va antes.
   * Es facil mirar esa linea y creer que ya esta resuelto.
   */
  const plan = quitarComentarios(leer(path.join('src', 'planificador.js')));

  assert.match(plan, /cerrojos\.tomar\(CERROJO_AVISO/,
    'el aviso manda correos: sin cerrojo, dos instancias mandan dos');

  assert.match(plan, /cerrojos\.soltar\(CERROJO_AVISO/,
    'y hay que soltarlo, o el aviso se apaga hasta que caduque');

  /*
   * El envio tiene que quedar DENTRO del cerrojo. Tomarlo y soltarlo antes de
   * mandar seria un cerrojo decorativo: se comprueba que `avisarDeTodas` cae
   * entre el `tomar` y el `finally` que suelta.
   */
  const tomar = plan.indexOf('cerrojos.tomar(CERROJO_AVISO');
  const envio = plan.indexOf('avisarDeTodas(');
  const soltar = plan.indexOf('cerrojos.soltar(CERROJO_AVISO');

  assert.ok(tomar >= 0 && envio > tomar && soltar > envio,
    'el envio tiene que ir entre tomar y soltar el cerrojo, no fuera');

  /*
   * Y el trabajo vive en su propio reloj, no colgado del ciclo del proveedor:
   * un ciclo abandonado por tiempo -hay metrica que los cuenta- se llevaria el
   * aviso con el, y avisar no necesita salir a la red.
   */
  assert.match(plan, /setInterval\([\s\S]{0,200}avisarDeCompartir\(\)/,
    'el aviso necesita su propio reloj');
});

test('⛔ el aviso por correo no lleva marcadores dentro', () => {
  /*
   * El correo avisa; la pantalla informa. Meter los pronosticos dentro no
   * filtraria nada -a esa hora ya son publicos- y aun asi esta mal: un correo
   * se reenvia, se queda en bandejas ajenas y no se puede corregir. Si el
   * proveedor se adelanto y el partido no habia arrancado, el correo llevaria
   * marcadores que no tocaba enseñar; el enlace no, porque la pantalla vuelve a
   * mirar.
   */
  const mod = quitarComentarios(leer(path.join('src', 'correo.js')));
  const aviso = mod.slice(mod.indexOf('async function enviarAvisoDeCompartir'));

  assert.ok(aviso.length > 200, 'no se encontro el aviso; revisa esta prueba');

  for (const prohibido of ['marcador1', 'marcador2', 'pronosticos', 'marcadorVisible']) {
    assert.ok(!aviso.includes(prohibido),
      `el aviso menciona "${prohibido}": el correo avisa, la pantalla informa`);
  }
});

test('⛔ toda pantalla que llame a rutas de solo-administrador esta en PAGINAS_ADMIN', () => {
  /*
   * `PAGINAS_ADMIN` es una lista escrita a mano en `src/servidor.js`. Anadir una
   * pantalla de administracion y olvidarse de meterla ahi **no falla**: la
   * pagina se sirve a cualquiera con sesion, carga entera, y luego va fallando
   * peticion por peticion con 403.
   *
   * No es una fuga de datos —las rutas de datos exigen `requireAdmin`— pero si
   * de superficie, y una experiencia pesima. Ya paso: la guardia antes solo
   * comprobaba que hubiera sesion.
   *
   * ⚠️ La condicion que se comprueba es mecanica, no una lista repetida.
   *
   * ⛔ Y hasta el 3 de septiembre lo mecanico se quedaba corto: solo miraba
   * `/api/cobros/`, escrito a mano aqui. Una pantalla de administracion que
   * usara OTRAS rutas seguia pudiendo olvidarse, y era deuda anotada en §B.2.13
   * antes de que existiera ningun caso. El primero fue `compartir.html`.
   *
   * Ahora los prefijos se DEDUCEN de las rutas: se agrupan por `/api/<x>/` y se
   * queda con aquellos en los que TODAS las rutas llevan `requireAdmin`. Si un
   * prefijo tiene una sola ruta abierta no cuenta, porque entonces una pantalla
   * de jugador puede llamarlo con toda razon —es el caso de `/api/jornadas/`,
   * que mezcla lectura publica con escritura de administracion—.
   */
  const servidor = leer(path.join('src', 'servidor.js'));
  const bloque = servidor.match(/const PAGINAS_ADMIN = \[([\s\S]*?)\];/)?.[1] || '';

  assert.ok(bloque, 'no se encontro PAGINAS_ADMIN en src/servidor.js');

  const declaradas = new Set([...bloque.matchAll(/'(\/[^']+\.html)'/g)].map(m => m[1]));

  /*
   * Que rutas hay bajo cada prefijo, y cuales exigen administrador.
   *
   * El corte del `(?=async|\(req|\n)` es para quedarse con lo que va ENTRE la
   * ruta y el manejador, que es donde se enganchan las guardias. Sin el, el
   * cuerpo entero de la ruta entraria en la comparacion y cualquier mencion a
   * requireAdmin en un comentario la daria por protegida.
   */
  const porPrefijo = new Map();

  for (const nombre of fs.readdirSync(path.join(root, 'src', 'rutas')).filter(f => f.endsWith('.js'))) {
    const codigo = leer(path.join('src', 'rutas', nombre));
    const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*(,[^)]*?)?(?=async|\(req|\r?\n)/g;

    let m;
    while ((m = re.exec(codigo))) {
      const segmentos = m[2].split('/').filter(Boolean);
      if (segmentos[0] !== 'api' || segmentos.length < 3) continue;

      const prefijo = `/api/${segmentos[1]}/`;
      if (!porPrefijo.has(prefijo)) porPrefijo.set(prefijo, []);
      porPrefijo.get(prefijo).push(/requireAdmin/.test(m[3] || ''));
    }
  }

  const soloAdmin = [...porPrefijo.entries()]
    .filter(([, guardias]) => guardias.length && guardias.every(Boolean))
    .map(([prefijo]) => prefijo);

  /*
   * ⚠️ Si esto se queda vacio la prueba pasaria sin comprobar nada, que es la
   * forma exacta en que un centinela deja de servir sin avisar (Entrada 072).
   */
  assert.ok(soloAdmin.includes('/api/cobros/') && soloAdmin.includes('/api/compartir/'),
    `la deduccion de prefijos dejo de funcionar: ${soloAdmin.join(', ')}`);

  const faltan = [];

  for (const archivo of fs.readdirSync('public').filter(f => f.endsWith('.html'))) {
    const pagina = leer(path.join('public', archivo));

    /* Los scripts propios que carga esa pagina. */
    const scripts = [...pagina.matchAll(/src="\/js\/([\w.-]+\.js)"/g)].map(m => m[1]);

    const llamaAAdmin = scripts.some(s => {
      const ruta = path.join('private', 'js', s);
      if (!fs.existsSync(path.join(root, ruta))) return false;
      const codigo = leer(ruta);
      return soloAdmin.some(prefijo => codigo.includes(prefijo));
    });

    if (llamaAAdmin && !declaradas.has('/' + archivo)) faltan.push(archivo);
  }

  assert.deepEqual(faltan, [],
    'estas pantallas llaman a rutas de administracion y se sirven a cualquiera con sesion');
});

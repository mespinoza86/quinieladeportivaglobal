/*
 * Los niveles de administrador.
 *
 * ============================================================================
 * ⛔ POR QUÉ ESTA SUITE ES UNA REJILLA ESCRITA A MANO
 * ============================================================================
 *
 * Un fallo de permisos no se parece a los demás. Si una ruta se queda con el
 * nivel equivocado **nadie ve un error**: la pantalla funciona, la petición
 * responde 200, y lo único que pasa es que alguien pudo hacer algo que no le
 * tocaba. No hay excepción, no hay registro, no hay prueba que caiga sola.
 *
 * Por eso aquí no se comprueba «que haya guardia» —eso es fácil y no dice
 * nada—: se escribe **a mano quién puede llegar a cada ruta** y se compara con
 * lo que el código monta de verdad. La rejilla es deliberadamente aburrida y
 * repetitiva; ésa es la propiedad que se busca. Si alguien mueve una capacidad
 * de escalón, esto dice exactamente qué casilla se movió.
 *
 * ⚠️ La rejilla NO se deriva de `src/permisos.js`. Derivarla sería escribir una
 * prueba que dice «el código hace lo que hace el código», que es la forma más
 * común de tener cobertura de mentira.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const db = require('../src/db');
const permisos = require('../src/permisos');
const enMemoria = require('./postgres-en-memoria');

const RAIZ = path.join(__dirname, '..');

/* ==================== 1 · La escalera ==================== */

test('los roles son una escalera: cada escalón puede todo lo del anterior', () => {
  /*
   * Ésta es LA propiedad de la que vive el resto del diseño. Si un día alguien
   * le da a `admin_jornadas` algo que `admin` no tiene, el reparto deja de ser
   * un orden y pasa a ser un conjunto de casos: nadie podría contestar «¿quién
   * puede esto?» sin leer la tabla entera.
   */
  const todas = Object.keys(permisos.CAPACIDADES);

  for (let i = 1; i < permisos.ESCALERA.length; i++) {
    const abajo = permisos.ESCALERA[i - 1];
    const arriba = permisos.ESCALERA[i];

    for (const cap of todas) {
      if (permisos.puede(abajo, cap)) {
        assert.ok(permisos.puede(arriba, cap),
          `"${arriba}" está por encima de "${abajo}" pero no alcanza "${cap}"`);
      }
    }
  }
});

test('un jugador no alcanza NINGUNA capacidad', () => {
  for (const cap of Object.keys(permisos.CAPACIDADES)) {
    assert.equal(permisos.puede('user', cap), false, `un jugador alcanzó "${cap}"`);
  }
  assert.equal(permisos.capacidadesDe('user').length, 0);
});

test('un rol inventado no alcanza nada, y no revienta', () => {
  /*
   * Importa porque el rol llega de la BASE. Si un día hubiera una fila con un
   * valor raro —una migración a medias, un arreglo a mano— lo que NO puede
   * pasar es que `escalon()` devuelva algo que cuele.
   */
  assert.equal(permisos.puede('superjefe', 'admin.ver'), false);
  assert.equal(permisos.puede(null, 'admin.ver'), false);
  assert.equal(permisos.puede(undefined, 'admin.ver'), false);
  assert.equal(permisos.puede('', 'admin.ver'), false);
});

test('⛔ una capacidad mal escrita revienta en vez de decir que no', () => {
  /*
   * Un `false` silencioso sería seguro y MUDO: la ruta quedaría cerrada para
   * todo el mundo y el fallo aparecería semanas después como «no tengo
   * permisos». Reventar hace que caiga la suite el mismo día.
   */
  assert.throws(() => permisos.puede('propietario', 'dinero.gestion'),
    /Capacidad desconocida/);
});

test('sólo el dueño elimina la quiniela y sólo el dueño reparte roles', () => {
  /* Las dos cosas que Marco separó explícitamente del administrador pleno. */
  assert.deepEqual(permisos.rolesCon('quiniela.eliminar'), ['propietario']);
  assert.deepEqual(permisos.rolesCon('roles.asignar'), ['propietario']);

  assert.equal(permisos.puede('admin', 'quiniela.eliminar'), false);
  assert.equal(permisos.puede('admin', 'roles.asignar'), false);
});

test('⛔ propietario NO se puede repartir desde la pantalla de roles', () => {
  /*
   * Si estuviera en la lista, cambiar un rol sería una forma callada de regalar
   * la quiniela. Hacerse dueño pasa por `transferir-propiedad`, que es otra
   * ruta con su confirmación.
   */
  assert.ok(!permisos.ROLES_ASIGNABLES.includes('propietario'));
  assert.ok(permisos.ROLES_ASIGNABLES.includes('admin'));
  assert.ok(permisos.ROLES_ASIGNABLES.includes('admin_jornadas'));
  assert.ok(permisos.ROLES_ASIGNABLES.includes('admin_lector'));
  assert.ok(permisos.ROLES_ASIGNABLES.includes('user'));
});

/* ==================== 2 · La rejilla ==================== */

/*
 * Ruta -> el escalón MÁS BAJO que puede llamarla.
 *
 * Escrito a mano desde lo que pidió Marco, sin mirar `src/permisos.js`:
 *
 *   «un administrador que puede hacer jornadas, pero no puede cambiar
 *    marcadores, ni borrar jugadores o modificar esas cosas, ni tampoco
 *    modificar lo de los cobros»
 *
 *   «otro nivel de administrador que no puede ni hacer jornadas, ni borrar
 *    nada, ni cambiar nada, pero sí puede enviar los partidos y ver las cosas
 *    que ven los otros administradores»
 */
const REJILLA = {
  /* ---- Mirar: todos los escalones administrativos ---- */
  'get /api/admin/respuestas-trivias-jornada/:jornadaNombre': 'admin_lector',
  'get /api/admin/sync-metricas': 'admin_lector',
  'get /api/admin/trivias/:jornadaNombre': 'admin_lector',
  'get /api/debug/estado-partido/:status': 'admin_lector',
  'get /api/debug/jornadas': 'admin_lector',
  'get /api/cobros/cuentas': 'admin_lector',
  'get /api/cobros/abonos': 'admin_lector',
  'get /api/cobros/reporte': 'admin_lector',
  'get /api/cobros/botes': 'admin_lector',
  'get /api/cobros/caja': 'admin_lector',
  'get /api/compartir/pendientes': 'admin_lector',
  'get /api/quiniela-actual/miembros': 'admin_lector',

  /* ---- Enviar al grupo: «sí puede enviar los partidos» ---- */
  'post /api/compartir/marcar': 'admin_lector',
  'post /api/compartir/desmarcar': 'admin_lector',

  /* ---- Armar jornadas ---- */
  /*
   * El borrador propone la jornada siguiente ya armada (§22). Va con los
   * demas de armar jornadas: quien puede crearlas puede pedir la propuesta.
   * ⚠️ Sale a la red del proveedor, asi que NO puede alcanzarla el escalon de
   * solo lectura: la cuota es una sola para todas las quinielas.
   */
  'get /api/borrador-de-jornada': 'admin_jornadas',
  'post /api/jornadas': 'admin_jornadas',
  'post /api/jornadas/agregar-partido': 'admin_jornadas',
  'post /api/jornadas/eliminar-partidos': 'admin_jornadas',
  'post /api/jornadas/comodin': 'admin_jornadas',
  'delete /api/jornadas/:nombre': 'admin_jornadas',
  'post /actualizar-equipos': 'admin_jornadas',
  'post /api/admin/trivias': 'admin_jornadas',
  'put /api/admin/trivias/:jornadaNombre': 'admin_jornadas',
  'delete /api/admin/trivias/:triviaId': 'admin_jornadas',

  /*
   * ⚠️ Las del proveedor son de `admin_jornadas` y NUNCA del sólo-lectura: la
   * cuota de APIFootball es UNA para todas las quinielas.
   */
  'get /api/football/fixtures': 'admin_jornadas',
  'get /api/football/ligas-disponibles': 'admin_jornadas',
  'get /api/football/leagues': 'admin_jornadas',
  'get /api/debug/api-football-match/:matchId': 'admin_jornadas',
  'get /debug/trivia-goles/:matchId': 'admin_jornadas',
  'get /api/admin/debug-partido-api/:matchId': 'admin_jornadas',

  /* ---- «no puede cambiar marcadores» ---- */
  'post /api/admin/resultados': 'admin',
  'post /api/resultados-oficiales': 'admin',
  'post /api/sync-resultados-oficiales/:jornada': 'admin',
  'post /api/admin/trivias/resolver': 'admin',

  /* ---- «ni borrar jugadores» ---- */
  'post /api/jugadores': 'admin',
  'delete /api/jugadores/:nombre': 'admin',
  'patch /api/quiniela-actual/miembros/:membresiaId/aprobar': 'admin',
  'patch /api/quiniela-actual/miembros/:membresiaId/rechazar': 'admin',
  'patch /api/quiniela-actual/miembros/:membresiaId/aprobar-retiro': 'admin',
  'patch /api/quiniela-actual/miembros/:membresiaId/expulsar': 'admin',

  /* ---- «ni tampoco modificar lo de los cobros» ---- */
  'post /api/cobros/abonos': 'admin',
  'post /api/cobros/abonos/:pagoId/anular': 'admin',
  'patch /api/cobros/jugadores/:jugadorId': 'admin',
  'post /api/cobros/acumulado/entregar': 'admin',
  'patch /api/cobros/jornadas/:nombre/precio': 'admin',
  'post /api/cobros/jornadas/:nombre/entregar-premio': 'admin',

  /* ---- Configuración ---- */
  'patch /api/quiniela-actual/configuracion': 'admin',
  'patch /api/quiniela-actual/archivar': 'admin',

  /* ---- Sólo el dueño ---- */
  'delete /api/quiniela-actual': 'propietario',
  'post /api/quiniela-actual/transferir-propiedad': 'propietario',
  'patch /api/quiniela-actual/miembros/:membresiaId/rol': 'propietario'
};

/** Lo que el código monta DE VERDAD: ruta -> capacidad exigida. */
function guardiasDelCodigo() {
  const encontradas = new Map();
  const dir = path.join(RAIZ, 'src', 'rutas');

  for (const nombre of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const codigo = fs.readFileSync(path.join(dir, nombre), 'utf8');
    const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'[^\n]*?requierePermiso\('([^']+)'\)/g;

    let m;
    while ((m = re.exec(codigo))) {
      encontradas.set(`${m[1]} ${m[2]}`, { capacidad: m[3], fichero: nombre });
    }
  }
  return encontradas;
}

test('⛔ la rejilla y el código dicen lo mismo, casilla por casilla', () => {
  const reales = guardiasDelCodigo();

  /*
   * ⚠️ Control positivo. Si la extracción se rompiera —un cambio de formato, un
   * `requierePermiso` partido en dos líneas— este test pasaría sin comprobar
   * nada, que es como un centinela deja de servir sin avisar (Entrada 072).
   */
  assert.ok(reales.size >= 45,
    `la extracción de guardias dejó de funcionar: sólo ${reales.size} rutas`);

  const faltan = [...reales.keys()].filter(k => !REJILLA[k]);
  assert.deepEqual(faltan, [],
    'rutas con guardia que NADIE puso en la rejilla: decide quién puede llamarlas');

  const sobran = Object.keys(REJILLA).filter(k => !reales.has(k));
  assert.deepEqual(sobran, [],
    'rutas en la rejilla que ya no existen en el código: la rejilla envejeció');

  /* Y ahora la comparación de verdad: rol por rol, ruta por ruta. */
  const diferencias = [];

  for (const [clave, { capacidad }] of reales) {
    const minimoEsperado = REJILLA[clave];

    for (const rol of permisos.ESCALERA) {
      const deberia = permisos.escalon(rol) >= permisos.escalon(minimoEsperado);
      const puede = permisos.puede(rol, capacidad);

      if (deberia !== puede) {
        diferencias.push(
          `${clave} · exige "${capacidad}" · "${rol}" ${puede ? 'PUEDE' : 'no puede'}` +
          ` pero la rejilla dice ${deberia ? 'que sí' : 'que NO'}`);
      }
    }
  }

  assert.deepEqual(diferencias, []);
});

test('⛔ ninguna ruta de administración se quedó sin guardia', () => {
  /*
   * El agujero que esta rejilla NO ve por sí sola: una ruta nueva sin
   * `requierePermiso` no aparece en `reales`, así que tampoco aparece como
   * diferencia. Esto la busca por el otro lado.
   */
  const dir = path.join(RAIZ, 'src', 'rutas');
  const sospechosas = [];

  for (const nombre of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const codigo = fs.readFileSync(path.join(dir, nombre), 'utf8');
    const re = /app\.(get|post|put|patch|delete)\(\s*'(\/api\/(?:admin|cobros|compartir)\/[^']*)'([^\n]*)/g;

    let m;
    while ((m = re.exec(codigo))) {
      if (!/requierePermiso\(/.test(m[3])) sospechosas.push(`${nombre} · ${m[1]} ${m[2]}`);
    }
  }

  assert.deepEqual(sospechosas, [],
    'rutas bajo /api/admin, /api/cobros o /api/compartir sin requierePermiso');
});

test('⛔ toda capacidad usada en el código existe en la tabla', () => {
  const usadas = new Set([...guardiasDelCodigo().values()].map(v => v.capacidad));
  const inventadas = [...usadas].filter(c => !permisos.CAPACIDADES[c]);

  assert.deepEqual(inventadas, []);
});

test('ninguna capacidad de la tabla se quedó sin usar', () => {
  /*
   * No es purismo: una capacidad que no guarda ninguna ruta es una promesa que
   * la pantalla puede estar enseñando —«este rol puede X»— sin que X exista.
   */
  const usadas = new Set([...guardiasDelCodigo().values()].map(v => v.capacidad));
  const huerfanas = Object.keys(permisos.CAPACIDADES).filter(c => !usadas.has(c));

  assert.deepEqual(huerfanas, []);
});

/* ==================== 3 · Con peticiones de verdad ==================== */

let app;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.APIFOOTBALL_COM_KEY = 'clave-falsa-no-se-usa';
  const adaptador = await enMemoria.levantar();
  app = require('../src/servidor').crearApp({
    pool: adaptador,
    secretoSesion: 'secreto-solo-para-pruebas'
  }).app;
});

test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

let n = 0;
function credenciales(prefijo) {
  n += 1;
  return {
    username: `${prefijo}${n}`,
    email: `${prefijo}${n}@ejemplo.com`,
    password: 'contrasena-larga-1',
    confirmarPassword: 'contrasena-larga-1'
  };
}

async function cuentaNueva(prefijo = 'usu') {
  const correo = require('../src/correo');
  const agente = request.agent(app);
  const datos = credenciales(prefijo);

  await agente.post('/api/auth/registro').send(datos);
  const token = correo.bandeja.at(-1).texto.match(/token=([a-f0-9]{64})/)[1];
  await agente.post('/api/auth/verificar-correo').send({ token });
  await agente.post('/api/auth/login')
    .send({ identificador: datos.username, password: datos.password });

  return { agente, datos };
}

/**
 * Un dueño con su quiniela, y un segundo miembro con el rol que se pida,
 * aprobado y con el Admin Mode puesto.
 *
 * ⚠️ Pasa por el flujo entero —unirse, aprobar, cambiar rol, activar Admin
 * Mode— en vez de escribir el rol en la base. Cuesta cinco peticiones y a
 * cambio prueba que el reparto de roles FUNCIONA, no sólo que la guardia lee
 * bien una columna.
 */
async function conRol(rol) {
  const dueno = await cuentaNueva('due');
  const creada = await dueno.agente.post('/api/quinielas').send({ nombre: 'Quiniela de prueba' });
  const quiniela = creada.body.quiniela;

  await dueno.agente.post(`/api/quinielas/${quiniela.id}/seleccionar`).send({});
  await dueno.agente.post('/api/admin-mode/activar').send({ password: dueno.datos.password });

  const otro = await cuentaNueva('otr');
  await otro.agente.post('/api/quinielas/unirse').send({ codigoIngreso: quiniela.codigoIngreso });

  const miembros = await dueno.agente.get('/api/quiniela-actual/miembros');
  const pendiente = miembros.body.find(m => m.estado === 'pendiente_ingreso');
  await dueno.agente.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`).send({});

  const cambio = await dueno.agente
    .patch(`/api/quiniela-actual/miembros/${pendiente.id}/rol`).send({ rol });
  assert.equal(cambio.status, 200, `no se pudo poner el rol ${rol}: ${JSON.stringify(cambio.body)}`);

  await otro.agente.post(`/api/quinielas/${quiniela.id}/seleccionar`).send({});
  await otro.agente.post('/api/admin-mode/activar').send({ password: otro.datos.password });

  return { dueno, otro, quiniela, membresiaId: pendiente.id };
}

test('el de sólo lectura ve los cobros pero no los toca', async () => {
  const { otro } = await conRol('admin_lector');

  const mirando = await otro.agente.get('/api/cobros/caja');
  assert.equal(mirando.status, 200, 'debería poder VER la caja');

  const tocando = await otro.agente.post('/api/cobros/abonos')
    .send({ jugador: 'quien-sea', jornada: 'Jornada1', monto: 1000 });
  assert.equal(tocando.status, 403, 'NO debería poder anotar un abono');
  assert.equal(tocando.body.capacidadRequerida, 'dinero.gestionar');
});

test('el de sólo lectura envía partidos al grupo, que es su trabajo', async () => {
  const { otro } = await conRol('admin_lector');

  const pendientes = await otro.agente.get('/api/compartir/pendientes');
  assert.equal(pendientes.status, 200);
});

test('el de sólo lectura NO arma jornadas', async () => {
  const { otro } = await conRol('admin_lector');

  const res = await otro.agente.post('/api/jornadas')
    .send({ nombre: 'Jornada9', partidos: [] });
  assert.equal(res.status, 403);
});

test('⛔ el de sólo lectura NO gasta la cuota del proveedor', async () => {
  /*
   * La cuota de APIFootball es una sola para TODAS las quinielas. Es el escalón
   * que más gente va a tener, y el daño no se quedaría en su quiniela.
   */
  const { otro } = await conRol('admin_lector');

  const res = await otro.agente.get('/api/football/fixtures?desde=2099-01-01&hasta=2099-01-02');
  assert.equal(res.status, 403);
});

test('el de jornadas arma jornadas pero no fija marcadores', async () => {
  const { otro } = await conRol('admin_jornadas');

  const armando = await otro.agente.post('/api/jornadas')
    .send({ nombre: 'Jornada9', partidos: [] });
  assert.notEqual(armando.status, 403, 'debería poder crear una jornada');

  const fijando = await otro.agente.post('/api/resultados-oficiales')
    .send({ jornada: 'Jornada9', resultados: {} });
  assert.equal(fijando.status, 403, 'NO debería fijar resultados oficiales');
  assert.equal(fijando.body.capacidadRequerida, 'resultados.escribir');
});

test('el de jornadas no borra jugadores ni toca los cobros', async () => {
  const { otro } = await conRol('admin_jornadas');

  const borrando = await otro.agente.delete('/api/jugadores/alguien');
  assert.equal(borrando.status, 403);

  const cobrando = await otro.agente
    .patch('/api/cobros/jornadas/Jornada1/precio').send({ precio: 5000 });
  assert.equal(cobrando.status, 403);
});

test('el administrador pleno hace todo menos eliminar la quiniela', async () => {
  const { otro, quiniela } = await conRol('admin');

  const configurando = await otro.agente
    .patch('/api/quiniela-actual/configuracion').send({ avisarAlCompartir: true });
  assert.equal(configurando.status, 200, 'debería poder configurar');

  const borrando = await otro.agente.delete('/api/quiniela-actual')
    .send({ nombre: quiniela.nombre });
  assert.equal(borrando.status, 403, 'NO debería poder eliminar la quiniela');
  assert.equal(borrando.body.capacidadRequerida, 'quiniela.eliminar');
});

test('⛔ un administrador pleno NO puede repartir roles', async () => {
  /*
   * La decisión de seguridad de todo el reparto, y la que Marco pidió con estas
   * palabras: «el único que asigna o modifica las capacidades es el dueño».
   *
   * Si esto dejara pasar, el reparto no significaría nada: cualquiera con el
   * escalón alto podría concederlo, incluso nombrarse pares para siempre.
   */
  const { otro, membresiaId } = await conRol('admin');

  const res = await otro.agente
    .patch(`/api/quiniela-actual/miembros/${membresiaId}/rol`).send({ rol: 'user' });

  assert.equal(res.status, 403);
  assert.equal(res.body.capacidadRequerida, 'roles.asignar');
});

test('un jugador raso no entra ni al modo administrador', async () => {
  const { otro } = await conRol('user');

  const modo = await otro.agente.get('/api/admin-mode');
  assert.equal(modo.body.autorizadoPorRol, false);

  const mirando = await otro.agente.get('/api/cobros/caja');
  assert.equal(mirando.status, 403);
});

test('⛔ el código de ingreso no se le enseña al de sólo lectura', async () => {
  /*
   * Con ese código se entra a la quiniela: repartirlo ES meter gente, y meter
   * gente es justo lo que este escalón no hace.
   */
  const lector = await conRol('admin_lector');
  const vistaLector = await lector.otro.agente.get('/api/quiniela-actual');
  assert.equal(vistaLector.body.codigoIngreso, undefined);

  const pleno = await conRol('admin');
  const vistaPleno = await pleno.otro.agente.get('/api/quiniela-actual');
  assert.ok(vistaPleno.body.codigoIngreso, 'el administrador pleno sí debe verlo');
});

test('⛔ la quiniela no se puede quedar sin nadie que gestione', async () => {
  /*
   * Antes esto sólo miraba el paso de `admin` a `user`. Con escalones hay una
   * forma nueva de dejarla huérfana: bajar al único administrador a
   * `admin_jornadas`, que NO gestiona miembros. La comprobación pasó a mirar si
   * PIERDE la capacidad, no la etiqueta a la que se mueve.
   */
  const { dueno, otro, membresiaId } = await conRol('admin');

  /* Con el dueño dentro, bajarlo se puede: queda alguien que gestiona. */
  const primera = await dueno.agente
    .patch(`/api/quiniela-actual/miembros/${membresiaId}/rol`).send({ rol: 'admin_jornadas' });
  assert.equal(primera.status, 200);

  assert.ok(otro, 'el segundo miembro sigue existiendo');
});

/* ==================== 4 · Que no vuelva a repartirse ==================== */

test('⛔ nadie escribe una LISTA de roles fuera de src/permisos.js', () => {
  /*
   * El diseño entero se apoya en que la escalera viva en un sitio. Una lista
   * suelta —`['propietario', 'admin']`— no da error el día que se escribe: da
   * error el día que se añade un escalón y alguien se queda fuera, o peor, se
   * queda dentro. Había once de esas listas repartidas por el código antes de
   * esta entrada, y dos estaban en el navegador.
   *
   * ⚠️ Lo que se prohíbe es la LISTA, no comparar con un rol concreto:
   * `m.rol !== 'propietario'` para no dejar cambiarle el rol al dueño habla del
   * miembro que se pinta y es correcto. Lo que envejece es enumerar «quiénes
   * mandan».
   */
  const B = String.fromCharCode(92);
  const listaDeRoles = new RegExp(
    "[" + B + "[(]" + B + "s*'(propietario|admin|admin_jornadas|admin_lector|user)'" +
    B + "s*,[" + B + "s]*'(propietario|admin|admin_jornadas|admin_lector|user)'", 'g');

  const sospechosos = [];
  const mirar = (dir, filtro) => {
    for (const entrada of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const relativo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) { mirar(relativo, filtro); continue; }
      if (!filtro(entrada.name)) continue;
      if (relativo.endsWith(`permisos.js`)) continue;

      const codigo = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
      /* Sin comentarios: uno que MENCIONE la lista vieja no es un uso. */
      const sinComentarios = codigo
        .split('\n')
        .filter(l => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .join('\n');

      if (listaDeRoles.test(sinComentarios)) sospechosos.push(relativo);
      listaDeRoles.lastIndex = 0;
    }
  };

  mirar('src', f => f.endsWith('.js'));
  mirar(path.join('private', 'js'), f => f.endsWith('.js'));

  assert.deepEqual(sospechosos, [],
    'listas de roles a mano: usa permisos.puede() o las capacidades que manda el servidor');
});

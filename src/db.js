/*
 * La capa de datos sobre PostgreSQL.
 *
 * Este módulo es el único sitio del proyecto que sabe abrir una transacción y
 * fijar el contexto de quiniela. Todo lo demás pasa por aquí.
 *
 * ============================================================================
 * LAS TRES REGLAS QUE SOSTIENEN EL AISLAMIENTO (Entradas 038 y 039)
 * ============================================================================
 *
 * 1. LA TRANSACCIÓN ES POR PETICIÓN, NO POR CONSULTA.
 *
 *    Todas las consultas de una petición caben en la misma transacción con el
 *    mismo contexto, así que el sobrecoste del aislamiento se paga UNA vez.
 *    Si alguien escribe una transacción por consulta, el coste se multiplica
 *    por cuatro y parecerá culpa de PostgreSQL. Por eso `enQuiniela` es
 *    reentrante: si ya estamos dentro de una, reutiliza la que hay en vez de
 *    abrir otra.
 *
 * 2. EL CONTEXTO SE FIJA CON `SET LOCAL`, DENTRO DE LA TRANSACCIÓN.
 *
 *    Es TODA la defensa. Con un pool, la conexión que atendió a la quiniela A
 *    la reutiliza después otra petición cualquiera; `SET LOCAL` hace que
 *    PostgreSQL deshaga el contexto al cerrar la transacción. Un `SET` de
 *    sesión NO sirve: el pooler de Neon trabaja en modo transacción y el
 *    contexto se colaría en la petición siguiente. Sería una fuga peor que
 *    C-02, porque sería intermitente y dependería de la carga.
 *
 * 3. LA APLICACIÓN NO SE CONECTA CON EL ROL DUEÑO.
 *
 *    El dueño puede APAGAR RLS con un `ALTER TABLE`. `app_quiniela` sólo puede
 *    leer y escribir filas. `comprobarRol()` lo verifica al arrancar y se
 *    niega a seguir si no es así — no avisa, se planta: un aviso al arrancar
 *    no lo lee nadie.
 *
 * ============================================================================
 */
'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

/*
 * El contexto de la petición en curso: qué cliente de la base tiene abierta la
 * transacción y con qué quiniela. Es el mismo mecanismo que usaba el
 * `tenantContext` de Mongoose, y por el mismo motivo: no hay que ir pasando el
 * cliente de mano en mano por veinte funciones.
 */
const contexto = new AsyncLocalStorage();

let fuente = null;          // el pool de `pg`, o el adaptador de pruebas
let esAdaptador = false;

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ========================= Arranque y cierre ========================= */

/**
 * Arranca el pool contra PostgreSQL.
 *
 * `max` no es un número al azar: son las conexiones simultáneas que esta
 * instancia puede tener abiertas. El plan gratuito de Neon tiene un límite
 * bajo, y con varias instancias en Render se suman.
 */
function iniciar(cadena = process.env.DATABASE_URL, opciones = {}) {
  if (fuente) return fuente;
  if (!cadena) throw new Error('Falta DATABASE_URL');

  const { Pool } = require('pg');
  fuente = new Pool({
    connectionString: cadena,
    max: Number(process.env.DB_MAX_CONEXIONES || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...opciones
  });

  /*
   * Un error en una conexión inactiva del pool llega aquí y, sin este
   * manejador, tumba el proceso entero. Con Neon pasa de forma normal: el
   * plan gratuito suspende el cómputo por inactividad y corta las conexiones
   * abiertas. No es un fallo, es el comportamiento del plan.
   */
  fuente.on('error', error => {
    console.error('[db] conexión inactiva caída (normal si Neon se suspendió):', error.message);
  });

  return fuente;
}

/** Inyecta un adaptador en lugar del pool. Es la costura para las pruebas. */
function usarAdaptador(adaptador) {
  fuente = adaptador;
  esAdaptador = true;
}

async function cerrar() {
  if (!fuente) return;
  await fuente.end();
  fuente = null;
  esAdaptador = false;
}

/**
 * ⛔ Se planta si la aplicación se conecta con un rol que puede desactivar RLS.
 *
 * Mirar `rolsuper` y `rolbypassrls` NO basta: el rol dueño de Neon no es
 * ninguna de las dos cosas y aun así puede apagar RLS. Lo que lo delata es ser
 * dueño de las tablas.
 */
async function comprobarRol() {
  const { rows: [r] } = await consulta(`
    SELECT current_user AS usuario,
           (SELECT count(*) FROM pg_tables
             WHERE schemaname = 'public' AND tableowner = current_user)::int AS propias,
           (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS superusuario,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`);

  if (r.superusuario || r.bypassrls || r.propias > 0) {
    throw new Error(
      `La aplicación está conectada como "${r.usuario}", que puede desactivar RLS ` +
      `(dueño de ${r.propias} tablas, superusuario=${r.superusuario}, bypassrls=${r.bypassrls}). ` +
      'DATABASE_URL tiene que usar el rol app_quiniela. Ver el Anexo C.');
  }
  return r.usuario;
}

/* ========================= Consultar ========================= */

/**
 * Una consulta suelta, sin contexto de quiniela.
 *
 * Sirve para las tablas de plataforma —`usuarios`, `quinielas`, `membresias`,
 * `fixtures`, `job_locks`—, que no llevan RLS. Si se usa contra una tabla de
 * dominio sin contexto, RLS devuelve cero filas: no es un fallo de la consulta,
 * es la política haciendo su trabajo.
 *
 * Si ya estamos dentro de una transacción, va por ella. Eso importa: una
 * lectura de plataforma en mitad de una escritura tiene que ver el mismo estado.
 */
function consulta(sql, params) {
  const actual = contexto.getStore();
  if (actual) return actual.cliente.query(sql, params);
  if (!fuente) throw new Error('La base no está iniciada: llama a iniciar() primero');
  return fuente.query(sql, params);
}

/* ========================= Transacciones ========================= */

/**
 * Ejecuta `fn` dentro de una transacción, sin contexto de quiniela.
 *
 * Para las secuencias de varias escrituras sobre tablas de plataforma. Es el
 * relevo de `src/transacciones.js`, y aquí no hace falta el baile de "MongoDB
 * sólo hace transacciones sobre un conjunto de réplicas": en PostgreSQL las
 * transacciones son de serie y sin condiciones.
 */
async function enTransaccion(fn) {
  const actual = contexto.getStore();
  if (actual) return fn(actual.cliente);   // reentrante: ya hay una abierta

  const cliente = await fuente.connect();
  try {
    await cliente.query('BEGIN');
    const r = await contexto.run({ cliente, quinielaId: null }, () => fn(cliente));
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch { /* la conexión ya no sirve */ }
    throw e;
  } finally {
    cliente.release();
  }
}

/**
 * Ejecuta `fn` dentro de una transacción CON el contexto de una quiniela.
 *
 * A partir de aquí, las 12 tablas de dominio sólo dejan ver y tocar las filas
 * de esa quiniela, y lo impone la base: una consulta a la que se le olvide el
 * filtro no ve nada ajeno, y una inserción con otra `quiniela_id` la rechaza la
 * política. Es la diferencia con el `tenantPlugin` de Mongoose, que no
 * enganchaba `aggregate` ni `insertMany` ni `bulkWrite` (M-33).
 *
 * ⚠️ Reentrante a propósito (regla 1): si ya estamos dentro del contexto de
 * ESTA misma quiniela, reutiliza la transacción. Si se pide otra quiniela
 * distinta estando dentro de una, es un error de programación y se avisa: sería
 * justo el cruce que todo esto existe para impedir.
 */
async function enQuiniela(quinielaId, fn) {
  const id = String(quinielaId || '');
  if (!ES_UUID.test(id)) throw new Error(`quinielaId no es un UUID: ${quinielaId}`);

  const actual = contexto.getStore();
  if (actual?.quinielaId === id) return fn(actual.cliente);
  if (actual?.quinielaId) {
    throw new Error(
      `Anidar el contexto de la quiniela ${id} dentro del de ${actual.quinielaId}. ` +
      'Una petición atiende a una sola quiniela.');
  }

  const cliente = actual?.cliente || await fuente.connect();
  const propia = !actual;

  try {
    /*
     * `BEGIN` y el contexto en UNA sola llamada: cada `await` contra la base es
     * un viaje de ida y vuelta, y con la base en otra región eso se nota
     * (Entrada 039). El protocolo simple no admite parámetros, así que el
     * identificador va interpolado — y por eso se valida como UUID arriba.
     * Sin esa validación esto sería una inyección de SQL de manual.
     */
    if (propia) await cliente.query(`BEGIN; SELECT set_config('app.quiniela_id', '${id}', true);`);
    else        await cliente.query(`SELECT set_config('app.quiniela_id', '${id}', true)`);

    const r = await contexto.run({ cliente, quinielaId: id }, () => fn(cliente));
    if (propia) await cliente.query('COMMIT');
    return r;
  } catch (e) {
    if (propia) { try { await cliente.query('ROLLBACK'); } catch { /* ya no sirve */ } }
    throw e;
  } finally {
    if (propia) cliente.release();
    else {
      /*
       * Entramos prestados en una transacción que NO tenía contexto de
       * quiniela —es el caso de `enTransaccion` haciendo un apaño de dominio en
       * medio, como el alta del jugador al aprobar un miembro—. Al salir hay
       * que dejarla como estaba: si no, lo que venga después en esa misma
       * transacción seguiría filtrado por esta quiniela sin haberlo pedido.
       */
      try { await cliente.query(`SELECT set_config('app.quiniela_id', '', true)`); }
      catch { /* la transacción ya está abortada: da igual */ }
    }
  }
}

/** La quiniela del contexto en curso, o `null`. */
function quinielaActual() {
  return contexto.getStore()?.quinielaId || null;
}

/* ========================= Esquema ========================= */

const RUTA_ESQUEMA = path.join(__dirname, '..', 'db', 'esquema.sql');

/** Aplica `db/esquema.sql`. Lo usan las pruebas y la creación de una base nueva. */
async function aplicarEsquema(cliente = null) {
  const sql = fs.readFileSync(RUTA_ESQUEMA, 'utf8');
  if (cliente) return cliente.query(sql);
  return fuente.query(sql);
}

module.exports = {
  iniciar, cerrar, usarAdaptador, comprobarRol,
  consulta, enTransaccion, enQuiniela, quinielaActual,
  aplicarEsquema, RUTA_ESQUEMA,
  get iniciada() { return Boolean(fuente); },
  get esDePruebas() { return esAdaptador; }
};

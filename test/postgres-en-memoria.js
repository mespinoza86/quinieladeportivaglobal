/*
 * Un PostgreSQL de verdad para las pruebas, sin red y sin Docker.
 *
 * Es PGlite: PostgreSQL 18 compilado a WebAssembly, un paquete de npm y ya.
 * Arranca en unos 3 segundos, contra los 13,4 que tardaba `MongoMemoryReplSet`
 * (Entrada 032). Ese es el motivo de que las pruebas no se hayan hecho más
 * lentas con la migración, sino más rápidas.
 *
 * ⚠️ PGlite ATIENDE UNA SOLA CONEXIÓN.
 *
 * La aplicación pide conexiones a un pool y las suelta; aquí sólo hay una, así
 * que este adaptador reparte turnos: quien pide `connect()` espera a que el
 * anterior llame a `release()`. Con las pruebas eso no estorba —son
 * secuenciales— pero tiene una consecuencia que hay que saber:
 *
 *   NINGUNA PRUEBA DE CONCURRENCIA REAL SIRVE AQUÍ. Si dos peticiones se lanzan
 *   con `Promise.all`, este adaptador las serializa y la prueba pasará aunque
 *   el código tenga una carrera. Lo concurrente se comprueba contra un
 *   PostgreSQL de verdad, con `sondeo-sql/probar-pool.js`.
 */
'use strict';

const db = require('../src/db');

/** ¿Lleva varias sentencias? PGlite necesita `exec` para eso, y no admite parámetros. */
function esMultiple(sql) {
  return /;\s*\S/.test(sql);
}

/** Deja las respuestas de PGlite con la forma que devuelve `pg`. */
function comoPg(resultado) {
  const r = Array.isArray(resultado) ? resultado[resultado.length - 1] : resultado;
  return {
    rows: r?.rows || [],
    rowCount: r?.affectedRows ?? (r?.rows ? r.rows.length : 0),
    fields: r?.fields || []
  };
}

class PostgresEnMemoria {
  constructor(pglite) {
    this.pglite = pglite;
    this.cola = Promise.resolve();
  }

  async ejecutar(sql, params) {
    if (esMultiple(sql)) {
      if (params && params.length) {
        throw new Error('PGlite no admite parámetros en sentencias múltiples');
      }
      return comoPg(await this.pglite.exec(sql));
    }
    return comoPg(await this.pglite.query(sql, params));
  }

  /** Una consulta suelta, sin reservar turno. */
  query(sql, params) {
    return this.ejecutar(sql, params);
  }

  /**
   * Reserva la única conexión hasta que se llame a `release()`.
   *
   * La cola es una cadena de promesas: cada quien espera a que el anterior
   * suelte. Sin esto, dos transacciones se pisarían —una haría COMMIT de lo de
   * la otra— y las pruebas fallarían de formas incomprensibles.
   */
  async connect() {
    let liberar;
    const miTurno = new Promise(resolver => { liberar = resolver; });
    const anterior = this.cola;
    this.cola = this.cola.then(() => miTurno);
    await anterior;

    let soltada = false;
    return {
      query: (sql, params) => this.ejecutar(sql, params),
      release: () => { if (!soltada) { soltada = true; liberar(); } }
    };
  }

  async end() {
    await this.cola;
    await this.pglite.close();
  }
}

/*
 * ⚠️ EL ARNÉS TIENE QUE CORRER CON LOS MISMOS PERMISOS QUE PRODUCCIÓN.
 *
 * PGlite conecta como `postgres`, que es SUPERUSUARIO, y los superusuarios se
 * saltan RLS entero. Sin lo de abajo, las pruebas de aislamiento pasan siempre:
 * ven todas las quinielas y no se quejan, porque no hay política que aplicar.
 *
 * Es el mismo error que costó cuatro vueltas montando el Anexo C (Entradas 034
 * a 037): un banco de pruebas con más privilegios que el entorno real no prueba
 * lo que dice probar. Aquí se crea el rol `app_quiniela` igual que en Neon y la
 * sesión se pone en su piel.
 */
const PREPARAR_ROL = `
  CREATE ROLE app_quiniela NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  GRANT USAGE ON SCHEMA public TO app_quiniela;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_quiniela;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_quiniela;
  SET ROLE app_quiniela;
`;

/**
 * Levanta la base, aplica `db/esquema.sql` y la deja enchufada en `src/db`.
 *
 * Devuelve la instancia para poder cerrarla al terminar la suite.
 */
async function levantar() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = await PGlite.create();
  const adaptador = new PostgresEnMemoria(pglite);

  db.usarAdaptador(adaptador);
  await db.aplicarEsquema();
  await adaptador.query(PREPARAR_ROL);

  // Si esto falla, las pruebas de aislamiento no valdrían nada.
  const { rows: [r] } = await adaptador.query(
    'SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super');
  if (r.u !== 'app_quiniela' || r.super) {
    throw new Error(`El arnés corre como "${r.u}" (superusuario=${r.super}): se saltaría RLS`);
  }

  return adaptador;
}

/**
 * Deja las 12 tablas de dominio y las de plataforma vacías, sin recrear nada.
 *
 * ⚠️ `TRUNCATE` de las tablas de dominio NO pasa por RLS —es DDL, no DML— así
 * que no hace falta contexto de quiniela. Es justo lo que se quiere entre
 * pruebas: borrar de todas las quinielas a la vez.
 */
async function vaciar() {
  /*
   * La bandeja del transporte de consola vive en memoria del proceso, no en la
   * base, asi que TRUNCATE no la toca. Sin esto, una prueba leeria el ultimo
   * correo de la prueba ANTERIOR y pasaria por casualidad.
   */
  require('../src/correo').bandeja.length = 0;

  /*
   * `TRUNCATE` exige ser dueño de las tablas, y `app_quiniela` no lo es a
   * propósito. Así que se vuelve al rol dueño el rato justo y se regresa.
   *
   * Va en una sola llamada para que no quede forma de salirse a mitad y dejar
   * la sesión con permisos de dueño: eso convertiría las pruebas siguientes en
   * falsos verdes, que es exactamente lo que este arnés existe para evitar.
   */
  await db.consulta(`
    RESET ROLE;
    TRUNCATE usuarios, quinielas, membresias, fixtures, job_locks, sesiones,
             auth_tokens,
             jugadores, jornadas, partidos, resultados, pronosticos,
             resultados_oficiales, resultados_oficiales_partidos,
             trivias, respuestas_trivia, equipos,
             puntos_jornada, puntos_jornada_jugador
    RESTART IDENTITY CASCADE;
    SET ROLE app_quiniela;`);
}

module.exports = { levantar, vaciar, PostgresEnMemoria };

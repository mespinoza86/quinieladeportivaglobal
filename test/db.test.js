/*
 * Los cimientos de la capa de datos: `src/db.js`.
 *
 * Esta suite no prueba ninguna ruta. Prueba las tres reglas de las que depende
 * todo lo demás, porque si alguna se rompe, se rompe en silencio y se lleva por
 * delante el aislamiento entre quinielas:
 *
 *   1. La transacción es por petición: `enQuiniela` es reentrante.
 *   2. El contexto se fija con SET LOCAL y NO sobrevive a la transacción.
 *   3. Las tablas de dominio no se dejan ver sin contexto.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const enMemoria = require('./postgres-en-memoria');

let base;

test.before(async () => { base = await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); });

/** Crea una quiniela con un jugador dentro y devuelve sus identificadores. */
async function quinielaCon(nombreJugador) {
  const { rows: [u] } = await db.consulta(
    `INSERT INTO usuarios (username, username_normalizado, email, email_normalizado, password)
     VALUES ($1,$1,$2,$2,'x') RETURNING id`,
    [nombreJugador, `${nombreJugador}@x`]);

  const { rows: [q] } = await db.consulta(
    `INSERT INTO quinielas (nombre, codigo_ingreso, propietario_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [`Q-${nombreJugador}`, `C-${nombreJugador}`, u.id]);

  await db.enQuiniela(q.id, c =>
    c.query('INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,$2)', [q.id, nombreJugador]));

  return { usuario: u.id, quiniela: q.id, jugador: nombreJugador };
}

/* ==================== El contexto aísla ==================== */

test('dentro de una quiniela sólo se ven sus propios jugadores', async () => {
  const a = await quinielaCon('ana');
  await quinielaCon('beto');

  const vistos = await db.enQuiniela(a.quiniela, async c => {
    const { rows } = await c.query('SELECT nombre FROM jugadores');
    return rows.map(r => r.nombre);
  });

  assert.deepEqual(vistos, ['ana']);
});

test('pedir a propósito la quiniela ajena devuelve vacío', async () => {
  const a = await quinielaCon('ana');
  const b = await quinielaCon('beto');

  const vistos = await db.enQuiniela(a.quiniela, async c => {
    const { rows } = await c.query('SELECT nombre FROM jugadores WHERE quiniela_id = $1', [b.quiniela]);
    return rows;
  });

  assert.equal(vistos.length, 0);
});

test('escribir en una quiniela ajena lo rechaza la base, no el código', async () => {
  const a = await quinielaCon('ana');
  const b = await quinielaCon('beto');

  await assert.rejects(
    () => db.enQuiniela(a.quiniela, c =>
      c.query('INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,$2)', [b.quiniela, 'colado'])),
    /row-level security/i);
});

/*
 * Es el agujero que tenía el `tenantPlugin` de Mongoose y que quedó anotado
 * como M-33: no enganchaba `aggregate`, así que la primera agregación que
 * alguien escribiera salía sin filtro y en silencio. Aquí no hay esa puerta.
 */
test('una agregación tampoco escapa del contexto', async () => {
  const a = await quinielaCon('ana');
  await quinielaCon('beto');

  const total = await db.enQuiniela(a.quiniela, async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM jugadores');
    return rows[0].n;
  });

  assert.equal(total, 1);
});

/* ==================== El contexto no sobrevive ==================== */

test('sin contexto, las tablas de dominio no dejan ver nada', async () => {
  await quinielaCon('ana');
  await quinielaCon('beto');

  const { rows } = await db.consulta('SELECT count(*)::int AS n FROM jugadores');
  assert.equal(rows[0].n, 0, 'sin contexto no debería verse ni una fila');
});

test('el contexto no sobrevive a la transacción que lo fijó', async () => {
  const a = await quinielaCon('ana');

  await db.enQuiniela(a.quiniela, c => c.query('SELECT 1'));

  // La misma conexión, ya devuelta al pool, no puede arrastrar el contexto.
  const { rows } = await db.consulta(
    `SELECT current_setting('app.quiniela_id', true) AS ctx`);
  assert.ok(!rows[0].ctx, `el contexto sobrevivió: ${rows[0].ctx}`);
});

test('las tablas de plataforma sí se leen sin contexto', async () => {
  await quinielaCon('ana');
  const { rows } = await db.consulta('SELECT count(*)::int AS n FROM quinielas');
  assert.equal(rows[0].n, 1, 'quinielas no lleva RLS: debe verse');
});

/* ==================== La transacción es por petición ==================== */

test('enQuiniela es reentrante: no abre una transacción por consulta', async () => {
  const a = await quinielaCon('ana');

  const resultado = await db.enQuiniela(a.quiniela, async () => {
    // Anidada con la MISMA quiniela: debe reutilizar la transacción de fuera.
    return db.enQuiniela(a.quiniela, async c => {
      const { rows } = await c.query('SELECT nombre FROM jugadores');
      return rows.map(r => r.nombre);
    });
  });

  assert.deepEqual(resultado, ['ana']);
});

test('anidar dos quinielas distintas es un error, no un cruce silencioso', async () => {
  const a = await quinielaCon('ana');
  const b = await quinielaCon('beto');

  await assert.rejects(
    () => db.enQuiniela(a.quiniela, () => db.enQuiniela(b.quiniela, c => c.query('SELECT 1'))),
    /Una petición atiende a una sola quiniela/);
});

test('lo escrito en la transacción se deshace si algo falla', async () => {
  const a = await quinielaCon('ana');

  await assert.rejects(() => db.enQuiniela(a.quiniela, async c => {
    await c.query('INSERT INTO jugadores (quiniela_id, nombre) VALUES ($1,$2)', [a.quiniela, 'nuevo']);
    throw new Error('algo salió mal a mitad');
  }), /algo salió mal a mitad/);

  const quedan = await db.enQuiniela(a.quiniela, async c => {
    const { rows } = await c.query('SELECT nombre FROM jugadores ORDER BY nombre');
    return rows.map(r => r.nombre);
  });

  assert.deepEqual(quedan, ['ana'], 'la inserción debería haberse deshecho');
});

test('quinielaActual() dice en qué contexto estamos, y fuera no miente', async () => {
  const a = await quinielaCon('ana');

  assert.equal(db.quinielaActual(), null);
  const dentro = await db.enQuiniela(a.quiniela, async () => db.quinielaActual());
  assert.equal(dentro, a.quiniela);
  assert.equal(db.quinielaActual(), null);
});

/* ==================== Guardias ==================== */

test('un quinielaId que no es UUID se rechaza antes de tocar la base', async () => {
  await assert.rejects(
    () => db.enQuiniela("x'; DROP TABLE jugadores; --", c => c.query('SELECT 1')),
    /no es un UUID/);

  // Y la tabla sigue ahí.
  const { rows } = await db.consulta("SELECT to_regclass('public.jugadores') AS t");
  assert.equal(rows[0].t, 'jugadores');
});

test('el esquema deja las 14 tablas de dominio con RLS activo y forzado', async () => {
  const { rows } = await db.consulta(`
    SELECT count(*)::int AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity`);

  /*
   * ⚠️ Si esta cuenta baja, alguien dejó una tabla sin aislamiento y NO va a
   * fallar nada: devolverá filas de otra quiniela, en silencio.
   *
   * Y si sube sin que se haya añadido una tabla a propósito, tampoco está
   * bien: significa que hay una tabla nueva que nadie declaró aquí.
   *
   * La 13.ª es `pagos` (migración 001) y la 14.ª `entregas_acumulado` (006).
   * Las dos guardan dinero: sin RLS serían una fuga de cuánto pagó o cobró
   * cada quiniela, y no fallarían — devolverían filas de más.
   */
  assert.equal(rows[0].n, 14);
});

test('⚠️ ninguna tabla con quiniela_id se queda sin aislamiento, salvo la excepción declarada', async () => {
  /*
   * La comprobación de arriba cuenta; ésta dice CUÁL falta, que es lo que hace
   * falta saber cuando falla. Toda tabla que lleve `quiniela_id` guarda datos
   * de una quiniela concreta, así que en principio todas necesitan políticas.
   *
   * ⚠️ `membresias` es la ÚNICA excepción, y es deliberada: `quinielas.deUsuario`
   * la consulta SIN contexto de quiniela para armar «mis quinielas» —hay que
   * saber a cuáles perteneces antes de poder elegir una—. Con RLS esa consulta
   * devolvería cero filas y nadie podría entrar a ninguna quiniela.
   *
   * A cambio, cada consulta sobre `membresias` filtra por `quiniela_id` a mano;
   * son seis y están todas en `src/membresias.js`.
   *
   * Si alguien añade otra tabla a esta lista, que sea con una razón igual de
   * concreta escrita al lado.
   */
  const EXCEPCIONES = ['membresias'];

  const { rows } = await db.consulta(`
    SELECT c.relname AS tabla
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attname = 'quiniela_id'
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
     ORDER BY c.relname`);

  assert.deepEqual(rows.map(r => r.tabla), EXCEPCIONES,
    'una tabla con quiniela_id y sin RLS devuelve filas de otra quiniela EN SILENCIO');
});

/* ==================== Lo que no se puede borrar ==================== */

/*
 * Tres tablas guardan hechos que no se reescriben. Aquí no se comprueba que el
 * código no lo intente —eso lo mira un centinela leyendo el texto—, sino que
 * **la base lo impide** aunque el código lo intentara.
 *
 * La diferencia importa: un centinela que lee el código protege del código que
 * hay hoy; el permiso protege del que se escriba mañana.
 */
test('⛔ la aplicación no puede borrar ni editar un abono', async () => {
  const a = await quinielaCon('ana');

  const jugadorId = await db.enQuiniela(a.quiniela, async c => {
    const { rows: [j] } = await c.query('SELECT id FROM jugadores LIMIT 1');
    await c.query(
      `INSERT INTO pagos (quiniela_id, jugador_id, concepto, monto)
       VALUES ($1, $2, 'jornada', 2000)`, [a.quiniela, j.id]);
    return j.id;
  });

  await assert.rejects(
    () => db.enQuiniela(a.quiniela, c =>
      c.query('DELETE FROM pagos WHERE jugador_id = $1', [jugadorId])),
    /permission denied/i,
    'un abono borrable convierte el historial de dinero en papel mojado');

  await assert.rejects(
    () => db.enQuiniela(a.quiniela, c =>
      c.query('UPDATE pagos SET monto = 1 WHERE jugador_id = $1', [jugadorId])),
    /permission denied/i,
    'y editable es peor: cambia la cifra sin dejar rastro de que cambió');

  // Y sigue ahí.
  const quedan = await db.enQuiniela(a.quiniela, async c =>
    (await c.query('SELECT count(*)::int AS n FROM pagos')).rows[0].n);
  assert.equal(quedan, 1);
});

test('⚠️ pero borrar un jugador SÍ se lleva sus abonos', async () => {
  /*
   * Es la duda que había antes de quitar el permiso, y la razón de que esta
   * prueba exista: si la cascada necesitara `DELETE` del rol de la aplicación,
   * cerrar la tabla dejaría jugadores imposibles de borrar.
   *
   * No lo necesita: las cascadas de clave ajena las ejecuta PostgreSQL como
   * dueño de la tabla, no como quien llama.
   */
  const a = await quinielaCon('ana');

  const jugadorId = await db.enQuiniela(a.quiniela, async c => {
    const { rows: [j] } = await c.query('SELECT id FROM jugadores LIMIT 1');
    await c.query(
      `INSERT INTO pagos (quiniela_id, jugador_id, concepto, monto)
       VALUES ($1, $2, 'jornada', 2000)`, [a.quiniela, j.id]);
    return j.id;
  });

  await db.enQuiniela(a.quiniela, c =>
    c.query('DELETE FROM jugadores WHERE id = $1', [jugadorId]));

  const quedan = await db.enQuiniela(a.quiniela, async c =>
    (await c.query('SELECT count(*)::int AS n FROM pagos')).rows[0].n);
  assert.equal(quedan, 0, 'la cascada se los llevó');
});

test('⛔ ninguna tabla de solo-escritura conserva UPDATE ni DELETE', async () => {
  /*
   * La comprobación de arriba prueba una tabla por su comportamiento; ésta
   * recorre las tres y mira el permiso, que es lo que hace falta saber cuando
   * se añade una cuarta.
   */
  const { SOLO_ESCRITURA } = require('./postgres-en-memoria');

  const { rows } = await db.consulta(`
    SELECT table_name AS tabla,
           string_agg(privilege_type, ',' ORDER BY privilege_type) AS permisos
      FROM information_schema.role_table_grants
     WHERE grantee = 'app_quiniela' AND table_name = ANY($1)
     GROUP BY table_name ORDER BY table_name`, [SOLO_ESCRITURA]);

  assert.equal(rows.length, SOLO_ESCRITURA.length,
    'alguna tabla de la lista no existe o no tiene ningún permiso concedido');

  for (const fila of rows) {
    assert.equal(fila.permisos, 'INSERT,SELECT',
      `${fila.tabla} tiene ${fila.permisos}: se le puede borrar el rastro`);
  }
});

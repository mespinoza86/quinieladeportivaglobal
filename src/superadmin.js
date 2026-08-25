/*
 * El superadministrador: ver las cuentas del sistema y poder retirarlas.
 *
 * ============================================================================
 * ⛔ QUIEN MANDA SALE DE LA VARIABLE DE ENTORNO, NO DE LA BASE
 * ============================================================================
 *
 * `SUPERADMIN_EMAILS` es una lista de correos separados por comas, y es la
 * única fuente. **No hay columna `es_superadmin`, y es deliberado**: con una
 * columna, cualquiera que llegue a superadministrador puede nombrar a otro
 * desde la propia pantalla, y una cuenta comprometida se vuelve permanente.
 * Con la variable hace falta entrar al panel de Render.
 *
 * Es la misma lógica que impide que la aplicación se conecte con el rol dueño
 * de la base: **el poder total no se concede desde dentro de la aplicación.**
 *
 * Variable vacía o ausente = nadie es superadministrador. El fallo por defecto
 * es cerrado, que es el único aceptable para una puerta como ésta.
 *
 * ============================================================================
 * ESTO NO MIRA DENTRO DE LAS QUINIELAS, Y POR ESO NO TOCA LA RLS
 * ============================================================================
 *
 * Todo lo que se lee aquí vive en tablas de PLATAFORMA —`usuarios`,
 * `quinielas`, `membresias`—, que a propósito no llevan RLS. Así que este
 * módulo no necesita `enQuiniela`, no desactiva políticas y no pide un rol
 * distinto: son consultas normales.
 *
 * ⚠️ El día que se quiera ver pronósticos o pagos de todas las quinielas, la
 * única vía honesta es recorrerlas una a una con `db.enQuiniela`. Apagar la
 * política sería quitar la pieza sobre la que se sostiene el aislamiento
 * entero, y hacerlo para una pantalla de consulta no lo justifica.
 */
'use strict';

const db = require('./db');
const usuarios = require('./usuarios');

/** Las cuatro cosas que se pueden hacer, y que el registro sabe nombrar. */
const ACCIONES = ['desactivar', 'reactivar', 'liberar_correo', 'borrar'];

/** Un motivo tiene que decir algo: el registro existe para poder releerlo. */
const MOTIVO_MINIMO = 3;
const MOTIVO_MAXIMO = 500;

/**
 * Los correos con poder, leídos de la variable de entorno.
 *
 * Se normalizan con la MISMA función que usa el registro de cuentas
 * (`usuarios.normalizarIdentidad`). Si se compararan de otra forma, un correo
 * escrito con mayúsculas en Render no casaría con el de la base y el panel
 * diría «no eres superadministrador» sin explicar por qué.
 *
 * Se lee en cada llamada y no se cachea: cambiar la variable en Render reinicia
 * el proceso de todas formas, y una lista cacheada es una que puede quedarse
 * desfasada sin que nadie lo note.
 */
function correosConPoder(valor = process.env.SUPERADMIN_EMAILS) {
  return String(valor || '')
    .split(',')
    .map(correo => usuarios.normalizarIdentidad(correo))
    .filter(Boolean);
}

/**
 * ¿Este usuario es superadministrador?
 *
 * ⚠️ Recibe el usuario **leído de la base**, no lo que diga el navegador. Y
 * exige además que esté activo y verificado: una cuenta retirada o sin
 * confirmar no manda, aunque su correo siga escrito en la variable.
 */
function esSuperadmin(usuario) {
  if (!usuario?.email || !usuario.activo || !usuario.email_verificado) return false;
  return correosConPoder().includes(usuarios.normalizarIdentidad(usuario.email));
}

/** ¿Hay alguien con poder configurado? Lo usa la sonda de estado. */
function hayAlguienConfigurado() {
  return correosConPoder().length > 0;
}

function errorDeValidacion(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  error.esValidacion = true;
  return error;
}

/** Un motivo válido, recortado. Obligatorio en las cuatro acciones. */
function normalizarMotivo(valor) {
  const motivo = typeof valor === 'string' ? valor.trim() : '';

  if (motivo.length < MOTIVO_MINIMO) {
    throw errorDeValidacion(
      `Escribe el motivo (al menos ${MOTIVO_MINIMO} caracteres): queda en el registro.`);
  }
  if (motivo.length > MOTIVO_MAXIMO) {
    throw errorDeValidacion(`El motivo admite hasta ${MOTIVO_MAXIMO} caracteres.`);
  }
  return motivo;
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comprueba la forma antes de consultar, para no mandarle basura a PostgreSQL. */
function exigirUuid(valor, etiqueta = 'La cuenta') {
  const id = String(valor || '');
  if (!ES_UUID.test(id)) throw errorDeValidacion(`${etiqueta} no es válida.`, 404);
  return id;
}

/* ==================== Lectura ==================== */

/**
 * Las cuentas del sistema, con las quinielas de cada una.
 *
 * Va en DOS consultas y no en una por cuenta: con doscientos usuarios, pedir
 * sus membresías de una en una serían doscientos viajes para pintar una tabla.
 * Es el mismo N+1 que la Fase 5 quitó del ranking.
 *
 * ⚠️ Nunca devuelve la contraseña, ni siquiera cifrada. No hace falta para
 * nada de lo que esta pantalla hace, y lo que no se envía no se puede filtrar.
 */
async function listarCuentas({ buscar = '', filtro = 'todas', limite = 50, desplazamiento = 0 } = {}) {
  const patron = String(buscar || '').trim().toLowerCase();
  const tope = Math.min(200, Math.max(1, Number(limite) || 50));
  const salto = Math.max(0, Number(desplazamiento) || 0);

  /*
   * ⚠️ EL FILTRO SE APLICA AQUÍ, NO EN EL NAVEGADOR.
   *
   * La lista viene paginada, así que filtrar sólo lo que ya llegó diría «3 sin
   * confirmar» cuando hay veinte en las páginas siguientes: un número que
   * parece una respuesta y no lo es. Es el mismo error que la Entrada 061
   * evitó en los cobros —contar sobre lo que se ve en vez de sobre lo que hay—.
   */
  const CONDICIONES = {
    todas: 'TRUE',
    sin_confirmar: 'NOT email_verificado',
    desactivadas: 'NOT activo'
  };

  const condicion = CONDICIONES[filtro] || CONDICIONES.todas;

  const donde = `($1 = '' OR email_normalizado LIKE '%' || $1 || '%'
                          OR username_normalizado LIKE '%' || $1 || '%')
                 AND ${condicion}`;

  const { rows: cuentas } = await db.consulta(
    `SELECT id, username, email, email_verificado, activo, created_at
       FROM usuarios
      WHERE ${donde}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [patron, tope, salto]);

  /*
   * Los tres recuentos salen en UNA consulta y **sin el filtro puesto**: los
   * rótulos de los botones tienen que decir cuántas hay de cada clase, no
   * cuántas quedan después de filtrar. Un botón «Sin confirmar (0)» estando
   * dentro de ese mismo filtro sería absurdo.
   */
  const { rows: [conteos] } = await db.consulta(
    `SELECT count(*)::int AS todas,
            count(*) FILTER (WHERE NOT email_verificado)::int AS sin_confirmar,
            count(*) FILTER (WHERE NOT activo)::int AS desactivadas
       FROM usuarios
      WHERE ($1 = '' OR email_normalizado LIKE '%' || $1 || '%'
                     OR username_normalizado LIKE '%' || $1 || '%')`,
    [patron]);

  const total = conteos[filtro] ?? conteos.todas;

  if (!cuentas.length) return { cuentas: [], total, conteos };

  const { rows: membresias } = await db.consulta(
    `SELECT m.usuario_id, m.rol, m.estado, q.id AS quiniela_id, q.nombre, q.estado AS quiniela_estado
       FROM membresias m
       JOIN quinielas q ON q.id = m.quiniela_id
      WHERE m.usuario_id = ANY($1::uuid[])
      ORDER BY q.nombre`,
    [cuentas.map(c => c.id)]);

  const porUsuario = new Map();
  for (const m of membresias) {
    if (!porUsuario.has(m.usuario_id)) porUsuario.set(m.usuario_id, []);
    porUsuario.get(m.usuario_id).push({
      quinielaId: m.quiniela_id,
      nombre: m.nombre,
      rol: m.rol,
      estado: m.estado,
      quinielaEstado: m.quiniela_estado
    });
  }

  return {
    total,
    conteos,
    cuentas: cuentas.map(c => ({
      id: c.id,
      username: c.username,
      email: c.email,
      emailVerificado: c.email_verificado,
      activo: c.activo,
      creadaEn: c.created_at,
      esSuperadmin: correosConPoder().includes(usuarios.normalizarIdentidad(c.email)),
      quinielas: porUsuario.get(c.id) || []
    }))
  };
}

/**
 * En qué quinielas juega alguien, recorriéndolas UNA A UNA.
 *
 * ============================================================================
 * ⛔ POR QUÉ NO ES UNA SOLA CONSULTA CON UN JOIN
 * ============================================================================
 *
 * Porque `jugadores` lleva RLS, y **una consulta a una tabla de dominio sin
 * contexto de quiniela devuelve CERO FILAS**. No falla: devuelve vacío.
 *
 * La primera versión de esto era un `JOIN` de `jugadores` con `quinielas` a
 * pelo, y por eso decía siempre «no juega en ninguna parte». Con eso,
 * `sePuedeBorrar` daba que sí, el borrado seguía adelante y **reventaba con un
 * error de clave ajena** — justo lo que se prometía evitar. Lo cazó una prueba
 * de ruta; leyendo el código parecía correcto.
 *
 * ⚠️ Es la trampa de la que avisa `src/db.js` en su cabecera, y muerde igual
 * aquí, en el módulo que precisamente no habla de quinielas. **La RLS impidió
 * escribir el fallo, no lo causó**: sin ella, el JOIN habría devuelto filas de
 * todas las quinielas y nadie se habría enterado de nada.
 *
 * Se recorren TODAS las quinielas no eliminadas, y no sólo aquellas donde la
 * persona tiene membresía, a propósito: un jugador puede seguir vinculado sin
 * membresía viva, y si uno de ésos se escapara, el borrado volvería a fallar
 * con el error críptico. Son tantas consultas como quinielas haya; con las
 * decenas que puede tener este sistema es barato, y si algún día son miles
 * habrá que acotarlo — pero acotarlo mal aquí es devolver una respuesta falsa.
 */
async function jugadoresDe(usuarioId) {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre FROM quinielas WHERE estado <> 'eliminada' ORDER BY nombre`);

  const encontrados = [];

  for (const quiniela of quinielas) {
    const filas = await db.enQuiniela(quiniela.id, async cliente => {
      const { rows } = await cliente.query(
        'SELECT id, nombre FROM jugadores WHERE usuario_id = $1', [usuarioId]);
      return rows;
    });

    for (const fila of filas) {
      encontrados.push({
        id: fila.id,
        nombre: fila.nombre,
        quinielaId: quiniela.id,
        quiniela: quiniela.nombre
      });
    }
  }

  return encontrados;
}

/**
 * Lo que ata a una cuenta, y por tanto qué se puede hacer con ella.
 *
 * Es lo que la pantalla necesita para no ofrecer un borrado que va a fallar:
 * más vale decir «no se puede porque es dueña de estas dos quinielas» antes
 * que después, con un error de clave ajena que no explica nada.
 */
async function ataduras(usuarioId) {
  const id = exigirUuid(usuarioId);

  const { rows: quinielasPropias } = await db.consulta(
    `SELECT id, nombre, estado FROM quinielas
      WHERE propietario_id = $1 AND estado <> 'eliminada'
      ORDER BY nombre`,
    [id]);

  const jugadores = await jugadoresDe(id);

  const { rows: [{ membresias }] } = await db.consulta(
    'SELECT count(*)::int AS membresias FROM membresias WHERE usuario_id = $1', [id]);

  return {
    /*
     * ⚠️ Ser propietaria bloquea el borrado y no hay vuelta: `propietario_id`
     * es obligatorio, así que una quiniela no puede quedarse sin dueño. Hay
     * que transferirla primero, y eso ya existe en la pantalla de miembros.
     */
    quinielasPropias: quinielasPropias.map(q => ({ id: q.id, nombre: q.nombre, estado: q.estado })),

    /*
     * Tener jugador NO bloquea: se puede desvincular. `jugadores.usuario_id`
     * es nulable justamente para eso —así quedaron los que migró el script de
     * la base anterior—, así que la persona pasa a ser un jugador histórico y
     * conserva pronósticos, puntos y pagos.
     */
    /*
     * `quinielaId` viaja aunque la pantalla no lo pinte: sin él, la
     * desvinculación no sabría en qué contexto hacer su UPDATE, y un UPDATE sin
     * contexto sobre una tabla con RLS no toca nada.
     */
    jugadores: jugadores.map(j => ({
      id: j.id, nombre: j.nombre, quiniela: j.quiniela, quinielaId: j.quinielaId
    })),

    membresias,
    sePuedeBorrar: quinielasPropias.length === 0
  };
}

/** Una cuenta con todo lo que la pantalla de detalle necesita. */
async function cuenta(usuarioId) {
  const id = exigirUuid(usuarioId);
  const usuario = await usuarios.porId(id);
  if (!usuario) return null;

  const [{ cuentas }, atada] = await Promise.all([
    listarCuentas({ buscar: usuario.email }),
    ataduras(id)
  ]);

  const ficha = cuentas.find(c => c.id === id) || null;
  return ficha ? { ...ficha, ataduras: atada } : null;
}

/* ==================== El registro ==================== */

/**
 * Anota una acción. Se llama SIEMPRE dentro de la transacción que la ejecuta.
 *
 * ⚠️ Dentro y no después: si el asiento fuera aparte, un fallo entre la acción
 * y su registro dejaría una cuenta desactivada sin rastro de quién lo hizo. La
 * acción y su explicación van juntas o no van, igual que la cuenta y su token
 * en el registro (Entrada 055).
 */
async function anotar(cliente, { actor, accion, objetivo, motivo, detalle = {} }) {
  if (!ACCIONES.includes(accion)) throw new Error(`Acción desconocida: ${accion}`);

  await cliente.query(
    `INSERT INTO acciones_superadmin
       (actor_usuario_id, actor_email, accion,
        objetivo_usuario_id, objetivo_email, objetivo_username, motivo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [actor.id, actor.email, accion,
      objetivo.id, objetivo.email, objetivo.username, motivo, JSON.stringify(detalle)]);
}

/** El historial, lo más reciente primero. */
async function historial({ limite = 100 } = {}) {
  const tope = Math.min(500, Math.max(1, Number(limite) || 100));

  /*
   * ⚠️ Si la cuenta sigue existiendo se comprueba con un LEFT JOIN, NO mirando
   * si `objetivo_usuario_id` es nulo.
   *
   * Es un error fácil y lo cometí: esa columna **no tiene clave ajena** —a
   * propósito, para que el asiento sobreviva al borrado— así que nunca se pone
   * a nulo sola. Deducir de ahí que la cuenta existe daba «existe» siempre,
   * incluso en el asiento que registraba haberla borrado. El dato estaba ahí,
   * y la conclusión era del revés.
   */
  const { rows } = await db.consulta(
    `SELECT a.actor_email, a.accion, a.objetivo_email, a.objetivo_username,
            a.motivo, a.detalle, a.created_at,
            (u.id IS NOT NULL) AS objetivo_existe
       FROM acciones_superadmin a
       LEFT JOIN usuarios u ON u.id = a.objetivo_usuario_id
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [tope]);

  return rows.map(f => ({
    actorEmail: f.actor_email,
    accion: f.accion,
    objetivoEmail: f.objetivo_email,
    objetivoUsername: f.objetivo_username,
    objetivoExiste: f.objetivo_existe,
    motivo: f.motivo,
    detalle: f.detalle,
    fecha: f.created_at
  }));
}

/* ==================== Las cuatro acciones ==================== */

/**
 * Comprueba lo que vale para todas: que exista, y que no sea un disparo al pie.
 *
 * ⚠️ **Nadie se toca a sí mismo.** Desactivarse o borrarse dejaría al sistema
 * sin quien lo administra y a la persona fuera de la pantalla desde la que
 * acaba de hacerlo. No es una regla teórica: es un clic de distancia.
 *
 * ⚠️ **Y un superadministrador no puede retirar a otro.** Los dos salen de la
 * misma variable, así que quien quiera cambiar eso tiene que entrar a Render —
 * que es exactamente la friccion que hace que el poder no se conceda ni se
 * quite desde dentro.
 */
async function objetivoValido(usuarioId, actor) {
  const id = exigirUuid(usuarioId);

  if (id === String(actor.id)) {
    throw errorDeValidacion('No puedes aplicarte esto a tu propia cuenta.', 409);
  }

  const objetivo = await usuarios.porId(id);
  if (!objetivo) throw errorDeValidacion('Esa cuenta no existe.', 404);

  if (correosConPoder().includes(usuarios.normalizarIdentidad(objetivo.email))) {
    throw errorDeValidacion(
      'Esa cuenta también es superadministradora: quítala de SUPERADMIN_EMAILS primero.', 409);
  }

  return objetivo;
}

/**
 * Deja a alguien fuera sin borrar nada.
 *
 * Es la acción que resuelve casi todos los casos reales, y la única
 * reversible. `activo = false` basta porque `autenticar` y `porId` ya filtran
 * por ese campo desde siempre: deja de poder entrar en la siguiente petición.
 *
 * ⚠️ Y se le cierran las sesiones abiertas. Sin eso, quien ya estuviera dentro
 * seguiría dentro hasta que su cookie caducara —catorce días—, que es
 * justamente lo que la Entrada 064 arregló al cambiar la contraseña.
 */
async function desactivar(usuarioId, { actor, motivo }) {
  const razon = normalizarMotivo(motivo);
  const objetivo = await objetivoValido(usuarioId, actor);

  if (!objetivo.activo) throw errorDeValidacion('Esa cuenta ya estaba desactivada.', 409);

  const sesionesCerradas = await db.enTransaccion(async cliente => {
    await cliente.query(
      'UPDATE usuarios SET activo = false, updated_at = now() WHERE id = $1', [objetivo.id]);

    const cerradas = await usuarios.cerrarSesiones(objetivo.id);

    await anotar(cliente, {
      actor, accion: 'desactivar', objetivo, motivo: razon,
      detalle: { sesionesCerradas: cerradas }
    });

    return cerradas;
  });

  return { ok: true, sesionesCerradas };
}

/** Le devuelve el acceso. */
async function reactivar(usuarioId, { actor, motivo }) {
  const razon = normalizarMotivo(motivo);
  const objetivo = await objetivoValido(usuarioId, actor);

  if (objetivo.activo) throw errorDeValidacion('Esa cuenta ya estaba activa.', 409);

  await db.enTransaccion(async cliente => {
    await cliente.query(
      'UPDATE usuarios SET activo = true, updated_at = now() WHERE id = $1', [objetivo.id]);

    await anotar(cliente, { actor, accion: 'reactivar', objetivo, motivo: razon });
  });

  return { ok: true };
}

/**
 * Deja la dirección libre para que se pueda volver a registrar.
 *
 * ============================================================================
 * ⚠️ POR QUÉ EL CORREO SE RENOMBRA EN VEZ DE VACIARSE
 * ============================================================================
 *
 * `usuarios.email` y `email_normalizado` son únicos y obligatorios, así que no
 * se pueden dejar en blanco ni repetir. Se le añade un sufijo irrepetible: la
 * fila conserva su historia, el índice único no choca, y la dirección original
 * queda libre.
 *
 * El sufijo lleva `+liberado-` con la parte del dominio intacta para que siga
 * pareciendo un correo y se entienda de un vistazo qué pasó. **No sirve para
 * recibir nada**, y no debe: la cuenta queda además desactivada.
 *
 * ⚠️ Y se desactiva SIEMPRE, aunque estuviera activa. Si no, esa persona
 * seguiría entrando con su nombre de usuario y su contraseña de siempre, y
 * habría dos cuentas vivas para la misma persona.
 */
async function liberarCorreo(usuarioId, { actor, motivo }) {
  const razon = normalizarMotivo(motivo);
  const objetivo = await objetivoValido(usuarioId, actor);

  const marca = Date.now().toString(36);
  const [local, dominio = 'liberado'] = String(objetivo.email).split('@');
  const emailLiberado = `${local}+liberado-${marca}@${dominio}`;

  await db.enTransaccion(async cliente => {
    await cliente.query(
      `UPDATE usuarios
          SET email = $2, email_normalizado = $3, email_verificado = false,
              activo = false, updated_at = now()
        WHERE id = $1`,
      [objetivo.id, emailLiberado, usuarios.normalizarIdentidad(emailLiberado)]);

    /*
     * Sus enlaces pendientes dejan de valer: apuntaban a una dirección que a
     * partir de ahora puede ser de otra persona.
     */
    await cliente.query(
      'DELETE FROM auth_tokens WHERE usuario_id = $1 AND usado_en IS NULL', [objetivo.id]);

    await usuarios.cerrarSesiones(objetivo.id);

    await anotar(cliente, {
      actor, accion: 'liberar_correo', objetivo, motivo: razon,
      detalle: { emailAnterior: objetivo.email, emailAhora: emailLiberado }
    });
  });

  return { ok: true, emailLiberado: objetivo.email, emailAhora: emailLiberado };
}

/**
 * Borra la cuenta de verdad.
 *
 * ============================================================================
 * ⛔ LO QUE SE COMPRUEBA ANTES, Y POR QUÉ
 * ============================================================================
 *
 * - **Propietaria de una quiniela** → no se puede, y no es una decisión de
 *   producto: `quinielas.propietario_id` es obligatorio, así que la base lo
 *   rechazaría igual. Se dice antes y con los nombres, en vez de dejar salir
 *   un error de clave ajena que no explica nada.
 *
 * - **Con jugador en alguna quiniela** → se ofrece DESVINCULAR. Poner
 *   `jugadores.usuario_id` a nulo deja a esa persona como jugador histórico,
 *   y conserva sus pronósticos, sus puntos y sus pagos. Es para lo que esa
 *   columna es nulable. Sin `desvincularJugadores`, se bloquea: borrar la
 *   historia de una quiniela por retirar una cuenta sería una sorpresa cara.
 *
 * Lo que sí se va por cascada son sus membresías y sus tokens, que no son
 * historia de nadie: son permisos y enlaces caducados.
 */
async function borrar(usuarioId, { actor, motivo, desvincularJugadores = false }) {
  const razon = normalizarMotivo(motivo);
  const objetivo = await objetivoValido(usuarioId, actor);
  const atada = await ataduras(objetivo.id);

  if (atada.quinielasPropias.length) {
    const nombres = atada.quinielasPropias.map(q => q.nombre).join(', ');
    throw errorDeValidacion(
      `No se puede borrar: es propietaria de ${nombres}. Transfiere la propiedad primero.`, 409);
  }

  if (atada.jugadores.length && !desvincularJugadores) {
    const donde = atada.jugadores.map(j => j.quiniela).join(', ');
    throw errorDeValidacion(
      `Tiene historial de juego en ${donde}. Confirma que quieres desvincularlo `
      + '(se conserva como jugador sin cuenta, con sus pronósticos y pagos).', 409);
  }

  await db.enTransaccion(async cliente => {
    /*
     * ⚠️ La desvinculación va quiniela por quiniela, por lo mismo que
     * `jugadoresDe`: un `UPDATE` sobre `jugadores` sin contexto **no toca
     * ninguna fila**, y no avisa. La primera versión lo hacía así y el `DELETE`
     * de abajo reventaba contra la clave ajena.
     *
     * `enQuiniela` es reentrante y entra prestado en esta transacción, así que
     * todo esto sigue siendo atómico: o se desvinculan todos y se borra la
     * cuenta, o no se hace nada.
     */
    const porQuiniela = new Set(atada.jugadores.map(j => j.quinielaId));

    for (const quinielaId of porQuiniela) {
      await db.enQuiniela(quinielaId, async c => {
        const { rowCount } = await c.query(
          'UPDATE jugadores SET usuario_id = NULL WHERE usuario_id = $1', [objetivo.id]);

        /*
         * Si aquí no se desvincula nada es que el contexto no está haciendo lo
         * que se cree, y seguir dejaría el `DELETE` estallando con un error que
         * no explica nada. Mejor plantarse donde se entiende.
         */
        if (rowCount === 0) {
          throw new Error(
            `No se pudo desvincular al jugador en la quiniela ${quinielaId}: revisa el contexto.`);
        }
      });
    }

    await usuarios.cerrarSesiones(objetivo.id);

    /*
     * El asiento se escribe ANTES del borrado. Da igual para el resultado
     * —están en la misma transacción— pero deja claro al leerlo que el
     * registro no depende de que la fila siga existiendo: su `objetivo_usuario_id`
     * no tiene clave ajena justamente para eso.
     */
    await anotar(cliente, {
      actor, accion: 'borrar', objetivo, motivo: razon,
      detalle: {
        membresiasBorradas: atada.membresias,
        jugadoresDesvinculados: atada.jugadores.map(j => `${j.nombre} (${j.quiniela})`)
      }
    });

    await cliente.query('DELETE FROM usuarios WHERE id = $1', [objetivo.id]);
  });

  return {
    ok: true,
    membresiasBorradas: atada.membresias,
    jugadoresDesvinculados: atada.jugadores.length
  };
}

module.exports = {
  correosConPoder, esSuperadmin, hayAlguienConfigurado,
  listarCuentas, cuenta, ataduras, historial,
  desactivar, reactivar, liberarCorreo, borrar,
  normalizarMotivo, ACCIONES, MOTIVO_MINIMO, MOTIVO_MAXIMO
};

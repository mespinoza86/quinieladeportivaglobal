/*
 * Jornadas y sus partidos.
 *
 * ============================================================================
 * LO QUE CAMBIA RESPECTO A MONGO, Y NO ES COSMÉTICO
 * ============================================================================
 *
 * En Mongo, los partidos eran un arreglo dentro de la jornada y el vínculo con
 * un pronóstico era **la posición en ese arreglo** — el hallazgo M-02. Guardar
 * la jornada reemplazaba el arreglo entero, así que si alguien cambiaba el
 * orden de los partidos, los pronósticos que ya existían pasaban a apuntar a
 * otro partido **sin que nada avisara**.
 *
 * Aquí cada partido tiene identidad propia, y por eso `guardar` **reconcilia en
 * vez de borrar y volver a insertar**: el partido que sigue estando conserva su
 * `id`, así que los pronósticos que colgaban de él siguen colgando de él.
 * Borrar y reinsertar sería más corto de escribir y se llevaría por delante los
 * pronósticos en cascada.
 *
 * ⚠️ **Y reconcilia por `api_fixture_id`, no por posición** (Entrada 063).
 * Emparejar por posición parecía suficiente y no lo era: quitar el segundo de
 * cuatro partidos desde la pantalla mandaba una lista más corta, cada posición
 * pasaba a contener otro partido, y **se borraban los pronósticos de todos los
 * posteriores al que se quitó** — en silencio, y con el contador de borrados
 * calculado y tirado por la ruta.
 *
 * El camino por posición se conserva sólo para los partidos SIN identificador,
 * que son los históricos de la migración. Ahí no hay forma de saber si es el
 * mismo partido, y adivinar podría dejar un pronóstico colgando del equivocado
 * —que es peor que perderlo—.
 *
 * ============================================================================
 * DE CARA AFUERA SE SIGUE HABLANDO POR NOMBRE
 * ============================================================================
 *
 * Es la decisión de alcance de §21.1: claves ajenas dentro, nombres en el API.
 * Estas funciones reciben el nombre de la jornada y lo resuelven una vez; el
 * frontend no se entera de que existen los identificadores.
 */
'use strict';

const db = require('./db');
const pronosticos = require('./pronosticos');
const { parseFechaPartidoCostaRica } = require('./fechas');

/** De columnas de la base a la forma que espera el frontend. Sin tocar nada. */
function partidoPublico(fila) {
  return {
    equipo1: fila.equipo1,
    equipo2: fila.equipo2,
    logoEquipo1: fila.logo_equipo1,
    logoEquipo2: fila.logo_equipo2,
    comodin: fila.comodin,
    apiFixtureId: fila.api_fixture_id,
    apiLeagueId: fila.api_league_id,
    apiDate: fila.api_date,
    apiStatus: fila.api_status
  };
}

/** Los valores de un partido en el orden en que los esperan las consultas. */
function valoresDePartido(p) {
  return [
    p.equipo1 ?? null, p.equipo2 ?? null,
    p.logoEquipo1 ?? null, p.logoEquipo2 ?? null,
    Boolean(p.comodin),
    p.apiFixtureId ?? null, p.apiLeagueId ?? null,
    p.apiDate ?? null, p.apiStatus ?? null
  ];
}

/* ==================== Lectura ==================== */

/**
 * La jornada actual y la lista de todas.
 *
 * ⚠️ **La actual es la ÚLTIMA QUE SE CREÓ** (Fase B, Entrada 028), y se ordena
 * por `secuencia`, no por `id`. En Mongo bastaba `sort({_id: -1})` porque un
 * ObjectId lleva la fecha dentro; un uuid es aleatorio y ordenar por él daría
 * un orden arbitrario **sin fallar**: seguiría devolviendo una jornada, sólo
 * que la que no es.
 *
 * Devuelve también la lista completa para que una pantalla llene su desplegable
 * y elija el valor por defecto con UNA sola petición.
 */
async function actual(quinielaId) {
  const filas = await db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(
      'SELECT nombre FROM jornadas ORDER BY secuencia DESC');
    return rows;
  });

  return {
    sugerida: filas[0]?.nombre ?? null,
    jornadas: filas.map(f => ({ nombre: f.nombre }))
  };
}

/** Sólo los nombres, en orden de creación. Es el `?resumen=1` de la ruta. */
async function resumen(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query('SELECT nombre FROM jornadas ORDER BY secuencia');
    return rows.map(f => ({ nombre: f.nombre }));
  });
}

/**
 * Todas las jornadas con sus partidos.
 *
 * Va en UNA consulta con `json_agg` en vez de una por jornada: es el N+1 que
 * arrastraban varias rutas, y aquí no cuesta nada evitarlo.
 */
async function listar(quinielaId) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows } = await c.query(`
      SELECT j.nombre,
             COALESCE(
               json_agg(
                 json_build_object(
                   'equipo1', p.equipo1, 'equipo2', p.equipo2,
                   'logoEquipo1', p.logo_equipo1, 'logoEquipo2', p.logo_equipo2,
                   'comodin', p.comodin,
                   'apiFixtureId', p.api_fixture_id, 'apiLeagueId', p.api_league_id,
                   'apiDate', p.api_date, 'apiStatus', p.api_status
                 ) ORDER BY p.orden
               ) FILTER (WHERE p.id IS NOT NULL),
               '[]'
             ) AS partidos
        FROM jornadas j
        LEFT JOIN partidos p ON p.jornada_id = j.id
       GROUP BY j.id, j.nombre, j.secuencia
       ORDER BY j.secuencia`);
    return rows.map(f => ({ nombre: f.nombre, partidos: f.partidos }));
  });
}

/** Una jornada con sus partidos, o `null`. */
async function porNombre(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      'SELECT id, nombre FROM jornadas WHERE nombre = $1', [nombre]);
    if (!j) return null;

    const { rows } = await c.query(
      'SELECT * FROM partidos WHERE jornada_id = $1 ORDER BY orden', [j.id]);
    return { nombre: j.nombre, partidos: rows.map(partidoPublico) };
  });
}

/** El identificador interno, para lo que sí lo necesita. `null` si no existe. */
async function idDe(cliente, nombre) {
  const { rows: [j] } = await cliente.query(
    'SELECT id FROM jornadas WHERE nombre = $1', [nombre]);
  return j?.id ?? null;
}

/* ==================== El orden de los partidos ==================== */

/*
 * Cuando no hay hora, el partido va al final. Se usa un valor enorme en vez de
 * dejarlo fuera para que el criterio siga siendo una sola comparación.
 */
const SIN_HORA = Number.MAX_SAFE_INTEGER;

/** Milisegundos de inicio del partido, en hora de Costa Rica. */
function horaDeInicio(partido) {
  const fecha = parseFechaPartidoCostaRica(partido?.apiDate ?? partido?.api_date);
  return fecha ? fecha.getTime() : SIN_HORA;
}

/**
 * Compara dos partidos por hora de inicio, con desempate fijo.
 *
 * ⚠️ El desempate NO es un adorno. Sin él, dos partidos a la misma hora podrían
 * salir en un orden distinto en cada guardado —`sort` no promete estabilidad
 * entre listas diferentes—, y la jornada bailaría sola sin que nadie la tocara.
 * Liga y luego equipo local es arbitrario, pero es SIEMPRE EL MISMO.
 */
function porHoraDeInicio(a, b) {
  const diferencia = horaDeInicio(a) - horaDeInicio(b);
  if (diferencia !== 0) return diferencia;

  const liga = String(a?.apiLeagueId ?? '').localeCompare(String(b?.apiLeagueId ?? ''), 'es');
  if (liga !== 0) return liga;

  return String(a?.equipo1 ?? '').localeCompare(String(b?.equipo1 ?? ''), 'es');
}

/**
 * Ordena los partidos de una jornada por hora de inicio, sin mover los que ya
 * estaban guardados.
 *
 * ============================================================================
 * POR QUÉ LOS GUARDADOS NO SE TOCAN
 * ============================================================================
 *
 * Al CREAR una jornada no hay nada guardado, así que se ordena todo: es lo que
 * se quiere, que el primero en jugarse salga primero.
 *
 * Al MODIFICARLA, los que ya estaban conservan su orden exacto y los nuevos se
 * ordenan entre sí y van al final. Es lo que pidió el usuario, y además evita
 * el único caso peligroso: reordenar una jornada que ya tiene pronósticos
 * significaría cambiar de sitio partidos que la gente ya rellenó, y quien mira
 * su quiniela vería otra cosa de la que llenó.
 *
 * `guardados` son los `apiFixtureId` que ya están en la base, en su orden.
 */
function ordenarParaGuardar(partidos = [], guardados = []) {
  const posicion = new Map();
  guardados.forEach((fixture, i) => {
    if (fixture) posicion.set(String(fixture), i);
  });

  const yaEstaban = [];
  const nuevos = [];

  for (const partido of partidos) {
    if (!partido) continue;
    const fixture = String(partido.apiFixtureId ?? '');
    if (fixture && posicion.has(fixture)) yaEstaban.push(partido);
    else nuevos.push(partido);
  }

  // Los guardados, en el orden que tenían en la base. No en el que llegaron.
  yaEstaban.sort((a, b) =>
    posicion.get(String(a.apiFixtureId)) - posicion.get(String(b.apiFixtureId)));

  return [...yaEstaban, ...nuevos.sort(porHoraDeInicio)];
}

/* ==================== Escritura ==================== */

/**
 * Crea la jornada si no existe y deja sus partidos como los que llegan.
 *
 * ⚠️ **Reconcilia por posición**, no borra y reinserta. Ver la cabecera del
 * módulo: reinsertar se llevaría los pronósticos por delante en cascada.
 */
async function guardar(quinielaId, nombre, partidos, precio = 0, alAcumulado = 0) {
  return db.enQuiniela(quinielaId, async c => {
    /*
     * ⚠️ `precio` sólo entra en el INSERT: el `DO UPDATE` no lo toca a
     * propósito. Editar los partidos de una jornada NO puede cambiar lo que
     * costó, ni aunque el precio de la configuración haya subido desde que se
     * creó. Lo pasado ya quedó; el precio nuevo es para las que vengan.
     *
     * Para cambiar el de una jornada concreta está `cambiarPrecio`, que es una
     * decisión explícita del administrador y no un efecto de guardar.
     */
    const { rows: [j] } = await c.query(
      `INSERT INTO jornadas (quiniela_id, nombre, precio, al_acumulado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (quiniela_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
      [quinielaId, nombre, precio, Math.min(Number(alAcumulado) || 0, Number(precio) || 0)]);

    const { rows: existentes } = await c.query(
      'SELECT id, orden, api_fixture_id FROM partidos WHERE jornada_id = $1 ORDER BY orden',
      [j.id]);

    /*
     * ============================================================
     * EMPAREJAR LO GUARDADO CON LO QUE LLEGA
     * ============================================================
     *
     * Un partido guardado y uno entrante son EL MISMO cuando comparten
     * `api_fixture_id`. Desde la Fase D los partidos salen sólo del API, así
     * que ese identificador está siempre y es la señal fiable.
     *
     * ⚠️ ANTES SE EMPAREJABA POR POSICIÓN, y eso hacía perder pronósticos sin
     * avisar. Con [A,B,C,D] guardados, quitar B desde la pantalla mandaba
     * [A,C,D]: la posición 1 pasaba de B a C, la 2 de C a D, y como el fixture
     * de cada posición cambiaba, se daban por sustituidos y **se borraban los
     * pronósticos de todos los partidos posteriores al que se quitó**.
     *
     * Emparejando por identidad, C y D se reconocen y conservan su fila, su id
     * y sus pronósticos; sólo desaparece B, que es el que de verdad se quitó.
     *
     * Se conserva el camino por posición para los partidos SIN identificador
     * -los históricos de la migración-. Ahí no hay forma de saber si es el
     * mismo, y cambiar de criterio a medias sería peor: podría dejar un
     * pronóstico colgando del partido equivocado, que es peor que perderlo.
     */
    const hayIdentidad = existentes.length > 0
      && existentes.every(e => e.api_fixture_id)
      && partidos.every(p => p.apiFixtureId);

    let pronosticosBorrados = 0;
    let partidosReemplazados = 0;

    if (hayIdentidad) {
      /*
       * Renumerar pasa por estados en los que dos partidos comparten posición
       * -uno que baja y otro que aún no ha subido-. La unicidad de `orden` es
       * DEFERRABLE justo para esto: se comprueba al cerrar la transacción.
       */
      await c.query('SET CONSTRAINTS ALL DEFERRED');

      const porFixture = new Map(existentes.map(e => [String(e.api_fixture_id), e]));
      const reusados = new Set();

      for (let i = 0; i < partidos.length; i++) {
        const valores = valoresDePartido(partidos[i]);
        const fila = porFixture.get(String(partidos[i].apiFixtureId));

        if (fila && !reusados.has(fila.id)) {
          reusados.add(fila.id);
          await c.query(
            `UPDATE partidos SET orden=$2, equipo1=$3, equipo2=$4,
                    logo_equipo1=$5, logo_equipo2=$6, comodin=$7,
                    api_fixture_id=$8, api_league_id=$9, api_date=$10, api_status=$11
              WHERE id = $1`,
            [fila.id, i, ...valores]);
        } else {
          await c.query(
            `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2,
                                   logo_equipo1, logo_equipo2, comodin,
                                   api_fixture_id, api_league_id, api_date, api_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [quinielaId, j.id, i, ...valores]);
        }
      }

      /*
       * Lo que ya no está en la jornada se va, y sus pronósticos con él por
       * cascada. Eso SÍ es correcto: ese partido dejó de existir.
       *
       * Se cuentan ANTES de borrar, porque la cascada no dice cuántos se llevó
       * y quien guarda tiene derecho a saber qué perdió.
       */
      const sobran = existentes.filter(e => !reusados.has(e.id)).map(e => e.id);

      if (sobran.length) {
        partidosReemplazados = sobran.length;
        const { rows: [cuenta] } = await c.query(
          'SELECT count(*)::int AS n FROM pronosticos WHERE partido_id = ANY($1::uuid[])',
          [sobran]);
        pronosticosBorrados = cuenta.n;
        await c.query('DELETE FROM partidos WHERE id = ANY($1::uuid[])', [sobran]);
      }
    } else {
      /* ---- Camino antiguo: por posición, para partidos sin identificador ---- */
      const cambiaronDePartido = [];

      for (let i = 0; i < partidos.length; i++) {
        const valores = valoresDePartido(partidos[i]);
        if (i < existentes.length) {
          const antes = existentes[i].api_fixture_id;
          const ahora = partidos[i].apiFixtureId;
          if (antes && ahora && String(antes) !== String(ahora)) {
            cambiaronDePartido.push(existentes[i].id);
          }

          await c.query(
            `UPDATE partidos SET equipo1=$2, equipo2=$3, logo_equipo1=$4, logo_equipo2=$5,
                    comodin=$6, api_fixture_id=$7, api_league_id=$8, api_date=$9, api_status=$10
              WHERE id = $1`,
            [existentes[i].id, ...valores]);
        } else {
          await c.query(
            `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2,
                                   logo_equipo1, logo_equipo2, comodin,
                                   api_fixture_id, api_league_id, api_date, api_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [quinielaId, j.id, i, ...valores]);
        }
      }

      if (existentes.length > partidos.length) {
        await c.query('DELETE FROM partidos WHERE jornada_id = $1 AND orden >= $2',
          [j.id, partidos.length]);
      }

      partidosReemplazados = cambiaronDePartido.length;
      pronosticosBorrados = await pronosticos.borrarDePartidos(c, cambiaronDePartido);

      /*
       * ⛔ Y LAS MARCAS DE COMPARTIDO Y DE AVISADO SE VAN CON ELLOS
       * (migraciones 008 y 009).
       *
       * Esta fila conserva su `id` pero ya es OTRO partido: sus pronósticos
       * acaban de borrarse en la línea de arriba justo por eso. Si se le dejara
       * el `compartido_en` del anterior, el partido nuevo nacería con «ya se
       * compartió» puesto y **la pantalla de compartir no lo propondría nunca**,
       * sin dar ningún error: el grupo se quedaría sin los pronósticos de ese
       * partido y no habría forma de notarlo.
       *
       * ⚠️ El camino por identidad de arriba NO necesita esto, y ponérselo sería
       * un error: allí la fila que se reutiliza es el MISMO partido —se emparejó
       * por `api_fixture_id`— así que su marca sigue siendo cierta. Las que dejan
       * de estar se borran enteras y se llevan la marca con ellas.
       */
      if (cambiaronDePartido.length) {
        await c.query(
          'UPDATE partidos SET compartido_en = NULL, avisado_en = NULL WHERE id = ANY($1::uuid[])',
          [cambiaronDePartido]);
      }
    }

    return { nombre, partidosReemplazados, pronosticosBorrados };
  });
}

/** Añade un partido al final. Devuelve un motivo si la jornada no existe. */
async function agregarPartido(quinielaId, nombre, partido, maximo) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    const { rows: [{ n }] } = await c.query(
      'SELECT count(*)::int AS n FROM partidos WHERE jornada_id = $1', [jornadaId]);
    if (n >= maximo) return { ok: false, motivo: 'demasiados', total: n };

    await c.query(
      `INSERT INTO partidos (quiniela_id, jornada_id, orden, equipo1, equipo2,
                             logo_equipo1, logo_equipo2, comodin,
                             api_fixture_id, api_league_id, api_date, api_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [quinielaId, jornadaId, n, ...valoresDePartido(partido)]);

    return { ok: true };
  });
}

/**
 * Quita los partidos de esas posiciones y renumera los que quedan.
 *
 * Los que sobreviven **conservan su `id`**, así que sus pronósticos siguen
 * apuntando a ellos. En Mongo esto era un `splice` sobre el arreglo y los
 * pronósticos posteriores pasaban a apuntar al partido de al lado en silencio:
 * es M-02, y aquí deja de poder pasar.
 */
async function eliminarPartidos(quinielaId, nombre, indices) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    // Diferir la unicidad: la renumeración pasa por estados intermedios en los
    // que dos partidos comparten posición.
    await c.query('SET CONSTRAINTS ALL DEFERRED');
    await c.query('DELETE FROM partidos WHERE jornada_id = $1 AND orden = ANY($2::int[])',
      [jornadaId, indices]);
    await c.query(`
      UPDATE partidos p
         SET orden = nuevo.fila - 1
        FROM (SELECT id, row_number() OVER (ORDER BY orden) AS fila
                FROM partidos WHERE jornada_id = $1) AS nuevo
       WHERE p.id = nuevo.id AND p.orden <> nuevo.fila - 1`,
      [jornadaId]);

    return { ok: true };
  });
}

/**
 * Cambia sólo la casilla de comodín de cada partido.
 *
 * ⚠️ La ruta manda la lista entera para cambiar una casilla. Si el número de
 * partidos no coincide, lo que llega no es «la misma jornada con otro comodín»
 * sino otra cosa, y aplicarla borraría partidos sin querer.
 */
async function fijarComodines(quinielaId, nombre, partidos) {
  return db.enQuiniela(quinielaId, async c => {
    const jornadaId = await idDe(c, nombre);
    if (!jornadaId) return { ok: false, motivo: 'no_encontrada' };

    const { rows: existentes } = await c.query(
      'SELECT id, orden FROM partidos WHERE jornada_id = $1 ORDER BY orden', [jornadaId]);

    if (existentes.length !== partidos.length) {
      return { ok: false, motivo: 'no_coincide' };
    }

    for (let i = 0; i < existentes.length; i++) {
      await c.query('UPDATE partidos SET comodin = $2 WHERE id = $1',
        [existentes[i].id, Boolean(partidos[i].comodin)]);
    }
    return { ok: true };
  });
}

async function eliminar(quinielaId, nombre) {
  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query('DELETE FROM jornadas WHERE nombre = $1', [nombre]);
    return { ok: rowCount > 0 };
  });
}

/**
 * Cambia lo que cuesta UNA jornada.
 *
 * Es el caso de «esta vale 5000 porque el premio está grande». Va aparte de
 * `guardar` a propósito: cambiar un precio es una decisión del administrador
 * sobre el dinero, no algo que deba pasar de rebote al editar los partidos.
 */
async function cambiarPrecio(quinielaId, nombre, precio, alAcumulado) {
  /*
   * ⚠️ Se reciben las DOS cuotas, no sólo el total.
   *
   * Cuando la cuota se partió en premio de jornada y bote acumulado, esta
   * pantalla se quedó con un solo campo por un momento — y entonces subir una
   * jornada de ₡2.000 a ₡5.000 obligaba a INVENTAR cómo repartir el extra. Esa
   * regla habría sido una suposición del programa sobre algo que el
   * administrador ya sabía.
   *
   * Cuando un dato pasa de ser uno a ser dos, tiene que ser dos en todos los
   * sitios donde se toca.
   */
  /*
   * ⚠️ Si el desglose no viene, se CONSERVA el que la jornada ya tenía; no se
   * pone a cero. Una llamada que sólo quiera cambiar el total no puede vaciar
   * el bote de esa jornada sin habérselo pedido nadie.
   *
   * Y se acota al precio nuevo con `LEAST`: bajar el total de ₡5.000 a ₡1.000
   * dejaría un bote de ₡1.000 mayor que lo que se cobra, y la base lo
   * rechazaría con un error que no explica nada.
   */
  const bote = alAcumulado === undefined || alAcumulado === null
    ? null
    : Math.max(0, Number(alAcumulado) || 0);

  return db.enQuiniela(quinielaId, async c => {
    const { rows: [j] } = await c.query(
      `UPDATE jornadas
          SET precio = $2,
              al_acumulado = LEAST($2, COALESCE($3, al_acumulado))
        WHERE nombre = $1
       RETURNING id, nombre, precio, al_acumulado`,
      [nombre, precio, bote]);
    return j || null;
  });
}

module.exports = {
  partidoPublico,
  actual, resumen, listar, porNombre, idDe,
  ordenarParaGuardar,
  guardar, agregarPartido, eliminarPartidos, fijarComodines, eliminar,
  cambiarPrecio
};

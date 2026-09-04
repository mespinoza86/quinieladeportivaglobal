/*
 * Qué pronósticos están listos para salir al grupo, y cuáles ya salieron.
 *
 * ============================================================================
 * EL TRABAJO QUE VIENE A QUITAR
 * ============================================================================
 *
 * Mandar al grupo de WhatsApp los pronósticos de un partido eran cinco pasos a
 * mano —abrir la pantalla, elegir jornada, elegir partido, copiar, enviar—
 * repetidos partido por partido. Un domingo con cinco partidos son veinticinco
 * pasos, y lo que se olvida no deja ninguna señal de que se olvidó.
 *
 * Aquí NO se envía nada: **no existe forma oficial de que un programa escriba
 * en un grupo de WhatsApp**. Las librerías que lo consiguen incumplen sus
 * términos y arriesgan el bloqueo del número de quien las use, y ése fue el
 * motivo de descartarlas. Lo que se hace es quitar los cuatro pasos que sí se
 * pueden quitar: la lista se arma sola, el texto se prepara solo, y sólo queda
 * el toque de enviar.
 *
 * ============================================================================
 * ⛔ AQUÍ NO SE DA FORMATO AL TEXTO, Y ES A PROPÓSITO
 * ============================================================================
 *
 * Este módulo devuelve datos: qué partidos, quién pronosticó qué, y si ese dato
 * ya es público. **El texto lo arma `private/js/compartir.js`** con
 * `marcadorVisible()`, que es el mismo ayudante que usan las otras tres
 * pantallas que copian pronósticos.
 *
 * La alternativa —armarlo aquí— obligaría a que `src/` conociera la regla de
 * cómo se enseña un marcador, que hoy vive en `private/js/`. Serían dos copias
 * de la misma regla, y el guardián de funciones duplicadas existe porque la vez
 * que hubo dos, la de arriba nunca llegaba a ejecutarse y engañaba al leer.
 *
 * ============================================================================
 * ⚠️ LA VENTANA ES LO QUE IMPIDE QUE EL PRIMER DÍA SEA UN ALUD
 * ============================================================================
 *
 * La marca `partidos.compartido_en` nace en `NULL` para TODOS los partidos que
 * ya existen, incluidos los de hace tres meses. Si «pendiente» fuera sólo «sin
 * marca», el día que esto se despliegue la pantalla propondría la temporada
 * entera y sería inservible justo en su primer uso.
 *
 * Por eso pendiente es «sin marca **y** arrancó hace poco». Un partido de hace
 * tres semanas no es noticia aunque nunca se compartiera, y para ése siguen
 * estando las pantallas de siempre.
 */
'use strict';

const db = require('./db');
const jugadoresMod = require('./jugadores');
const { partidoYaInicio } = require('./fechas');

/**
 * Cuántas horas hacia atrás se proponen partidos.
 *
 * Doce cubren de sobra la jornada de un domingo —el partido de la mañana sigue
 * a mano cuando termina el último de la tarde— sin arrastrar lo de ayer.
 */
const VENTANA_HORAS = Number(process.env.COMPARTIR_VENTANA_HORAS || 12);

/**
 * Un instante, en el mismo formato de texto en que `partidos.api_date` guarda
 * la hora de inicio.
 *
 * ============================================================================
 * ⛔ EN HORA DE COSTA RICA, NO EN LA DEL SERVIDOR
 * ============================================================================
 *
 * Es la inversa exacta de `parseFechaPartidoCostaRica`, y tiene que serlo.
 * `api_date` guarda SIEMPRE hora de Costa Rica; el servidor de Render corre en
 * UTC. Leer las partes con `getHours()` daría la hora del servidor, y la
 * ventana quedaría corrida **seis horas** contra unos datos que están en otra
 * zona.
 *
 * ⚠️ Y no fallaría. La lista seguiría saliendo, con los partidos de las últimas
 * seis horas en vez de las últimas doce: el que arrancó esta mañana no se
 * propondría nunca y nada lo explicaría. Es el mismo error que en su día cerró
 * los pronósticos a destiempo, y por eso la conversión vive en un solo sitio.
 *
 * Costa Rica es UTC-6 todo el año —no hay horario de verano— así que restar el
 * desfase y leer las partes en UTC es toda la conversión que hace falta.
 *
 * ⚠️ La comparación con `api_date` es de TEXTO, y sale bien porque el formato
 * es «YYYY-MM-DD HH:MM»: en ese orden, el alfabético y el cronológico son el
 * mismo. Con cualquier otro —el día delante, o el mes en letras— esto daría
 * respuestas equivocadas **sin fallar**. Si algún día cambia el formato del
 * proveedor, hay que volver aquí.
 */
function comoApiDate(fecha) {
  const enCostaRica = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
  const dos = n => String(n).padStart(2, '0');

  return `${enCostaRica.getUTCFullYear()}`
    + `-${dos(enCostaRica.getUTCMonth() + 1)}`
    + `-${dos(enCostaRica.getUTCDate())}`
    + ` ${dos(enCostaRica.getUTCHours())}:${dos(enCostaRica.getUTCMinutes())}`;
}

/**
 * Los partidos cuyos pronósticos están listos para salir, agrupados por hora de
 * inicio, más los que ya salieron dentro de la misma ventana.
 *
 * Se agrupa por (jornada, hora de inicio) porque es como ocurre de verdad: un
 * domingo hay cinco partidos a las 15:00 y son **un** mensaje, no cinco. Ése es
 * el grueso del trabajo que se ahorra.
 *
 * Van dos consultas, y ninguna por jugador. Recorrer los jugadores pidiendo los
 * pronósticos de cada uno —que es lo que hace hoy la pantalla por partido— son
 * veinte viajes a la base para armar un mensaje: el mismo N+1 que la Fase 5
 * quitó de la tabla general y que volvió a colarse al portar `/api/resultados`.
 */
async function paraCompartir(quinielaId, { ahora = new Date(), ventanaHoras = VENTANA_HORAS } = {}) {
  const desde = comoApiDate(new Date(ahora.getTime() - ventanaHoras * 60 * 60 * 1000));

  const datos = await db.enQuiniela(quinielaId, async c => {
    /*
     * ⚠️ El filtro por fecha mira la hora PREVISTA, así que deja fuera a los
     * partidos sin `api_date`. No es un descuido: la ventana se define sobre el
     * momento de arranque, y un partido sin hora prevista no tiene ese momento.
     * `partidoYaInicio` tampoco sabría decir si empezó.
     */
    const { rows: candidatos } = await c.query(`
      SELECT p.id, p.orden, p.equipo1, p.equipo2, p.api_date,
             p.compartido_en, p.avisado_en,
             jor.id AS jornada_id, jor.nombre AS jornada, jor.secuencia,
             rop.estado AS oficial_estado
        FROM partidos p
        JOIN jornadas jor ON jor.id = p.jornada_id
        LEFT JOIN resultados_oficiales_partidos rop ON rop.partido_id = p.id
       WHERE p.api_date >= $1
       ORDER BY p.api_date DESC, jor.secuencia DESC, p.orden`,
      [desde]);

    /*
     * El corte fino se hace aquí y no en SQL porque la regla del cierre vive en
     * `partidoYaInicio`, y ahí manda el estado oficial sobre el calendario: un
     * partido que el proveedor da por empezado lo está aunque el reloj diga que
     * todavía no. Escribir una segunda versión de esa regla en SQL sería tener
     * dos respuestas a «¿ya empezó?» —y una de ellas se quedaría vieja—.
     */
    const arrancados = candidatos.filter(f =>
      partidoYaInicio(f, f.oficial_estado ? { estado: f.oficial_estado } : null, ahora));

    if (!arrancados.length) return { arrancados: [], porPartido: new Map() };

    const ids = arrancados.map(f => f.id);

    /*
     * ⚠️ Sólo se piden los pronósticos que EXISTEN. Quien no pronosticó no
     * tiene fila, y su hueco se rellena abajo cruzando contra la lista de
     * jugadores: tiene que salir como «no pronosticó», nunca como un cero.
     */
    const { rows: filas } = await c.query(`
      SELECT pr.partido_id, jug.nombre AS jugador, pr.marcador1, pr.marcador2
        FROM pronosticos pr
        JOIN resultados r   ON r.id   = pr.resultado_id
        JOIN jugadores  jug ON jug.id = r.jugador_id
       WHERE pr.partido_id = ANY($1::uuid[])`,
      [ids]);

    const porPartido = new Map(ids.map(id => [id, new Map()]));
    for (const f of filas) porPartido.get(f.partido_id)?.set(f.jugador, f);

    return { arrancados, porPartido };
  });

  if (!datos.arrancados.length) return { ventanaHoras, grupos: [] };

  /*
   * Los nombres salen de `jugadores.nombres()` y no de la tabla `jugadores`
   * porque son dos orígenes: los miembros de la quiniela y los históricos sin
   * cuenta. Quien es miembro pero nunca mandó nada **no tiene fila** en
   * `jugadores`, y aun así le toca aparecer —con su raya— en el mensaje.
   */
  const nombres = await jugadoresMod.nombres(quinielaId, { incluirExpulsados: false });

  const porClave = new Map();

  for (const f of datos.arrancados) {
    const clave = `${f.jornada_id}|${f.api_date}`;

    if (!porClave.has(clave)) {
      porClave.set(clave, {
        clave,
        jornada: f.jornada,
        secuencia: f.secuencia,
        apiDate: f.api_date,
        compartido: true,
        compartidoEn: null,
        avisado: true,
        partidoIds: [],
        partidos: []
      });
    }

    const grupo = porClave.get(clave);

    /*
     * ⚠️ Un grupo cuenta como compartido sólo si lo están TODOS sus partidos.
     *
     * Con «alguno» bastaría para esconderlo, y un partido añadido a las 15:00
     * después de haber mandado el mensaje quedaría tapado por la marca de sus
     * compañeros: no se compartiría nunca y nada lo diría.
     */
    if (!f.compartido_en) {
      grupo.compartido = false;
      grupo.compartidoEn = null;
    } else if (grupo.compartido) {
      grupo.compartidoEn = f.compartido_en;
    }

    /*
     * Y lo mismo con el aviso, por la misma razón: si un partido se añade a un
     * grupo del que ya se avisó, hay algo nuevo de lo que avisar.
     *
     * ⚠️ `avisado` y `compartido` son hechos DISTINTOS y ninguno implica al
     * otro: se avisa antes de compartir —para eso sirve— y se puede compartir
     * sin que nadie avisara, que es lo que pasa cuando el interruptor del
     * correo está apagado.
     */
    if (!f.avisado_en) grupo.avisado = false;

    grupo.partidoIds.push(f.id);
    grupo.partidos.push({
      id: f.id,
      orden: f.orden,
      equipo1: f.equipo1,
      equipo2: f.equipo2,
      pronosticos: nombres.map(nombre => {
        const p = datos.porPartido.get(f.id)?.get(nombre);
        return {
          jugador: nombre,
          marcador1: p?.marcador1 ?? null,
          marcador2: p?.marcador2 ?? null,
          /*
           * ⛔ Aquí sale siempre `false`, porque arriba ya se filtró por
           * `partidoYaInicio` y un partido que empezó es público.
           *
           * Se calcula y se manda igual, y quien lo pinte tiene que
           * respetarlo. Es la red de la Entrada 068: el día que alguien afloje
           * el filtro de arriba —para previsualizar, por ejemplo— esta línea
           * es lo único que impediría que los pronósticos de todos salieran al
           * grupo antes de tiempo.
           */
          oculto: false
        };
      })
    });
  }

  /* Lo más reciente primero: es lo que hay que mandar ahora. */
  const grupos = [...porClave.values()].sort((a, b) =>
    String(b.apiDate).localeCompare(String(a.apiDate)) || b.secuencia - a.secuencia);

  return { ventanaHoras, grupos };
}

/**
 * Deja constancia de que estos partidos ya salieron al grupo.
 *
 * ⚠️ El `AND compartido_en IS NULL` la hace idempotente: volver a marcar lo ya
 * marcado no mueve la hora. Sin eso, abrir dos veces el mismo mensaje
 * reescribiría la fecha y el orden de la lista bailaría sin motivo.
 */
async function marcar(quinielaId, partidoIds, ahora = new Date()) {
  if (!partidoIds?.length) return 0;

  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query(
      `UPDATE partidos SET compartido_en = $2
        WHERE id = ANY($1::uuid[]) AND compartido_en IS NULL`,
      [partidoIds, ahora]);
    return rowCount;
  });
}

/**
 * Deshace la marca: el grupo vuelve a estar pendiente.
 *
 * Existe porque el toque de «enviar» marca **antes** de saber si de verdad se
 * envió —WhatsApp no lo cuenta— así que quien cancele a mitad se quedaría con
 * un mensaje dado por mandado que nunca salió. Sin esta vuelta atrás, el
 * remedio sería peor que la enfermedad: hoy al menos uno se acuerda de que no
 * lo mandó; con una marca falsa, la pantalla afirmaría que sí.
 */
async function desmarcar(quinielaId, partidoIds) {
  if (!partidoIds?.length) return 0;

  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query(
      'UPDATE partidos SET compartido_en = NULL WHERE id = ANY($1::uuid[])',
      [partidoIds]);
    return rowCount;
  });
}

/* ==================== El aviso por correo ==================== */

/**
 * Deja constancia de que ya se avisó de estos partidos.
 *
 * ⚠️ Idempotente por la misma razón que `marcar`, y aquí importa más: sin el
 * `IS NULL`, un fallo a mitad del barrido volvería a mover la hora y no habría
 * forma de distinguir «avisado hace un minuto» de «avisado hace una hora».
 */
async function marcarAvisados(quinielaId, partidoIds, ahora = new Date()) {
  if (!partidoIds?.length) return 0;

  return db.enQuiniela(quinielaId, async c => {
    const { rowCount } = await c.query(
      `UPDATE partidos SET avisado_en = $2
        WHERE id = ANY($1::uuid[]) AND avisado_en IS NULL`,
      [partidoIds, ahora]);
    return rowCount;
  });
}

/**
 * ¿Esta quiniela quiere que se avise por correo?
 *
 * ⛔ La comprobación es `=== true`, no `!== false`, y va al revés que la del
 * dinero **a propósito**.
 *
 * En los cobros el valor por defecto de la duda es COBRAR, porque cobrar de más
 * lo reclama alguien mañana y perdonar no lo reclama nadie. Aquí la asimetría
 * es la contraria: **un correo que nadie pidió es un problema, y uno que falta
 * es una molestia**. Así que sin una respuesta explícita, no se manda nada.
 *
 * Es también lo que hace que esto no despierte a nadie el día que se despliegue:
 * ninguna quiniela existente tiene el campo puesto.
 */
function quiereAviso(configuracion) {
  return configuracion?.avisarAlCompartir === true;
}

/**
 * Avisa por correo, en TODAS las quinielas activas que lo hayan pedido.
 *
 * Es el gemelo de `resolverTriviasDeTodas`, y comparte su forma por la misma
 * razón: quiniela por quiniela, cada una en su propio contexto, y el fallo de
 * una no interrumpe el barrido de las demás. Recorrerlas de una vez sería más
 * corto y sería la forma exacta del hallazgo C-02.
 *
 * `enviarAviso` se recibe de fuera —no se importa `correo` aquí— para que las
 * pruebas no dependan del transporte, igual que `trivias.resolverPendientes`
 * recibe su intérprete.
 */
async function avisarDeTodas({ ahora = new Date(), enviarAviso, destinatariosDe }) {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre, configuracion FROM quinielas WHERE estado = 'activa'`);

  let avisos = 0;
  let correos = 0;

  for (const quiniela of quinielas) {
    if (!quiereAviso(quiniela.configuracion)) continue;

    try {
      const { grupos } = await paraCompartir(quiniela.id, { ahora });

      /*
       * ⚠️ Lo ya compartido NO se avisa, aunque nadie hubiera avisado de ello.
       * Si alguien entró a la pantalla y lo mandó por su cuenta, el aviso
       * llegaría tarde y a decir algo que ya no hay que hacer.
       */
      const nuevos = grupos.filter(g => !g.avisado && !g.compartido);
      if (!nuevos.length) continue;

      const destinatarios = await destinatariosDe(quiniela.id);

      /*
       * Sin nadie a quien avisar no se marca nada: si mañana hay un
       * administrador con correo, el aviso sigue pendiente y le llegará.
       */
      if (!destinatarios.length) continue;

      const partidoIds = nuevos.flatMap(g => g.partidoIds);

      const enviados = await Promise.allSettled(destinatarios.map(d =>
        enviarAviso({ destinatario: d, quiniela, grupos: nuevos })));

      const salio = enviados.filter(r => r.status === 'fulfilled').length;

      for (const fallo of enviados.filter(r => r.status === 'rejected')) {
        console.error(`[aviso] no salió el correo de "${quiniela.nombre}":`,
          fallo.reason?.message || fallo.reason);
      }

      /*
       * ⛔ SE MARCA DESPUÉS DE ENVIAR, Y SÓLO SI SALIÓ ALGUNO.
       *
       * Al revés —marcar primero— un fallo del proveedor de correo se comería
       * el aviso para siempre y en silencio: nadie volvería a intentarlo.
       * Marcando después, un fallo se reintenta al minuto siguiente.
       *
       * ⚠️ Y «alguno» y no «todos» a propósito: con un solo destinatario
       * fallando de forma persistente, exigir todos dejaría al resto recibiendo
       * el mismo aviso cada minuto. Prefiere perder un aviso a inundar a tres.
       */
      if (!salio) continue;

      await marcarAvisados(quiniela.id, partidoIds, ahora);
      avisos += nuevos.length;
      correos += salio;
    } catch (error) {
      console.error(`[aviso] error avisando en "${quiniela.nombre}":`, error.message);
    }
  }

  return { avisos, correos };
}

module.exports = {
  VENTANA_HORAS, comoApiDate, quiereAviso,
  paraCompartir, marcar, desmarcar, marcarAvisados, avisarDeTodas
};

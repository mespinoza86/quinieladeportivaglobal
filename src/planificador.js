/*
 * Los trabajos periódicos: sincronizar partidos y resolver trivias.
 *
 * ============================================================================
 * EL RITMO LO MARCA UN RELOJ PROPIO, NO EL TRÁFICO
 * ============================================================================
 *
 * Antes, un middleware colgado de CADA petición disparaba una sincronización
 * cada treinta segundos. Ataba el consumo del API externo a quién estuviera
 * mirando la pantalla, así que el domingo por la tarde —cuando más importa— era
 * cuando más se repetía. Y su estado vivía en variables de módulo, que no se
 * comparten entre instancias: dos procesos web eran dos sincronizaciones a la
 * vez. Eso era C-05.
 *
 * Ahora es un `setInterval` propio, con un cerrojo distribuido detrás.
 *
 * ============================================================================
 * ⚠️ POR QUÉ HAY UN INTERRUPTOR
 * ============================================================================
 *
 * `JOBS_HABILITADOS=false` existe para el día en que convenga mover estos
 * trabajos a un proceso aparte: se despliega el MISMO código con la bandera
 * apagada en las instancias que sólo atienden peticiones, y encendida en la que
 * hace de trabajador. Sin ella habría que partir el código antes de poder
 * partir el despliegue.
 */
'use strict';

const db = require('./db');
const sincronizador = require('./sincronizador');
const proveedor = require('./proveedor');
const eventos = require('./eventos');
const fixtures = require('./fixtures');
const trivias = require('./trivias');
const compartir = require('./compartir');
const membresias = require('./membresias');
const correo = require('./correo');
const notificaciones = require('./notificaciones');
const push = require('./push');
const cerrojos = require('./cerrojos');
/*
 * ⛔ La tregua: lo que decide si este latido toca la base o se calla.
 *
 * Sin ella los cuatro relojes escribían un cerrojo cada 60 segundos, día y
 * noche, y Neon no veía nunca los cinco minutos de inactividad que necesita
 * para suspender el cómputo: 19,7 días encendido y ~197 CU-hrs al mes de
 * factura, casi toda por estar despierto sin nada que hacer. El porqué entero
 * está en `src/tregua.js`.
 */
const tregua = require('./tregua');

const INTERVALO_CICLO_SYNC_MS = Number(process.env.SYNC_INTERVALO_MS || 60 * 1000);
const INTERVALO_RESOLUCION_TRIVIAS_MS = 5 * 60 * 1000;
const INTERVALO_AVISO_COMPARTIR_MS = Number(process.env.AVISO_INTERVALO_MS || 60 * 1000);
const INTERVALO_NOTIFICACIONES_MS = Number(process.env.NOTIFICACION_INTERVALO_MS || 60 * 1000);
const JOBS_HABILITADOS = process.env.JOBS_HABILITADOS !== 'false';

const CERROJO_AVISO = 'aviso-de-compartir';
const TTL_CERROJO_AVISO_MS = 2 * 60 * 1000;

const CERROJO_NOTIFICACION = 'notificacion-push';
const TTL_CERROJO_NOTIFICACION_MS = 2 * 60 * 1000;

/** Un ciclo de sincronización, con el proveedor de verdad enchufado. */
function unCiclo(opciones = {}) {
  return sincronizador.tick({
    consultar: descriptor => proveedor.buscarEvento(descriptor, sincronizador.metricas),
    reescribirJornada: sincronizador.reescribirJornadaDesdeCache,
    ...opciones
  });
}

/**
 * Resuelve las trivias vencidas de TODAS las quinielas activas.
 *
 * ⚠️ Quiniela por quiniela, cada una en su propio contexto. Recorrerlas de una
 * vez sería más corto y sería la forma exacta del hallazgo C-02.
 *
 * El fallo de una no interrumpe el barrido de las demás: una quiniela con datos
 * raros no puede dejar sin puntos a todas las otras.
 */
async function resolverTriviasDeTodas() {
  const { rows: quinielas } = await db.consulta(
    `SELECT id, nombre FROM quinielas WHERE estado = 'activa'`);

  let resueltas = 0;

  for (const quiniela of quinielas) {
    try {
      const r = await trivias.resolverPendientes(quiniela.id, {
        obtenerEvento: apiFixtureId => fixtures.eventoDe(apiFixtureId),
        interpretar: eventos.resolverRespuestaTrivia
      });
      resueltas += r.resueltas;
    } catch (error) {
      console.error(`Error resolviendo trivias de "${quiniela.nombre}":`, error.message);
    }
  }

  return { quinielas: quinielas.length, resueltas };
}

/* Cuenta propia, para que el testigo del cerrojo sea distinto en cada pasada. */
let avisosLanzados = 0;

/**
 * Avisa por correo de los partidos que acaban de arrancar y no se han
 * compartido, en las quinielas que lo hayan pedido.
 *
 * ============================================================================
 * ⛔ EL CERROJO NO ES OPCIONAL AQUÍ, Y ES LA DIFERENCIA CON LAS TRIVIAS
 * ============================================================================
 *
 * `resolverTriviasDeTodas` corre sin cerrojo y no pasa nada: resolver dos veces
 * la misma trivia da el mismo resultado. Un correo no. Con dos instancias en
 * Render, las dos leerían «sin avisar», las dos mandarían, y sólo después una
 * de ellas marcaría: **dos correos por partido**, y nadie sabría por qué.
 *
 * ⚠️ El `AND avisado_en IS NULL` de `marcarAvisados` NO cierra esa carrera:
 * protege de marcar dos veces, no de enviar dos veces, y el envío va antes.
 *
 * El TTL es corto —dos minutos, contra los cinco del sincronizador— porque este
 * trabajo dura milisegundos: si una instancia se muere con el cerrojo cogido,
 * conviene que la otra pueda avisar cuanto antes.
 */
async function avisarDeCompartir({ ahora = new Date() } = {}) {
  const titular = `${cerrojos.ID_INSTANCIA}#aviso${++avisosLanzados}`;

  if (!(await cerrojos.tomar(CERROJO_AVISO, TTL_CERROJO_AVISO_MS, ahora, titular))) {
    return { omitido: true, motivo: 'cerrojo en poder de otra instancia' };
  }

  try {
    /*
     * Se quita la barra final si la hay, igual que en los enlaces de la Fase E:
     * un APP_ORIGIN terminado en barra daría una URL con dos, y algunos
     * clientes de correo la parten ahí.
     */
    const base = (process.env.APP_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '');

    return await compartir.avisarDeTodas({
      ahora,
      destinatariosDe: quinielaId => membresias.correosDeAdministradores(quinielaId),
      enviarAviso: ({ destinatario, quiniela, grupos }) => correo.enviarAvisoDeCompartir({
        para: destinatario.email,
        nombre: destinatario.username,
        quiniela: quiniela.nombre,
        cuantos: grupos.reduce((n, g) => n + g.partidos.length, 0),
        resumen: grupos
          .map(g => `${g.jornada} a las ${String(g.apiDate).split(' ')[1] || g.apiDate}`)
          .join('; '),
        url: `${base}/compartir.html`
      })
    });
  } finally {
    await cerrojos.soltar(CERROJO_AVISO, titular).catch(error => {
      console.error('Error soltando el cerrojo del aviso:', error.message);
    });
  }
}

let notificacionesLanzadas = 0;

/**
 * Avisa al teléfono de los partidos que arrancan en quince minutos.
 *
 * ⛔ CERROJO PROPIO, y por la misma razón que el del correo: una notificación
 * **no es idempotente**. Si dos instancias corrieran esto a la vez, el mismo
 * teléfono recibiría el aviso dos veces — y la marca `notificado_en` no lo
 * evitaría, porque las dos leerían el partido sin marcar antes de que ninguna
 * lo marcara.
 *
 * ⚠️ Y va en su propio reloj, no colgado del ciclo de sincronización: un ciclo
 * abandonado por tiempo se llevaría el aviso con él, y el aviso no necesita
 * salir a la red del proveedor para saber a qué hora empieza un partido.
 */
async function notificarDeTodas({ ahora = new Date() } = {}) {
  /*
   * Sin claves no hay nada que hacer, y se sale ANTES de tocar el cerrojo: no
   * tiene sentido bloquear a las demás instancias para no hacer nada.
   */
  if (!push.hayClaves()) return { omitido: true, motivo: 'sin claves VAPID' };

  const titular = `${cerrojos.ID_INSTANCIA}#push${++notificacionesLanzadas}`;

  if (!(await cerrojos.tomar(CERROJO_NOTIFICACION, TTL_CERROJO_NOTIFICACION_MS, ahora, titular))) {
    return { omitido: true, motivo: 'cerrojo en poder de otra instancia' };
  }

  try {
    return await notificaciones.notificarDeTodas({ ahora, enviar: push.enviar });
  } finally {
    await cerrojos.soltar(CERROJO_NOTIFICACION, titular).catch(error => {
      console.error('Error soltando el cerrojo de notificaciones:', error.message);
    });
  }
}

let temporizadores = [];

/** Arranca los cuatro relojes. No hace nada si los trabajos están apagados. */
function arrancar() {
  if (!JOBS_HABILITADOS) {
    console.log('[planificador] trabajos periódicos apagados (JOBS_HABILITADOS=false)');
    return false;
  }

  /*
   * ============================================================
   * ⛔ CADA LATIDO PREGUNTA PRIMERO SI HAY ALGO QUE HACER
   * ============================================================
   *
   * `tregua.tocaTrabajar()` responde SIN tocar la base en el caso normal, que
   * es el caso aburrido: no hay partidos en las próximas horas. Así Neon ve el
   * hueco de inactividad que necesita para suspender el cómputo.
   *
   * ⚠️ El reloj sigue latiendo cada minuto, y eso está bien: un temporizador en
   * memoria no cuesta nada. Lo que cuesta es la consulta, y es lo que se evita.
   *
   * ⭐ Y el primer reloj que llegue despierta a los cuatro: `tocaTrabajar`
   * recalcula el horizonte y los demás lo verán ya vencido en su propio latido.
   * Si el cómputo está despierto, aprovecharlo es gratis.
   */
  /*
   * ==========================================================================
   * ⛔ UN SOLO LATIDO MAESTRO, Y CUATRO TRABAJOS CON SU CADENCIA
   * ==========================================================================
   *
   * Antes eran cuatro `setInterval` independientes, cada uno con su reloj y su
   * cerrojo. Al meter la tregua entre medias eso se rompió de una forma que no
   * daba ningún error: **los cuatro se robaban el turno**. El primero en latir
   * preguntaba, recalculaba el horizonte, lo empujaba al futuro, y los otros
   * tres se encontraban con que «ya no tocaba».
   *
   * Medido con un partido en vivo durante diez minutos:
   *
   *     sincronizar  10 de 10   ✔
   *     notificar     9 de 10   ⛔
   *     compartir     9 de 10   ⛔
   *     trivias       1 de  2   ⛔
   *
   * ⚠️ Y en un día tranquilo el robo habría sido TOTAL: el primero se lleva el
   * único turno y los otros tres no corren jamás. La notificación de los quince
   * minutos —que tiene una ventana de quince minutos— se habría perdido sin que
   * nada lo dijera.
   *
   * ⭐ Ahora late UNO, pregunta UNA vez y reparte. Cada trabajo conserva su
   * cadencia con su propia marca de última ejecución, así que durante un
   * partido el comportamiento es idéntico al de antes de la tregua.
   *
   * ⚠️ Lo que se pierde: los cuatro ya no son independientes. Un trabajo que se
   * cuelgue retrasa a los de detrás. Por eso cada uno va con su `try` propio y
   * el orden pone primero el que más tarda —sincronizar, que sale a la red—,
   * cuyos fallos ya estaban acotados por su propio tiempo de espera.
   */
  const ultima = Object.create(null);

  /** ¿A este trabajo le toca ya, por su propia cadencia? */
  const leToca = (nombre, cada, ahora) =>
    ultima[nombre] === undefined || ahora - ultima[nombre] >= cada;

  const correr = async (nombre, cada, trabajo, ahora) => {
    if (!leToca(nombre, cada, ahora)) return;
    ultima[nombre] = ahora;
    try {
      await trabajo();
    } catch (error) {
      console.error(`Error en ${nombre}:`, error.message);
    }
  };

  async function latido() {
    const ahora = Date.now();

    /*
     * La única pregunta, y en el caso aburrido se responde SIN tocar la base.
     * Es lo que deja a Neon suspender el cómputo.
     */
    if (!(await tregua.tocaTrabajar(new Date(ahora)))) return;

    await correr('la sincronización', INTERVALO_CICLO_SYNC_MS, unCiclo, ahora);
    await correr('el aviso de compartir', INTERVALO_AVISO_COMPARTIR_MS, avisarDeCompartir, ahora);
    await correr('la notificación de los partidos', INTERVALO_NOTIFICACIONES_MS, notificarDeTodas, ahora);
    await correr('la resolución de trivias', INTERVALO_RESOLUCION_TRIVIAS_MS, resolverTriviasDeTodas, ahora);
  }

  /*
   * El latido va a la cadencia más fina de las cuatro, la del ciclo de
   * sincronización. Las otras tres se respetan dentro, con `leToca`.
   */
  temporizadores = [
    setInterval(() => {
      latido().catch(error => {
        console.error('Error en el latido del planificador:', error.message);
      });
    }, INTERVALO_CICLO_SYNC_MS)
  ];
  // Un temporizador pendiente no debe impedir que el proceso termine.
  temporizadores.forEach(t => t.unref?.());

  return true;
}

function parar() {
  temporizadores.forEach(clearInterval);
  temporizadores = [];
}

module.exports = {
  INTERVALO_CICLO_SYNC_MS, INTERVALO_RESOLUCION_TRIVIAS_MS,
  INTERVALO_AVISO_COMPARTIR_MS, CERROJO_AVISO, TTL_CERROJO_AVISO_MS,
  INTERVALO_NOTIFICACIONES_MS, CERROJO_NOTIFICACION, TTL_CERROJO_NOTIFICACION_MS,
  JOBS_HABILITADOS,
  unCiclo, resolverTriviasDeTodas, avisarDeCompartir, notificarDeTodas,
  arrancar, parar
};

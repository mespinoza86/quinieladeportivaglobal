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

  temporizadores = [
    setInterval(() => {
      unCiclo().catch(error => {
        console.error('Error en el ciclo de sincronización:', error.message);
      });
    }, INTERVALO_CICLO_SYNC_MS),

    setInterval(() => {
      resolverTriviasDeTodas().catch(error => {
        console.error('Error automático resolviendo trivias:', error.message);
      });
    }, INTERVALO_RESOLUCION_TRIVIAS_MS),

    /*
     * ⚠️ Va en su propio reloj y no colgado del ciclo de sincronización, aunque
     * los dos corran cada minuto. Si fuera dentro, un ciclo abandonado por
     * tiempo —que pasa: hay métrica para contarlo— se llevaría el aviso con él,
     * y el correo dependería de que el proveedor externo respondiera a tiempo.
     * Avisar no necesita salir a la red.
     */
    setInterval(() => {
      avisarDeCompartir().catch(error => {
        console.error('Error avisando de lo que hay que compartir:', error.message);
      });
    }, INTERVALO_AVISO_COMPARTIR_MS),

    /*
     * ⚠️ El cuarto, también con reloj y cerrojo propios. Avisar al teléfono no
     * depende del proveedor ni del correo, y compartir su suerte sería regalar
     * una forma de que se pierda: si el ciclo de sincronización se abandona por
     * tiempo, el partido arranca igual.
     */
    setInterval(() => {
      notificarDeTodas().catch(error => {
        console.error('Error notificando los partidos que arrancan:', error.message);
      });
    }, INTERVALO_NOTIFICACIONES_MS)
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

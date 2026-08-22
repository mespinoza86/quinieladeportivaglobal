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

const INTERVALO_CICLO_SYNC_MS = Number(process.env.SYNC_INTERVALO_MS || 60 * 1000);
const INTERVALO_RESOLUCION_TRIVIAS_MS = 5 * 60 * 1000;
const JOBS_HABILITADOS = process.env.JOBS_HABILITADOS !== 'false';

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

let temporizadores = [];

/** Arranca los dos relojes. No hace nada si los trabajos están apagados. */
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
    }, INTERVALO_RESOLUCION_TRIVIAS_MS)
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
  INTERVALO_CICLO_SYNC_MS, INTERVALO_RESOLUCION_TRIVIAS_MS, JOBS_HABILITADOS,
  unCiclo, resolverTriviasDeTodas, arrancar, parar
};

/*
 * La tregua: cuándo NO hace falta tocar la base.
 *
 * ============================================================================
 * ⛔ POR QUÉ EXISTE ESTO: LA FACTURA DE NEON
 * ============================================================================
 *
 * Neon cobra **por hora de cómputo despierto** —$0,106 el CU-hora en el plan
 * Launch— y apaga el cómputo solo cuando lleva cinco minutos sin actividad.
 *
 * Los cuatro relojes del planificador corrían cada 60 segundos y **escribían en
 * la base antes de empezar** (el cerrojo). Medido el 14 de noviembre de 2026
 * contra producción, con sólo Render hablando:
 *
 *     58 transacciones/min
 *     34 escrituras/min
 *     día y noche, sin parar
 *
 * Con eso Neon no ve NUNCA un hueco de cinco minutos: el cómputo llevaba **19,7
 * días sin suspenderse** y facturaba ~197 CU-hrs al mes, ~21 dólares, de los
 * cuales casi todo era estar encendido sin nada que hacer. Los partidos ocupan
 * unas pocas horas por semana.
 *
 * ⭐ Y el ajuste de Neon ya estaba bien: «scale to zero» encendido. El problema
 * era nuestro.
 *
 * ============================================================================
 * CÓMO FUNCIONA
 * ============================================================================
 *
 * Los relojes siguen latiendo cada minuto —eso es gratis, es un temporizador en
 * memoria— pero antes de abrir una consulta preguntan aquí. Si no hay nada que
 * hacer hasta las 19:45, esto responde «espera» **sin tocar la base**, y el
 * cómputo se duerme.
 *
 * El horizonte sale de `fixtures`, que es la única tabla que sabe cuándo toca lo
 * siguiente y **la única que no lleva RLS**: una consulta, sin contexto de
 * quiniela, sin recorrer las siete. De ahí salen los dos momentos que importan:
 *
 *   · `proxima_consulta` — cuándo hay que volver a preguntarle al proveedor;
 *   · `api_date` menos dos horas — el aviso previo de jornada, que es el primer
 *     trabajo que despierta antes de un partido.
 *
 * ⚠️ Es CONSERVADOR a propósito: despierta antes de lo necesario, nunca después.
 * Si una de las dos cuentas se equivoca, se equivoca gastando, no perdiendo un
 * marcador.
 *
 * ============================================================================
 * ⛔ LAS TRES COSAS QUE PUEDEN SALIR MAL, Y CÓMO SE CUBREN
 * ============================================================================
 *
 * 1. **Que el horizonte se calcule mal y durmamos de más.** Por eso hay un
 *    TOPE: nunca se duerme más de `TOPE_MS`. Un error de cálculo retrasa como
 *    mucho ese tope, no indefinidamente.
 *
 * 2. **Que algo cambie mientras dormimos.** Marco crea una jornada, o corrige
 *    la hora de un partido: el horizonte guardado ya no vale.
 *    ⭐ No hace falta sondearlo: esos cambios llegan por HTTP, que ya despierta
 *    el cómputo. Lo que hace falta es **olvidar el horizonte**, y para eso está
 *    `invalidar()`, que llama quien escribe.
 *
 * 3. **Que el proceso se reinicie.** El horizonte vive en memoria y se pierde.
 *    No es un problema: al arrancar no hay horizonte, así que el primer latido
 *    hace su trabajo y lo recalcula. Se paga una consulta de más por reinicio.
 */
'use strict';

const db = require('./db');
const { parseFechaPartidoCostaRica } = require('./fechas');

/*
 * Nunca se duerme más de esto, pase lo que pase con el cálculo.
 *
 * ⚠️ Seis horas no es un número cómodo elegido al azar: es la ventana más larga
 * que usa `fixtures.calcularProximaConsulta` para un partido lejano. Dormir más
 * que eso significaría que el horizonte se ha calculado por encima de lo que el
 * propio sincronizador considera su peor caso, y eso es un error, no un ahorro.
 */
const TOPE_MS = Number(process.env.TREGUA_TOPE_MS || 6 * 60 * 60 * 1000);

/*
 * Cuánto antes del partido hay que estar despierto.
 *
 * ⛔ Lo manda el aviso previo de jornada, que sale DOS HORAS antes del primer
 * partido. Es el trabajo que despierta más temprano, así que es el que fija el
 * margen; la notificación de los quince minutos y la ventana de compartir caen
 * dentro. Se añaden cinco minutos de holgura para no llegar justo.
 */
const MARGEN_ANTES_DEL_PARTIDO_MS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;

/*
 * ============================================================================
 * ⛔ CUÁNTO SE PERDONA UNA `proxima_consulta` VENCIDA
 * ============================================================================
 *
 * La primera versión de este módulo **no habría ahorrado un céntimo**, y se
 * descubrió midiendo contra producción antes de subirlo.
 *
 * En la caché había **19 fixtures con la consulta vencida hacía 60 días**. Con
 * eso `min(proxima_consulta)` siempre caía en el pasado, el horizonte era
 * siempre «ahora», y los relojes no habrían dormido nunca.
 *
 * ⭐ Y la causa: esos 19 partidos pertenecen a quinielas **ELIMINADAS**. El
 * censo del sincronizador sólo recorre las que están `activa`, así que no las
 * consulta nunca — pero sus filas de caché siguen ahí, vencidas a perpetuidad.
 *
 * La regla que lo resuelve sin tener que cruzar con `partidos` —que lleva RLS y
 * obligaría a recorrer las siete quinielas— sale de una propiedad del propio
 * sincronizador: **un partido que se sigue de verdad se consulta como muy tarde
 * cada 6 horas**, que es su ventana más larga. Así que una consulta vencida
 * hace MÁS de eso significa que nadie la está siguiendo.
 *
 * ⚠️ Se perdona el doble —12 horas— para no confundir un ciclo que se retrasó
 * por un reinicio con un partido abandonado. Y una vencida hace treinta
 * segundos sigue contando: ésa sí hay que atenderla ya.
 */
const GRACIA_VENCIDA_MS = 12 * 60 * 60 * 1000;

/** El instante hasta el que no hace falta tocar la base. `null` = no se sabe. */
let horizonte = null;

/* Para poder contar el ahorro sin tener que mirar la factura. */
const cuenta = { latidosAhorrados: 0, recalculos: 0, trabajos: 0 };

/**
 * ¿Toca esperar? **No toca la base.**
 *
 * `true` significa «no hay nada que hacer, no abras una consulta». Es lo único
 * que los relojes llaman en el caso normal, y por eso no puede consultar nada:
 * una consulta para averiguar si hace falta consultar no ahorraría nada.
 */
function hayQueEsperar(ahora = new Date()) {
  if (horizonte === null) return false;          // sin horizonte, se trabaja
  if (ahora.getTime() >= horizonte) return false;

  cuenta.latidosAhorrados += 1;
  return true;
}

/**
 * Olvida el horizonte. Lo llama quien escribe algo que pueda adelantar el
 * próximo trabajo: guardar una jornada, corregir la hora de un partido.
 *
 * ⚠️ Es deliberadamente tonta —no recalcula, sólo olvida—. Recalcular aquí
 * obligaría a quien guarda a esperar una consulta más por un dato que el
 * siguiente latido va a pedir de todos modos.
 */
function invalidar() {
  horizonte = null;
}

/**
 * Recalcula el horizonte con UNA consulta, y lo devuelve.
 *
 * ⚠️ `fixtures` no lleva RLS, así que esto va sin contexto de quiniela y sin
 * recorrer las activas una por una. Es lo que hace que medir el horizonte sea
 * más barato que el trabajo que evita.
 */
async function recalcular(ahora = new Date()) {
  cuenta.recalculos += 1;

  const { rows: [f] } = await db.consulta(`
    SELECT min(proxima_consulta) FILTER (WHERE proxima_consulta > $2) AS proxima,
           min(api_date) FILTER (WHERE api_date > $1) AS siguiente_partido
      FROM fixtures
     WHERE estado IS DISTINCT FROM 'TC'`,
  /*
   * ⚠️ La comparación de `api_date` es de TEXTO, y funciona porque el formato
   * es «YYYY-MM-DD HH:MM» con ceros a la izquierda: ahí el orden alfabético y
   * el cronológico son el mismo. Es la misma propiedad en la que se apoyan las
   * ventanas de aviso, y está escrita en §C.
   */
  [textoDeFecha(ahora), new Date(ahora.getTime() - GRACIA_VENCIDA_MS)]);

  const candidatos = [];

  if (f.proxima) candidatos.push(new Date(f.proxima).getTime());

  if (f.siguiente_partido) {
    const inicio = parseFechaPartidoCostaRica(f.siguiente_partido);
    if (inicio) candidatos.push(inicio.getTime() - MARGEN_ANTES_DEL_PARTIDO_MS);
  }

  const tope = ahora.getTime() + TOPE_MS;

  /*
   * Si no hay nada vivo —ni un partido por jugarse ni una consulta pendiente—
   * se duerme hasta el tope. Es el caso de una semana sin jornada, y es
   * justamente cuando más se ahorra.
   */
  const proximo = candidatos.length ? Math.min(...candidatos) : tope;

  horizonte = Math.min(Math.max(proximo, ahora.getTime()), tope);
  return horizonte;
}

/**
 * Lo que llama el latido maestro: «¿trabajo o espero?».
 *
 * Devuelve `true` si hay que trabajar. Cuando dice que sí, además recalcula el
 * horizonte, porque el cómputo ya está despierto y la consulta sale gratis en
 * términos de factura.
 *
 * ⚠️ El recálculo va ANTES del trabajo y no después: si fuera después, un
 * trabajo que falla dejaría el horizonte sin tocar y los relojes volverían a
 * intentarlo cada minuto — justo lo que esto evita.
 *
 * ============================================================================
 * ⛔ LO LLAMA UN SOLO LATIDO, NO CUATRO. Y COSTÓ ENCONTRARLO.
 * ============================================================================
 *
 * La primera versión tenía los cuatro relojes llamando aquí cada uno por su
 * cuenta, y **se robaban el turno entre ellos**: el primero en latir
 * recalculaba, empujaba el horizonte al futuro, y los otros tres se encontraban
 * con que «ya no tocaba». Medido con un partido en vivo durante diez minutos:
 *
 *     sincronizar  10 de 10   ✔
 *     notificar     9 de 10   ⛔
 *     compartir     9 de 10   ⛔
 *     trivias       1 de 2    ⛔
 *
 * Y en un día tranquilo el robo habría sido TOTAL: el primero se lleva el único
 * turno y los demás no corren nunca. La notificación de los quince minutos
 * —que tiene una ventana de quince minutos— se habría perdido sin más.
 *
 * ⭐ Por eso ahora hay **un solo latido maestro** en el planificador que
 * pregunta una vez y reparte el turno entre los cuatro trabajos, cada uno con
 * su propia cadencia. Ver `arrancar()` en `planificador.js`.
 */
async function tocaTrabajar(ahora = new Date()) {
  if (hayQueEsperar(ahora)) return false;

  await recalcular(ahora);
  cuenta.trabajos += 1;
  return true;
}

/**
 * Pide que haya una pasada no más tarde de `cuando`.
 *
 * ⛔ Existe por las TRIVIAS, y es un caso que el horizonte no sabe ver.
 *
 * Una trivia se puede resolver cuando su partido TERMINA. Pero en cuanto el
 * partido termina, su fixture deja de pedir consultas —`proxima_consulta` pasa
 * a nulo— así que, si era lo último vivo, el horizonte salta al tope y las
 * trivias se resolverían **hasta seis horas tarde**.
 *
 * ⚠️ No se puede resolver mirando la tabla de trivias desde aquí: lleva RLS, y
 * consultarla obligaría a recorrer las quinielas activas una por una — justo el
 * coste que este módulo existe para evitar.
 *
 * Así que lo pide quien SÍ lo sabe: el sincronizador, cuando ve que un partido
 * ha pasado a terminado.
 */
function pedirPasada(cuando) {
  const t = cuando instanceof Date ? cuando.getTime() : Number(cuando);
  if (!Number.isFinite(t)) return;

  /* Se queda con la más temprana: una petición no puede retrasar a otra. */
  if (horizonte === null || t < horizonte) horizonte = t;
}

/** Hora de Costa Rica en el formato de `api_date`, para comparar por texto. */
function textoDeFecha(fecha) {
  const cr = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
  const dos = n => String(n).padStart(2, '0');
  return `${cr.getUTCFullYear()}-${dos(cr.getUTCMonth() + 1)}-${dos(cr.getUTCDate())}`
    + ` ${dos(cr.getUTCHours())}:${dos(cr.getUTCMinutes())}`;
}

/** Para las pruebas y para poder contar el ahorro en el registro. */
function estado() {
  return { horizonte, ...cuenta };
}

function reiniciar() {
  horizonte = null;
  cuenta.latidosAhorrados = 0;
  cuenta.recalculos = 0;
  cuenta.trabajos = 0;
}

module.exports = {
  TOPE_MS, MARGEN_ANTES_DEL_PARTIDO_MS, GRACIA_VENCIDA_MS,
  hayQueEsperar, invalidar, recalcular, tocaTrabajar, pedirPasada, estado, reiniciar,
  textoDeFecha
};

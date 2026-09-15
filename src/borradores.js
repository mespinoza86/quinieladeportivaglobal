/*
 * El borrador de la próxima jornada de una liga.
 *
 * ============================================================================
 * ⭐ ARITMÉTICA, SIN EFECTOS — y por eso no habla ni con la red ni con la base
 * ============================================================================
 *
 * `proponer()` recibe los partidos que el proveedor ya devolvió y las rondas que
 * la quiniela ya tiene metidas, y contesta cuál toca. Nada más.
 *
 * Es el mismo reparto que `cobros.js` frente a `pagos.js`: la regla se puede
 * probar entera sin levantar nada, y quien trae los datos —la ruta, con la caché
 * compartida— no tiene que saber nada de la regla. Si esto abriera su propia
 * consulta al proveedor, cada vez que alguien abriera la pantalla se gastaría
 * cuota que es **una sola para todas las quinielas**, y que ya se agotó una vez.
 *
 * ============================================================================
 * ⛔ LO QUE SE PROPONE Y LO QUE NO
 * ============================================================================
 *
 * Se propone **la ronda más temprana que todavía tenga partidos sin jugar y que
 * no esté ya en una jornada de esta quiniela**.
 *
 * No «la última creada + 1», que parece equivalente y no lo es: se rompe al
 * empezar una quiniela a mitad de temporada, al saltarse una semana, y cuando el
 * proveedor numera de una forma que no es la tuya.
 *
 * ⚠️ Y el orden de las rondas lo da **la fecha del partido más temprano de cada
 * una**, nunca su nombre: «Quarter-finals» y «10» no se ordenan alfabéticamente
 * contra «9» de ninguna manera que signifique algo.
 */
'use strict';

const { comoApiDate } = require('./fechas');

/** El nombre que se propone para la jornada. Editable por quien confirme. */
function nombreDeRonda(ronda) {
  const texto = String(ronda ?? '').trim();
  if (!texto) return '';

  /*
   * Un número se convierte en «Jornada 9» —así la llama el calendario y así la
   * busca la gente—; un nombre se deja tal cual, porque «Jornada Quarter-finals»
   * no lo dice nadie.
   */
  return /^\d+$/.test(texto) ? `Jornada ${texto}` : texto;
}

/**
 * La próxima jornada de una liga, con sus partidos.
 *
 * `partidos` son los del proveedor ya traducidos (`mapearEvento`), de UNA liga.
 * `rondasUsadas` son las que esta quiniela ya tiene metidas.
 *
 * Devuelve `{ ok: true, ... }` con la propuesta, o `{ ok: false, motivo }`
 * cuando no hay nada que proponer — y el motivo importa, porque la pantalla
 * ofrece salidas distintas según cuál sea.
 */
function proponer({ partidos = [], rondasUsadas = [], ahora = new Date() } = {}) {
  if (!partidos.length) return { ok: false, motivo: 'sin_partidos' };

  const conRonda = partidos.filter(p => String(p?.ronda ?? '').trim());
  if (!conRonda.length) return { ok: false, motivo: 'liga_sin_rondas' };

  const ya = new Set(rondasUsadas.map(r => String(r).trim()).filter(Boolean));
  const ahoraTexto = comoApiDate(ahora);

  /* ---------- Agrupar por ronda ---------- */

  const porRonda = new Map();

  for (const partido of conRonda) {
    const ronda = String(partido.ronda).trim();
    if (!porRonda.has(ronda)) porRonda.set(ronda, { ronda, partidos: [] });
    porRonda.get(ronda).partidos.push(partido);
  }

  for (const grupo of porRonda.values()) {
    /*
     * ⚠️ El orden DENTRO de la ronda también es por fecha. El proveedor no
     * garantiza ninguno, y una jornada cuyos partidos salen desordenados se ve
     * mal y encima confunde a quien la revisa antes de confirmar.
     */
    grupo.partidos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    grupo.arranque = grupo.partidos[0]?.fecha || '';

    /*
     * «Sin jugar» se mide sobre el partido MÁS TARDÍO: mientras quede uno por
     * arrancar, la ronda sigue viva. Mirar el más temprano daría por cerrada una
     * jornada de sábado a domingo en cuanto empezara el primero.
     */
    grupo.ultimo = grupo.partidos[grupo.partidos.length - 1]?.fecha || '';
    grupo.tienePendientes = String(grupo.ultimo) > ahoraTexto;
  }

  /* ---------- Elegir ---------- */

  const candidatas = [...porRonda.values()]
    .filter(g => g.tienePendientes && !ya.has(g.ronda))
    /* ⛔ Por FECHA, nunca por nombre. Ver la cabecera. */
    .sort((a, b) => String(a.arranque).localeCompare(String(b.arranque)));

  if (!candidatas.length) return { ok: false, motivo: 'sin_rondas_nuevas' };

  const elegida = candidatas[0];

  return {
    ok: true,
    ronda: elegida.ronda,
    nombre: nombreDeRonda(elegida.ronda),
    arranque: elegida.arranque,
    partidos: elegida.partidos,
    aviso: avisoDeRondaCorta(elegida, porRonda)
  };
}

/**
 * ⚠️ «Esta ronda trae menos partidos que la anterior» — puede estar a medio
 * publicar.
 *
 * ⛔ Es el riesgo que este borrador introduce y que no existía armando a mano.
 * El proveedor a veces publica seis de los nueve partidos de una jornada.
 * Confirmarla así dejaría a la gente pronosticando seis, y los otros tres
 * aparecerían después —o no aparecerían nunca—, con la jornada ya abierta.
 *
 * No se bloquea nada: se avisa y decide quien confirma. Bloquear sería peor,
 * porque hay jornadas que de verdad tienen menos partidos —una fecha FIFA, un
 * aplazamiento— y entonces la función dejaría de servir justo cuando hace falta.
 */
function avisoDeRondaCorta(elegida, porRonda) {
  const anteriores = [...porRonda.values()]
    .filter(g => g !== elegida && g.arranque && g.arranque < elegida.arranque)
    .sort((a, b) => String(b.arranque).localeCompare(String(a.arranque)));

  const previa = anteriores[0];
  if (!previa || previa.partidos.length <= elegida.partidos.length) return null;

  return `La ronda anterior tuvo ${previa.partidos.length} partidos y ésta trae `
    + `${elegida.partidos.length}. Puede estar a medio publicar.`;
}

/**
 * Lo que dice cada motivo, para que la pantalla no tenga que interpretarlo.
 *
 * ⚠️ Los tres significan «no hay borrador» y llevan a sitios distintos: uno es
 * temporal, otro es un error de configuración y el tercero es el fin de la
 * temporada, que es cuando hay que ofrecer cambiar de liga o archivar.
 */
const MOTIVOS = {
  sin_partidos: 'El proveedor no devolvió partidos de esta liga en las próximas semanas.',
  liga_sin_rondas: 'Esta liga no publica el número de jornada, así que no se puede armar sola.',
  sin_rondas_nuevas: 'Ya tienes creadas todas las jornadas publicadas de esta liga.'
};

module.exports = { proponer, nombreDeRonda, MOTIVOS };

/*
 * Ligas disponibles.
 *
 * Hasta la Fase C, el desplegable de torneos de «Importar Partidos» era una
 * lista de unas veinte opciones escrita a mano en el HTML, con el país y el
 * nombre de la competición incrustados como texto. Tenía dos defectos que no se
 * arreglan escribiendo más opciones:
 *
 *   1. Si el proveedor cambia el nombre de una competición, la opción deja de
 *      encontrar nada y NADIE se entera: la búsqueda devuelve cero partidos y
 *      parece que ese día no se juega.
 *   2. Los torneos que no estaban en la lista sencillamente no existían.
 *
 * La solución es preguntar qué partidos hay y deducir las ligas de ahí. Estas
 * funciones son la parte pura de eso: no consultan la base, no conocen Express
 * y no llaman al proveedor. Viven en src/ por lo mismo que las demás, y por la
 * misma regla: NO pueden depender de server.js.
 */
'use strict';

/** Cuántos días hacia adelante se buscan cuando nadie dice otra cosa. */
const DIAS_POR_DEFECTO = 7;

/*
 * Tope duro. Cada día consultado es cuota del proveedor, y un `dias=365` puesto
 * a mano —o por equivocación en una URL— costaría un año de consultas de una
 * sentada.
 */
const DIAS_MAXIMO = 30;

/*
 * Competiciones que no se ofrecen nunca.
 *
 * Esta lista existía en el navegador desde antes de la Fase C y se sube aquí
 * para que haya UNA: una quiniela de la Primera División no quiere que se cuele
 * el mismo partido de la sub-20 o de reservas, que suele llamarse casi igual y
 * se elige sin querer.
 *
 * Se compara sobre el nombre normalizado —sin tildes y en minúsculas—, así que
 * basta escribir cada palabra una vez.
 */
const PALABRAS_BLOQUEADAS = [
  'u20', 'u21', 'u23',
  'sub 20', 'sub 21', 'sub 23',
  'reserves', 'reserve', 'reservas',
  'femenil', 'femenina', 'feminine', 'women', 'womens',
  'juvenil', 'youth'
];

/** Sin tildes, en minúsculas y sin espacios sobrantes. */
function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿Es una competición de las que nunca se ofrecen? */
function esLigaNoPermitida(nombreLiga) {
  const texto = normalizarTexto(nombreLiga);
  if (!texto) return false;
  return PALABRAS_BLOQUEADAS.some(palabra => texto.includes(normalizarTexto(palabra)));
}

/**
 * Cuántos días se consultan, a partir de lo que llegue por la URL.
 *
 * Se acepta cualquier cosa y se devuelve siempre un número usable: un `dias`
 * ausente, vacío, negativo o con letras cae en el valor por defecto en vez de
 * reventar la consulta o pedirle al proveedor un rango absurdo.
 */
function normalizarDias(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 1) return DIAS_POR_DEFECTO;
  return Math.min(Math.floor(numero), DIAS_MAXIMO);
}

/** `YYYY-MM-DD` de una fecha, en UTC, que es como las pide el proveedor. */
function comoDiaISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/**
 * El rango que se va a consultar: desde un día, y tantos días hacia adelante.
 *
 * `dias = 7` significa hoy más seis, es decir SIETE días contando el primero.
 * Se escribe así porque es lo que espera quien lo lee: «buscar la semana» son
 * siete días, no ocho.
 */
function rangoDeBusqueda({ desde, dias, ahora = new Date() } = {}) {
  const cuantos = normalizarDias(dias);

  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || ''))
    ? new Date(`${desde}T00:00:00Z`)
    : new Date(`${comoDiaISO(ahora)}T00:00:00Z`);

  const fin = new Date(inicio.getTime());
  fin.setUTCDate(fin.getUTCDate() + cuantos - 1);

  return { desde: comoDiaISO(inicio), hasta: comoDiaISO(fin), dias: cuantos };
}

/**
 * Agrupa por país las ligas que aparecen en una lista de partidos.
 *
 * Lo que se devuelve es lo que el desplegable necesita y nada más: país, y
 * dentro las ligas con su id, su nombre y cuántos partidos traen. El número de
 * partidos no es adorno —dice de un vistazo si vale la pena entrar en esa liga
 * esta semana—.
 *
 * Se agrupa por país porque es como la gente busca: primero «Costa Rica», luego
 * la competición. Los torneos internacionales suelen venir sin país, y en vez
 * de esconderlos en un grupo vacío se juntan bajo un rótulo propio.
 */
const SIN_PAIS = 'Internacional';

function agruparLigasPorPais(partidos = []) {
  const porPais = new Map();

  for (const partido of partidos) {
    if (!partido) continue;

    const nombreLiga = String(partido.liga || '').trim();
    if (!nombreLiga || esLigaNoPermitida(nombreLiga)) continue;

    const pais = String(partido.pais || '').trim() || SIN_PAIS;

    /*
     * La clave es el id de liga cuando lo hay, y el nombre si no. El id es lo
     * que hace que esto no se rompa cuando el proveedor renombra un torneo: la
     * opción sigue apuntando al mismo sitio aunque el rótulo cambie.
     */
    const id = partido.apiLeagueId ? String(partido.apiLeagueId) : '';
    const clave = id || normalizarTexto(nombreLiga);

    if (!porPais.has(pais)) porPais.set(pais, new Map());
    const ligas = porPais.get(pais);

    if (!ligas.has(clave)) {
      ligas.set(clave, { id, nombre: nombreLiga, partidos: 0 });
    }
    ligas.get(clave).partidos += 1;
  }

  return [...porPais.entries()]
    .map(([pais, ligas]) => ({
      pais,
      ligas: [...ligas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    }))
    /*
     * Los internacionales al final: el caso común es buscar una liga nacional,
     * y dejarlos arriba obligaría a bajar siempre.
     */
    .sort((a, b) => {
      if (a.pais === SIN_PAIS) return 1;
      if (b.pais === SIN_PAIS) return -1;
      return a.pais.localeCompare(b.pais, 'es');
    });
}

/* ==================== Ligas favoritas ==================== */

/*
 * Tope de favoritas. No es una limitación del uso —nadie sigue veinte ligas—
 * sino del almacenamiento: esto vive dentro de `quinielas.configuracion`, que
 * es un bloque jsonb que se lee y se escribe ENTERO. Una lista sin tope la
 * engorda sin límite y se paga en cada lectura de la quiniela.
 */
const MAXIMO_FAVORITAS = 20;

/**
 * Deja la lista de favoritas en algo usable, venga como venga.
 *
 * Se guarda `{ id, nombre }` y no sólo el id **porque una favorita que esta
 * semana no juega tiene que poder mostrarse igual**, en gris. Si sólo se
 * guardara el id no habría de dónde sacar el rótulo: el nombre llega con los
 * partidos, y justamente no hay partidos.
 *
 * El id manda: es el del proveedor, y es lo que sobrevive a que renombren la
 * competición. El nombre es sólo la etiqueta, y se refresca cuando se puede.
 */
function normalizarFavoritas(valor) {
  if (!Array.isArray(valor)) return [];

  const vistas = new Set();
  const limpias = [];

  for (const cruda of valor) {
    if (!cruda) continue;

    const id = String(cruda.id ?? '').trim();
    const nombre = String(cruda.nombre ?? '').trim();
    if (!id || !nombre || vistas.has(id)) continue;

    vistas.add(id);
    limpias.push({ id, nombre });
    if (limpias.length >= MAXIMO_FAVORITAS) break;
  }

  return limpias;
}

/**
 * Saca las favoritas de sus países y las devuelve aparte, para pintarlas arriba.
 *
 * ⚠️ NO TOCA LO QUE RECIBE. Parece un detalle de estilo y no lo es: quien llama
 * le pasa el objeto que está guardado en la caché de ligas, y esa caché **se
 * comparte entre quinielas** —tiene por clave el rango de fechas y nada más—.
 * Modificarlo aquí le serviría a la quiniela siguiente los favoritos de la
 * anterior, con las ligas ya arrancadas de sus países.
 *
 * Las que no aparecen entre los partidos de la semana salen con `partidos: 0`:
 * eso es lo que el navegador pinta en gris. Se prefiere eso a esconderlas,
 * porque un favorito que desaparece sin explicación se siente como una
 * configuración que se perdió.
 */
function aplicarFavoritas(agrupado, favoritas = []) {
  const buscadas = normalizarFavoritas(favoritas);
  if (!buscadas.length) return { ...agrupado, favoritas: [] };

  const porId = new Map(buscadas.map(f => [f.id, f]));
  const halladas = new Map();
  const paises = [];

  for (const grupo of agrupado?.paises || []) {
    const resto = [];

    for (const liga of grupo?.ligas || []) {
      if (liga?.id && porId.has(liga.id)) {
        /*
         * El nombre que se muestra es el que acaba de dar el proveedor, no el
         * que se guardó al marcarla: si renombraron el torneo, el rótulo viejo
         * es el desfasado. El id es lo que identifica, el nombre sólo rotula.
         */
        halladas.set(liga.id, { ...liga, pais: grupo.pais });
      } else {
        resto.push(liga);
      }
    }

    // Un país cuyas ligas eran todas favoritas ya no tiene nada que enseñar.
    if (resto.length) paises.push({ ...grupo, ligas: resto });
  }

  const conPartidos = [];
  const sinPartidos = [];

  for (const favorita of buscadas) {
    const hallada = halladas.get(favorita.id);
    if (hallada) conPartidos.push(hallada);
    else sinPartidos.push({ id: favorita.id, nombre: favorita.nombre, partidos: 0, pais: null });
  }

  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

  /*
   * Las que juegan primero. El orden en que se marcaron no significa nada —son
   * casillas—, y dejar arriba las que no se pueden elegir sería empezar por lo
   * inútil.
   */
  return {
    ...agrupado,
    favoritas: [...conPartidos.sort(porNombre), ...sinPartidos.sort(porNombre)],
    paises
  };
}

module.exports = {
  DIAS_POR_DEFECTO,
  DIAS_MAXIMO,
  SIN_PAIS,
  MAXIMO_FAVORITAS,
  normalizarTexto,
  esLigaNoPermitida,
  normalizarDias,
  rangoDeBusqueda,
  agruparLigasPorPais,
  normalizarFavoritas,
  aplicarFavoritas
};

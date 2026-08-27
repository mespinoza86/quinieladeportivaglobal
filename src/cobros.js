/*
 * Cobros: la cuota del torneo y la cuota por jornada.
 *
 * ============================================================================
 * DOS COBROS INDEPENDIENTES, NO UN MODO
 * ============================================================================
 *
 * Una quiniela puede cobrar 10.000 por el torneo completo —para el premio
 * final— Y ADEMÁS algo por cada jornada, para los premios de jornada. No es
 * «o uno o el otro»: son dos conceptos separados, cada uno con su precio y su
 * cuenta.
 *
 * ⚠️ **Y no se mezclan en una bolsa común.** Con un solo saldo, los 10.000 de
 * la cuota del torneo se los irían comiendo las jornadas y nadie sabría cuánto
 * hay puesto para el premio final.
 *
 * ============================================================================
 * ⚠️ EL SALDO ES EN DINERO, NO EN JORNADAS
 * ============================================================================
 *
 * Parece más cómodo llevar «le quedan 3 jornadas», y no se puede: **el precio
 * de una jornada cambia**. El administrador sube a 5.000 la jornada de finales
 * porque el premio está grande. Entonces un saldo de 6.000 no son «3 jornadas»
 * —son tres a 2.000, o una a 5.000 y sobra—, y cuántas cubra depende de cuánto
 * valgan las que vienen, que todavía no se sabe.
 *
 * Así que el saldo se lleva en colones y punto. «Te quedan 3» se calcula
 * aparte, se marca como ESTIMACIÓN y se dice a qué precio: es lo que la gente
 * quiere saber, pero no es un hecho.
 *
 * ============================================================================
 * EL PRECIO VIVE EN LA JORNADA
 * ============================================================================
 *
 * Subir el precio afecta SOLO A LO QUE VIENE; lo pasado ya quedó. Por eso cada
 * jornada guarda lo que costó (`jornadas.precio`), copiado de la configuración
 * al crearla, y estas funciones nunca miran el precio configurado para calcular
 * una deuda: lo reciben ya resuelto, jornada por jornada.
 *
 * Este módulo no consulta la base, no conoce Express y no llama a nadie. Es
 * aritmética, y por eso se puede probar entera sin levantar nada.
 */
'use strict';

/** Los dos conceptos que se cobran. Cada abono es de uno o del otro. */
const CONCEPTOS = ['torneo', 'jornada'];

/*
 * Tope de un abono. `numeric(12,2)` aguanta hasta 9.999.999.999,99, y pasarse
 * hacía reventar la consulta con un 500 en vez de decir qué pasaba. Diez
 * millones es holgadísimo para una quiniela de barrio y deja el error del lado
 * del mensaje claro.
 */
const MONTO_MAXIMO = 10_000_000;

/** ¿Tiene forma de uuid? Sirve para no mandarle basura a PostgreSQL. */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esUuid(valor) {
  return ES_UUID.test(String(valor || ''));
}

/**
 * Lo que trae una quiniela que no ha configurado nada.
 *
 * ⚠️ Los dos APAGADOS. Una quiniela que hoy funciona no puede empezar a
 * mostrar deudas porque se desplegó una versión nueva.
 */
const COBROS_POR_DEFECTO = {
  torneo: { activo: false, precio: 0 },
  jornada: { activo: false, precio: 0 }
};

/**
 * Redondea a céntimo y devuelve un número de verdad.
 *
 * ⚠️ `numeric` de PostgreSQL llega a JavaScript como CADENA, a propósito: el
 * cliente `pg` no lo convierte para no perder precisión. Sumar sin pasar por
 * aquí daría `"2000" + "2000" === "20002000"`, que es el error de dinero más
 * tonto y más difícil de ver en una pantalla.
 */
function aMonto(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 100) / 100;
}

/** La configuración de cobros de una quiniela, venga como venga. */
function normalizarCobros(configuracion) {
  const crudo = configuracion?.cobros || {};
  const rama = nombre => {
    const r = crudo[nombre] || {};
    const precio = Math.max(0, aMonto(r.precio));
    return { activo: Boolean(r.activo), precio };
  };
  return { torneo: rama('torneo'), jornada: rama('jornada') };
}

/**
 * Lo que un jugador debe por jornadas.
 *
 * `jornadas` son las de la quiniela, con su `secuencia` y su `precio` —el que
 * tenía cada una, no el de hoy—. `cobrarDesde` es la secuencia de la primera
 * que se le cobra: quien entró en la jornada 7 no debe las seis anteriores,
 * no estaba. `null` es «desde siempre».
 */
function debePorJornadas(jornadas = [], cobrarDesde = null) {
  const desde = cobrarDesde === null || cobrarDesde === undefined
    ? -Infinity
    : Number(cobrarDesde);

  let total = 0;
  for (const jornada of jornadas) {
    if (!jornada) continue;
    if (Number(jornada.secuencia) < desde) continue;
    total += Math.max(0, aMonto(jornada.precio));
  }
  return aMonto(total);
}

/**
 * Suma los abonos de un concepto.
 *
 * Los asientos negativos son las correcciones: un abono mal anotado no se
 * borra, se anula con su inverso. Sumarlos todos da la cuenta correcta sin
 * tener que saber cuál anula a cuál.
 */
function totalAbonado(pagos = [], concepto) {
  let total = 0;
  for (const pago of pagos) {
    if (!pago || pago.concepto !== concepto) continue;
    total += aMonto(pago.monto);
  }
  return aMonto(total);
}

/**
 * Cuántas jornadas cubre un saldo, al precio de hoy.
 *
 * ⚠️ ES UNA ESTIMACIÓN, y quien la muestre tiene que decirlo. La jornada que
 * viene puede costar el doble, y entonces este número era mentira. Se calcula
 * igualmente porque es lo que la gente quiere saber; lo que no se puede es
 * presentarlo como un hecho.
 *
 * Con precio 0 no se devuelve infinito ni cero: se devuelve `null`, que
 * significa «esto no se puede estimar» y obliga a quien pinta a no inventarse
 * un número.
 */
function jornadasQueCubre(saldo, precioActual) {
  const precio = aMonto(precioActual);
  if (precio <= 0) return null;
  const cuantas = Math.floor(aMonto(saldo) / precio);
  return Math.max(0, cuantas);
}

/**
 * La cuenta completa de un jugador: las dos, y qué se le debe mostrar.
 *
 * Se calcula, no se guarda. Es la misma decisión que el ranking: si mañana se
 * borra una jornada o se corrige un abono, la cuenta sale bien sola. Un
 * contador que se va descontando se desincroniza en cuanto algo cambia, y
 * cuando se descubre ya nadie sabe cuál era el número bueno.
 */
function cuentaDeJugador({ jugador, jornadas = [], pagos = [], cobros } = {}) {
  const config = normalizarCobros({ cobros });

  /* ---- Cuota del torneo ---- */
  const juegaTorneo = jugador?.juegaTorneo !== false;
  const debeTorneo = config.torneo.activo && juegaTorneo ? config.torneo.precio : 0;
  const abonadoTorneo = totalAbonado(pagos, 'torneo');

  const torneo = {
    activo: config.torneo.activo,
    juega: juegaTorneo,
    debe: debeTorneo,
    abonado: abonadoTorneo,
    // Positivo: le falta. Negativo: pagó de más, y también hay que verlo.
    pendiente: aMonto(debeTorneo - abonadoTorneo),
    alDia: aMonto(abonadoTorneo - debeTorneo) >= 0
  };

  /* ---- Cuota por jornada ---- */

  /*
   * ⚠️ Dos condiciones, no una: que la quiniela cobre jornadas Y que a ESTA
   * persona se le cobren. La segunda es la casilla «Se le cobran las jornadas»,
   * gemela de la del torneo, y sirve para eximir a quien el administrador
   * decida —el caso que la motivó: que un administrador no tenga que pagar—.
   *
   * `!== false` y no `=== true`: un jugador que venga sin el campo —de una
   * consulta vieja, de una prueba— tiene que pagar. **El valor por defecto de
   * una duda sobre dinero es cobrar, no perdonar.**
   */
  const juegaJornadas = jugador?.juegaJornadas !== false;

  const debeJornadas = config.jornada.activo && juegaJornadas
    ? debePorJornadas(jornadas, jugador?.cobrarDesde ?? null)
    : 0;

  const abonadoJornadas = totalAbonado(pagos, 'jornada');
  const saldo = aMonto(abonadoJornadas - debeJornadas);

  const jornada = {
    activo: config.jornada.activo,
    /*
     * Se dice aparte de `activo` a propósito: «la quiniela no cobra jornadas» y
     * «a ti no te las cobramos» son cosas distintas, y quien pinta la pantalla
     * necesita distinguirlas para no enseñar una cuota que no le toca a nadie.
     *
     * ⚠️ Y lo abonado se conserva aunque no se le cobre: sus pagos siguen
     * contados y salen como saldo a favor. Quitarle la casilla no le borra el
     * dinero que puso.
     */
    juega: juegaJornadas,
    debe: debeJornadas,
    abonado: abonadoJornadas,
    // Positivo es saldo A FAVOR; negativo es lo que debe.
    saldo,
    alDia: saldo >= 0,
    precioActual: config.jornada.precio,
    /*
     * Sólo tiene sentido estimar cuando hay saldo a favor. Con saldo negativo
     * la pregunta no es «cuántas cubre» sino «cuánto debe».
     */
    jornadasQueCubre: saldo > 0 ? jornadasQueCubre(saldo, config.jornada.precio) : 0
  };

  return { torneo, jornada, alDia: torneo.alDia && jornada.alDia };
}

/**
 * Si una jornada concreta le quedó pagada.
 *
 * ⚠️ Esto SÍ es exacto, a diferencia de la estimación: el precio de esa jornada
 * ya está fijado, y se compara contra lo abonado hasta ella. Se cubren las
 * jornadas en orden, que es como se pagan.
 */
function jornadaPagada({ jugador, jornadas = [], pagos = [], jornadaId } = {}) {
  const desde = jugador?.cobrarDesde ?? null;
  const limite = desde === null || desde === undefined ? -Infinity : Number(desde);

  const suyas = jornadas
    .filter(j => j && Number(j.secuencia) >= limite)
    .sort((a, b) => Number(a.secuencia) - Number(b.secuencia));

  let disponible = totalAbonado(pagos, 'jornada');

  for (const j of suyas) {
    const precio = Math.max(0, aMonto(j.precio));
    /*
     * Una jornada gratis está pagada por definición, y no consume saldo. Sin
     * este caso, una quiniela que no cobra mostraría todo como impagado.
     */
    const cubierta = precio === 0 || disponible >= precio;
    if (String(j.id) === String(jornadaId)) return cubierta;
    if (cubierta) disponible = aMonto(disponible - precio);
    else return false;
  }

  return false;
}

module.exports = {
  CONCEPTOS,
  MONTO_MAXIMO,
  esUuid,
  COBROS_POR_DEFECTO,
  aMonto,
  normalizarCobros,
  debePorJornadas,
  totalAbonado,
  jornadasQueCubre,
  cuentaDeJugador,
  jornadaPagada
};

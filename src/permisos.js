'use strict';

/**
 * ============================================================================
 * QUIÉN PUEDE HACER QUÉ — la única tabla de permisos del sistema
 * ============================================================================
 *
 * Antes esto era binario: administrador o no. Marco pidió repartir el trabajo
 * sin repartir el riesgo —que alguien arme jornadas sin poder tocar el dinero,
 * que alguien envíe los partidos al grupo sin poder cambiar un marcador— y eso
 * son niveles.
 *
 * ⛔ POR QUÉ UNA SOLA TABLA, Y POR QUÉ AQUÍ
 *
 * Los fallos de permisos son silenciosos **hacia el lado malo**. Si una ruta
 * se queda con el nivel equivocado nadie ve un error: simplemente alguien
 * puede hacer algo que no le tocaba, y no se sabrá hasta que lo haga. Es el
 * mismo patrón que consultar una tabla con RLS sin contexto —cero filas, sin
 * quejarse—, y la defensa es la misma: que la decisión viva en UN sitio que se
 * pueda leer entero de una vez y comparar con lo que se quería.
 *
 * Repartir `rol === 'admin'` por cuarenta ficheros es cómo se llega a un
 * sistema donde nadie sabe quién puede qué.
 */

/**
 * ⭐ LOS ROLES SON UNA ESCALERA, NO UN CONJUNTO DE ETIQUETAS.
 *
 * Cada escalón puede todo lo del anterior y algo más. No es casualidad: así lo
 * describió Marco, y tiene consecuencias buenas. Con conjuntos sueltos habría
 * que razonar sobre combinaciones que nadie ha pensado («¿un lector que además
 * cobra?»); con una escalera sólo hay que contestar *hasta dónde llega cada
 * uno*, y eso cabe en la cabeza.
 *
 * El orden importa: el índice ES el nivel.
 */
const ESCALERA = ['user', 'admin_lector', 'admin_jornadas', 'admin', 'propietario'];

/**
 * Cada capacidad, y el escalón MÍNIMO que la alcanza.
 *
 * El corte no es por pantalla, es por daño: lo que destruye, lo que mueve
 * dinero, lo que cambia la estructura y lo que sólo mira. Cortar por pantalla
 * produce permisos que no significan nada en cuanto una pantalla hace dos
 * cosas.
 */
const CAPACIDADES = {
  /* Sólo el dueño. Apagar la quiniela para todos, o dejar de ser el dueño. */
  'quiniela.eliminar': 'propietario',

  /*
   * ⛔ Repartir roles es SÓLO del dueño, y ésta es la decisión de seguridad de
   * todo el sistema. Si un `admin` pudiera repartir roles podría nombrarse
   * pares, o subir a quien quisiera hasta su propio escalón: el reparto dejaría
   * de significar nada, porque cualquiera con el nivel alto podría concederlo.
   * Un permiso que sus titulares pueden regalar no es un permiso.
   *
   * Marco lo dejó dicho así: «el único que asigna o modifica las capacidades es
   * el dueño de la quiniela».
   */
  'roles.asignar': 'propietario',

  /* Administración plena: la configuración, la gente y el dinero. */
  'quiniela.configurar': 'admin',
  'miembros.gestionar': 'admin',
  'dinero.gestionar': 'admin',

  /*
   * ⚠️ Cubre DOS cosas que se escriben en pantallas distintas: los marcadores
   * oficiales y las predicciones de los jugadores (`resultados.html` las
   * escribe, cosa que hubo que ir a mirar en vez de suponerla por el nombre).
   * Las dos deciden quién gana dinero, así que van juntas.
   *
   * Y son de `admin`, NO de `admin_jornadas`, aunque los dos trabajen sobre
   * las mismas jornadas: quien arma los partidos propone, quien fija el
   * resultado decide. Marco lo separó con estas palabras: «puede hacer
   * jornadas, pero no puede cambiar marcadores».
   */
  'resultados.escribir': 'admin',

  /* Armar la jornada: partidos, comodines, trivias y buscar en el proveedor. */
  'jornadas.escribir': 'admin_jornadas',

  /*
   * Marcar un partido como enviado al grupo. Escribe (`compartido_en`), y aun
   * así es el escalón más bajo: lo que anota es «ya avisé», no un dato del
   * juego. Equivocarse aquí se arregla desmarcando.
   */
  'compartir': 'admin_lector',

  /* Ver las pantallas de administración. Leer, nada más. */
  'admin.ver': 'admin_lector'
};

/**
 * Cada pantalla de administración con la capacidad que hace falta para ABRIRLA.
 *
 * ⚠️ Esto es SUPERFICIE, no seguridad. Quien protege los datos es
 * `requierePermiso` en cada ruta de la API; esto sólo evita aterrizar en una
 * pantalla que iría fallando petición por petición.
 *
 * El criterio: las pantallas que existen para ACTUAR piden la capacidad de esa
 * acción; las que existen para MIRAR piden `admin.ver`.
 */
const PAGINAS = {
  '/jugadores.html': 'miembros.gestionar',
  '/miembros.html': 'miembros.gestionar',
  '/configuracion-quiniela.html': 'quiniela.configurar',
  '/jornadas.html': 'jornadas.escribir',
  '/admin_trivias.html': 'jornadas.escribir',
  '/resultados.html': 'resultados.escribir',
  '/agregar-resultados-oficiales.html': 'resultados.escribir',
  '/copiarresultadojugador.html': 'admin.ver',
  '/generar_reporte.html': 'admin.ver',
  '/cobros.html': 'admin.ver',
  '/reporte-cobros.html': 'admin.ver',
  '/compartir.html': 'compartir',
  '/enviarresultados.html': 'compartir',
  '/enviarresultadostrivias.html': 'compartir',
  '/enviarresultadospartido.html': 'compartir',
  '/enviarresultadostriviaspartido.html': 'compartir'
};

/** El escalón de un rol, o -1 si el rol no existe. */
function escalon(rol) {
  return ESCALERA.indexOf(String(rol || ''));
}

/**
 * ¿Puede este rol esta capacidad?
 *
 * ⛔ Una capacidad desconocida **revienta**, no devuelve `false`. Un `false`
 * sería seguro pero mudo: la ruta quedaría cerrada para todo el mundo y el
 * fallo aparecería como «no tengo permisos» semanas después. Reventar hace que
 * caiga la prueba de la matriz el mismo día que se escribe la errata.
 */
function puede(rol, capacidad) {
  const minimo = CAPACIDADES[capacidad];
  if (minimo === undefined) {
    throw new Error(`Capacidad desconocida: "${capacidad}". Las que hay: ${Object.keys(CAPACIDADES).join(', ')}`);
  }
  const nivel = escalon(rol);
  return nivel >= 0 && nivel >= escalon(minimo);
}

/** Todas las capacidades de un rol. Para que la pantalla esconda lo que no toca. */
function capacidadesDe(rol) {
  return Object.keys(CAPACIDADES).filter(c => puede(rol, c));
}

/** ¿Este rol entra al modo administrador, sea del escalón que sea? */
function esAdministrativo(rol) {
  return escalon(rol) >= escalon('admin_lector');
}

/**
 * Los roles que alcanzan una capacidad, para meterlos en un `= ANY($n)`.
 *
 * ⭐ Existe para que NINGUNA consulta vuelva a escribir `rol IN ('propietario',
 * 'admin')` a mano. Esas listas repetidas son la forma exacta en que un
 * sistema de permisos se desincroniza: se añade un escalón, se actualizan seis
 * sitios de siete, y el que falta no da error — sólo deja fuera a alguien, o
 * peor, deja entrar a alguien.
 */
function rolesCon(capacidad) {
  return ESCALERA.filter(r => puede(r, capacidad));
}

/**
 * Los roles que el dueño puede repartir.
 *
 * ⛔ `propietario` NO está, y no es un olvido. Hacerse dueño sólo ocurre por
 * transferencia explícita, que es otra ruta, con su confirmación y su registro.
 * Si estuviera aquí, cambiar un rol sería una forma callada de regalar la
 * quiniela.
 */
const ROLES_ASIGNABLES = ['admin', 'admin_jornadas', 'admin_lector', 'user'];

/** Cómo se llama cada rol para una persona. */
const NOMBRES = {
  propietario: 'Dueño',
  admin: 'Administrador',
  admin_jornadas: 'Administrador de jornadas',
  admin_lector: 'Administrador de sólo lectura',
  user: 'Jugador'
};

module.exports = {
  ESCALERA, CAPACIDADES, ROLES_ASIGNABLES, NOMBRES, PAGINAS,
  escalon, puede, capacidadesDe, esAdministrativo, rolesCon
};

/*
 * Mantener una pantalla al día sin repintarla cada treinta segundos.
 *
 * ============================================================================
 * ⛔ POR QUÉ EXISTE ESTO
 * ============================================================================
 *
 * Cinco pantallas de resultados tenían, cada una por su cuenta:
 *
 *     setInterval(() => recargarloTodo(), 30000);
 *
 * Marco lo encontró usándolo: *«si estoy en ver resultados puntos, se me
 * reinicia todo, como cada 20 o 30 segundos»*. Y tenía razón en las cinco.
 *
 * Tres cosas iban mal, y ninguna daba error:
 *
 *   1. **Repintaba aunque no hubiera cambiado nada.** Un partido terminado hace
 *      tres días se volvía a dibujar cada treinta segundos, borrando el sitio
 *      donde ibas leyendo.
 *   2. **Refrescaba sin que hubiera nada que mirar**, y con la pestaña en el
 *      bolsillo también.
 *   3. **Treinta segundos no servían de nada.** El sincronizador consulta al
 *      proveedor cada SESENTA (`VENTANAS_MS.enVivo`), así que preguntar al doble
 *      de velocidad devuelve exactamente lo mismo. Tráfico pagado a cambio de
 *      nada — y la cuota de Neon ya se agotó una vez por algo así.
 *
 * ⭐ LA IDEA: PREGUNTAR POCO Y REPINTAR MENOS.
 *
 * Lo único que cambia mientras miras son los resultados oficiales. Así que cada
 * minuto se pide SÓLO eso —una petición, no tres— y la pantalla se recarga
 * entera únicamente si de verdad llegó algo distinto.
 */
(function (global) {
  'use strict';

  /*
   * ⚠️ 60 segundos, y no es un número elegido a ojo: es lo que tarda el
   * servidor en poder saber algo nuevo. Bajarlo no adelanta ninguna noticia.
   */
  var CADA_MS = 60 * 1000;

  /**
   * Vigila una jornada y avisa cuando cambie.
   *
   * @param obtenerJornada  Función que devuelve el nombre de la jornada que se
   *                        está mirando, o algo vacío si no hay ninguna. Se
   *                        pregunta CADA VEZ, porque el usuario puede cambiarla.
   * @param alCambiar       Qué hacer cuando los oficiales cambiaron de verdad.
   * @param inicial         Lo que ya se pintó al cargar, si se tiene. Evita una
   *                        primera vuelta que repinta sin motivo.
   */
  function refrescoEnVivo(obtenerJornada, alCambiar, inicial) {
    var ultimaHuella = inicial === undefined ? null : huella(inicial);
    var reloj = null;

    /*
     * ⛔ Una firma del contenido, no el contenido.
     *
     * Comparar objetos con `===` dice que no son iguales aunque digan lo mismo,
     * porque son objetos distintos. Y comparar campo a campo obligaría a saber
     * qué campos tiene cada pantalla. El texto JSON sirve para las cinco.
     */
    function huella(datos) {
      try {
        return JSON.stringify(datos);
      } catch (error) {
        /* Algo no serializable: se trata como «cambió», que es lo prudente. */
        return String(Math.random());
      }
    }

    /** ¿Ya terminó todo? Entonces el reloj sobra para siempre. */
    function todoTerminado(partidos) {
      return Array.isArray(partidos)
        && partidos.length > 0
        && partidos.every(function (p) { return p && p.estado === 'TC'; });
    }

    function parar() {
      if (reloj) { clearInterval(reloj); reloj = null; }
    }

    async function mirar() {
      /* Regla: con la pestaña escondida no se pregunta nada. */
      if (document.hidden) return;

      var jornada = obtenerJornada();
      if (!jornada) return;

      var oficiales;

      try {
        /*
         * ⚠️ UNA jornada, no todas. El parámetro existe desde la M-26 y es la
         * diferencia entre una petición pequeña y traerse la quiniela entera.
         */
        var respuesta = await fetch(
          '/api/resultados-oficiales?jornada=' + encodeURIComponent(jornada));

        if (!respuesta.ok) return;

        var lista = await respuesta.json();
        var doc = Array.isArray(lista)
          ? lista.find(function (j) { return j && j.nombre === jornada; })
          : null;

        oficiales = doc ? doc.partidos : [];
      } catch (error) {
        /* Un fallo de red no apaga el reloj: al minuto se vuelve a intentar. */
        return;
      }

      var ahora = huella(oficiales);

      /*
       * ⭐ AQUÍ ESTÁ EL ARREGLO DE LO QUE MARCO VEÍA.
       *
       * Si llegó lo mismo que ya había, NO SE TOCA LA PANTALLA. Sin esto, cada
       * vuelta borraba y redibujaba lo idéntico, y con ello el sitio donde
       * estabas leyendo.
       */
      /*
       * ⛔ LA PRIMERA MIRADA SOLO RECUERDA, NO REPINTA.
       *
       * Sin esto, la primera vuelta comparaba contra `null` —que no es igual a
       * nada— y daba el cambio por bueno SIEMPRE: la pantalla se repintaba una
       * vez al minuto de entrar, que es justo lo que se venia a quitar.
       *
       * Y no hace falta repintar: la pantalla acaba de dibujarse con datos
       * frescos. Esta primera consulta solo existe para tener con que comparar
       * la siguiente.
       */
      if (ultimaHuella === null) {
        ultimaHuella = ahora;
        if (todoTerminado(oficiales)) parar();
        return;
      }

      if (ahora === ultimaHuella) {
        if (todoTerminado(oficiales)) parar();
        return;
      }

      ultimaHuella = ahora;
      alCambiar(oficiales);

      if (todoTerminado(oficiales)) parar();
    }

    reloj = setInterval(mirar, CADA_MS);

    /*
     * Al volver a la pestaña, una mirada — pero con el mismo cerrojo: si acaba
     * de mirar, no repite. Entrar y salir diez veces en un minuto no puede ser
     * diez peticiones.
     */
    var ultimaMirada = Date.now();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (Date.now() - ultimaMirada < CADA_MS) return;
      ultimaMirada = Date.now();
      mirar();
    });

    return {
      parar: parar,
      /* Para cuando la pantalla cambia de jornada y hay que olvidar lo anterior. */
      olvidar: function () { ultimaHuella = null; }
    };
  }

  global.refrescoEnVivo = refrescoEnVivo;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Elegir de qué liga es esta quiniela, y con qué precio nacen sus jornadas.
 *
 * ============================================================================
 * ⛔ LAS LIGAS QUE NO SE PUEDEN ARMAR SOLAS NO SE OFRECEN — Y SE DICE POR QUÉ
 * ============================================================================
 *
 * El servidor marca cada liga con `automatizable` y, cuando no lo es, con un
 * `motivo`. Aquí se pintan igual pero deshabilitadas, con su motivo debajo.
 *
 * Esconderlas sería peor: quien busca la MLS y no la encuentra piensa que la
 * aplicación no la conoce, y se queda intentándolo. Verla con «no publica el
 * número de jornada» cierra la pregunta de una vez.
 *
 * ⚠️ La regla NO es «ligas sí, copas no»: la MLS es una liga y falla; los
 * cuartos de Concacaf son una copa y sirven. Lo único que importa es si el
 * proveedor dice a qué ronda pertenece cada partido.
 */
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('panelLiga');
  if (!panel) return;

  const resumen = document.getElementById('ligaResumen');
  const mensaje = document.getElementById('ligaMensaje');
  const precio = document.getElementById('precioPorDefecto');
  const alAcumulado = document.getElementById('alAcumuladoPorDefecto');
  const guardar = document.getElementById('guardarLiga');
  const quitar = document.getElementById('quitarLiga');
  const cajaCombo = document.getElementById('comboLigaCaja');
  const combo = document.getElementById('comboLiga');
  const listaCombo = document.getElementById('comboLigaLista');
  const filtroResumen = document.getElementById('filtroResumen');
  const precios = document.getElementById('ligaPrecios');
  const selector = document.getElementById('selectorLiga');
  const abrirSelector = document.getElementById('abrirSelector');

  let configuracion = {};

  async function api(url, opciones) {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      /*
       * ⚠️ «Confirma tu contraseña» a secas no dice qué hacer, y aquí es
       * especialmente confuso: a quien acaba de crear la quiniela le parece
       * que le piden la contraseña sin motivo. Se convierte en un enlace.
       */
      const fallo = new Error(datos.error || 'No se pudo completar la operación.');
      fallo.requiereAdminMode = Boolean(datos.requiereAdminMode);
      throw fallo;
    }
    return datos;
  }

  /** Pone en el mensaje un enlace para entrar al modo administrador. */
  function pedirAdminMode() {
    mensaje.textContent = 'Para configurar la quiniela hace falta entrar al modo administrador. ';

    const enlace = document.createElement('a');
    enlace.href = `/adminmode.html?volver=${encodeURIComponent('/configuracion-quiniela.html#liga')}`;
    enlace.textContent = 'Entrar ahora';
    mensaje.appendChild(enlace);
  }

  const dinero = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  /**
   * Enseña el selector, y con él los precios.
   *
   * ⚠️ Van JUNTOS a propósito: al elegir liga, el precio viaja en la misma
   * petición. Enseñar el selector sin los precios dejaría elegir una liga con
   * el precio a cero sin haberlo visto.
   */
  function mostrarSelector() {
    selector.hidden = false;
    precios.hidden = false;
    abrirSelector.hidden = true;
    combo.focus();
  }

  /** Lo recoge otra vez: ya se eligió, y deja de hacer falta. */
  function ocultarSelector() {
    selector.hidden = true;
    abrirSelector.hidden = false;
  }

  function pintarResumen() {
    const esDeLiga = configuracion.tipo === 'liga' && configuracion.ligaId;

    quitar.hidden = !esDeLiga;

    /*
     * El rótulo dice lo que va a pasar, no dónde lleva: desde una quiniela a
     * mano es empezar algo nuevo; desde una de liga es sustituir lo que hay.
     */
    abrirSelector.textContent = esDeLiga ? 'Cambiar de liga' : 'Armarlas por liga';

    /*
     * Los precios acompañan a la liga: en una quiniela que se arma a mano no
     * hay ninguna jornada que nazca sola, así que no hay precio de partida que
     * poner. Si el selector está abierto mandan ellos y no se tocan.
     */
    if (selector.hidden) precios.hidden = !esDeLiga;

    if (!esDeLiga) {
      resumen.textContent = 'Ahora mismo eliges los partidos tú, jornada a jornada.';
      return;
    }

    const p = configuracion.precioPorDefecto;
    resumen.textContent = `De ${configuracion.ligaNombre || 'una liga'}`
      + (p ? `. Cada jornada nace en ${dinero(p.precio)}, de los que ${dinero(p.alAcumulado)} van al acumulado.` : '.');
  }

  abrirSelector?.addEventListener('click', mostrarSelector);

  /* ==================== El desplegable escribible ==================== */

  /*
   * El armazón —escribir, filtrar, agrupar, moverse con las flechas, cerrar al
   * pinchar fuera— vive en `combo-de-ligas.js`, compartido con las favoritas.
   * Aquí queda sólo lo propio de esta pantalla: de dónde salen las ligas y qué
   * pasa al elegir una.
   */
  window.comboDeLigas({
    caja: cajaCombo,
    entrada: combo,
    lista: listaCombo,
    resumen: filtroResumen,

    textoResumen: n => `${n} se pueden armar solas.`,

    cargar: async () => {
      mensaje.textContent = 'Buscando ligas…';

      try {
        const datos = await api('/api/football/ligas-disponibles');
        mensaje.textContent = '';

        /*
         * ⚠️ Si NINGUNA se puede armar sola, la lista sale llena de motivos y
         * ni una opción viva. Sin este aviso parece que la aplicación está rota;
         * dicho, se entiende que es la semana y que hay salida.
         */
        const todas = [
          ...(datos.favoritas || []),
          ...(datos.paises || []).flatMap(pais => pais.ligas || [])
        ];

        if (!todas.some(liga => liga.partidos && liga.automatizable !== false)) {
          mensaje.textContent = 'Ninguna de las ligas de esta semana publica el número de jornada. '
            + 'Prueba otra semana, o arma las jornadas a mano.';
        }

        return datos;
      } catch (error) {
        /*
         * ⚠️ Se avisa aquí y se vuelve a lanzar: el módulo no sabe de qué
         * pantalla es, y «confirma tu contraseña» necesita su enlace.
         */
        if (error.requiereAdminMode) pedirAdminMode();
        else mensaje.textContent = error.message;
        throw error;
      }
    },

    alElegir: async liga => {
      combo.value = liga.nombre;
      await seleccionar(liga);
    }
  });


  async function seleccionar(liga) {
    mensaje.textContent = '';

    /*
     * ⚠️ El precio viaja en la MISMA petición que la liga. Si fueran dos, un
     * fallo en la segunda dejaría una quiniela de liga sin precio por defecto,
     * y la primera jornada propuesta nacería en cero.
     */
    const precioPorDefecto = {
      precio: Number(precio.value || 0),
      alAcumulado: Number(alAcumulado.value || 0)
    };

    try {
      await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'liga', ligaId: liga.id, ligaNombre: liga.nombre, precioPorDefecto
        })
      });

      /*
       * ⛔ El precio entra TAMBIÉN en el estado local. Sin esto el resumen decía
       * «De Liga MX.» a secas justo después de haber guardado un precio: la
       * pantalla contaba menos de lo que acababa de hacer, que es la forma
       * barata de que alguien crea que no se guardó y lo repita.
       */
      configuracion = {
        ...configuracion,
        tipo: 'liga', ligaId: liga.id, ligaNombre: liga.nombre, precioPorDefecto
      };
      ocultarSelector();
      pintarResumen();
      mensaje.textContent = `Listo: cada semana se te propondrá la jornada de ${liga.nombre}.`;
    } catch (error) {
      if (error.requiereAdminMode) pedirAdminMode();
      else mensaje.textContent = error.message;
    }
  }

  guardar?.addEventListener('click', async () => {
    mensaje.textContent = '';
    try {
      await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          precioPorDefecto: {
            precio: Number(precio.value || 0),
            alAcumulado: Number(alAcumulado.value || 0)
          }
        })
      });
      mensaje.textContent = 'Precio guardado.';
    } catch (error) {
      if (error.requiereAdminMode) pedirAdminMode();
      else mensaje.textContent = error.message;
    }
  });

  quitar?.addEventListener('click', async () => {
    if (!confirm('¿Dejar de armarla por liga? Las jornadas que ya existen no se tocan.')) return;

    try {
      await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'customizada' })
      });
      configuracion = { ...configuracion, tipo: 'customizada', ligaId: null };
      ocultarSelector();
      pintarResumen();
      combo.value = '';
      mensaje.textContent = 'A partir de ahora eliges tú los partidos.';
    } catch (error) {
      if (error.requiereAdminMode) pedirAdminMode();
      else mensaje.textContent = error.message;
    }
  });


  (async () => {
    try {
      const q = await api('/api/quiniela-actual');
      configuracion = q.configuracion || {};

      if (!(q.capacidades || []).includes('quiniela.configurar')) {
        return;                       // La guardia del servidor manda; esto es cortesía.
      }

      panel.hidden = false;

      const p = configuracion.precioPorDefecto;
      if (p) { precio.value = p.precio; alAcumulado.value = p.alAcumulado; }

      pintarResumen();

      /*
       * Quien acaba de crear una quiniela «de liga» llega con `#liga` y todavía
       * no ha elegido ninguna: se le abre la lista sin que tenga que buscarla.
       */
      if (window.location.hash === '#liga' && configuracion.tipo !== 'liga') {
        panel.scrollIntoView({ behavior: 'smooth' });
        mostrarSelector();
      }
    } catch (error) {
      /* Sin sesión o sin quiniela: el panel se queda oculto, que es lo correcto. */
    }
  })();
});

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
  const boton = document.getElementById('botonElegirLiga');
  const lista = document.getElementById('listaLigas');
  const mensaje = document.getElementById('ligaMensaje');
  const precio = document.getElementById('precioPorDefecto');
  const alAcumulado = document.getElementById('alAcumuladoPorDefecto');
  const guardar = document.getElementById('guardarLiga');
  const quitar = document.getElementById('quitarLiga');

  let configuracion = {};

  async function api(url, opciones) {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
    return datos;
  }

  const dinero = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  function pintarResumen() {
    const esDeLiga = configuracion.tipo === 'liga' && configuracion.ligaId;

    if (!esDeLiga) {
      resumen.textContent = 'Ahora mismo eliges los partidos tú, jornada a jornada.';
      quitar.hidden = true;
      return;
    }

    const p = configuracion.precioPorDefecto;
    resumen.textContent = `De ${configuracion.ligaNombre || 'una liga'}`
      + (p ? `. Cada jornada nace en ${dinero(p.precio)}, de los que ${dinero(p.alAcumulado)} van al acumulado.` : '.');
    quitar.hidden = false;
  }

  /** Una liga, pinchable o no según el proveedor sepa agruparla por jornada. */
  function tarjetaDeLiga(liga, pais) {
    const fila = document.createElement('div');
    fila.className = 'action-card';

    const texto = document.createElement('div');
    const titulo = document.createElement('h3');
    titulo.textContent = liga.nombre;

    const detalle = document.createElement('p');
    detalle.className = 'helper-text';

    texto.appendChild(titulo);
    texto.appendChild(detalle);
    fila.appendChild(texto);

    if (!liga.automatizable) {
      /*
       * ⚠️ Se enseña, no se esconde. Y el motivo es el del servidor, tal cual:
       * distingue «no publica la jornada» de «sólo la publica en 3 de 8», y esa
       * diferencia es lo que separa un dato del proveedor de un fallo nuestro.
       */
      fila.classList.add('ghost-button');
      detalle.textContent = liga.motivo || 'No se puede armar sola.';
      return fila;
    }

    detalle.textContent = `${pais} · ${liga.partidos} partidos esta semana`;

    const elegir = document.createElement('button');
    elegir.type = 'button';
    elegir.className = 'secondary-button';
    elegir.textContent = 'Elegir';
    elegir.onclick = () => seleccionar(liga);

    fila.appendChild(elegir);
    return fila;
  }

  async function cargarLigas() {
    lista.innerHTML = '';
    mensaje.textContent = 'Buscando ligas…';

    try {
      const datos = await api('/api/football/ligas-disponibles');
      mensaje.textContent = '';

      let cuantas = 0;

      for (const pais of datos.paises || []) {
        const titulo = document.createElement('h3');
        titulo.textContent = pais.pais;
        lista.appendChild(titulo);

        for (const liga of pais.ligas) {
          lista.appendChild(tarjetaDeLiga(liga, pais.pais));
          if (liga.automatizable) cuantas += 1;
        }
      }

      if (!cuantas) {
        mensaje.textContent = 'Ninguna de las ligas de esta semana publica el número de jornada. '
          + 'Prueba otra semana, o arma las jornadas a mano.';
      }
      lista.hidden = false;
    } catch (error) {
      mensaje.textContent = error.message;
    }
  }

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
      pintarResumen();
      lista.hidden = true;
      mensaje.textContent = `Listo: cada semana se te propondrá la jornada de ${liga.nombre}.`;
    } catch (error) {
      mensaje.textContent = error.message;
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
      mensaje.textContent = error.message;
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
      pintarResumen();
      lista.hidden = true;
      mensaje.textContent = 'A partir de ahora eliges tú los partidos.';
    } catch (error) {
      mensaje.textContent = error.message;
    }
  });

  boton?.addEventListener('click', cargarLigas);

  (async () => {
    try {
      const q = await api('/api/quiniela-actual');
      configuracion = q.configuracion || {};

      if (!(configuracion.capacidades || q.capacidades || []).includes('quiniela.configurar')) {
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
        await cargarLigas();
      }
    } catch (error) {
      /* Sin sesión o sin quiniela: el panel se queda oculto, que es lo correcto. */
    }
  })();
});

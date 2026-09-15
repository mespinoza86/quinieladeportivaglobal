/*
 * La jornada que toca, ya armada, para revisar y confirmar (§22).
 *
 * ============================================================================
 * ⭐ PROPONE, NO CREA
 * ============================================================================
 *
 * Todo lo que se decide al confirmar —el nombre, los comodines, qué partidos
 * entran— se decide AQUÍ, no en el servidor. Ésa es la diferencia entre este
 * borrador y una creación automática, y es lo que evita los cuatro problemas
 * anotados en §22: que la jornada actual deje de ser la última creada, que nadie
 * haya fijado el precio ni los comodines, y que el proveedor cambie de idea con
 * la jornada ya abierta.
 *
 * ⚠️ Y no estorba: si esta quiniela no es de liga, el panel no aparece y la
 * pantalla se comporta exactamente como siempre.
 */
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('panelBorrador');
  if (!panel) return;

  const titulo = document.getElementById('borradorTitulo');
  const resumen = document.getElementById('borradorResumen');
  const aviso = document.getElementById('borradorAviso');
  const nombreBox = document.getElementById('borradorNombreBox');
  const nombre = document.getElementById('borradorNombre');
  const listaPartidos = document.getElementById('borradorPartidos');
  const acciones = document.getElementById('borradorAcciones');
  const salidas = document.getElementById('borradorSalidas');
  const crear = document.getElementById('crearDelBorrador');
  const seguirAMano = document.getElementById('seguirAMano');

  let propuesta = null;

  async function api(url, opciones) {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
    return datos;
  }

  /** «2099-01-03 15:00» → «vie 3 ene, 15:00», que es como lo lee una persona. */
  function cuando(apiDate) {
    const texto = String(apiDate || '');
    const [dia, hora] = texto.split(' ');
    if (!dia) return texto;

    const fecha = new Date(`${dia}T12:00:00Z`);
    if (Number.isNaN(fecha.getTime())) return texto;

    const formato = fecha.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
    return hora ? `${formato}, ${hora}` : formato;
  }

  /**
   * Un partido de la propuesta, con su casilla de comodín.
   *
   * ⚠️ Quitar un partido es DESMARCARLO, no borrarlo de la lista: quien revisa
   * tiene que poder cambiar de idea sin volver a pedir el borrador, y una lista
   * de la que desaparecen cosas se lee peor que una con casillas.
   */
  function filaDePartido(partido, i) {
    const fila = document.createElement('div');
    fila.className = 'action-card';
    fila.dataset.indice = String(i);

    const entra = document.createElement('input');
    entra.type = 'checkbox';
    entra.checked = true;
    entra.className = 'borrador-entra';
    entra.setAttribute('aria-label', `Incluir ${partido.equipo1} contra ${partido.equipo2}`);

    const texto = document.createElement('div');
    const equipos = document.createElement('h3');
    equipos.textContent = `${partido.equipo1} vs ${partido.equipo2}`;

    const detalle = document.createElement('p');
    detalle.className = 'helper-text';
    detalle.textContent = cuando(partido.fecha);

    texto.appendChild(equipos);
    texto.appendChild(detalle);

    const comodin = document.createElement('label');
    comodin.className = 'checkbox-fila';
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.className = 'borrador-comodin';
    const rotulo = document.createElement('span');
    rotulo.textContent = 'Comodín';
    comodin.appendChild(casilla);
    comodin.appendChild(rotulo);

    fila.appendChild(entra);
    fila.appendChild(texto);
    fila.appendChild(comodin);
    return fila;
  }

  function pintarPropuesta(datos) {
    propuesta = datos;

    titulo.textContent = `${datos.nombre} de ${datos.liga.nombre || 'la liga'}`;
    resumen.textContent = `${datos.partidos.length} partidos, del ${cuando(datos.arranque)} en adelante. `
      + 'Revísala y confírmala: puedes quitar partidos, poner comodines y cambiarle el nombre.';

    nombre.value = datos.nombre;
    nombreBox.hidden = false;

    /*
     * ⚠️ El aviso de «ronda a medio publicar» se enseña ARRIBA y en rojo, pero
     * no bloquea nada. Hay jornadas que de verdad traen menos partidos —una
     * fecha FIFA, un aplazamiento— y bloquearlas dejaría la función inservible
     * justo en los casos raros.
     */
    if (datos.aviso) { aviso.textContent = `⚠️ ${datos.aviso}`; aviso.hidden = false; }
    else { aviso.hidden = true; }

    listaPartidos.innerHTML = '';
    datos.partidos.forEach((partido, i) => listaPartidos.appendChild(filaDePartido(partido, i)));

    acciones.hidden = false;
    salidas.hidden = true;
    panel.hidden = false;
  }

  /** Se acabó la temporada: las tres salidas, y decide quien mira. */
  function pintarFinDeTemporada(datos) {
    titulo.textContent = 'No hay más jornadas por ahora';
    resumen.textContent = datos.explicacion || 'No hay ninguna jornada nueva que proponer.';

    aviso.hidden = true;
    nombreBox.hidden = true;
    listaPartidos.innerHTML = '';
    acciones.hidden = true;

    /*
     * Las tres salidas sólo tienen sentido cuando se acabaron las jornadas de la
     * liga. Si el proveedor simplemente no devolvió nada esta semana, ofrecer
     * «archiva la quiniela» sería alarmante y equivocado.
     */
    salidas.hidden = datos.motivo !== 'sin_rondas_nuevas';
    panel.hidden = false;
  }

  async function confirmar() {
    if (!propuesta) return;

    const filas = [...listaPartidos.querySelectorAll('.action-card')];
    const partidos = filas
      .filter(f => f.querySelector('.borrador-entra').checked)
      .map(f => {
        const partido = propuesta.partidos[Number(f.dataset.indice)];
        return {
          equipo1: partido.equipo1,
          equipo2: partido.equipo2,
          logoEquipo1: partido.logoEquipo1 || '',
          logoEquipo2: partido.logoEquipo2 || '',
          comodin: f.querySelector('.borrador-comodin').checked,
          apiFixtureId: partido.apiFixtureId || '',
          apiLeagueId: partido.apiLeagueId || '',
          apiDate: partido.fecha || '',
          apiStatus: partido.estado || '',
          /*
           * ⛔ La ronda viaja con el partido. Es lo único que hará que la semana
           * que viene el borrador sepa que esta jornada ya está hecha; sin ella
           * volvería a proponer la misma.
           */
          apiRound: partido.ronda || ''
        };
      });

    if (!partidos.length) {
      aviso.textContent = '⚠️ No queda ningún partido marcado.';
      aviso.hidden = false;
      return;
    }

    crear.disabled = true;

    try {
      await api('/api/jornadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.value.trim() || propuesta.nombre, partidos })
      });

      /*
       * Se recarga entera en vez de actualizar a mano. La pantalla de jornadas
       * tiene su propio estado —el desplegable, la lista de abajo— y sincronizar
       * dos mitades a mano es como se cuelan las que discrepan.
       */
      window.location.reload();
    } catch (error) {
      crear.disabled = false;
      aviso.textContent = `⚠️ ${error.message}`;
      aviso.hidden = false;
    }
  }

  crear?.addEventListener('click', confirmar);
  seguirAMano?.addEventListener('click', () => { panel.hidden = true; });

  (async () => {
    try {
      const datos = await api('/api/borrador-de-jornada');

      /*
       * ⚠️ `quiniela_customizada` NO se enseña: es el caso por defecto y el de
       * todas las quinielas que ya existían. Quien arma sus jornadas a mano no
       * tiene por qué ver un panel explicándole algo que no ha pedido.
       */
      if (datos.motivo === 'quiniela_customizada') return;

      if (datos.ok) pintarPropuesta(datos);
      else pintarFinDeTemporada(datos);
    } catch (error) {
      /*
       * Sin clave del proveedor, o sin permisos: el panel se queda oculto y la
       * pantalla funciona como siempre. Es cortesía, no una función que falte.
       */
    }
  })();
});

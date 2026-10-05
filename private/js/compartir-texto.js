/*
 * Copiar para el grupo: el texto de una jornada, un partido o un jugador.
 *
 * ============================================================================
 * ⛔ ESTE ARCHIVO SUSTITUYE A CINCO PANTALLAS
 * ============================================================================
 *
 * `enviarresultados`, `enviarresultadospartido`, `enviarresultadostrivias`,
 * `enviarresultadostriviaspartidos` y `copiarresultadojugador`. Tres de ellas
 * se anunciaban en el panel con la misma frase, «Compartir información», que no
 * distingue nada.
 *
 * Las cinco pedían los mismos datos a TRES rutas —de hecho tres de ellas
 * llamaban exactamente a la misma— y sólo cambiaban en cómo pegaban el texto.
 * Por eso esto no toca el servidor.
 *
 * ⚠️ LOS CINCO FORMATOS SE CONSERVAN TAL CUAL. Son textos que la gente ya
 * reconoce pegados en el grupo; cambiarlos «de paso» habría sido meter una
 * sorpresa que nadie pidió.
 *
 * ============================================================================
 * ⚠️ LO QUE NO SE ARREGLA AQUÍ, Y ESTÁ ANOTADO
 * ============================================================================
 *
 * Para los pronósticos se pide la jornada de CADA jugador por separado, una
 * petición por cabeza. Es como estaba y se respeta para no cambiar dos cosas a
 * la vez, pero con veinte jugadores son veinte viajes. Queda como deuda.
 */
document.addEventListener('DOMContentLoaded', () => {
  const jornadaSelect = document.getElementById('jornadaSelect');
  const alcanceSelect = document.getElementById('alcanceSelect');
  const partidoSelect = document.getElementById('partidoSelect');
  const jugadorSelect = document.getElementById('jugadorSelect');
  const cajaPartido = document.getElementById('cajaPartido');
  const cajaJugador = document.getElementById('cajaJugador');
  const texto = document.getElementById('texto');
  const aviso = document.getElementById('aviso');
  const mensaje = document.getElementById('mensaje');

  const queSeleccionado = () =>
    document.querySelector('input[name="que"]:checked')?.value || 'resultados';

  let jugadores = [];
  let partidos = [];

  /* ==================== Hablar con el servidor ==================== */

  /*
   * ⚠️ Un solo sitio donde se traduce un fallo a algo que se pueda leer. Las
   * cinco pantallas de antes soltaban `alert('Error cargando jornadas')`, que
   * ni dice qué pasó ni qué hacer, y encima tapa la pantalla.
   */
  async function pedir(url) {
    const respuesta = await fetch(url);
    if (respuesta.status === 404) return null;

    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      throw new Error(datos?.error || 'No se pudo traer la información.');
    }
    return datos;
  }

  function decir(elemento, mensajeTexto) {
    elemento.textContent = mensajeTexto;
  }

  /* ==================== Llenar los desplegables ==================== */

  function opciones(select, lista, vacio) {
    select.innerHTML = '';

    if (!lista.length) {
      select.appendChild(new Option(vacio, ''));
      select.disabled = true;
      return;
    }

    select.disabled = false;
    for (const item of lista) {
      select.appendChild(new Option(item.rotulo, item.valor));
    }
  }

  async function cargarJornadas() {
    const deTrivias = queSeleccionado() === 'trivias';
    decir(aviso, 'Buscando jornadas…');

    try {
      const datos = await pedir(deTrivias ? '/api/trivias-jornadas' : '/api/jornadas?resumen=1');
      const lista = (datos || []).map(j => ({
        rotulo: j.nombre || String(j),
        valor: j.nombre || String(j)
      }));

      opciones(jornadaSelect, lista,
        deTrivias ? 'Todavía no hay jornadas con trivias' : 'Todavía no hay jornadas');

      /*
       * ⚠️ Si no hay ninguna, se dice qué hacer y no sólo que no hay. Un «no
       * hay nada» a secas deja a quien lo lee sin saber si es un fallo suyo.
       */
      decir(aviso, lista.length ? '' : (deTrivias
        ? 'Aún no has creado trivias en ninguna jornada. Se crean en «Crear trivias».'
        : 'Aún no hay ninguna jornada. Se crean en «Armar jornadas».'));

      await alCambiarJornada();
    } catch (error) {
      decir(aviso, error.message);
    }
  }

  async function cargarJugadores() {
    if (jugadores.length) return jugadores;
    jugadores = (await pedir('/api/jugadores')) || [];
    return jugadores;
  }

  /*
   * Los partidos de la jornada salen del primer jugador que tenga pronósticos:
   * todos llenan los mismos partidos, así que el primero que conteste sirve de
   * índice. Es lo que hacían las pantallas de «por partido».
   */
  async function cargarPartidos(jornada) {
    partidos = [];

    if (queSeleccionado() === 'trivias') {
      const datos = await pedir(`/api/admin/respuestas-trivias-jornada/${encodeURIComponent(jornada)}`);
      const vistos = new Set();

      for (const trivia of datos?.trivias || []) {
        const nombre = `${trivia.equipo1} vs ${trivia.equipo2}`;
        if (!vistos.has(nombre)) { vistos.add(nombre); partidos.push(nombre); }
      }
      return partidos.map((p, i) => ({ rotulo: p, valor: String(i) }));
    }

    for (const jugador of await cargarJugadores()) {
      const pronosticos = await pedir(
        `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
      );
      if (Array.isArray(pronosticos) && pronosticos.length) {
        partidos = pronosticos.map(p => `${p.equipo1} vs ${p.equipo2}`);
        break;
      }
    }
    return partidos.map((p, i) => ({ rotulo: p, valor: String(i) }));
  }

  /* ==================== Los cinco formatos, intactos ==================== */

  const SEPARADOR = '-------------------------------\n';
  const MARCO = '===============================\n';

  function lineasDePronostico(pronosticos) {
    return pronosticos.map((p, i) =>
      `${i + 1}. ${p.equipo1} ${marcadorVisible(p.marcador1, p.oculto)}\n` +
      `   ${p.equipo2} ${marcadorVisible(p.marcador2, p.oculto)}\n`
    ).join('');
  }

  async function textoJornada(jornada) {
    let salida = '';

    for (const jugador of await cargarJugadores()) {
      const pronosticos = await pedir(
        `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
      );
      if (!Array.isArray(pronosticos) || !pronosticos.length) continue;

      salida += SEPARADOR + `Nombre: ${jugador}\n` + SEPARADOR;
      salida += lineasDePronostico(pronosticos) + '\n';
    }

    return salida || 'Nadie ha llenado esta jornada todavía.';
  }

  async function textoDeUnPartido(jornada, indice) {
    let salida = '';
    let cabecera = '';

    for (const jugador of await cargarJugadores()) {
      const pronosticos = await pedir(
        `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
      );
      if (!Array.isArray(pronosticos) || !pronosticos[indice]) continue;

      const p = pronosticos[indice];

      if (!cabecera) {
        cabecera = SEPARADOR + `Jornada: ${jornada}\n`
          + `Partido: ${p.equipo1} vs ${p.equipo2}\n` + SEPARADOR + '\n';
      }

      salida += `${jugador}: ${p.equipo1} ${marcadorVisible(p.marcador1, p.oculto)}`
        + ` - ${marcadorVisible(p.marcador2, p.oculto)} ${p.equipo2}\n`;
    }

    return salida ? cabecera + salida : 'Nadie ha pronosticado este partido todavía.';
  }

  async function textoDeUnJugador(jornada, jugador) {
    const pronosticos = await pedir(
      `/api/resultados-con-equipos/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`
    );

    if (!Array.isArray(pronosticos) || !pronosticos.length) {
      return `${jugador} no ha llenado esta jornada.`;
    }

    return `Nombre: ${jugador}\nJornada: ${jornada}\n` + SEPARADOR
      + lineasDePronostico(pronosticos);
  }

  function respuestaDe(respuestas, jugador, triviaId) {
    const r = respuestas.find(x =>
      x.jugador === jugador && String(x.triviaId) === String(triviaId));
    return r ? r.respuesta : 'Sin responder';
  }

  async function textoDeTrivias(jornada, soloPartido) {
    const datos = await pedir(`/api/admin/respuestas-trivias-jornada/${encodeURIComponent(jornada)}`);

    let trivias = datos?.trivias || [];
    const respuestas = datos?.respuestas || [];

    if (!trivias.length) return 'No hay trivias creadas para esta jornada.';

    let tituloPartido = '';
    if (soloPartido !== null) {
      tituloPartido = partidos[soloPartido] || '';
      trivias = trivias.filter(t => `${t.equipo1} vs ${t.equipo2}` === tituloPartido);
      if (!trivias.length) return 'No hay trivias creadas para este partido.';
    }

    const quienes = [...new Set(respuestas.map(r => r.jugador))].sort();
    if (!quienes.length) return 'Nadie ha contestado las trivias de esta jornada.';

    let salida = MARCO + `TRIVIAS - ${jornada}\n`;
    if (tituloPartido) salida += `Partido: ${tituloPartido}\n`;
    salida += MARCO + '\n';

    for (const jugador of quienes) {
      salida += SEPARADOR + `Nombre: ${jugador}\n` + SEPARADOR;

      let partidoActual = '';
      trivias.forEach((trivia, i) => {
        const partido = `${trivia.equipo1} vs ${trivia.equipo2}`;
        if (!tituloPartido && partido !== partidoActual) {
          partidoActual = partido;
          salida += `\n${partido}\n`;
        }
        salida += `${i + 1}. ${trivia.pregunta}\n`;
        salida += `   Respuesta: ${respuestaDe(respuestas, jugador, trivia.id)}\n`;
      });

      salida += '\n';
    }

    return salida;
  }

  /* ==================== Armar el texto ==================== */

  async function armar() {
    const jornada = jornadaSelect.value;
    if (!jornada) { texto.value = ''; return; }

    const alcance = alcanceSelect.value;
    decir(mensaje, 'Armando el texto…');

    try {
      if (queSeleccionado() === 'trivias') {
        texto.value = await textoDeTrivias(
          jornada, alcance === 'partido' ? Number(partidoSelect.value || 0) : null);
      } else if (alcance === 'partido') {
        texto.value = await textoDeUnPartido(jornada, Number(partidoSelect.value || 0));
      } else if (alcance === 'jugador') {
        texto.value = await textoDeUnJugador(jornada, jugadorSelect.value);
      } else {
        texto.value = await textoJornada(jornada);
      }
      decir(mensaje, '');
    } catch (error) {
      texto.value = '';
      decir(mensaje, error.message);
    }
  }

  /* ==================== Qué se enseña según lo elegido ==================== */

  function ajustarControles() {
    const esTrivias = queSeleccionado() === 'trivias';
    const alcance = alcanceSelect.value;

    /*
     * ⚠️ «Un jugador» sólo existe para los pronósticos: las trivias se piden al
     * servidor por jornada entera y no hay ruta por jugador. Se esconde la
     * opción en vez de dejarla y fallar después.
     */
    const porJugador = alcanceSelect.querySelector('option[value="jugador"]');
    if (porJugador) porJugador.hidden = esTrivias;
    if (esTrivias && alcance === 'jugador') alcanceSelect.value = 'jornada';

    cajaPartido.hidden = alcanceSelect.value !== 'partido';
    cajaJugador.hidden = alcanceSelect.value !== 'jugador';
  }

  async function alCambiarJornada() {
    ajustarControles();

    const jornada = jornadaSelect.value;
    if (!jornada) { texto.value = ''; return; }

    if (alcanceSelect.value === 'partido') {
      opciones(partidoSelect, await cargarPartidos(jornada), 'Esta jornada no tiene partidos');
    }
    if (alcanceSelect.value === 'jugador') {
      opciones(jugadorSelect,
        (await cargarJugadores()).map(j => ({ rotulo: j, valor: j })),
        'Todavía no hay jugadores');
    }

    await armar();
  }

  /* ==================== Copiar ==================== */

  document.getElementById('copiar').addEventListener('click', async () => {
    if (!texto.value) { decir(mensaje, 'Primero elige una jornada.'); return; }

    try {
      await navigator.clipboard.writeText(texto.value);
      decir(mensaje, 'Copiado. Ya lo puedes pegar en el grupo.');
    } catch {
      /*
       * ⚠️ El portapapeles se niega en algunos navegadores si la pestaña no
       * está en primer plano. Se selecciona el texto para que se pueda copiar a
       * mano, en vez de dejar un «no se pudo» sin salida.
       */
      texto.select();
      decir(mensaje, 'Tu navegador no dejó copiar solo. El texto queda seleccionado: cópialo con Ctrl+C.');
    }
  });

  document.getElementById('whatsapp').addEventListener('click', () => {
    if (!texto.value) { decir(mensaje, 'Primero elige una jornada.'); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto.value)}`, '_blank');
  });

  /* ==================== Arranque ==================== */

  for (const radio of document.querySelectorAll('input[name="que"]')) {
    radio.addEventListener('change', () => { partidos = []; cargarJornadas(); });
  }

  alcanceSelect.addEventListener('change', alCambiarJornada);
  jornadaSelect.addEventListener('change', alCambiarJornada);
  partidoSelect.addEventListener('change', armar);
  jugadorSelect.addEventListener('change', armar);

  cargarJornadas();
});

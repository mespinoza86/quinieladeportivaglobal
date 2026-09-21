document.addEventListener('DOMContentLoaded', async () => {
  const mensaje = document.getElementById('configMensaje'); let quiniela;
  async function api(url, options) { const r=await fetch(url,options); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Error'); return d; }
  try {
    quiniela=await api('/api/quiniela-actual'); const p=quiniela.configuracion.puntuacion;
    ['marcadorExacto','resultadoCorrecto','comodinExacto','comodinResultado','puntosTriviaDefault'].forEach(c=>document.getElementById(c).value=p[c]);
    document.getElementById('triviasHabilitadas').checked=p.triviasHabilitadas;
    document.getElementById('incluirExpulsadosEnRanking').checked=quiniela.configuracion.incluirExpulsadosEnRanking;
    /* El aviso nace apagado: sin campo, la casilla va desmarcada. `=== true` y no `!!` por lo mismo que en el servidor. */
    document.getElementById('avisarAlCompartir').checked=quiniela.configuracion.avisarAlCompartir===true;
    if((quiniela.capacidades||[]).includes('quiniela.configurar')){document.getElementById('cicloPanel').hidden=false;document.getElementById('archivarButton').textContent=quiniela.estado==='archivada'?'Restaurar quiniela':'Archivar quiniela';}
    if((quiniela.capacidades||[]).includes('quiniela.eliminar')) document.getElementById('eliminarPanel').hidden=false;
  } catch(e){mensaje.textContent=e.message;}
  document.getElementById('configForm').addEventListener('submit',async e=>{e.preventDefault();try{const campos=['marcadorExacto','resultadoCorrecto','comodinExacto','comodinResultado','puntosTriviaDefault'];const puntuacion=Object.fromEntries(campos.map(c=>[c,Number(document.getElementById(c).value)]));puntuacion.triviasHabilitadas=document.getElementById('triviasHabilitadas').checked;await api('/api/quiniela-actual/configuracion',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({puntuacion,incluirExpulsadosEnRanking:document.getElementById('incluirExpulsadosEnRanking').checked,avisarAlCompartir:document.getElementById('avisarAlCompartir').checked})});mensaje.textContent='Configuración guardada.';}catch(err){mensaje.textContent=err.message;}});
  document.getElementById('archivarButton').addEventListener('click',async()=>{try{await api('/api/quiniela-actual/archivar',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archivada:quiniela.estado!=='archivada'})});window.location.reload();}catch(e){mensaje.textContent=e.message;}});
  document.getElementById('eliminarButton')?.addEventListener('click',async()=>{if(!confirm('Esta acción retirará la quiniela de todos los usuarios. ¿Continuar?'))return;try{await api('/api/quiniela-actual',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmacion:document.getElementById('confirmarEliminacion').value})});window.location.href='/quinielas.html';}catch(e){mensaje.textContent=e.message;}});

  /* ==================== Ligas favoritas ==================== */

  /*
   * ============================================================================
   * SE AÑADEN DE UNA EN UNA Y SE QUITAN DE LA LISTA
   * ============================================================================
   *
   * Antes era una lista de casillas con TODOS los torneos de la semana: cientos
   * de filas por las que había que bajar y bajar. Es el mismo problema que hizo
   * nacer el desplegable escribible al armar jornadas, así que es la misma
   * solución y literalmente el mismo código —`combo-de-ligas.js`—.
   *
   * ⛔ LAS FAVORITAS QUE NO JUEGAN ESTA SEMANA SE TIENEN QUE PODER QUITAR
   *
   * Con las casillas, una favorita en descanso se pintaba aparte para eso
   * mismo. Aquí sale sola: las elegidas viven en `elegidas`, no en lo que el
   * proveedor devolvió, así que una favorita en descanso está en la lista de
   * abajo con su botón de quitar como cualquier otra.
   *
   * ⚠️ Aquí CUALQUIER liga vale, al revés que al armar jornadas. Una favorita
   * es sólo un atajo para que salga de primera; no hace falta que el proveedor
   * sepa agruparla por rondas. Por eso el `estadoDe` de esta pantalla dice
   * siempre que sí.
   */
  const panelFavoritas = document.getElementById('favoritasPanel');
  const listaElegidas = document.getElementById('favoritasElegidas');
  const mensajeFavoritas = document.getElementById('favoritasMensaje');

  /** Las favoritas de ahora mismo, en orden. Se guardan tal cual al pulsar. */
  let elegidas = [];

  /*
   * ⚠️ UNA sola petición para las dos cosas: pintar lo que ya está marcado y
   * llenar el desplegable. Guardada la promesa, el `await` de cada uno espera a
   * la misma respuesta.
   *
   * Cada consulta al proveedor gasta cuota COMPARTIDA entre todas las
   * quinielas: pedir lo mismo dos veces al abrir la pantalla es cuota tirada.
   */
  let promesaLigas = null;
  const ligasDisponibles = () => {
    if (!promesaLigas) promesaLigas = api('/api/football/ligas-disponibles?dias=7');
    return promesaLigas;
  };

  const MAXIMO_FAVORITAS = 20;   // El mismo tope que `ligas.js` en el servidor.

  function pintarElegidas() {
    listaElegidas.innerHTML = '';

    if (!elegidas.length) {
      const vacio = document.createElement('li');
      vacio.className = 'helper-text';
      vacio.textContent = 'Todavía no has marcado ninguna.';
      listaElegidas.appendChild(vacio);
      return;
    }

    elegidas.forEach((liga, i) => {
      const fila = document.createElement('li');

      const nombre = document.createElement('span');
      nombre.textContent = liga.nombre;
      fila.appendChild(nombre);

      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'ghost-button';
      /* El nombre va en la etiqueta: «Quitar» a secas, repetido veinte veces,
       * no le dice nada a quien navega con lector de pantalla. */
      quitar.setAttribute('aria-label', `Quitar ${liga.nombre}`);
      quitar.textContent = 'Quitar';

      quitar.addEventListener('click', () => {
        elegidas.splice(i, 1);
        pintarElegidas();
        /* Vuelve a estar disponible en el desplegable, si está abierto. */
        comboFavoritas?.refrescar();
        mensajeFavoritas.textContent = 'Sin guardar todavía.';
      });

      fila.appendChild(quitar);
      listaElegidas.appendChild(fila);
    });
  }

  let comboFavoritas = null;

  function montarComboFavoritas() {
    const caja = document.getElementById('comboFavoritaCaja');
    const entrada = document.getElementById('comboFavorita');
    const lista = document.getElementById('comboFavoritaLista');
    if (!caja || !entrada || !lista || !window.comboDeLigas) return null;

    return window.comboDeLigas({
      caja,
      entrada,
      lista,
      cargar: ligasDisponibles,

      /* Cualquiera sirve de favorita: no hace falta que se pueda automatizar. */
      estadoDe: () => ({ elegible: true, motivo: null }),

      /* Las que ya están marcadas no se ofrecen: marcarlas dos veces no existe. */
      excluir: () => new Set(elegidas.map(liga => String(liga.id))),

      alElegir: liga => {
        entrada.value = '';

        if (!liga.id) {
          // Sin id no se puede guardar: el id es lo que sobrevive a un renombre.
          mensajeFavoritas.textContent = `${liga.nombre} no se puede marcar: el proveedor no le da número.`;
          return;
        }

        if (elegidas.length >= MAXIMO_FAVORITAS) {
          mensajeFavoritas.textContent = `Ya son ${MAXIMO_FAVORITAS}, que es el máximo. Quita alguna para añadir otra.`;
          return;
        }

        elegidas.push({ id: String(liga.id), nombre: liga.nombre });
        pintarElegidas();
        mensajeFavoritas.textContent = 'Sin guardar todavía.';
      }
    });
  }

  async function cargarFavoritas() {
    try {
      const datos = await ligasDisponibles();
      elegidas = (datos.favoritas || [])
        .filter(liga => liga.id)
        .map(liga => ({ id: String(liga.id), nombre: liga.nombre }));
      pintarElegidas();
    } catch (error) {
      /*
       * Puede fallar por dos motivos corrientes y ninguno es un fallo del
       * programa: que no haya clave del proveedor, o que el modo administrador
       * haya caducado. Se dice lo que pasó en vez de dejar «Cargando…» eterno.
       */
      listaElegidas.innerHTML = '';
      mensajeFavoritas.textContent = error.message;

      /*
       * ⚠️ Se olvida la promesa fallida. Guardada, el desplegable heredaría el
       * mismo fallo para siempre y no habría forma de reintentar sin recargar.
       */
      promesaLigas = null;
    }
  }

  if ((quiniela?.capacidades || []).includes('quiniela.configurar')) {
    panelFavoritas.hidden = false;
    comboFavoritas = montarComboFavoritas();
    cargarFavoritas();
  }

  document.getElementById('guardarFavoritas')?.addEventListener('click', async () => {
    try {
      await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ligasFavoritas: elegidas })
      });
      mensajeFavoritas.textContent = elegidas.length
        ? elegidas.length + ' liga(s) favorita(s) guardada(s).'
        : 'Se quitaron todas las favoritas.';
    } catch (error) {
      mensajeFavoritas.textContent = error.message;
    }
  });


  /* ==================== Cobros ==================== */

  /*
   * Los dos cobros son independientes: una quiniela puede cobrar 10.000 por el
   * torneo completo —para el premio final— Y ADEMÁS algo por cada jornada.
   *
   * ⚠️ Cambiar el precio de la jornada NO toca las que ya existen: cada una
   * guarda lo que costó. Esto es el precio de las que vengan.
   */
  const cobrosPanel = document.getElementById('cobrosPanel');
  const cobrosMensaje = document.getElementById('cobrosMensaje');

  const jornadaPrecio = document.getElementById('jornadaPrecio');
  const jornadaAcumulado = document.getElementById('jornadaAcumulado');
  const jornadaTotal = document.getElementById('jornadaTotal');

  const colones = new Intl.NumberFormat('es-CR', {
    style: 'currency', currency: 'CRC', maximumFractionDigits: 0
  });

  /*
   * En pantalla se piden las DOS partes por separado —lo de la jornada y lo del
   * bote— porque es como lo piensa quien cobra: «2.000, mil y mil». Guardado
   * es al revés: `precio` es el total y `alAcumulado` la parte del bote.
   *
   * Se guarda así, y no los tres números, porque el tercero se deduce: teniendo
   * total y bote, la parte de jornada es la resta. Guardar los tres sería tener
   * el mismo dato en dos sitios, y algún día no coincidirían.
   */
  function refrescarTotal() {
    const suma = (Number(jornadaPrecio.value) || 0) + (Number(jornadaAcumulado.value) || 0);
    jornadaTotal.textContent = colones.format(Math.max(0, suma));
  }

  jornadaPrecio?.addEventListener('input', refrescarTotal);
  jornadaAcumulado?.addEventListener('input', refrescarTotal);

  function pintarCobros(config) {
    const c = config?.cobros || {};
    document.getElementById('torneoActivo').checked = Boolean(c.torneo?.activo);
    document.getElementById('torneoPrecio').value = Number(c.torneo?.precio || 0);
    document.getElementById('jornadaActivo').checked = Boolean(c.jornada?.activo);
    jornadaPrecio.value = Number(c.jornada?.aLaJornada || 0);
    jornadaAcumulado.value = Number(c.jornada?.alAcumulado || 0);
    refrescarTotal();
  }

  if ((quiniela?.capacidades || []).includes('quiniela.configurar')) {
    cobrosPanel.hidden = false;
    pintarCobros(quiniela.configuracion);
  }

  document.getElementById('guardarCobros')?.addEventListener('click', async () => {
    const aLaJornada = Math.max(0, Number(jornadaPrecio.value) || 0);
    const alAcumulado = Math.max(0, Number(jornadaAcumulado.value) || 0);

    const cobros = {
      torneo: {
        activo: document.getElementById('torneoActivo').checked,
        precio: Number(document.getElementById('torneoPrecio').value) || 0
      },
      jornada: {
        activo: document.getElementById('jornadaActivo').checked,
        precio: aLaJornada + alAcumulado,
        alAcumulado
      }
    };

    try {
      const r = await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cobros })
      });
      pintarCobros(r.configuracion);
      cobrosMensaje.textContent = 'Cobros guardados.';
    } catch (error) {
      cobrosMensaje.textContent = error.message;
    }
  });

});

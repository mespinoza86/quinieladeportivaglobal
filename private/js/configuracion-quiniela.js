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
    if(['propietario','admin'].includes(quiniela.rol)){document.getElementById('cicloPanel').hidden=false;document.getElementById('archivarButton').textContent=quiniela.estado==='archivada'?'Restaurar quiniela':'Archivar quiniela';}
    if(quiniela.rol==='propietario') document.getElementById('eliminarPanel').hidden=false;
  } catch(e){mensaje.textContent=e.message;}
  document.getElementById('configForm').addEventListener('submit',async e=>{e.preventDefault();try{const campos=['marcadorExacto','resultadoCorrecto','comodinExacto','comodinResultado','puntosTriviaDefault'];const puntuacion=Object.fromEntries(campos.map(c=>[c,Number(document.getElementById(c).value)]));puntuacion.triviasHabilitadas=document.getElementById('triviasHabilitadas').checked;await api('/api/quiniela-actual/configuracion',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({puntuacion,incluirExpulsadosEnRanking:document.getElementById('incluirExpulsadosEnRanking').checked,avisarAlCompartir:document.getElementById('avisarAlCompartir').checked})});mensaje.textContent='Configuración guardada.';}catch(err){mensaje.textContent=err.message;}});
  document.getElementById('archivarButton').addEventListener('click',async()=>{try{await api('/api/quiniela-actual/archivar',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archivada:quiniela.estado!=='archivada'})});window.location.reload();}catch(e){mensaje.textContent=e.message;}});
  document.getElementById('eliminarButton')?.addEventListener('click',async()=>{if(!confirm('Esta acción retirará la quiniela de todos los usuarios. ¿Continuar?'))return;try{await api('/api/quiniela-actual',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmacion:document.getElementById('confirmarEliminacion').value})});window.location.href='/quinielas.html';}catch(e){mensaje.textContent=e.message;}});

  /* ==================== Ligas favoritas ==================== */

  /*
   * Se escogen de lo que juega la semana que viene, que es la misma lista que
   * alimenta el desplegable al armar una jornada. Marcar favoritas sobre el
   * catálogo entero del proveedor serían cientos de torneos y un buscador
   * aparte; esto es lo que de verdad se usa.
   *
   * ⚠️ Las que ya están marcadas se pintan SIEMPRE, jueguen o no esta semana.
   * Si sólo se listara lo que juega, una favorita en descanso no aparecería y
   * NO HABRÍA MANERA DE QUITARLA.
   */
  const panelFavoritas = document.getElementById('favoritasPanel');
  const listaFavoritas = document.getElementById('favoritasLista');
  const mensajeFavoritas = document.getElementById('favoritasMensaje');

  function casillaDeLiga(liga, marcada) {
    const fila = document.createElement('label');
    fila.className = 'checkbox-fila';

    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.value = liga.id;
    casilla.dataset.nombre = liga.nombre;
    casilla.checked = marcada;

    const texto = liga.partidos
      ? liga.nombre + ' (' + liga.partidos + ')'
      : liga.nombre + ' — sin partidos esta semana';

    const rotulo = document.createElement('span');
    rotulo.textContent = texto;

    fila.appendChild(casilla);
    fila.appendChild(rotulo);
    return fila;
  }

  function pintarFavoritas(datos) {
    listaFavoritas.innerHTML = '';

    const favoritas = datos.favoritas || [];
    const marcadas = new Set(favoritas.map(liga => String(liga.id)));

    if (favoritas.length) {
      const titulo = document.createElement('h3');
      titulo.className = 'grupo-titulo';
      titulo.textContent = 'Tus favoritas';
      listaFavoritas.appendChild(titulo);
      favoritas.forEach(liga => listaFavoritas.appendChild(casillaDeLiga(liga, true)));
    }

    const grupos = (datos.paises || []).filter(g => (g.ligas || []).length);

    if (!grupos.length && !favoritas.length) {
      listaFavoritas.innerHTML = '<p class="helper-text">No hay torneos con partidos esta semana.</p>';
      return;
    }

    grupos.forEach(grupo => {
      const titulo = document.createElement('h3');
      titulo.className = 'grupo-titulo';
      titulo.textContent = grupo.pais;
      listaFavoritas.appendChild(titulo);
      grupo.ligas.forEach(liga => {
        // Sin id no se puede guardar: el id es lo que sobrevive a un renombre.
        if (liga.id) listaFavoritas.appendChild(casillaDeLiga(liga, marcadas.has(String(liga.id))));
      });
    });
  }

  async function cargarFavoritas() {
    try {
      pintarFavoritas(await api('/api/football/ligas-disponibles?dias=7'));
    } catch (error) {
      /*
       * Puede fallar por dos motivos corrientes y ninguno es un fallo del
       * programa: que no haya clave del proveedor, o que el modo administrador
       * haya caducado. Se dice lo que pasó en vez de dejar «Cargando…» eterno.
       */
      listaFavoritas.innerHTML = '';
      const aviso = document.createElement('p');
      aviso.className = 'helper-text';
      aviso.textContent = error.message;
      listaFavoritas.appendChild(aviso);
    }
  }

  if (['propietario', 'admin'].includes(quiniela?.rol)) {
    panelFavoritas.hidden = false;
    cargarFavoritas();
  }

  document.getElementById('guardarFavoritas')?.addEventListener('click', async () => {
    const ligasFavoritas = [...listaFavoritas.querySelectorAll('input[type="checkbox"]:checked')]
      .map(casilla => ({ id: casilla.value, nombre: casilla.dataset.nombre }));

    try {
      await api('/api/quiniela-actual/configuracion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ligasFavoritas })
      });
      mensajeFavoritas.textContent = ligasFavoritas.length
        ? ligasFavoritas.length + ' liga(s) favorita(s) guardada(s).'
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

  if (['propietario', 'admin'].includes(quiniela?.rol)) {
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

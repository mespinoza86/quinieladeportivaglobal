/*
 * Cobros: quién debe qué, y anotar abonos.
 *
 * ⚠️ Esta pantalla SÓLO INFORMA. Deber dinero no impide jugar, ni saca del
 * ranking, ni cierra ninguna pantalla; es un control para quien administra.
 *
 * Dos cosas que se dicen tal como son, y no de más:
 *
 *   - «Le quedan 3 jornadas» es una ESTIMACIÓN al precio de hoy. El precio de
 *     la próxima puede subir, así que se muestra siempre acompañado del precio
 *     con el que se calculó.
 *   - «Esta jornada está pagada» sí es exacto, porque el precio de esa jornada
 *     ya está fijado. Eso lo ve el jugador en su propia pantalla.
 */
document.addEventListener('DOMContentLoaded', () => {
  const resumen = document.getElementById('resumenCobros');
  const listaCuentas = document.getElementById('listaCuentas');
  const listaHistorial = document.getElementById('listaHistorial');
  const listaBotes = document.getElementById('listaBotes');
  const listaEntregas = document.getElementById('listaEntregas');
  const mensaje = document.getElementById('mensajeCobros');
  const abonoMensaje = document.getElementById('abonoMensaje');
  const selectorJugador = document.getElementById('abonoJugador');
  const selectorGanador = document.getElementById('entregaGanador');
  const botesMensaje = document.getElementById('botesMensaje');

  let configuracion = null;

  async function api(url, opciones) {
    const r = await fetch(url, opciones);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la operación.');
    return d;
  }

  /** Colones, sin decimales cuando no hacen falta. */
  const plata = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  function pintarCuentas(datos) {
    configuracion = datos.cobros;

    const cobraAlgo = datos.cobros.torneo.activo || datos.cobros.jornada.activo;
    document.getElementById('apagadoPanel').hidden = cobraAlgo;
    document.getElementById('cuentasPanel').hidden = !cobraAlgo;
    document.getElementById('abonoPanel').hidden = !cobraAlgo;
    document.getElementById('historialPanel').hidden = !cobraAlgo;
    /*
     * Los botes son de las jornadas: si la quiniela sólo cobra el torneo no hay
     * premio de jornada ni acumulado que enseñar, y el panel sobra.
     */
    document.getElementById('botesPanel').hidden = !datos.cobros.jornada.activo;

    if (!cobraAlgo) {
      resumen.textContent = 'Sin cobros activos.';
      return;
    }

    const partes = [];
    if (datos.cobros.torneo.activo) partes.push('Torneo: ' + plata(datos.cobros.torneo.precio));
    if (datos.cobros.jornada.activo) {
      /*
       * El desglose va al lado del total porque es lo primero que se pregunta
       * quien cobra: «de los 2.000, ¿cuánto es del bote?». Si no hay acumulado
       * no se enseña el paréntesis: sería ruido que dice «+ ₡0».
       */
      const bote = Number(datos.cobros.jornada.alAcumulado || 0);
      partes.push('Jornada: ' + plata(datos.cobros.jornada.precio) + (bote > 0
        ? ` (${plata(datos.cobros.jornada.aLaJornada)} premio + ${plata(bote)} acumulado)`
        : ''));
    }
    resumen.textContent = partes.join(' · ');

    const cuentas = datos.cuentas || [];

    if (!cuentas.length) {
      listaCuentas.innerHTML = html`<p class="helper-text">Todavía no hay jugadores en esta quiniela.</p>`;
      selectorJugador.innerHTML = '';
      return;
    }

    listaCuentas.innerHTML = cuentas.map(c => {
      const lineas = [];

      if (c.torneo.activo) {
        lineas.push(c.torneo.juega
          ? (c.torneo.pendiente > 0
              ? html`<p class="helper-text">Torneo: debe ${plata(c.torneo.pendiente)}</p>`
              : html`<p class="helper-text">Torneo: al día</p>`)
          : html`<p class="helper-text">No juega el torneo completo</p>`);
      }

      if (c.jornada.activo && !c.jornada.juega) {
        /*
         * Se dice igual que en el torneo, y hace falta decirlo: sin esta línea
         * una persona exenta se vería «al día» y parecería que pagó.
         *
         * ⚠️ Y si ya había abonado antes de eximirla, ese dinero **sigue
         * contando** y hay que enseñarlo: quitarle la casilla no le borra lo
         * que puso, y quien administra tiene que saber que hay un saldo suyo
         * pendiente de devolver o de reutilizar.
         */
        lineas.push(c.jornada.abonado > 0
          ? html`<p class="helper-text">
              No se le cobran las jornadas — tiene ${plata(c.jornada.abonado)} a favor
            </p>`
          : html`<p class="helper-text">No se le cobran las jornadas</p>`);
      } else if (c.jornada.activo) {
        if (c.jornada.saldo < 0) {
          lineas.push(html`<p class="helper-text">Jornadas: debe ${plata(-c.jornada.saldo)}</p>`);
        } else if (c.jornada.saldo > 0) {
          /*
           * El «alcanza para N» va con el precio al lado a propósito: sin él
           * parece una promesa, y la jornada que viene puede costar el doble.
           */
          const cuantas = c.jornada.jornadasQueCubre;
          const cuantasTexto = cuantas === 1 ? '1 jornada más' : `${cuantas} jornadas más`;

          lineas.push(html`<p class="helper-text">
            Jornadas: saldo a favor de ${plata(c.jornada.saldo)}${
              cuantas === null ? '' : ` — alcanza para ${cuantasTexto} al precio de hoy (${plata(c.jornada.precioActual)})`
            }</p>`);
        } else {
          lineas.push(html`<p class="helper-text">Jornadas: al día</p>`);
        }

        /*
         * Que alguien pague menos que los demás tiene que estar escrito, no
         * deducirse de una casilla: si no, quien cobra ve «al día» con una
         * cifra distinta a la del resto y no sabe si es un error.
         */
        if (!c.jornada.juegaAcumulado && Number(configuracion.jornada.alAcumulado || 0) > 0) {
          lineas.push(html`<p class="helper-text">
            No juega el acumulado — paga ${plata(c.jornada.precioActual)} por jornada
          </p>`);
        }
      }

      return html`<div class="info-card" data-jugador="${c.jugadorId}">
        <h3>${c.nombre}${c.tieneCuenta ? '' : ' (sin cuenta)'}</h3>
        ${crudo(lineas.join(''))}
        <label class="checkbox-fila">
          <input type="checkbox" class="juegaTorneo" data-jugador="${c.jugadorId}" ${c.juegaTorneo ? 'checked' : ''} />
          <span>Juega el torneo completo</span>
        </label>
        <label class="checkbox-fila">
          <input type="checkbox" class="juegaJornadas" data-jugador="${c.jugadorId}" ${c.juegaJornadas ? 'checked' : ''} />
          <span>Se le cobran las jornadas</span>
        </label>
        <label class="checkbox-fila">
          <input type="checkbox" class="juegaAcumulado" data-jugador="${c.jugadorId}" ${c.juegaAcumulado ? 'checked' : ''} />
          <span>Participa en el acumulado</span>
        </label>
      </div>`;
    }).join('');

    const opciones = cuentas
      .map(c => html`<option value="${c.jugadorId}">${c.nombre}</option>`)
      .join('');

    selectorJugador.innerHTML = opciones;
    /*
     * El acumulado se le puede entregar a CUALQUIERA de la lista, aunque no
     * haya jugado por él: el ganador de la tabla general es quien es, y no le
     * toca a esta pantalla discutirlo. Quien administra sabrá.
     */
    selectorGanador.innerHTML = opciones;

    /*
     * Las dos casillas se guardan igual y por separado: cada una manda SÓLO su
     * campo, así que tocar una no puede pisar la otra. La ruta deja como estaba
     * lo que no viaja.
     */
    const CASILLAS = [
      { clase: 'juegaTorneo', campo: 'juegaTorneo' },
      { clase: 'juegaJornadas', campo: 'juegaJornadas' },
      { clase: 'juegaAcumulado', campo: 'juegaAcumulado' }
    ];

    for (const { clase, campo } of CASILLAS) {
      for (const casilla of listaCuentas.querySelectorAll('.' + clase)) {
        casilla.addEventListener('change', async () => {
          try {
            await api('/api/cobros/jugadores/' + casilla.dataset.jugador, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [campo]: casilla.checked })
            });
            await cargar();
          } catch (error) {
            mensaje.textContent = error.message;
            casilla.checked = !casilla.checked;   // deshacer lo que no se guardó
          }
        });
      }
    }

  }

  function pintarHistorial(abonos) {
    if (!abonos.length) {
      listaHistorial.innerHTML = html`<p class="helper-text">Todavía no hay abonos anotados.</p>`;
      return;
    }

    listaHistorial.innerHTML = abonos.map(a => {
      const fecha = new Date(a.created_at).toLocaleDateString('es-CR');
      const esCorreccion = Boolean(a.anula_a);
      const monto = Number(a.monto);

      return html`<div class="info-card">
        <p class="helper-text">
          ${fecha} · ${a.concepto === 'torneo' ? 'Torneo' : 'Jornadas'} ·
          <strong>${plata(monto)}</strong>
          ${esCorreccion ? ' (corrección)' : ''}
        </p>
        ${a.nota ? crudo(html`<p class="helper-text">${a.nota}</p>`) : ''}
        ${a.registrado_por ? crudo(html`<p class="helper-text">Anotó: ${a.registrado_por}</p>`) : ''}
        ${esCorreccion || monto < 0 ? '' : crudo(html`
          <button class="ghost-button anular" data-pago="${a.id}">Corregir con asiento inverso</button>`)}
      </div>`;
    }).join('');

    for (const boton of listaHistorial.querySelectorAll('.anular')) {
      boton.addEventListener('click', async () => {
        if (!confirm('Se anotará un asiento inverso. El abono original queda a la vista. ¿Continuar?')) return;
        try {
          await api('/api/cobros/abonos/' + boton.dataset.pago + '/anular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          await cargar();
        } catch (error) {
          mensaje.textContent = error.message;
        }
      });
    }
  }

  /*
   * Los botes: cuánto hay en el premio de cada jornada y cuánto en el bote
   * acumulado.
   *
   * ⚠️ Todo lo que se pinta aquí es dinero COBRADO. Enseñar lo esperado como
   * si estuviera es lo que hace que un premio se anuncie más grande de lo que
   * hay en la mano; por eso van los dos números, y el segundo dice «de».
   */
  function pintarBotes(datos) {
    const acumulado = datos.acumulado || {};
    const disponible = Number(acumulado.disponible || 0);

    document.getElementById('boteAcumulado').innerHTML = html`<div class="info-card">
      <h3>Acumulado</h3>
      <p class="hero-text"><strong>${plata(disponible)}</strong></p>
      <p class="helper-text">
        Juntado: ${plata(acumulado.cobrado)} de ${plata(acumulado.esperado)}${
          Number(acumulado.entregado || 0) > 0
            ? ` · ya entregado: ${plata(acumulado.entregado)}`
            : ''
        }
      </p>
    </div>`;

    const jornadas = datos.jornadas || [];

    listaBotes.innerHTML = jornadas.length
      ? jornadas.map(j => html`<div class="info-card">
          <h3>${j.nombre}</h3>
          <p class="helper-text">
            Premio de la jornada: <strong>${plata(j.premio)}</strong> de ${plata(j.esperado)}
          </p>
        </div>`).join('')
      : html`<p class="helper-text">Todavía no hay jornadas creadas.</p>`;

    /*
     * El botón sólo aparece cuando hay algo que entregar. Un botón que siempre
     * está y siempre responde «no hay nada» enseña a la gente a ignorarlo.
     */
    document.getElementById('entregaPanel').hidden = !(disponible > 0);

    const entregas = datos.entregas || [];

    listaEntregas.innerHTML = entregas.length
      ? html`<h3>Entregas</h3>` + entregas.map(e => {
          const fecha = new Date(e.created_at).toLocaleDateString('es-CR');
          return html`<div class="info-card">
            <p class="helper-text">
              ${fecha} · ${e.nombre_ganador} · <strong>${plata(e.monto)}</strong>
            </p>
            ${e.nota ? crudo(html`<p class="helper-text">${e.nota}</p>`) : ''}
            ${e.registrado_por ? crudo(html`<p class="helper-text">Anotó: ${e.registrado_por}</p>`) : ''}
          </div>`;
        }).join('')
      : '';
  }

  document.getElementById('entregarAcumulado')?.addEventListener('click', async () => {
    const jugadorId = selectorGanador.value;
    if (!jugadorId) { botesMensaje.textContent = 'Elige a quién se le entrega.'; return; }

    if (!confirm('Se entrega todo el acumulado disponible y el bote vuelve a cero. Queda anotado y no se puede borrar. ¿Continuar?')) return;

    try {
      const r = await api('/api/cobros/acumulado/entregar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jugadorId, nota: document.getElementById('entregaNota').value })
      });
      botesMensaje.textContent = `Entregado ${plata(r.entrega.monto)} a ${r.entrega.nombre_ganador}.`;
      document.getElementById('entregaNota').value = '';
      await cargar();
    } catch (error) {
      botesMensaje.textContent = error.message;
    }
  });

  async function cargar() {
    try {
      mensaje.textContent = '';
      botesMensaje.textContent = '';
      pintarCuentas(await api('/api/cobros/cuentas'));
      if (configuracion?.torneo.activo || configuracion?.jornada.activo) {
        pintarHistorial(await api('/api/cobros/abonos'));
      }
      if (configuracion?.jornada.activo) {
        pintarBotes(await api('/api/cobros/botes'));
      }
    } catch (error) {
      mensaje.textContent = error.message;
    }
  }

  document.getElementById('guardarAbono').addEventListener('click', async () => {
    const jugadorId = selectorJugador.value;
    const monto = Number(document.getElementById('abonoMonto').value);

    if (!jugadorId) { abonoMensaje.textContent = 'Elige un jugador.'; return; }
    if (!(monto > 0)) { abonoMensaje.textContent = 'El monto tiene que ser mayor que cero.'; return; }

    try {
      await api('/api/cobros/abonos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jugadorId,
          concepto: document.getElementById('abonoConcepto').value,
          monto,
          nota: document.getElementById('abonoNota').value
        })
      });

      abonoMensaje.textContent = 'Abono anotado.';
      document.getElementById('abonoMonto').value = '';
      document.getElementById('abonoNota').value = '';
      await cargar();
    } catch (error) {
      abonoMensaje.textContent = error.message;
    }
  });

  cargar();
});

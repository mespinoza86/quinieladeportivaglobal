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
  const mensaje = document.getElementById('mensajeCobros');
  const abonoMensaje = document.getElementById('abonoMensaje');
  const selectorJugador = document.getElementById('abonoJugador');

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

    if (!cobraAlgo) {
      resumen.textContent = 'Sin cobros activos.';
      return;
    }

    const partes = [];
    if (datos.cobros.torneo.activo) partes.push('Torneo: ' + plata(datos.cobros.torneo.precio));
    if (datos.cobros.jornada.activo) partes.push('Jornada: ' + plata(datos.cobros.jornada.precio));
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

      if (c.jornada.activo) {
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
      }

      return html`<div class="info-card" data-jugador="${c.jugadorId}">
        <h3>${c.nombre}${c.tieneCuenta ? '' : ' (sin cuenta)'}</h3>
        ${crudo(lineas.join(''))}
        <label class="checkbox-fila">
          <input type="checkbox" class="juegaTorneo" data-jugador="${c.jugadorId}" ${c.juegaTorneo ? 'checked' : ''} />
          <span>Juega el torneo completo</span>
        </label>
      </div>`;
    }).join('');

    selectorJugador.innerHTML = cuentas
      .map(c => html`<option value="${c.jugadorId}">${c.nombre}</option>`)
      .join('');

    for (const casilla of listaCuentas.querySelectorAll('.juegaTorneo')) {
      casilla.addEventListener('change', async () => {
        try {
          await api('/api/cobros/jugadores/' + casilla.dataset.jugador, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ juegaTorneo: casilla.checked })
          });
          await cargar();
        } catch (error) {
          mensaje.textContent = error.message;
          casilla.checked = !casilla.checked;   // deshacer lo que no se guardó
        }
      });
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

  async function cargar() {
    try {
      mensaje.textContent = '';
      pintarCuentas(await api('/api/cobros/cuentas'));
      if (configuracion?.torneo.activo || configuracion?.jornada.activo) {
        pintarHistorial(await api('/api/cobros/abonos'));
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

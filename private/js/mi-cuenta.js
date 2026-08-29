/*
 * Mis pagos: el estado de cuenta que ve cada jugador de lo suyo.
 *
 * ============================================================================
 * QUE NO HAYA DUDA
 * ============================================================================
 *
 * Es lo que pidió el usuario con esas palabras. La pregunta que responde no es
 * «cuánto debo» —eso ya salía en la portada— sino **«de mi plata, adónde fue»**:
 * cuánto al premio de cada jornada y cuánto al bote acumulado.
 *
 * ⚠️ Los números NO se calculan aquí. Vienen de `/api/quiniela-actual/mi-cuenta`,
 * que usa la misma aritmética que la pantalla del administrador. Si esta página
 * sumara por su cuenta, algún día enseñaría una cifra distinta a la de él, y ése
 * es justo el día en que un estado de cuenta deja de servir para nada.
 *
 * ============================================================================
 * TRES ESTADOS POR JORNADA, NO DOS
 * ============================================================================
 *
 * `pagada` llega como `true`, `false` o **`null`** —«no aplica», porque no la
 * jugó—. Colapsarlos en un booleano es lo que producía el «sin pagar (₡0)» que
 * había en la portada: ni la debía, ni eran cero colones lo que no debía.
 */
document.addEventListener('DOMContentLoaded', () => {
  const mensaje = document.getElementById('reporteMensaje');
  const tabla = document.getElementById('tablaJornadas');
  const totales = document.getElementById('totales');

  /** Colones, sin decimales cuando no hacen falta. */
  const plata = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  async function api(url) {
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo cargar la cuenta.');
    return d;
  }

  document.getElementById('imprimir').addEventListener('click', () => window.print());

  function pintar(cuenta, quiniela) {
    document.getElementById('reporteQuiniela').textContent = quiniela?.nombre || 'Mis pagos';
    document.getElementById('reporteTitulo').textContent = cuenta.nombre || 'Mis pagos';

    if (!cuenta.cobra) {
      document.getElementById('apagadoPanel').hidden = false;
      return;
    }

    if (!cuenta.juega) {
      document.getElementById('apagadoPanel').hidden = false;
      document.getElementById('apagadoPanel').innerHTML =
        html`<p class="helper-text">Todavía no juegas en esta quiniela, así que no debes nada.</p>`;
      return;
    }

    document.getElementById('cuentaPanel').hidden = !cuenta.jornada?.activo;
    document.getElementById('totalesPanel').hidden = false;

    /* ---- Jornada por jornada ---- */

    const jornadas = cuenta.jornadas || [];
    let sumaPremio = 0;
    let sumaAcumulado = 0;
    let jugadas = 0;

    if (!jornadas.length) {
      tabla.innerHTML = html`<p class="helper-text">Todavía no hay jornadas.</p>`;
    } else {
      tabla.innerHTML = jornadas.map(j => {
        if (!j.jugada) {
          /*
           * Se enseña igualmente, y en gris. Omitirla dejaría un hueco en la
           * numeración que se lee como un error; decir «no la jugaste» cierra
           * la pregunta antes de que nadie la haga.
           */
          return html`<div class="info-card">
            <p class="helper-text"><strong>${j.nombre}</strong> — no la jugaste, no se te cobra</p>
          </div>`;
        }

        jugadas += 1;
        sumaPremio = sumaPremio + Number(j.alPremio || 0);
        sumaAcumulado = sumaAcumulado + Number(j.alAcumulado || 0);

        const desglose = Number(j.alAcumulado || 0) > 0
          ? ` (${plata(j.alPremio)} al premio + ${plata(j.alAcumulado)} al acumulado)`
          : '';

        return html`<div class="info-card">
          <p class="helper-text">
            <strong>${j.nombre}</strong> — ${plata(j.precio)}${desglose}
          </p>
          <p class="helper-text">${j.pagada ? 'Pagada ✅' : 'Sin pagar'}</p>
        </div>`;
      }).join('');
    }

    /* ---- El total ---- */

    const bloques = [];

    if (cuenta.torneo?.activo && cuenta.torneo.juega) {
      bloques.push(cuenta.torneo.pendiente > 0
        ? html`<p class="helper-text">Cuota del torneo: te faltan ${plata(cuenta.torneo.pendiente)}</p>`
        : html`<p class="helper-text">Cuota del torneo: al día ✅</p>`);
    }

    if (cuenta.jornada?.activo && cuenta.jornada.juega !== false) {
      bloques.push(html`<p class="helper-text">
        Jornadas jugadas: <strong>${jugadas}</strong> de ${jornadas.length}
      </p>`);

      bloques.push(html`<p class="helper-text">
        Te ha tocado pagar: <strong>${plata(cuenta.jornada.debe)}</strong>
      </p>`);

      if (sumaAcumulado > 0) {
        /*
         * El desglose es el motivo de esta pantalla: la pregunta que la gente
         * hace no es cuánto debe, es adónde fue lo que ya puso.
         */
        bloques.push(html`<p class="helper-text">
          De eso, ${plata(sumaPremio)} a los premios de jornada
          y <strong>${plata(sumaAcumulado)} al bote acumulado</strong>
        </p>`);
      }

      bloques.push(html`<p class="helper-text">
        Has abonado: <strong>${plata(cuenta.jornada.abonado)}</strong>
      </p>`);

      if (cuenta.jornada.saldo > 0) {
        bloques.push(html`<p class="helper-text">Saldo a favor: <strong>${plata(cuenta.jornada.saldo)}</strong></p>`);
      } else if (cuenta.jornada.saldo < 0) {
        bloques.push(html`<p class="helper-text">Debes: <strong>${plata(-cuenta.jornada.saldo)}</strong></p>`);
      } else {
        bloques.push(html`<p class="helper-text">Estás al día ✅</p>`);
      }
    }

    totales.innerHTML = bloques.join('');

    document.getElementById('reporteResumen').textContent =
      'Al ' + new Date().toLocaleDateString('es-CR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  (async () => {
    try {
      const [cuenta, quiniela] = await Promise.all([
        api('/api/quiniela-actual/mi-cuenta'),
        api('/api/quiniela-actual').catch(() => null)
      ]);
      pintar(cuenta, quiniela);
    } catch (error) {
      mensaje.textContent = error.message;
    }
  })();
});

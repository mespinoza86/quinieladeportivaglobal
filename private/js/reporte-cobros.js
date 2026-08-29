/*
 * Reporte de pagos: el estado de cuenta de toda la quiniela.
 *
 * ============================================================================
 * PARA LLEVAR ORDEN, Y PARA PODER COMPARTIRLO
 * ============================================================================
 *
 * Responde tres preguntas que la pantalla de Cobros no respondía:
 *
 *   1. ¿Cuánto hay juntado en total, y cuánto falta?
 *   2. Por jornada: ¿quién la jugó, cuánto se cobró de cuánto, y QUIÉN FALTA?
 *   3. Por persona: ¿qué jornadas jugó, cuánto le tocó, cuánto al premio y
 *      cuánto al acumulado?
 *
 * ⚠️ La tercera es la que pidió el usuario con estas palabras: «tener las
 * cuentas claras, que no haya duda».
 *
 * ============================================================================
 * ⛔ NADA SE CALCULA AQUÍ
 * ============================================================================
 *
 * Todos los números vienen de `/api/cobros/reporte`, que usa la misma
 * aritmética que la pantalla de cada jugador. Si esta página sumara por su
 * cuenta, algún día enseñaría una cifra distinta a la que ve la gente en su
 * teléfono, y ese día el reporte deja de servir para lo único que sirve.
 *
 * Lo único que se hace aquí es contar filas para las cabeceras.
 */
document.addEventListener('DOMContentLoaded', () => {
  const mensaje = document.getElementById('reporteMensaje');

  /** Colones, sin decimales cuando no hacen falta. */
  const plata = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  async function api(url) {
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo cargar el reporte.');
    return d;
  }

  document.getElementById('imprimir').addEventListener('click', () => window.print());

  function pintar(datos) {
    document.getElementById('reporteQuiniela').textContent =
      datos.quiniela?.nombre || 'Administración';

    document.getElementById('reporteFecha').textContent =
      'Al ' + new Date(datos.generadoEn).toLocaleDateString('es-CR',
        { day: 'numeric', month: 'long', year: 'numeric' });

    const cobraAlgo = datos.cobros.torneo.activo || datos.cobros.jornada.activo;
    document.getElementById('apagadoPanel').hidden = cobraAlgo;
    if (!cobraAlgo) return;

    document.getElementById('totalPanel').hidden = false;
    document.getElementById('jornadasPanel').hidden = !datos.cobros.jornada.activo;
    document.getElementById('jugadoresPanel').hidden = false;

    /* ---- 1. El torneo en total ---- */

    const jornadas = datos.jornadas || [];
    const premioCobrado = jornadas.reduce((t, j) => t + Number(j.premio || 0), 0);
    const premioEsperado = jornadas.reduce((t, j) => t + Number(j.premioEsperado || 0), 0);

    const lineas = [
      html`<p class="helper-text">
        Premios de jornada: <strong>${plata(premioCobrado)}</strong> cobrados de ${plata(premioEsperado)}
      </p>`,
      html`<p class="helper-text">
        Acumulado: <strong>${plata(datos.acumulado.disponible)}</strong> disponibles
        (juntado ${plata(datos.acumulado.cobrado)} de ${plata(datos.acumulado.esperado)})
      </p>`
    ];

    if (Number(datos.acumulado.entregado || 0) > 0) {
      lineas.push(html`<p class="helper-text">
        Ya entregado del acumulado: ${plata(datos.acumulado.entregado)}
      </p>`);
    }

    /*
     * Lo que falta por cobrar, en una línea. Es el número por el que pregunta
     * quien administra antes que por ningún otro.
     */
    const falta = (premioEsperado - premioCobrado)
      + (Number(datos.acumulado.esperado) - Number(datos.acumulado.cobrado));

    lineas.push(falta > 0
      ? html`<p class="helper-text">Falta por cobrar: <strong>${plata(falta)}</strong></p>`
      : html`<p class="helper-text">Todo el mundo está al día ✅</p>`);

    document.getElementById('totalTorneo').innerHTML = lineas.join('');

    /* ---- 2. Por jornada ---- */

    document.getElementById('tablaJornadas').innerHTML = jornadas.length
      ? jornadas.map(j => {
          const desglose = Number(j.alAcumulado) > 0
            ? ` (${plata(j.alPremio)} premio + ${plata(j.alAcumulado)} acumulado)`
            : '';

          /*
           * ⚠️ Los nombres de quien falta, no sólo el número. Un total que no
           * cuadra no dice a quién hay que preguntarle, que es lo único que se
           * puede hacer con esa información.
           */
          const deben = j.sinPagar.length
            ? html`<p class="helper-text">Falta que paguen: ${j.sinPagar.join(', ')}</p>`
            : html`<p class="helper-text">Todos al día ✅</p>`;

          return html`<div class="info-card">
            <h3>${j.nombre}</h3>
            <p class="helper-text">Cuota: ${plata(j.precio)}${desglose}</p>
            <p class="helper-text">La jugaron <strong>${j.jugaron}</strong> persona(s)</p>
            <p class="helper-text">
              Premio de la jornada: <strong>${plata(j.premio)}</strong> de ${plata(j.premioEsperado)}
            </p>
            ${crudo(deben)}
          </div>`;
        }).join('')
      : html`<p class="helper-text">Todavía no hay jornadas.</p>`;

    /* ---- 3. Por persona ---- */

    const jugadores = datos.jugadores || [];

    document.getElementById('tablaJugadores').innerHTML = jugadores.length
      ? jugadores.map(p => {
          const filas = [];

          if (datos.cobros.torneo.activo) {
            filas.push(p.juegaTorneo
              ? html`<p class="helper-text">
                  Torneo: ${p.torneo.pendiente > 0 ? 'debe ' + plata(p.torneo.pendiente) : 'al día ✅'}
                </p>`
              : html`<p class="helper-text">No juega el torneo completo</p>`);
          }

          if (datos.cobros.jornada.activo && !p.juegaJornadas) {
            filas.push(html`<p class="helper-text">No se le cobran las jornadas</p>`);
          } else if (datos.cobros.jornada.activo) {
            filas.push(html`<p class="helper-text">
              Jugó <strong>${p.jugadas}</strong> de ${p.jornadasDetalle.length} jornada(s)
            </p>`);

            filas.push(html`<p class="helper-text">
              Le ha tocado: <strong>${plata(p.jornada.debe)}</strong> ·
              abonado: ${plata(p.jornada.abonado)}
            </p>`);

            if (Number(p.alAcumulado) > 0) {
              filas.push(html`<p class="helper-text">
                De eso, ${plata(p.alPremio)} a premios y ${plata(p.alAcumulado)} al acumulado
              </p>`);
            }

            if (p.jornada.saldo < 0) {
              filas.push(html`<p class="helper-text"><strong>Debe ${plata(-p.jornada.saldo)}</strong></p>`);
            } else if (p.jornada.saldo > 0) {
              filas.push(html`<p class="helper-text">Saldo a favor: ${plata(p.jornada.saldo)}</p>`);
            } else {
              filas.push(html`<p class="helper-text">Al día ✅</p>`);
            }

            /*
             * El detalle jornada a jornada. Las que no jugó se dicen, no se
             * omiten: un hueco en la lista se lee como un error y genera la
             * pregunta que este reporte existe para evitar.
             */
            const detalle = p.jornadasDetalle.map(d => {
              if (!d.jugada) return `${d.nombre}: no la jugó`;
              return `${d.nombre}: ${plata(d.precio)} ${d.pagada ? '✅' : '(sin pagar)'}`;
            }).join(' · ');

            if (detalle) filas.push(html`<p class="helper-text">${detalle}</p>`);
          }

          return html`<div class="info-card">
            <h3>${p.nombre}${p.tieneCuenta ? '' : ' (sin cuenta)'}</h3>
            ${crudo(filas.join(''))}
          </div>`;
        }).join('')
      : html`<p class="helper-text">Todavía no hay jugadores.</p>`;
  }

  (async () => {
    try {
      pintar(await api('/api/cobros/reporte'));
    } catch (error) {
      mensaje.textContent = error.message;
    }
  })();
});

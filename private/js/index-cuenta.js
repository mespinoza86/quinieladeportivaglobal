/*
 * «Mis pagos», en la portada.
 *
 * Lo que el jugador quiere saber de un vistazo: si esta jornada le quedó
 * pagada y cuánto le queda por delante.
 *
 * ⚠️ Dos cosas se dicen con distinta certeza a propósito, y no se mezclan:
 *
 *   - **«Esta jornada está pagada» es EXACTO.** El precio de esa jornada ya
 *     está fijado, así que se puede afirmar.
 *   - **«Te alcanza para 3 más» es una ESTIMACIÓN**, y se muestra siempre con
 *     el precio con el que se calculó. La jornada que viene puede costar el
 *     doble —una final con premio grande—, y entonces no serían 3. Prometer un
 *     número que luego no se cumple es peor que no darlo.
 *
 * La tarjeta no aparece si la quiniela no cobra nada, que es el caso de todas
 * las que existían antes de esto.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const tarjeta = document.getElementById('miCuentaCard');
  const contenido = document.getElementById('miCuentaContenido');
  if (!tarjeta || !contenido) return;

  const plata = n => '₡' + Number(n || 0).toLocaleString('es-CR');

  try {
    const respuesta = await fetch('/api/quiniela-actual/mi-cuenta');
    if (!respuesta.ok) return;              // sin sesión o sin quiniela: no se pinta nada

    const cuenta = await respuesta.json();

    // Ni cobra la quiniela, ni esta persona juega todavía: no hay nada que decir.
    if (!cuenta.cobra || !cuenta.juega) return;

    const bloques = [];

    if (cuenta.torneo?.activo && cuenta.torneo.juega) {
      bloques.push(cuenta.torneo.pendiente > 0
        ? html`<p class="helper-text">Cuota del torneo: te faltan ${plata(cuenta.torneo.pendiente)}</p>`
        : html`<p class="helper-text">Cuota del torneo: al día ✅</p>`);
    }

    if (cuenta.jornada?.activo) {
      /* La última que le toca es la que le interesa: la que se está jugando. */
      const suyas = cuenta.jornadas || [];
      const actual = suyas[suyas.length - 1];

      if (actual) {
        bloques.push(actual.pagada
          ? html`<p class="helper-text"><strong>${actual.nombre}</strong>: pagada ✅</p>`
          : html`<p class="helper-text"><strong>${actual.nombre}</strong>: sin pagar (${plata(actual.precio)})</p>`);
      }

      if (cuenta.jornada.saldo > 0) {
        const cuantas = cuenta.jornada.jornadasQueCubre;
        const cuantasTexto = cuantas === 1 ? '1 jornada más' : `${cuantas} jornadas más`;

        bloques.push(html`<p class="helper-text">
          Saldo a favor: ${plata(cuenta.jornada.saldo)}${
            cuantas === null ? '' : ` — te alcanza para ${cuantasTexto} al precio de hoy (${plata(cuenta.jornada.precioActual)})`
          }</p>`);
      } else if (cuenta.jornada.saldo < 0) {
        bloques.push(html`<p class="helper-text">Debes ${plata(-cuenta.jornada.saldo)} de jornadas.</p>`);
      }
    }

    if (!bloques.length) return;

    contenido.innerHTML = bloques.join('');
    tarjeta.hidden = false;
  } catch (error) {
    /*
     * Si esto falla no se avisa: es información de apoyo en la portada, y una
     * tarjeta de error donde debería ir un saldo asusta más de lo que informa.
     */
    console.error('No se pudo cargar la cuenta:', error);
  }
});

/*
 * La pantalla del superadministrador.
 *
 * ⚠️ Todas las secciones arrancan ocultas en el HTML y aquí se enseña una sola
 * cada vez. Es la lección de la Entrada 062: un estado por defecto es una
 * decisión aunque nadie la haya tomado, y si algo falla a mitad se queda puesto
 * lo que hubiera. En esta pantalla eso importa más que en ninguna otra, porque
 * lo que se enseña son los correos de todas las personas del sistema.
 *
 * ⚠️ Y ninguna decisión de permisos se toma aquí. El navegador sólo pinta: la
 * guardia de verdad está en `requireSuperadmin`, en el servidor, y se aplica en
 * cada ruta. Si alguien abre esta pantalla a mano, no verá nada, porque los
 * datos no llegan.
 */
document.addEventListener('DOMContentLoaded', () => {
  const secciones = ['confirmarPanel', 'cuentasPanel', 'historialPanel', 'errorPanel'];

  const mostrarSolo = (...cuales) => {
    for (const id of secciones) {
      const seccion = document.getElementById(id);
      if (seccion) seccion.hidden = !cuales.includes(id);
    }
  };

  const resumen = document.getElementById('resumenCuentas');
  const listado = document.getElementById('listado');
  const historial = document.getElementById('historial');

  /**
   * Pide JSON y explica lo que pase.
   *
   * Comprueba el `content-type` antes de interpretar: si el servidor devuelve
   * una página de error en HTML, `response.json()` revienta con un error de
   * sintaxis que no ayuda a nadie (Entrada 062).
   */
  async function pedirJson(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones
    });

    const tipo = respuesta.headers.get('content-type') || '';
    if (!tipo.includes('application/json')) {
      throw new Error(`El servidor respondió ${respuesta.status} sin datos.`);
    }

    const cuerpo = await respuesta.json();

    if (!respuesta.ok) {
      const error = new Error(cuerpo.error || `Error ${respuesta.status}`);
      error.status = respuesta.status;
      error.requiereConfirmacion = cuerpo.requiereConfirmacion === true;
      throw error;
    }
    return cuerpo;
  }

  function fallar(mensaje) {
    document.getElementById('errorTexto').textContent = mensaje;
    mostrarSolo('errorPanel');
  }

  /* ---------- La puerta ---------- */

  async function confirmar() {
    const password = document.getElementById('password').value;
    const aviso = document.getElementById('confirmarError');

    aviso.hidden = true;

    try {
      await pedirJson('/api/superadmin/confirmar', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      document.getElementById('password').value = '';
      await cargar();
    } catch (error) {
      aviso.textContent = error.message;
      aviso.hidden = false;
    }
  }

  document.getElementById('confirmarBtn').addEventListener('click', confirmar);
  document.getElementById('password').addEventListener('keydown', evento => {
    if (evento.key === 'Enter') confirmar();
  });

  document.getElementById('reintentarBtn').addEventListener('click', () => cargar());

  /* ---------- Pintar ---------- */

  const fecha = valor => new Date(valor).toLocaleDateString('es-CR',
    { year: 'numeric', month: 'short', day: 'numeric' });

  /* `.info-card` y `.danger-button` ya existen: se reusan en vez de inventar
   * clases nuevas, que es la lección de la Entrada 060. */
  function pintarQuinielas(quinielas) {
    if (!quinielas.length) {
      return html`<p class="helper-text">Sin quinielas.</p>`;
    }

    return html`${quinielas.map(q =>
      html`<p class="helper-text">${q.nombre} — <strong>${q.rol}</strong> (${q.estado})</p>`)}`;
  }

  function pintarCuenta(cuenta) {
    /*
     * Un superadministrador se marca y no trae botones: no se puede retirar a
     * otro desde aquí, hay que quitarlo de la variable en Render. El servidor
     * lo rechaza igual; esto sólo evita ofrecer algo que no se puede hacer.
     */
    const acciones = cuenta.esSuperadmin
      ? html`<p class="helper-text">🛡️ Superadministrador. Se cambia en Render, no aquí.</p>`
      /*
       * ⚠️ Botones EN LÍNEA y pequeños, no tres barras a todo el ancho.
       *
       * La regla global `input, select, button, textarea { width: 100% }` los
       * estiraba, y con treinta cuentas la lista se volvía kilométrica: cada
       * ficha ocupaba más en botones que en información. Es la misma regla que
       * rompía las casillas de verificación en la Entrada 060.
       *
       * Y sólo «Borrar» va en rojo. Las otras dos no son la acción principal de
       * nada: pintarlas en verde de acción primaria invita a pulsarlas, y
       * «Liberar correo» es irreversible.
       */
      : html`<div class="acciones-cuenta">
          ${cuenta.activo
            ? html`<button data-accion="desactivar" data-id="${cuenta.id}">Desactivar</button>`
            : html`<button data-accion="reactivar" data-id="${cuenta.id}">Reactivar</button>`}
          <button data-accion="liberar-correo" data-id="${cuenta.id}">Liberar correo</button>
          <button class="danger-button" data-accion="borrar" data-id="${cuenta.id}">Borrar</button>
        </div>`;

    /*
     * ⚠️ El estado de confirmación va en su PROPIA insignia, no de corrido con
     * el resto.
     *
     * La primera versión pintaba «✅ activa · confirmada · alta 24 ago» todo
     * seguido, en gris y del mismo tamaño. Dos cosas distintas —si puede entrar
     * y si confirmó su correo— se leían como una sola, y el emoji del primero
     * hacía que el ojo diera por leído el segundo. El usuario dijo que no veía
     * cuáles estaban sin confirmar, y tenía razón: el dato estaba y no se veía.
     *
     * Es la lección de la Entrada 060: con dos cuentas se adivina; con treinta,
     * no. Lo que hay que destacar es lo EXCEPCIONAL —sin confirmar—, no lo
     * normal.
     */
    const confirmacion = cuenta.emailVerificado
      ? html`<span class="status-pill status-live">✅ confirmado</span>`
      : html`<span class="status-pill status-scheduled">✉️ SIN CONFIRMAR</span>`;

    /* Sólo se marca lo excepcional: una cuenta activa es lo normal y no
     * necesita insignia. Marcar todo es no marcar nada. */
    const actividad = cuenta.activo
      ? ''
      : html`<span class="status-pill status-desactivada">⛔ desactivada</span>`;

    return html`<div class="info-card">
      <h3>${cuenta.username}</h3>
      <p class="helper-text">${cuenta.email}</p>
      <p>${confirmacion} ${actividad}</p>
      <p class="helper-text">Alta: ${fecha(cuenta.creadaEn)}</p>
      ${pintarQuinielas(cuenta.quinielas)}
      ${acciones}
    </div>`;
  }

  function pintarHistorial(filas) {
    if (!filas.length) {
      historial.innerHTML = html`<p class="helper-text">Todavía no hay acciones.</p>`;
      return;
    }

    historial.innerHTML = html`${filas.map(f => html`
      <p class="helper-text">
        <strong>${fecha(f.fecha)}</strong> · ${f.actorEmail}<br />
        ${f.accion} → ${f.objetivoEmail} (${f.objetivoUsername})
        ${f.objetivoExiste ? '' : ' · cuenta ya borrada'}<br />
        <em>${f.motivo}</em>
      </p>`)}`;
  }

  /* ---------- Las acciones ---------- */

  const TEXTOS = {
    desactivar: 'Se desactiva la cuenta: deja de poder entrar y se cierran sus sesiones. Es reversible.',
    reactivar: 'Vuelve a poder entrar.',
    'liberar-correo': 'Su dirección queda libre para registrarse de nuevo, y la cuenta se desactiva. NO es reversible.',
    borrar: 'Se borra la cuenta. NO es reversible.'
  };

  async function ejecutar(accion, id) {
    const motivo = prompt(`${TEXTOS[accion]}\n\n¿Por qué? (queda en el registro)`);
    if (motivo === null) return;

    const ruta = accion === 'borrar'
      ? `/api/superadmin/cuentas/${id}`
      : `/api/superadmin/cuentas/${id}/${accion}`;

    const opciones = {
      method: accion === 'borrar' ? 'DELETE' : 'POST',
      body: JSON.stringify({ motivo })
    };

    try {
      await pedirJson(ruta, opciones);
      await cargar();
    } catch (error) {
      /*
       * ⚠️ El servidor rechaza el borrado de quien tiene historial de juego y
       * explica por qué. Aquí se ofrece la salida —desvincular— con lo que
       * significa, en vez de repetir el error. La segunda pulsación es distinta
       * de la primera a propósito: es la única acción irreversible que se lleva
       * algo por delante.
       */
      if (accion === 'borrar' && error.status === 409 && /desvincular/i.test(error.message)) {
        if (!confirm(`${error.message}\n\n¿Desvincular y borrar la cuenta?`)) return;

        try {
          await pedirJson(ruta, {
            method: 'DELETE',
            body: JSON.stringify({ motivo, desvincularJugadores: true })
          });
          await cargar();
          return;
        } catch (segundo) {
          alert(segundo.message);
          return;
        }
      }
      alert(error.message);
    }
  }

  listado.addEventListener('click', evento => {
    const boton = evento.target.closest('[data-accion]');
    if (boton) ejecutar(boton.dataset.accion, boton.dataset.id);
  });

  /* ---------- Carga ---------- */

  let buscando = null;
  let filtroActual = 'todas';

  document.getElementById('buscar').addEventListener('input', evento => {
    clearTimeout(buscando);
    const texto = evento.target.value;
    buscando = setTimeout(() => cargarCuentas(texto), 300);
  });

  document.getElementById('filtros').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-filtro]');
    if (!boton) return;

    filtroActual = boton.dataset.filtro;

    for (const otro of document.querySelectorAll('#filtros [data-filtro]')) {
      otro.classList.toggle('filtro-activo', otro === boton);
    }

    cargarCuentas(document.getElementById('buscar').value);
  });

  const VACIO = {
    todas: 'Ninguna cuenta coincide.',
    sin_confirmar: 'Nadie tiene el correo sin confirmar. 👍',
    desactivadas: 'No hay ninguna cuenta desactivada.'
  };

  async function cargarCuentas(buscar = '') {
    const datos = await pedirJson('/api/superadmin/cuentas'
      + `?buscar=${encodeURIComponent(buscar)}&filtro=${encodeURIComponent(filtroActual)}`);

    /*
     * ⚠️ El resumen y los rótulos salen de `conteos`, que el servidor calcula
     * SIN el filtro puesto. Contar sobre lo filtrado daría «Sin confirmar (0)»
     * estando dentro de ese mismo filtro.
     */
    const c = datos.conteos || { todas: datos.total, sin_confirmar: 0, desactivadas: 0 };

    resumen.textContent = c.sin_confirmar
      ? `${c.todas} cuenta(s) · ${c.sin_confirmar} sin confirmar`
      : `${c.todas} cuenta(s) · todas confirmadas`;

    for (const boton of document.querySelectorAll('#filtros [data-filtro]')) {
      const cuantas = c[boton.dataset.filtro] ?? 0;
      const base = boton.dataset.rotulo || (boton.dataset.rotulo = boton.textContent.trim());
      boton.textContent = `${base} (${cuantas})`;
    }

    listado.innerHTML = datos.cuentas.length
      ? html`${datos.cuentas.map(pintarCuenta)}`
      : html`<p class="helper-text">${VACIO[filtroActual] || VACIO.todas}</p>`;
  }

  async function cargar() {
    try {
      const quien = await pedirJson('/api/superadmin/quien-soy');

      if (!quien.esSuperadmin) {
        fallar('No tienes acceso a esta sección.');
        return;
      }

      if (!quien.confirmado) {
        mostrarSolo('confirmarPanel');
        document.getElementById('password').focus();
        return;
      }

      await cargarCuentas(document.getElementById('buscar').value);
      pintarHistorial(await pedirJson('/api/superadmin/acciones?limite=25'));

      mostrarSolo('cuentasPanel', 'historialPanel');
    } catch (error) {
      // Que la contraseña haya caducado no es un fallo: es la puerta pidiéndose.
      if (error.requiereConfirmacion) {
        mostrarSolo('confirmarPanel');
        document.getElementById('password').focus();
        return;
      }
      fallar(error.message);
    }
  }

  cargar();
});

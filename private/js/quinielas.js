/*
 * «Mis quinielas»: la pantalla de después de entrar.
 *
 * ============================================================================
 * ⛔ EL ORDEN DE LAS SECCIONES DEPENDE DE QUIÉN MIRA
 * ============================================================================
 *
 * Hasta el 11 de septiembre el orden estaba escrito en el HTML —crear, unirse,
 * lista— y era el mismo para todos. Marco lo reportó con un síntoma concreto:
 * **hubo gente que, intentando entrar a su quiniela, creó otras**, porque lo
 * primero que se encontraban era un formulario de crear.
 *
 * Ahora:
 *
 *   - Si hay algo que enseñar  →  la lista PRIMERO, luego unirse, luego crear.
 *   - Si no hay nada           →  unirse primero, crear después, y la lista ni
 *                                 aparece: no tiene nada que decir.
 *
 * «Algo que enseñar» incluye **una solicitud pendiente**. Fue la respuesta de
 * Marco y es la correcta: a quien está esperando aprobación hay que enseñarle
 * que su solicitud está en camino, porque si le pones «Unirme» delante vuelve a
 * meter el código — que es la misma confusión con otra cara.
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const shell = document.getElementById('shell');
  const lista = document.getElementById('listaQuinielas');
  const mensaje = document.getElementById('mensajeQuinielas');
  const heroTexto = document.getElementById('heroTexto');

  const paneles = {
    lista: document.getElementById('panelLista'),
    unirse: document.getElementById('panelUnirse'),
    crear: document.getElementById('panelCrear')
  };

  /*
   * Los estados de membresía que hacen que valga la pena enseñar la lista.
   *
   * ⚠️ `rechazado` y `expulsado` NO están, y es a propósito: quien sólo tiene
   * filas así no pertenece a ninguna parte, y lo que necesita es el formulario
   * de unirse. Enseñarle «expulsado» como primera cosa de la pantalla no le
   * resuelve nada.
   */
  const VALE_LA_PENA = ['activo', 'pendiente_retiro', 'pendiente_ingreso'];

  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Sesión finalizada.');
    }
    if (!response.ok) throw new Error(data.error || 'La operación no pudo completarse.');
    return data;
  }

  /**
   * Coloca las secciones en el orden que toca y las enseña.
   *
   * ⚠️ El orden se hace **moviendo los nodos** con `appendChild`, no con
   * `order` de CSS. `.mobile-shell` no es un contenedor flexible, así que
   * `order` no haría nada; y tener dos formas de colocar lo mismo —una en el
   * CSS y otra aquí— es como se llegó al panel invisible que ocupaba 189
   * píxeles de la Entrada 077.
   *
   * `appendChild` sobre un nodo que ya está en el documento lo MUEVE, no lo
   * duplica. Por eso basta con recorrer el orden deseado.
   */
  function colocar(orden) {
    for (const clave of orden) {
      shell.appendChild(paneles[clave]);
      paneles[clave].hidden = false;
    }

    /*
     * ⚠️ Y lo que no está en el orden se esconde AQUÍ, en la misma función.
     *
     * La primera versión decidía el orden en un sitio y escondía en otro, y con
     * eso ya había dos puntos que tenían que ponerse de acuerdo sobre lo mismo.
     * Esa es la forma exacta de la deuda que se arrastra: basta con que uno de
     * los dos cambie para que la pantalla enseñe un panel que no toca, sin que
     * nada falle.
     */
    for (const clave of Object.keys(paneles)) {
      if (!orden.includes(clave)) paneles[clave].hidden = true;
    }

    // El mensaje y el botón de salir se quedan al final, pase lo que pase.
    shell.appendChild(mensaje);
    shell.appendChild(document.getElementById('cerrarSesion'));
  }

  function tarjetaDe(q) {
    const card = document.createElement('article');
    card.className = 'action-card';

    const puedeEntrar = ['activo', 'pendiente_retiro'].includes(q.estadoMembresia);

    card.innerHTML = html`<div><h3>${q.nombre}</h3><p>${q.rol} · ${q.estadoMembresia} · ${q.estadoQuiniela}</p>${q.codigoIngreso ? html`<p>Código: <strong>${q.codigoIngreso}</strong></p>` : ''}</div>`;

    if (!puedeEntrar) {
      /*
       * Quien está esperando aprobación ve por qué no puede entrar todavía. Sin
       * esta línea, su tarjeta es igual que las demás pero sin botón, y eso
       * parece un fallo de la pantalla en vez de un estado de su solicitud.
       */
      if (q.estadoMembresia === 'pendiente_ingreso') {
        const espera = document.createElement('p');
        espera.className = 'helper-text';
        espera.textContent = 'Tu solicitud está en espera de aprobación.';
        card.appendChild(espera);
      }
      return card;
    }

    const entrar = document.createElement('button');
    entrar.type = 'button';
    entrar.textContent = 'Entrar';
    entrar.addEventListener('click', async () => {
      try {
        await api(`/api/quinielas/${q.id}/seleccionar`, { method: 'POST' });
        window.location.href = '/index.html';
      } catch (error) { mensaje.textContent = error.message; }
    });
    card.appendChild(entrar);

    if (q.rol !== 'propietario' && q.estadoMembresia === 'activo') {
      const retirar = document.createElement('button');
      retirar.type = 'button';
      retirar.className = 'ghost-button';
      retirar.textContent = 'Solicitar retiro';
      retirar.addEventListener('click', async () => {
        try {
          await api(`/api/quinielas/${q.id}/seleccionar`, { method: 'POST' });
          await api('/api/quiniela-actual/solicitar-retiro', { method: 'POST' });
          mensaje.textContent = 'Solicitud de retiro enviada.';
          await cargar();
        } catch (error) { mensaje.textContent = error.message; }
      });
      card.appendChild(retirar);
    }

    return card;
  }

  async function cargar() {
    try {
      const [sesion, quinielas] = await Promise.all([api('/api/auth/me'), api('/api/quinielas')]);
      document.getElementById('cuentaActual').textContent = sesion.usuario.username;

      lista.innerHTML = '';
      quinielas.forEach(q => lista.appendChild(tarjetaDe(q)));

      const hayAlgo = quinielas.some(q => VALE_LA_PENA.includes(q.estadoMembresia));

      heroTexto.textContent = hayAlgo
        ? 'Entra a tu quiniela. Arriba, la última que usaste.'
        : 'Para jugar en una quiniela que ya existe, pide el código a quien la administra.';

      /*
       * ⚠️ El orden se recalcula en CADA carga, no sólo en la primera: quien se
       * une desde aquí pasa de «no tengo nada» a «tengo una solicitud», y la
       * pantalla tiene que reordenarse sola para enseñársela.
       *
       * Los tres casos, en un solo sitio:
       *
       *   - Tiene algo vivo            → su quiniela primero.
       *   - Sólo rechazos o expulsiones→ los formularios primero, y la lista al
       *                                  final: se enseña, pero no manda.
       *   - No tiene nada              → los formularios, y la lista ni aparece.
       */
      colocar(
        hayAlgo ? ['lista', 'unirse', 'crear']
          : quinielas.length ? ['unirse', 'crear', 'lista']
            : ['unirse', 'crear']);
    } catch (error) {
      mensaje.textContent = error.message;
      heroTexto.textContent = 'No se pudo cargar tu lista de quinielas.';
      /*
       * Si la carga falla, los formularios se enseñan igual y en el orden
       * neutro: una pantalla en blanco no deja a nadie hacer nada, y unirse
       * sigue siendo lo más probable que quiera hacer quien llega aquí.
       */
      colocar(['unirse', 'crear']);
    }
  }

  document.getElementById('crearQuinielaForm').addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';
    try {
      await api('/api/quinielas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: document.getElementById('nombreQuiniela').value })
      });
      window.location.href = '/index.html';
    } catch (error) { mensaje.textContent = error.message; }
  });

  document.getElementById('unirseForm').addEventListener('submit', async event => {
    event.preventDefault();
    mensaje.textContent = '';
    try {
      const data = await api('/api/quinielas/unirse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoIngreso: document.getElementById('codigoIngreso').value })
      });
      mensaje.textContent = data.message;
      event.target.reset();
      await cargar();
    } catch (error) { mensaje.textContent = error.message; }
  });

  document.getElementById('cerrarSesion').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  await cargar();
});

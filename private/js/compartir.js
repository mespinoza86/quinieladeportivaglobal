/*
 * La pantalla que prepara los mensajes del grupo.
 *
 * ============================================================================
 * QUÉ AUTOMATIZA Y QUÉ NO
 * ============================================================================
 *
 * Compartir los pronósticos de un partido eran cinco pasos —abrir la pantalla,
 * elegir jornada, elegir partido, copiar, enviar— repetidos partido por
 * partido. Aquí se quitan los cuatro primeros: el servidor dice qué partidos
 * arrancaron y no se han compartido, y este archivo arma el texto.
 *
 * ⛔ **El quinto no se puede quitar.** No hay forma oficial de que un programa
 * escriba en un grupo de WhatsApp, y `wa.me` tampoco admite apuntar a un grupo
 * concreto: abre la lista de chats para que la persona elija. Las librerías que
 * sí lo consiguen incumplen los términos de WhatsApp y arriesgan el bloqueo del
 * número, y por eso se descartaron.
 *
 * ============================================================================
 * ⚠️ LA VENTANA SE ABRE ANTES DEL `await`, Y NO ES UN CAPRICHO
 * ============================================================================
 *
 * `window.open` sólo se permite mientras dura el gesto de la persona. Después
 * de un `await`, el navegador ya no lo considera respuesta a un clic y lo
 * bloquea **sin decir nada**: el mensaje no se abriría y la pantalla se quedaría
 * tan tranquila. Por eso se abre primero y se marca después.
 *
 * Ése es también el motivo de que el texto se arme aquí y no se pida al pulsar:
 * si hubiera que ir a buscarlo, el `await` llegaría antes que la ventana.
 */
'use strict';

/** Lo que devolvió la última consulta al servidor. */
let estado = { ventanaHoras: 12, grupos: [] };

document.addEventListener('DOMContentLoaded', () => {
  const resumen = document.getElementById('resumenCompartir');
  const mensaje = document.getElementById('mensajeCompartir');
  const notaVentana = document.getElementById('notaVentana');

  const paneles = {
    pendientes: document.getElementById('pendientesPanel'),
    vacio: document.getElementById('vacioPanel'),
    compartidos: document.getElementById('compartidosPanel')
  };

  const listas = {
    pendientes: document.getElementById('listaPendientes'),
    compartidos: document.getElementById('listaCompartidos')
  };

  /* ==================== El texto del mensaje ==================== */

  /**
   * La línea de una persona en un partido.
   *
   * ⚠️ Los dos marcadores pasan por `marcadorVisible` **con su `oculto`**. Hoy
   * ese campo llega siempre en `false` —sólo se proponen partidos que ya
   * empezaron, y un partido empezado es público— pero respetarlo es lo que
   * impide que un cambio futuro en el filtro del servidor mande al grupo
   * pronósticos que todavía son secretos (Entrada 068).
   *
   * Y quien no pronosticó sale dicho con palabras, no como «– - –», que no
   * significa nada para quien lee el mensaje en el teléfono.
   */
  function lineaDeJugador(p) {
    const m1 = marcadorVisible(p.marcador1, p.oculto);
    const m2 = marcadorVisible(p.marcador2, p.oculto);

    const sinPronostico = m1 === MARCADOR_SIN_PRONOSTICO && m2 === MARCADOR_SIN_PRONOSTICO;

    return sinPronostico
      ? `${p.jugador}: sin pronóstico`
      : `${p.jugador}: ${m1} - ${m2}`;
  }

  /** El mensaje entero de un grupo de partidos. */
  function textoDe(grupo) {
    const lineas = [
      '-------------------------------',
      `Jornada: ${grupo.jornada}`,
      `Hora: ${horaDe(grupo.apiDate)}`,
      '-------------------------------'
    ];

    for (const partido of grupo.partidos) {
      lineas.push('', `⚽ ${partido.equipo1} vs ${partido.equipo2}`);
      for (const p of partido.pronosticos) lineas.push(lineaDeJugador(p));
    }

    return lineas.join('\n');
  }

  /*
   * `api_date` viene como «YYYY-MM-DD HH:MM» en hora de Costa Rica. Se corta el
   * texto en vez de construir un `Date`: convertirlo a objeto lo pasaría por la
   * zona horaria del teléfono y un móvil configurado en otro país enseñaría una
   * hora distinta de la que dice la jornada.
   */
  function horaDe(apiDate) {
    const partes = String(apiDate || '').split(' ');
    return partes[1] || String(apiDate || '');
  }

  function fechaDe(apiDate) {
    return String(apiDate || '').split(' ')[0] || '';
  }

  /* ==================== Pintar ==================== */

  function tarjeta(grupo) {
    const cuantos = grupo.partidos.length;
    const texto = textoDe(grupo);

    const botones = grupo.compartido
      ? html`
          <button class="secondary-button" data-accion="enviar" data-clave="${grupo.clave}">
            Volver a enviar
          </button>
          <button class="ghost-button" data-accion="desmarcar" data-clave="${grupo.clave}">
            Volver a pendientes
          </button>`
      : html`
          <button data-accion="enviar" data-clave="${grupo.clave}">
            Enviar por WhatsApp
          </button>
          <button class="secondary-button" data-accion="copiar" data-clave="${grupo.clave}">
            Copiar
          </button>
          <button class="ghost-button" data-accion="marcar" data-clave="${grupo.clave}">
            Ya lo mandé
          </button>`;

    return html`
      <article class="lista-item">
        <h3>${grupo.jornada} — ${horaDe(grupo.apiDate)}</h3>
        <p class="helper-text">
          ${fechaDe(grupo.apiDate)} · ${cuantos} ${cuantos === 1 ? 'partido' : 'partidos'}
        </p>
        <details>
          <summary>Ver el mensaje</summary>
          <textarea rows="10" readonly>${texto}</textarea>
        </details>
        <div class="button-stack">${botones}</div>
      </article>`;
  }

  function pintar() {
    const pendientes = estado.grupos.filter(g => !g.compartido);
    const compartidos = estado.grupos.filter(g => g.compartido);

    resumen.textContent = pendientes.length
      ? `${pendientes.length} ${pendientes.length === 1 ? 'mensaje listo' : 'mensajes listos'} para mandar.`
      : 'Todo al día: no hay nada pendiente de mandar.';

    notaVentana.textContent =
      `Se proponen los partidos que arrancaron en las últimas ${estado.ventanaHoras} horas.`;

    listas.pendientes.innerHTML = html`${pendientes.map(tarjeta)}`;
    listas.compartidos.innerHTML = html`${compartidos.map(tarjeta)}`;

    paneles.pendientes.hidden = pendientes.length === 0;
    paneles.vacio.hidden = pendientes.length > 0;
    paneles.compartidos.hidden = compartidos.length === 0;
  }

  /* ==================== Hablar con el servidor ==================== */

  async function cargar() {
    try {
      const res = await fetch('/api/compartir/pendientes');
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);

      estado = await res.json();
      pintar();
    } catch (err) {
      console.error('Error cargando lo que hay para compartir:', err);
      resumen.textContent = 'No se pudo consultar qué hay para compartir.';
      mensaje.textContent = 'Vuelve a intentarlo con «Volver a mirar».';
    }
  }

  async function cambiarMarca(ruta, grupo) {
    const res = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partidoIds: grupo.partidoIds })
    });

    if (!res.ok) {
      const cuerpo = await res.json().catch(() => ({}));
      throw new Error(cuerpo.error || `El servidor respondió ${res.status}`);
    }
  }

  /* ==================== Los botones ==================== */

  function grupoDe(clave) {
    return estado.grupos.find(g => g.clave === clave) || null;
  }

  async function alPulsar(evento) {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;

    const grupo = grupoDe(boton.dataset.clave);
    if (!grupo) return;

    mensaje.textContent = '';

    try {
      if (boton.dataset.accion === 'copiar') {
        await navigator.clipboard.writeText(textoDe(grupo));
        mensaje.textContent = 'Mensaje copiado. Pégalo en el grupo.';
        return;
      }

      if (boton.dataset.accion === 'enviar') {
        /*
         * ⚠️ Primero la ventana, después el `await`. Ver la cabecera: pasado el
         * gesto, el navegador bloquea la apertura sin avisar de nada.
         */
        window.open(`https://wa.me/?text=${encodeURIComponent(textoDe(grupo))}`, '_blank');

        if (!grupo.compartido) {
          await cambiarMarca('/api/compartir/marcar', grupo);
          mensaje.textContent = 'Anotado como mandado. Si al final no salió, '
            + 'devuélvelo con «Volver a pendientes».';
        }
        await cargar();
        return;
      }

      if (boton.dataset.accion === 'marcar') {
        await cambiarMarca('/api/compartir/marcar', grupo);
        await cargar();
        return;
      }

      if (boton.dataset.accion === 'desmarcar') {
        await cambiarMarca('/api/compartir/desmarcar', grupo);
        await cargar();
      }
    } catch (err) {
      console.error('Error compartiendo:', err);
      mensaje.textContent = err.message || 'No se pudo completar la acción.';
    }
  }

  /*
   * Un solo escuchador por lista, no uno por botón. Con veinte grupos serían
   * sesenta escuchadores que hay que volver a poner en cada repintado, y es el
   * problema que ya tiene la pantalla de cobros (Entrada 083).
   */
  listas.pendientes.addEventListener('click', alPulsar);
  listas.compartidos.addEventListener('click', alPulsar);
  document.getElementById('recargarButton').addEventListener('click', cargar);

  cargar();
});

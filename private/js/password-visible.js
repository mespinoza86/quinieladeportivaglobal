/*
 * Ojo para mostrar u ocultar la contraseña, en todos los campos de la aplicación.
 *
 * Se aplica solo: recorre los `input[type="password"]` de la página y les monta
 * el botón encima. Se hizo así, y no repitiendo el mismo marcado en las nueve
 * pantallas que tienen campos de contraseña, para que un campo nuevo lo herede
 * sin que nadie tenga que acordarse de añadirlo.
 *
 * El icono muestra la ACCIÓN, no el estado: con la contraseña oculta se ve un
 * ojo abierto —"pulsa para verla"— y con la contraseña a la vista, el ojo
 * tachado. Es la convención de los navegadores y de los gestores de claves.
 */
(function () {
  const SVG = 'http://www.w3.org/2000/svg';

  /**
   * El ojo, dibujado a mano con createElementNS.
   *
   * No es `innerHTML` a propósito: es marcado constante y no habría riesgo
   * real, pero el proyecto está retirando `innerHTML` del frontend (S-04) y no
   * tiene sentido añadir uno nuevo mientras tanto.
   */
  function crearIcono(tachado) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const contorno = document.createElementNS(SVG, 'path');
    contorno.setAttribute('d', 'M1.8 12S5.4 5.8 12 5.8 22.2 12 22.2 12 18.6 18.2 12 18.2 1.8 12 1.8 12Z');
    svg.appendChild(contorno);

    const pupila = document.createElementNS(SVG, 'circle');
    pupila.setAttribute('cx', '12');
    pupila.setAttribute('cy', '12');
    pupila.setAttribute('r', '3');
    svg.appendChild(pupila);

    if (tachado) {
      const linea = document.createElementNS(SVG, 'line');
      linea.setAttribute('x1', '3.5');
      linea.setAttribute('y1', '3.5');
      linea.setAttribute('x2', '20.5');
      linea.setAttribute('y2', '20.5');
      svg.appendChild(linea);
    }

    return svg;
  }

  function activar(input) {
    // Una pantalla podría cargar el script dos veces; que no se monte doble.
    if (input.dataset.ojoMontado === '1') return;
    input.dataset.ojoMontado = '1';

    const contenedor = document.createElement('div');
    contenedor.className = 'password-field';
    input.parentNode.insertBefore(contenedor, input);
    contenedor.appendChild(input);

    const boton = document.createElement('button');
    boton.type = 'button';           // Sin esto, dentro de un <form> enviaría el formulario.
    boton.className = 'password-toggle';
    if (input.id) boton.setAttribute('aria-controls', input.id);

    let visible = false;

    function pintar() {
      input.type = visible ? 'text' : 'password';
      boton.replaceChildren(crearIcono(visible));

      const etiqueta = visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña';
      boton.setAttribute('aria-label', etiqueta);
      boton.setAttribute('aria-pressed', String(visible));
      boton.title = etiqueta;
    }

    boton.addEventListener('click', () => {
      /*
       * Cambiar el `type` mueve el cursor al final. Se guarda la posición y se
       * restaura, porque lo normal es pulsar el ojo a mitad de escribir para
       * comprobar lo que se lleva tecleado.
       */
      let posicion = null;
      try {
        posicion = input.selectionStart;
      } catch (error) {
        // Algunos navegadores no exponen la selección en campos de contraseña.
        posicion = null;
      }

      visible = !visible;
      pintar();

      input.focus();
      if (posicion !== null) {
        try {
          input.setSelectionRange(posicion, posicion);
        } catch (error) {
          /* Da igual: el campo ya tiene el foco. */
        }
      }
    });

    pintar();
    contenedor.appendChild(boton);
  }

  function montar() {
    document.querySelectorAll('input[type="password"]').forEach(activar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();

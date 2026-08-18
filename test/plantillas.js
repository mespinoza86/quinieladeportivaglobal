/*
 * Localiza las plantillas literales de un archivo JavaScript.
 *
 * Hace falta un recorrido con estado y no una expresión regular: las plantillas
 * se anidan, y una expresión regular empareja la comilla de cierre de la
 * interna con la de apertura de la siguiente, inventando plantillas que no
 * existen. Eso daba quince falsos positivos.
 */
function plantillasDe(codigo) {
  const salida = [];
  // Cada nivel es { tipo: 'codigo' | 'plantilla', ... }
  const pila = [{ tipo: 'codigo', llaves: 0 }];
  let i = 0;

  const cima = () => pila[pila.length - 1];

  while (i < codigo.length) {
    const nivel = cima();
    const c = codigo[i];
    const dos = codigo.slice(i, i + 2);

    if (nivel.tipo === 'codigo') {
      if (dos === '//') { const f = codigo.indexOf('\n', i); i = f === -1 ? codigo.length : f; continue; }
      if (dos === '/*') { const f = codigo.indexOf('*/', i + 2); i = f === -1 ? codigo.length : f + 2; continue; }

      if (c === '"' || c === "'") {
        const cierre = c;
        i++;
        while (i < codigo.length && codigo[i] !== cierre) { if (codigo[i] === '\\') i++; i++; }
        i++;
        continue;
      }

      if (c === '`') {
        // ¿Va precedida por la etiqueta `html`?
        const anterior = codigo.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);
        pila.push({ tipo: 'plantilla', inicio: i, etiqueta: anterior ? anterior[1] : null });
        i++;
        continue;
      }

      if (c === '{') { nivel.llaves++; i++; continue; }

      if (c === '}') {
        if (nivel.llaves > 0) { nivel.llaves--; i++; continue; }
        // Cierra una interpolación: se vuelve a la plantilla que la contiene.
        if (pila.length > 1) { pila.pop(); i++; continue; }
        i++;
        continue;
      }

      i++;
      continue;
    }

    // Dentro del texto de una plantilla.
    if (c === '\\') { i += 2; continue; }

    if (dos === '${') {
      pila.push({ tipo: 'codigo', llaves: 0 });
      i += 2;
      continue;
    }

    if (c === '`') {
      const abierta = pila.pop();
      salida.push({
        inicio: abierta.inicio,
        etiqueta: abierta.etiqueta,
        texto: codigo.slice(abierta.inicio, i + 1)
      });
      i++;
      continue;
    }

    i++;
  }

  return salida;
}

/** Las que producen HTML y además meten datos dentro. */
function plantillasDeRiesgo(codigo) {
  return plantillasDe(codigo).filter(p => /<[a-zA-Z\/]/.test(p.texto) && p.texto.includes('${'));
}

module.exports = { plantillasDe, plantillasDeRiesgo };

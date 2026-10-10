'use strict';
/*
 * ¿Hay algo bajo el nombre de Marco que no escribió Marco?
 *
 * ⚠️ La primera versión de este comprobador dio 6 contaminados y uno era FALSO:
 * troceaba por `### `, así que un bloque `<details>` que viene DESPUÉS del
 * mensaje de Marco —correctamente etiquetado como resumen del sistema— caía
 * dentro de su trozo. Ahora el cuerpo de un mensaje se corta en el primer
 * marcador de evento (`> *—`, `<details>`), que es donde de verdad acaba.
 *
 * Y lleva CONTROL en los dos sentidos: se le da un texto limpio (no debe
 * detectar nada) y uno contaminado a propósito (debe detectarlo). Un
 * comprobador que no se prueba en los dos sentidos no vale.
 */
const fs = require('fs');

const ENVOLTURAS = {
  'notificación de tarea': /<task-notification>/,
  'resumen de compactación': /This session is being continued/,
  'aviso del sistema': /SYSTEM NOTIFICATION - NOT USER INPUT/,
  'envoltorio del editor': /<ide_opened_file>|<ide_selection>|<system-reminder>/,
  'marcador de imagen': /^\[Image/
};

/** El cuerpo del mensaje, hasta donde empiezan los eventos que vienen detrás. */
function cuerpoDe(trozo) {
  const sinCabecera = trozo.replace(/^.*\n/, '');
  const corte = sinCabecera.search(/^(> \*—|> 🖼️|> ✋|> 🔔|> ⚙️|<details>)/m);
  return (corte < 0 ? sinCabecera : sinCabecera.slice(0, corte)).trim();
}

function revisar(texto) {
  const trozos = texto.split(/^### /m).slice(1);
  const malos = [];
  let marco = 0, claude = 0;

  for (const trozo of trozos) {
    if (trozo.startsWith('🤖 Claude')) { claude++; continue; }
    if (!trozo.startsWith('👤 Marco')) continue;
    marco++;
    const cuerpo = cuerpoDe(trozo);
    for (const [nombre, re] of Object.entries(ENVOLTURAS)) {
      if (re.test(cuerpo)) malos.push({ nombre, muestra: cuerpo.slice(0, 90).replace(/\n/g, ' ') });
    }
  }
  return { marco, claude, malos };
}

/* ---------- CONTROL, antes de creerle nada al comprobador ---------- */
const LIMPIO = [
  '### 👤 Marco *(10:00)*',
  '',
  'dale, hazlo',
  '',
  '> *— 3 acciones con herramientas (leer, buscar, editar, ejecutar pruebas…) —*',
  '',
  '<details>',
  '<summary>⚙️ <strong>RESUMEN AUTOMÁTICO DEL SISTEMA</strong></summary>',
  '',
  '```text',
  'This session is being continued from a previous conversation',
  '```',
  '',
  '</details>',
  ''
].join('\n');

const SUCIO = [
  '### 👤 Marco *(10:00)*',
  '',
  '<task-notification><status>completed</status></task-notification>',
  ''
].join('\n');

const cLimpio = revisar(LIMPIO);
const cSucio = revisar(SUCIO);

console.log('CONTROL limpio  (debe dar 0): ' + cLimpio.malos.length
  + (cLimpio.malos.length === 0 ? '  ✔' : '  ⛔ FALSO POSITIVO'));
console.log('CONTROL sucio   (debe dar 1): ' + cSucio.malos.length
  + (cSucio.malos.length === 1 ? '  ✔' : '  ⛔ NO LO DETECTA'));

if (cLimpio.malos.length !== 0 || cSucio.malos.length !== 1) {
  console.error('\n⛔ El comprobador no pasa sus propios controles. No vale lo que diga del archivo.');
  process.exit(2);
}

/* ---------- Ahora sí, el archivo ---------- */
const r = revisar(fs.readFileSync(process.argv[2], 'utf8'));

console.log('');
console.log('bloques «👤 Marco»:  ' + r.marco);
console.log('bloques «🤖 Claude»: ' + r.claude);
console.log('contaminados:        ' + r.malos.length);

if (r.malos.length) {
  const resumen = {};
  for (const m of r.malos) resumen[m.nombre] = (resumen[m.nombre] || 0) + 1;
  console.log(JSON.stringify(resumen, null, 2));
  for (const m of r.malos.slice(0, 5)) console.log('   · ' + m.nombre + ': ' + m.muestra);
  process.exit(1);
}

console.log('✔ nada ajeno bajo el nombre de Marco');

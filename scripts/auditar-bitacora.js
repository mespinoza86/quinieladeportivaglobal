/*
 * ¿Entendería la bitácora alguien que llega mañana sin recordar nada?
 *
 * Marco lo pregunta cada pocos días —«¿la bitácora está al día?»— y las tres
 * veces que lo preguntó había algo desfasado. Esto convierte esa pregunta en
 * algo que se puede ejecutar:
 *
 *     node scripts/auditar-bitacora.js
 *
 * No comprueba que esté bonita. Comprueba que las PREGUNTAS que haría quien
 * llega tengan respuesta dentro del archivo, y que las CIFRAS que dice —
 * pantallas, scripts, migraciones— coincidan con lo que hay en el disco.
 *
 * ⚠️ Cuando se añada algo importante, se añade aquí su pregunta. Un guion que
 * no crece con el proyecto acaba diciendo que todo está bien mirando nada.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const texto = fs.readFileSync('avance_proyecto.md', 'utf8');
/*
 * TODO el archivo, en minúsculas y con los saltos de línea aplanados: el
 * markdown parte las frases largas en dos, y buscar una frase entera fallaba
 * por eso.
 *
 * ⚠️ Esta línea se escribió primero desde el shell y bash se comió la barra
 * invertida de `\s`, dejando `/s+/g`: el guion borraba todas las ESES del
 * archivo y decía que «axios» no aparecía. Para texto con barras invertidas,
 * la herramienta de edición.
 */
const cabecera = texto.replace(/\s+/g, ' ').toLowerCase();

/*
 * ⛔ LA PARTE VIVA, APARTE DE LA HISTORIA.
 *
 * Todo lo anterior a «## 19. Bitácora de avance» describe cómo está el
 * proyecto HOY, y ahí una cifra vieja es una mentira. Las entradas de la
 * bitácora dicen «39 pantallas» porque entonces eran 39, y eso NO se toca:
 * son el registro de lo que pasó, no una descripción del presente.
 */
const corte = texto.indexOf('## 19. Bitácora de avance');
if (corte < 0) {
  console.error('⛔ No encuentro «## 19. Bitácora de avance»: sin eso no sé');
  console.error('   qué parte del archivo describe el presente. Abortando en');
  console.error('   vez de auditar media cosa.');
  process.exit(2);
}
const viva = texto.slice(0, corte).replace(/\s+/g, ' ').toLowerCase();

const sh = c => execSync(c, { encoding: 'utf8' }).trim();

const PREGUNTAS = [
  /* ⚠️ NO se busca el hash: la bitácora no puede nombrar el commit que la
     escribe, así que buscarlo era medir lo imposible. Lo que tiene que estar
     es la ADVERTENCIA de que hay que mirar git. */
  ['¿Se dice cómo saber el commit de verdad?', 'git log origin/main..main'],
  ['¿Cuántas pantallas hay?',              String(sh('ls public/*.html | wc -l'))],
  ['¿Cuántos scripts de navegador?',       String(sh('ls private/js/*.js | wc -l'))],
  ['¿Cuántas pruebas rápidas?',            '661'],
  ['¿Cuántas de navegador?',               '224'],
  ['¿Cuántas migraciones?',                String(sh('ls db/migraciones/*.sql | wc -l'))],
  ['¿Qué hace `aviso.js`?',                'aviso.js'],
  ['¿Qué hace `liga-con-pais.js`?',        'liga-con-pais.js'],
  ['¿Qué es `compartir-texto`?',           'compartir-texto'],
  ['¿Por qué hay menos pantallas?',        'se borraron seis pantallas'],
  ['¿Dónde viven los iconos?',             'public/iconos/'],
  ['¿Está la auditoría de dependencias?',  'vulnerabilidades'],
  ['¿Se sabe que hay que jalar?',          'Pendiente de jalar'],
  ['¿Está la lista de siete?',             'lista de siete'],
  ['¿Está el recorrido como usuario?',     'recorrido'],
  ['¿Está lo del muro de «Validar jugador»?', 'Validar jugador'],
  /* ⚠️ Un trozo corto: el archivo parte las frases largas en dos líneas. */
  ['¿Está el fallo de los pronósticos?',   'cuadros grises'],
  ['¿Está la trampa del CRLF?',            'CRLF'],
  ['¿Está la trampa de «flaky no es verde»?', 'flaky'],
  ['¿Está lo de `npm audit fix --omit=dev`?', 'omit=dev'],
  ['¿Está el punto ciego de axios?',       'axios'],
  ['¿Está lo que falta probar en el mundo real?', 'SIN COMPROBAR EN EL MUNDO REAL'],
  ['¿Está la deuda anotada?',              'Deuda anotada']
];

/*
 * ⛔ LO QUE YA NO DEBE ESTAR, que es la mitad que faltaba.
 *
 * Comprobar que la cifra BUENA aparece no basta: el 6 de octubre de 2026 la
 * línea 1953 decía «34 pantallas» y la 1961, ocho líneas más abajo, «39
 * pantallas». Las preguntas de arriba daban 23 de 23 con esa contradicción
 * dentro, porque sólo miraban si el 34 estaba en alguna parte.
 *
 * ⭐ Un número que cambia deja su versión vieja escrita en otros sitios. Así
 * que cuando una cifra de la parte viva cambie, su valor ANTERIOR se añade
 * aquí, y el guion se niega a dar verde mientras siga suelto.
 */
const NO_DEBE_QUEDAR = [
  ['39 pantallas', 'eran 39 antes de borrar seis (117)'],
  ['39 piezas',    'lo mismo, dicho de otra manera'],
  ['38 pantallas', 'cifra intermedia que nunca fue la buena']
];

let fallos = 0;

for (const [pregunta, buscado] of PREGUNTAS) {
  const hay = cabecera.includes(String(buscado).toLowerCase());
  if (!hay) fallos++;
  console.log(`  ${hay ? '✔' : '⛔'} ${pregunta.padEnd(46)} ${hay ? '' : '(falta: ' + buscado + ')'}`);
}

console.log('');

for (const [viejo, porque] of NO_DEBE_QUEDAR) {
  const sigue = viva.includes(viejo.toLowerCase());
  if (sigue) fallos++;
  console.log(`  ${sigue ? '⛔' : '✔'} ya no se dice «${viejo}»`.padEnd(48)
    + (sigue ? `SIGUE EN LA PARTE VIVA — ${porque}` : ''));
}

const total = PREGUNTAS.length + NO_DEBE_QUEDAR.length;
console.log(`\n${total - fallos} de ${total}: ${PREGUNTAS.length} preguntas respondidas`
  + ` y ${NO_DEBE_QUEDAR.length} cifras viejas fuera de la parte viva`);
process.exit(fallos ? 1 : 0);

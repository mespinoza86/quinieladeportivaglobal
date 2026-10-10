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
  ['¿Cuántas pruebas rápidas?',            '669'],
  ['¿Cuántas de navegador?',               '228'],
  ['¿Cuántas migraciones?',                String(sh('ls db/migraciones/*.sql | wc -l'))],
  ['¿Qué hace `aviso.js`?',                'aviso.js'],
  ['¿Qué hace `liga-con-pais.js`?',        'liga-con-pais.js'],
  ['¿Qué es `compartir-texto`?',           'compartir-texto'],
  ['¿Por qué hay menos pantallas?',        'se borraron seis pantallas'],
  ['¿Dónde viven los iconos?',             'public/iconos/'],
  ['¿Está la auditoría de dependencias?',  'vulnerabilidades'],
  /*
   * ⛔ ESTA PREGUNTA ESTABA MAL, y el 8 de octubre de 2026 lo demostró.
   *
   * Buscaba «Pendiente de jalar». El día que producción se puso al día hubo
   * que borrar esa frase —ya no era verdad— y el guion se puso rojo por un
   * cambio CORRECTO. Una comprobación que exige que un estado concreto siga
   * siendo el mismo se rompe en cuanto el proyecto avanza.
   *
   * Lo que de verdad tiene que estar no es «falta jalar»: es **cómo se supo**.
   * Eso vale igual diga «al día» o «pendiente», porque lo que afirma es que
   * alguien lo comprobó en vez de suponerlo.
   *
   * ⚠️ Y SIN FECHA FIJA, por el mismo motivo: una fecha escrita aquí caduca
   * sola. La expresión busca la fila de Producción de la tabla de estado y
   * exige que diga «comprobado» con una fecha, cualquiera que sea.
   */
  ['¿Se dice cómo se comprobó producción?',
   /\| producción \|[^|]*comprobad[oa] el \d{1,2} de \w+ de \d{4}/],
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
  ['¿Está la deuda anotada?',              'Deuda anotada'],
  /*
   * Lo de la entrada 121: el campo para corregir la hora que el proveedor da
   * mal. Es lo último que se puede tocar, así que quien llegue mañana tiene que
   * encontrarlo descrito sin leerse la bitácora entera.
   */
  ['¿Se explica el campo de la hora del partido?', 'Hora del partido', 'viva'],
  /*
   * Y el volcado de la conversación: hay DOS archivos grandes fuera del
   * repositorio, y sin esta línea el de mañana no sabe por qué están ahí ni
   * cuál es el bueno.
   */
  ['¿Se dice qué es `conversacion.md`?',   'conversacion.md', 'viva']
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
  ['38 pantallas', 'cifra intermedia que nunca fue la buena'],
  /*
   * ⚠️ CON LA PALABRA AL LADO, NO EL NÚMERO SUELTO.
   *
   * El 8 de octubre de 2026 las pruebas pasaron de 661+224 a 669+228, y en la
   * parte viva quedaron SEIS menciones viejas repartidas por cuatro apartados
   * distintos. Pero «224» a secas NO se puede prohibir: también es el número de
   * líneas de `quinielas.js`, y ahí es correcto. Prohibir la cifra sola habría
   * puesto el guion en rojo por un dato bueno — el error contrario, y el que
   * acaba con alguien borrando la comprobación.
   */
  ['661 pruebas',  'las rápidas pasaron a 669 (121)'],
  ['224 de navegador', 'las de navegador pasaron a 228 (121)'],
  ['661 + 224',    'la suma de antes de la entrada 121']
];

let fallos = 0;

for (const [pregunta, buscado, ambito] of PREGUNTAS) {
  /*
   * ⚠️ TERCER ELEMENTO `'viva'`: buscar SÓLO en la parte que describe el
   * presente.
   *
   * Por defecto se busca en todo el archivo, y para la mayoría está bien: una
   * trampa o un hallazgo valen igual contados en su entrada. Pero una pregunta
   * del tipo «¿se explica X?» pasa en cuanto X se nombre en CUALQUIER entrada
   * de la bitácora, aunque la descripción haya desaparecido de la cabecera,
   * que es lo que se lee al retomar. Eso es un falso verde, y las dos
   * preguntas añadidas el 8 de octubre de 2026 lo tenían al nacer.
   */
  const donde = ambito === 'viva' ? viva : cabecera;

  /*
   * Un texto se busca tal cual; una expresión se prueba. Las expresiones
   * existen para lo que NO puede escribirse fijo —una fecha, una cifra que
   * cambia—, porque un dato fijo aquí caduca solo y pone el guion rojo por un
   * cambio correcto. Pasó el 8 de octubre de 2026 con «Pendiente de jalar».
   */
  const hay = buscado instanceof RegExp
    ? buscado.test(donde)
    : donde.includes(String(buscado).toLowerCase());

  if (!hay) fallos++;
  const marca = ambito === 'viva' ? ' (parte viva)' : '';
  console.log(`  ${hay ? '✔' : '⛔'} ${(pregunta + marca).padEnd(46)} ${hay ? '' : '(falta: ' + buscado + ')'}`);
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

'use strict';
/*
 * Vuelca la conversación entera a Markdown, desde el transcript real.
 *
 * ⚠️ NO reconstruye nada de memoria. Lo que no esté en el transcript no entra.
 *
 * ⛔ LO IMPORTANTE DE ESTE GUION ES LO QUE SEPARA, no lo que copia. Dentro del
 * transcript, cuatro clases de cosa llegan con `role: "user"` y **no las
 * escribió Marco**:
 *
 *   1. los resúmenes automáticos de compactación (`isCompactSummary`), que van
 *      en inglés y son larguísimos;
 *   2. las notificaciones de tareas de fondo (`promptSource: "system"`);
 *   3. los marcadores de imagen pegada y de interrupción;
 *   4. las envolturas del editor (`<ide_opened_file>`, `<ide_selection>`).
 *
 * La versión de septiembre de este volcado publicó las del grupo 1 **bajo el
 * nombre de Marco** antes de que él mismo lo notara. De ahí que aquí se
 * clasifique por `promptSource` y por `isCompactSummary`, que son datos del
 * transcript, y no por lo que parezca el texto.
 *
 * Lo que de verdad escribió Marco es `promptSource === 'sdk'`, y nada más.
 */
const fs = require('fs');
const readline = require('readline');

const [salida, ...archivos] = process.argv.slice(2);
if (!salida || !archivos.length) {
  console.error('uso: node volcar-conversacion.js <salida.md> <transcript.jsonl...>');
  process.exit(2);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/*
 * ⚠️ Hora de Costa Rica (UTC−6, sin horario de verano), no la del servidor ni
 * la del lector. Es el mismo cuidado que §C exige en el resto del proyecto:
 * dar formato en la zona de quien corre el guion haría que el mismo transcript
 * produjera horas distintas en cada máquina.
 */
function enCostaRica(iso) {
  const d = new Date(new Date(iso).getTime() - 6 * 60 * 60 * 1000);
  return {
    dia: `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`,
    hora: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  };
}

const textoDe = contenido => {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return '';
  return contenido.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
};

/*
 * Las envolturas de máquina se quitan: son del entorno, no de Marco.
 *
 * ⛔ Y LA DE `task-notification` ESTÁ AQUÍ POR UN MOTIVO QUE COSTÓ ENCONTRAR.
 *
 * Clasificar por `promptSource` parecía suficiente: 32 notificaciones llegaban
 * como `system` y se apartaban bien. Pero hay **37** en total, y **5 vienen
 * marcadas como `sdk`**, o sea indistinguibles de un mensaje escrito por Marco
 * si sólo se mira ese campo. Las cinco acabaron publicadas bajo su nombre en el
 * primer intento de este volcado, que es EXACTAMENTE el fallo que tuvo la
 * versión de septiembre.
 *
 * ⚠️ De ahí la regla: `promptSource` dice de dónde dice venir el mensaje, y el
 * CONTENIDO dice lo que es. Hacen falta los dos. Y se enumeraron todas las
 * envolturas presentes entre sus mensajes antes de filtrar, en vez de parchear
 * la que se vio primero: son estas tres y ninguna más.
 *
 * Se quita el envoltorio en vez de descartar el mensaje entero: si además
 * llevara texto suyo, ese texto se conserva.
 */
const limpiar = t => t
  .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
  .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
  .replace(/\[SYSTEM NOTIFICATION[\s\S]*?(?=\n\n|$)/g, '')
  .trim();

const TRAE_NOTIFICACION = /<task-notification>/;

const eventos = [];

/*
 * ⛔ LAS CIFRAS SALEN DE LA MISMA PASADA QUE ESCRIBE EL ARCHIVO, y eso importa.
 *
 * Contar con una sonda aparte daba números distintos cada vez: 1620, 1625,
 * 1626, 1627 para lo mismo. No era un fallo de las sondas — **el transcript
 * crece mientras se lee**, porque la sesión que lo analiza se va escribiendo
 * dentro de él. Creció de 63,4 a 63,6 MB en unos minutos.
 *
 * Así que una cifra medida en una pasada y un documento escrito en otra NO
 * concuerdan nunca. Se cuenta y se escribe a la vez, y lo que sale es un
 * retrato coherente de un instante.
 */
const cuenta = { marco: 0, claude: 0, herramientas: 0,
  marcadoresDeImagen: 0, imagenesIncrustadas: 0,
  interrupciones: 0, notificaciones: 0, resumenes: 0 };

(async () => {
  for (const archivo of archivos) {
    const rl = readline.createInterface({ input: fs.createReadStream(archivo), crlfDelay: Infinity });

    for await (const linea of rl) {
      if (!linea.trim()) continue;
      let j;
      try { j = JSON.parse(linea); } catch { continue; }
      if (!j.message || !j.timestamp) continue;
      if (j.isSidechain) continue;           // conversación de un subagente, no con Marco

      const m = j.message;
      const bloques = Array.isArray(m.content) ? m.content : [];

      if (j.type === 'user') {
        /*
         * ⚠️ Las imágenes se cuentan ANTES de descartar nada, y por separado de
         * los marcadores: son dos cosas distintas y confundirlas daba «6» o
         * «21» según cuál se mirara. Un bloque `image` es la imagen dentro del
         * transcript; un marcador `[Image: …]` es la nota de texto que la
         * acompaña. Ni uno ni otro es «cuántas veces pegó algo», así que se
         * dicen los dos y no se inventa un total.
         */
        if (bloques.some(b => b.type === 'image')) cuenta.imagenesIncrustadas++;

        // Un resultado de herramienta no es un mensaje.
        if (bloques.some(b => b.type === 'tool_result') || j.toolUseResult) continue;

        const bruto = textoDe(m.content).trim();
        if (!bruto) continue;

        if (j.isCompactSummary) {
          cuenta.resumenes++;
          eventos.push({ ts: j.timestamp, clase: 'resumen', texto: bruto });
          continue;
        }

        if (j.promptSource === 'system') {
          cuenta.notificaciones++;
          eventos.push({ ts: j.timestamp, clase: 'notificacion', texto: bruto });
          continue;
        }

        if (j.promptSource !== 'sdk') {
          /* Imagen pegada, interrupción, u otra cosa del entorno. */
          if (/^\[Image/.test(bruto)) { cuenta.marcadoresDeImagen++; eventos.push({ ts: j.timestamp, clase: 'imagen' }); }
          else if (/interrupted/i.test(bruto)) { cuenta.interrupciones++; eventos.push({ ts: j.timestamp, clase: 'interrupcion' }); }
          else eventos.push({ ts: j.timestamp, clase: 'entorno', texto: bruto });
          continue;
        }

        /*
         * Una notificación disfrazada de `sdk` deja su nota de aviso, no un
         * mensaje de Marco. Si además traía texto suyo, el texto sigue abajo.
         */
        if (TRAE_NOTIFICACION.test(bruto)) {
          cuenta.notificaciones++;
          eventos.push({ ts: j.timestamp, clase: 'notificacion' });
        }

        const texto = limpiar(bruto);
        if (!texto) continue;
        cuenta.marco++;
        eventos.push({ ts: j.timestamp, clase: 'marco', texto });
        continue;
      }

      if (j.type === 'assistant') {
        const herramientas = bloques.filter(b => b.type === 'tool_use').length;
        if (herramientas) {
          cuenta.herramientas += herramientas;
          eventos.push({ ts: j.timestamp, clase: 'herramientas', n: herramientas });
        }
        const texto = textoDe(m.content).trim();
        if (texto) {
          cuenta.claude++;
          eventos.push({ ts: j.timestamp, clase: 'claude', texto });
        }
      }
    }
  }

  eventos.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  /* Las tandas de herramientas seguidas se juntan en una sola línea. */
  const juntados = [];
  for (const e of eventos) {
    const ultimo = juntados[juntados.length - 1];
    if (e.clase === 'herramientas' && ultimo && ultimo.clase === 'herramientas') {
      ultimo.n += e.n;
    } else {
      juntados.push({ ...e });
    }
  }

  const primera = enCostaRica(eventos[0].ts);
  const ultima = enCostaRica(eventos[eventos.length - 1].ts);

  const out = [];
  out.push('# Conversación completa — Quiniela Deportiva Global');
  out.push('');
  out.push('> Volcado del diálogo de trabajo, extraído del transcript real y **no');
  out.push('> reconstruido de memoria**. Regenerado entero, no pegado por trozos.');
  out.push('');
  out.push(`**Periodo:** del ${primera.dia} al ${ultima.dia}, hora de Costa Rica.`);
  out.push('');
  out.push(`**Qué contiene:** los **${cuenta.marco} mensajes de Marco** y las`);
  out.push(`**${cuenta.claude} respuestas escritas de Claude**, en orden, con su hora.`);
  out.push('');
  out.push('**Qué NO contiene, y conviene saberlo antes de leerlo:**');
  out.push('');
  out.push(`- Las **llamadas a herramientas y sus salidas** —leer archivos, buscar,`);
  /* Punto de millar escrito a mano: `toLocaleString` mete un espacio fino. */
  const conMillar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  out.push(`  editar, correr pruebas—. Son **${conMillar(cuenta.herramientas)}** y ocupan los 65 MB`);
  out.push('  del transcript; meterlas haría el documento ilegible. En su lugar queda una');
  out.push('  línea con cuántas hubo entre un mensaje y el siguiente, para que no parezca');
  out.push('  que ahí no pasó nada.');
  out.push('- Los bloques de razonamiento interno.');
  out.push('');
  out.push('**⛔ Y lo que se separa a propósito, porque NO lo escribió Marco** aunque');
  out.push('viaje en el transcript como si fuera suyo:');
  out.push('');
  out.push(`- Los **${cuenta.resumenes} resúmenes automáticos** que el sistema insertó al quedarse sin`);
  out.push('  memoria. Van marcados y plegados, y están en inglés.');
  out.push(`- Las **${cuenta.notificaciones} notificaciones de tareas de fondo** (una corrida de pruebas que`);
  out.push('  termina, por ejemplo).');
  out.push(`- Las imágenes que Marco pegó: **${cuenta.marcadoresDeImagen} marcadores** de imagen en el`);
  out.push(`  diálogo, de los cuales **${cuenta.imagenesIncrustadas}** traen la imagen dentro del transcript —son dos`);
  out.push('  cosas distintas y por eso se dicen las dos en vez de inventar un total—. Y');
  const interrup = cuenta.interrupciones === 1
    ? '**1 interrupción**' : `**${cuenta.interrupciones} interrupciones**`;
  out.push(`  ${interrup}. Queda la nota de que las hubo, porque son acciones`);
  out.push('  suyas, pero no son palabras suyas.');
  out.push('');
  out.push('⚠️ La versión de septiembre de este archivo publicó esos resúmenes **bajo el');
  out.push('nombre de Marco** hasta que él lo notó. Y al regenerarlo volvió a pasar con');
  out.push('otra cosa: de las **37** notificaciones de tareas, **5 vienen marcadas en el');
  out.push('transcript como si las hubiera escrito él** (`promptSource: "sdk"`, igual que');
  out.push('sus mensajes de verdad). O sea que clasificar por ese campo NO basta.');
  out.push('');
  out.push('⭐ Así que ahora se mira **el campo y el contenido**: `promptSource` dice de');
  out.push('dónde dice venir un mensaje, y la envoltura del texto dice lo que es. Y se');
  out.push('enumeraron todas las envolturas presentes entre sus mensajes antes de filtrar,');
  out.push('en vez de parchear la primera que se vio. Por eso aquí pone');
  out.push(`**${cuenta.marco} mensajes de Marco** y no 230: esos cinco no eran suyos.`);
  out.push('');
  out.push('⚠️ Esto es **la conversación**, no el registro del trabajo. Qué se cambió, por');
  out.push('qué, qué falló y qué quedó pendiente está en `avance_proyecto.md`.');
  out.push('');
  out.push('⚠️ Y acaba donde acababa el transcript al generarlo: los últimos mensajes,');
  out.push('incluido el que pidió este archivo, no pueden estar dentro.');
  out.push('');
  out.push('⛔ **El transcript CRECE mientras se lee**, porque la sesión que lo analiza se');
  out.push('va escribiendo dentro de él: creció de 63,4 a 63,6 MB en los minutos que llevó');
  out.push('generar esto. Por eso las cifras de arriba salen de **la misma pasada** que');
  out.push('escribió el archivo. Medirlas con una sonda aparte daba un número distinto cada');
  out.push('vez —1620, 1625, 1626, 1627 para lo mismo—, y no era un fallo de la sonda.');
  out.push('');
  out.push('---');
  out.push('');

  let diaActual = '';

  for (const e of juntados) {
    const { dia, hora } = enCostaRica(e.ts);
    if (dia !== diaActual) {
      diaActual = dia;
      out.push('');
      out.push(`## 📅 ${dia}`);
      out.push('');
    }

    if (e.clase === 'marco') {
      out.push(`### 👤 Marco *(${hora})*`);
      out.push('');
      out.push(e.texto);
      out.push('');
    } else if (e.clase === 'claude') {
      out.push('### 🤖 Claude');
      out.push('');
      out.push(e.texto);
      out.push('');
    } else if (e.clase === 'herramientas') {
      const plural = e.n === 1 ? 'acción' : 'acciones';
      out.push(`> *— ${e.n} ${plural} con herramientas (leer, buscar, editar, ejecutar pruebas…) —*`);
      out.push('');
    } else if (e.clase === 'imagen') {
      out.push(`> 🖼️ *— Marco pegó una imagen aquí (${hora}). No se puede incluir en un archivo de texto. —*`);
      out.push('');
    } else if (e.clase === 'interrupcion') {
      out.push(`> ✋ *— Marco interrumpió aquí (${hora}). —*`);
      out.push('');
    } else if (e.clase === 'notificacion') {
      out.push(`> 🔔 *— Aviso automático: una tarea de fondo terminó (${hora}). NO lo escribió Marco. —*`);
      out.push('');
    } else if (e.clase === 'resumen') {
      out.push('<details>');
      out.push(`<summary>⚙️ <strong>RESUMEN AUTOMÁTICO DEL SISTEMA</strong> (${hora}) — no lo escribió Marco, y va en inglés. Pulsa para desplegarlo.</summary>`);
      out.push('');
      out.push('```text');
      /* Las vallas de dentro se neutralizan para no romper el bloque. */
      out.push(e.texto.replace(/```/g, "'''"));
      out.push('```');
      out.push('');
      out.push('</details>');
      out.push('');
    } else if (e.clase === 'entorno') {
      out.push(`> ⚙️ *— Mensaje del entorno (${hora}), no de Marco. —*`);
      out.push('');
    }
  }

  out.push('');
  out.push('---');
  out.push('');
  out.push(`*Generado desde ${archivos.length} transcript(s) el ${enCostaRica(new Date().toISOString()).dia}.*`);
  out.push('');

  fs.writeFileSync(salida, out.join('\n'), 'utf8');

  console.log('escrito: ' + salida);
  console.log(JSON.stringify(cuenta, null, 2));
})();

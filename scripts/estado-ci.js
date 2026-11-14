/*
 * ¿Está el CI en verde?
 *
 *     node scripts/estado-ci.js
 *
 * ============================================================================
 * ⛔ POR QUÉ EXISTE ESTO
 * ============================================================================
 *
 * El 14 de noviembre de 2026 Marco preguntó por unos correos de GitHub que
 * decían que «las pruebas fallaron». El CI llevaba **cinco corridas en rojo
 * desde el 10 de octubre** — un mes entero — y en la conversación no había
 * salido ni una vez.
 *
 * ⚠️ Y no por descuido tonto: `git log`, `git status` y `npm test` **no dicen
 * nada del CI**. La comprobación de «¿cómo estamos?» que se hace al abrir y al
 * cerrar una sesión no lo incluía, así que el rojo podía quedarse ahí para
 * siempre sin que nadie tropezara con él. Ni al cerrar la entrada 126, que era
 * una entrada dedicada a enumerar lo que quedaba a medias.
 *
 * ⭐ Un correo que llega a Marco no es una comprobación del proyecto. Esto sí.
 *
 * ============================================================================
 * ⚠️ POR QUÉ NO USA `gh`
 * ============================================================================
 *
 * El `gh` CLI **no está instalado** en la máquina de Marco, y pedirle que lo
 * instale para poder mirar el CI es poner una barrera delante de la
 * comprobación. El repositorio es público, así que la API de GitHub contesta
 * sin credenciales.
 *
 * ⚠️ Sin autenticar, GitHub limita a 60 peticiones por hora por IP. Esto gasta
 * dos. Si alguna vez contesta 403 con «rate limit», no es que el CI esté mal.
 */
const https = require('https');

const REPO = process.env.CI_REPO || 'mespinoza86/quinieladeportivaglobal';
const CUANTAS = Number(process.env.CI_CUANTAS || 6);

function pedir(ruta) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: 'api.github.com',
      path: ruta,
      headers: {
        /* GitHub rechaza las peticiones sin «User-Agent». */
        'User-Agent': 'estado-ci-quiniela',
        Accept: 'application/vnd.github+json'
      },
      timeout: 20000
    }, res => {
      let cuerpo = '';
      res.on('data', d => { cuerpo += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(
            `GitHub contestó ${res.statusCode}. `
            + (res.statusCode === 403
              ? 'Probablemente el límite de peticiones sin autenticar (60/hora). '
                + 'Eso NO quiere decir que el CI esté rojo.'
              : 'Ruta: ' + ruta)));
        }
        try { resolve(JSON.parse(cuerpo)); }
        catch (e) { reject(new Error('respuesta que no es JSON: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub no contestó en 20 s')));
    req.on('error', reject);
  });
}

const marca = c => (c === 'success' ? '✔' : c === null || c === undefined ? '…' : '⛔');

(async () => {
  const runs = await pedir(`/repos/${REPO}/actions/runs?per_page=${CUANTAS}`);
  const corridas = runs.workflow_runs || [];

  if (!corridas.length) {
    console.log('  no hay corridas que mirar (¿repositorio recién creado?)');
    process.exit(0);
  }

  console.log(`  últimas ${corridas.length} corridas de ${REPO}:\n`);

  for (const r of corridas) {
    const titulo = ((r.head_commit && r.head_commit.message) || '').split('\n')[0];
    console.log(`  ${marca(r.conclusion)} #${String(r.run_number).padEnd(4)}`
      + ` ${String(r.head_sha).slice(0, 7)}`
      + ` ${String(r.conclusion || r.status).padEnd(11)} ${titulo.slice(0, 54)}`);
  }

  /*
   * ⭐ Y AQUÍ LO QUE DE VERDAD FALTABA: QUÉ PASO FALLÓ.
   *
   * El correo de GitHub nombra el *workflow* —que en este proyecto se llama
   * «Pruebas»— y no el paso, así que «fallaron las pruebas» puede ser cualquier
   * cosa. El 14 de noviembre eran las pruebas las que estaban VERDES y lo rojo
   * era la auditoría de dependencias. Sin esta parte, el guion repetiría el
   * mismo malentendido que vino a resolver.
   */
  /*
   * ============================================================================
   * ⛔ EL VEREDICTO LO DA LA ÚLTIMA CORRIDA TERMINADA, NO «¿HAY ALGUNA ROJA?»
   * ============================================================================
   *
   * La primera versión de esto buscaba la primera corrida fallida de la lista y
   * salía en rojo si encontraba una. El 14 de noviembre de 2026, a los cinco
   * minutos de escribirla, la corrida #110 salió **verde** y el guion gritó
   * «rojo» señalando la #109, que ya era historia — y habría seguido gritándolo
   * durante las siguientes cinco corridas.
   *
   * ⭐ Un guion que avisa cuando no pasa nada acaba ignorado, que es exactamente
   * el fallo que este guion vino a evitar. El estado del CI es **el de la última
   * corrida**; las anteriores son contexto, no veredicto.
   *
   * ⚠️ Y se salta las que siguen en marcha: una corrida `in_progress` no ha
   * dicho nada todavía, y tomarla por buena o por mala es inventar.
   */
  const ultima = corridas.find(r => r.status === 'completed' && r.conclusion);

  if (!ultima) {
    console.log('\n  … ninguna corrida ha terminado todavía. Vuelve a mirar en un rato.');
    /* No se sabe: ni 0 ni 1. Ver el `catch` de abajo. */
    process.exit(2);
  }

  const rojasViejas = corridas.filter(
    r => r !== ultima && r.conclusion && r.conclusion !== 'success').length;

  if (ultima.conclusion === 'success') {
    console.log(`\n  ✔ la última corrida terminada (#${ultima.run_number}) pasó.`);
    if (rojasViejas) {
      console.log(`  ⚠️  hay ${rojasViejas} corrida(s) roja(s) más atrás en la lista,`
        + ' pero son historia: el estado de hoy es el de arriba.');
    }
    process.exit(0);
  }

  console.log(`\n  ⛔ la última corrida terminada (#${ultima.run_number}) NO pasó.`
    + ' Qué paso falló:\n');

  const jobs = await pedir(`/repos/${REPO}/actions/runs/${ultima.id}/jobs`);

  for (const job of (jobs.jobs || [])) {
    console.log(`     ${marca(job.conclusion)} ${job.name} → ${job.conclusion}`);
    for (const paso of (job.steps || [])) {
      if (paso.conclusion === 'failure') {
        console.log(`          ⛔ paso: «${paso.name}»`);
      }
    }
  }

  console.log('\n  Para ver el registro completo:'
    + `\n     ${ultima.html_url}`);

  /*
   * Sale con 1 para que se note en un encadenado, igual que el auditor de la
   * bitácora. Un rojo del CI no es informativo: es algo que hay que arreglar.
   */
  process.exit(1);
})().catch(e => {
  console.error('  ⛔ no pude mirar el CI:', e.message);
  /*
   * ⚠️ 2 y no 1: «no pude mirar» NO es «está rojo». Confundir las dos cosas es
   * exactamente el fallo de las sondas que dicen «no» queriendo decir «no sé».
   */
  process.exit(2);
});

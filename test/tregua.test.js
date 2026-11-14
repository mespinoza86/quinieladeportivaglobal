/*
 * La tregua: cuándo NO hace falta tocar la base.
 *
 * ⛔ Lo que se prueba con más cuidado es el lado PELIGROSO. Que ahorre consultas
 * se nota en la factura; que duerma de más NO SE NOTA HASTA QUE FALTA UN
 * MARCADOR, y entonces se nota tarde. Así que cada prueba de «duerme» tiene al
 * lado una de «despierta a tiempo».
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db');
const tregua = require('../src/tregua');
const fixtures = require('../src/fixtures');
const enMemoria = require('./postgres-en-memoria');

test.before(async () => { await enMemoria.levantar(); });
test.after(async () => { await db.cerrar(); });
test.beforeEach(async () => { await enMemoria.vaciar(); tregua.reiniciar(); });

const descriptor = (clave, apiDate) => ({
  clave, apiFixtureId: clave, apiDate,
  busqueda: { fecha: String(apiDate).slice(0, 10), ligaId: '', equipo1: 'A', equipo2: 'B' }
});

const evento = (estado = 'Finished') => ({
  match_hometeam_name: 'A', match_awayteam_name: 'B',
  match_hometeam_score: '1', match_awayteam_score: '0',
  match_hometeam_ft_score: '1', match_awayteam_ft_score: '0',
  match_status: estado
});

/* ==================== Sin tocar la base ==================== */

test('⭐ con el horizonte en el futuro, esperar NO consulta nada', async () => {
  /*
   * Es la razón de existir del módulo: la respuesta en el caso aburrido tiene
   * que salir de memoria. Una consulta para saber si hace falta consultar no
   * ahorraría ni un céntimo.
   *
   * ⚠️ Se comprueba desconectando la base: si `hayQueEsperar` la tocara, esto
   * lanzaría en vez de responder.
   */
  const ahora = new Date('2026-11-14T00:00:00Z');
  await fixtures.guardar(descriptor('f1', '2099-06-01 15:00'), { evento: evento(''), ahora });
  await tregua.recalcular(ahora);

  const antes = tregua.estado().recalculos;

  /* Un minuto después, sin que nada haya cambiado. */
  assert.equal(tregua.hayQueEsperar(new Date(ahora.getTime() + 60_000)), true);
  assert.equal(tregua.estado().recalculos, antes,
    'no puede haber recalculado: eso sería una consulta');
  assert.ok(tregua.estado().latidosAhorrados > 0);
});

test('sin horizonte —recién arrancado— se trabaja, no se duerme', () => {
  /*
   * ⛔ El valor por defecto importa. Si un proceso recién arrancado se durmiera
   * «por si acaso», un reinicio de Render en pleno partido dejaría el marcador
   * parado hasta el tope. Sin horizonte, se trabaja.
   */
  assert.equal(tregua.hayQueEsperar(new Date()), false);
});

/* ==================== Despertar a tiempo ==================== */

test('⛔ el horizonte respeta el aviso previo: dos horas antes del partido', async () => {
  /*
   * ⚠️ EL ESCENARIO IMPORTA, Y LA PRIMERA VERSIÓN DE ESTA PRUEBA LO ELIGIÓ MAL.
   *
   * Usaba un partido de diciembre, a dos semanas. Con tanta antelación la
   * `proxima_consulta` del proveedor —6 h como máximo— siempre es más temprana
   * que «el partido menos dos horas», así que el margen NO decidía nada y la
   * prueba pasaba igual quitándolo. Lo destapó una mutación.
   *
   * El margen sólo manda cuando el partido está **entre 2 y 8 horas**: aquí, a
   * tres. Entonces «menos dos horas» cae en 55 minutos, antes que las 6 h de la
   * ventana del proveedor.
   */
  const ahora = new Date('2026-11-14T00:00:00Z');          // 18:00 CR del día 13
  await fixtures.guardar(descriptor('f1', '2026-11-13 21:00'), { evento: evento(''), ahora });

  const horizonte = await tregua.recalcular(ahora);

  const inicio = new Date(Date.UTC(2026, 10, 14, 3, 0));   // 21:00 CR = 03:00 UTC
  const esperado = inicio.getTime() - tregua.MARGEN_ANTES_DEL_PARTIDO_MS;

  assert.equal(horizonte, esperado,
    'el horizonte tiene que caer exactamente dos horas y cinco minutos antes '
    + 'del partido: es cuando sale el aviso previo de jornada');

  /* Y eso es MUCHO antes que el partido: si no, el correo llegaría tarde. */
  assert.ok(horizonte < inicio.getTime() - 2 * 60 * 60 * 1000);
});

test('⛔ si toca consultar al proveedor antes, manda eso', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  /*
   * Un partido en vivo: su `proxima_consulta` es dentro de un minuto, mucho
   * antes que cualquier margen de partido. El horizonte tiene que seguirlo.
   */
  await fixtures.guardar(descriptor('f1', '2026-11-13 18:00'),
    { evento: evento('67'), ahora });

  const horizonte = await tregua.recalcular(ahora);
  const dentroDeUnMinuto = ahora.getTime() + 60_000;

  assert.ok(horizonte <= dentroDeUnMinuto + 1000,
    'un partido en vivo se consulta cada minuto: el horizonte no puede ir más allá');
});

test('un partido TERMINADO no mantiene despierto a nadie', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  /* Terminado: `proxima_consulta` es null y no hay nada que esperar. */
  await fixtures.guardar(descriptor('f1', '2026-11-13 18:00'),
    { evento: evento('Finished'), ahora });

  const horizonte = await tregua.recalcular(ahora);

  assert.equal(horizonte, ahora.getTime() + tregua.TOPE_MS,
    'sin nada vivo se duerme hasta el tope, que es cuando más se ahorra');
});

test('con la base vacía se duerme hasta el tope, no indefinidamente', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');
  const horizonte = await tregua.recalcular(ahora);

  assert.equal(horizonte, ahora.getTime() + tregua.TOPE_MS);
  assert.equal(tregua.TOPE_MS, 6 * 60 * 60 * 1000, 'el tope son seis horas');
});

/* ==================== El tope y la invalidación ==================== */

test('⛔ el tope acota una proxima_consulta absurda', async () => {
  /*
   * ============================================================
   * ⚠️ ESTE TOPE HOY NO PUEDE DISPARARSE, Y HAY QUE DECIRLO
   * ============================================================
   *
   * `calcularProximaConsulta` nunca devuelve más de 6 horas —su ventana más
   * larga, `lejano`— y el tope son esas mismas 6 horas. Así que mientras las
   * dos cifras coincidan, el tope es **defensa en profundidad**, no una
   * restricción viva.
   *
   * La primera versión de esta prueba decía «acota cualquier error de cálculo»
   * y usaba un partido a dos años. Pasaba igual sin el tope, porque la
   * `proxima_consulta` de ese partido ya era de 6 h: el tope no decidía nada.
   * Lo destapó una mutación.
   *
   * ⭐ Para probar el tope de verdad hay que crear la situación de la que
   * defiende: una `proxima_consulta` lejanísima, como la dejaría un cambio
   * futuro en las ventanas del proveedor. Se escribe a mano en la caché,
   * salteando `calcularProximaConsulta`, que es justo la pieza que se supone
   * averiada.
   */
  const ahora = new Date('2026-11-14T00:00:00Z');
  await fixtures.guardar(descriptor('f1', '2026-11-20 15:00'), { evento: evento(''), ahora });

  await db.consulta(
    `UPDATE fixtures SET proxima_consulta = $1 WHERE clave = 'f1'`,
    [new Date('2027-06-01T00:00:00Z')]);

  const horizonte = await tregua.recalcular(ahora);

  assert.equal(horizonte, ahora.getTime() + tregua.TOPE_MS,
    'con una próxima consulta a siete meses, el tope tiene que recortarla a seis horas');
});

test('⛔ invalidar despierta: guardar una jornada no puede quedar dormido', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');
  await tregua.recalcular(ahora);

  assert.equal(tregua.hayQueEsperar(ahora), true, 'el control: estaba durmiendo');

  /*
   * Esto es lo que llama la ruta al guardar una jornada. Marco puede crear una
   * jornada con un partido dentro de una hora, y el horizonte guardado decía
   * «nada hasta dentro de seis». Sin esto, el partido arrancaría sin que nadie
   * lo hubiera consultado.
   */
  tregua.invalidar();

  assert.equal(tregua.hayQueEsperar(ahora), false,
    'tras invalidar hay que trabajar, sin esperar al tope');
});

test('tocaTrabajar recalcula ANTES de trabajar, no después', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  assert.equal(await tregua.tocaTrabajar(ahora), true, 'sin horizonte, toca');
  assert.equal(tregua.estado().recalculos, 1);

  /*
   * ⚠️ Recalcular antes y no después es lo que evita el peor caso: si el
   * trabajo falla —el proveedor caído, por ejemplo— el horizonte ya está
   * puesto, así que no se reintenta cada 60 segundos contra la base. Un fallo
   * no puede convertirse en la factura de antes.
   */
  assert.equal(await tregua.tocaTrabajar(new Date(ahora.getTime() + 60_000)), false,
    'el segundo latido ya espera, aunque el primero hubiera fallado');
});

/* ==================== La hora de Costa Rica ==================== */

test('el texto de la fecha va en hora de Costa Rica, no del servidor', () => {
  /*
   * ⚠️ La consulta compara `api_date` como TEXTO, y `api_date` está en hora de
   * Costa Rica. Formatear en la zona del servidor —UTC en Render— desplazaría
   * la comparación seis horas y el horizonte se calcularía sobre los partidos
   * equivocados. Es el bicho de la Entrada 086, que ya costó una vez.
   */
  assert.equal(tregua.textoDeFecha(new Date('2026-11-14T02:30:00Z')), '2026-11-13 20:30');
  assert.equal(tregua.textoDeFecha(new Date('2026-11-14T12:00:00Z')), '2026-11-14 06:00');
});

/* ==================== Las vencidas de hace meses ==================== */

/*
 * ============================================================================
 * ⛔ LA PRUEBA QUE HABRÍA EVITADO SUBIR ESTO INÚTIL
 * ============================================================================
 *
 * La primera versión del módulo no habría ahorrado un céntimo, y no lo dijo
 * ninguna prueba: lo dijo medir contra producción antes de subirlo.
 *
 * En la caché de verdad había **19 fixtures con la consulta vencida hacía 60
 * días**, porque sus partidos pertenecen a quinielas ELIMINADAS y el censo sólo
 * recorre las activas. Con eso `min(proxima_consulta)` caía siempre en el
 * pasado, el horizonte era siempre «ahora», y los relojes no dormían nunca.
 */
test('⛔ una consulta vencida hace meses NO mantiene despierto a nadie', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  /* Un partido de verdad, lejano: lo único que debería fijar el horizonte. */
  await fixtures.guardar(descriptor('vivo', '2026-11-20 15:00'), { evento: evento(''), ahora });

  /* Y el zombi: de una quiniela borrada, con la consulta vencida hace 60 días. */
  await fixtures.guardar(descriptor('zombi', '2026-09-18 10:00'), { evento: evento(''), ahora });
  await db.consulta(
    `UPDATE fixtures SET proxima_consulta = $1 WHERE clave = 'zombi'`,
    [new Date(ahora.getTime() - 60 * 24 * 60 * 60 * 1000)]);

  const horizonte = await tregua.recalcular(ahora);

  assert.ok(horizonte > ahora.getTime(),
    '⛔ si el horizonte es «ahora», la tregua no duerme y no ahorra nada');

  assert.equal(tregua.hayQueEsperar(new Date(ahora.getTime() + 60_000)), true,
    'el siguiente latido tiene que poder esperar');
});

/*
 * ⚠️ Y EL CONTROL, que es el que impide pasarse de listo: una vencida RECIENTE
 * sí tiene que despertar. Sin esta prueba, perdonar las vencidas podría
 * perdonar también la de un partido que acaba de empezar.
 */
test('una consulta vencida hace un minuto SÍ despierta', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  await fixtures.guardar(descriptor('f1', '2026-11-20 15:00'), { evento: evento(''), ahora });
  await db.consulta(
    `UPDATE fixtures SET proxima_consulta = $1 WHERE clave = 'f1'`,
    [new Date(ahora.getTime() - 60_000)]);

  const horizonte = await tregua.recalcular(ahora);

  assert.equal(horizonte, ahora.getTime(),
    'una consulta que acaba de vencer es trabajo para ahora mismo');
  assert.equal(tregua.hayQueEsperar(ahora), false);
});

test('la gracia son 12 horas: el doble de la ventana más larga del sincronizador', () => {
  /*
   * ⭐ No es un número cómodo: un partido que se sigue de verdad se consulta
   * como muy tarde cada 6 h —`VENTANAS_MS.lejano`—, así que una vencida de más
   * de eso significa que nadie la sigue. Se perdona el doble para no confundir
   * un ciclo retrasado por un reinicio con un partido abandonado.
   */
  assert.equal(tregua.GRACIA_VENCIDA_MS, 2 * fixtures.VENTANAS_MS.lejano,
    'si alguien cambia la ventana del sincronizador, esta gracia tiene que seguirla');
});

/* ==================== La pasada pedida (las trivias) ==================== */

/*
 * ⛔ Una trivia se resuelve cuando su partido TERMINA. Pero al terminar, el
 * fixture deja de pedir consultas, así que si era lo último vivo el horizonte
 * salta al tope y las trivias esperarían **hasta seis horas**.
 *
 * La tregua no puede verlo sola: la tabla de trivias lleva RLS y consultarla
 * obligaría a recorrer las quinielas activas una por una, justo el coste que
 * este módulo evita. Lo avisa el sincronizador, que sí lo sabe.
 */
test('⛔ una pasada pedida adelanta el horizonte', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  /* Todo terminado: el horizonte se iría al tope de seis horas. */
  await fixtures.guardar(descriptor('f1', '2026-11-13 18:00'),
    { evento: evento('Finished'), ahora });
  await tregua.recalcular(ahora);

  assert.equal(tregua.hayQueEsperar(new Date(ahora.getTime() + 60_000)), true,
    'el control: sin pedir nada, estaría durmiendo');

  /* Lo que hace el sincronizador al ver terminar un partido. */
  tregua.pedirPasada(ahora.getTime() + 60_000);

  assert.equal(tregua.hayQueEsperar(new Date(ahora.getTime() + 30_000)), true,
    'a los 30 segundos todavía no');
  assert.equal(tregua.hayQueEsperar(new Date(ahora.getTime() + 61_000)), false,
    'al minuto sí: las trivias se resuelven en la siguiente pasada');
});

test('una pasada pedida NUNCA retrasa el horizonte', async () => {
  const ahora = new Date('2026-11-14T00:00:00Z');

  /* Un partido en vivo: el horizonte es de un minuto. */
  await fixtures.guardar(descriptor('f1', '2026-11-13 18:00'), { evento: evento('67'), ahora });
  const antes = await tregua.recalcular(ahora);

  /*
   * ⚠️ Pedir una pasada para dentro de una hora no puede empujar el horizonte
   * de un partido en vivo hasta dentro de una hora. Se queda con la más
   * temprana: pedir es adelantar, nunca retrasar.
   */
  tregua.pedirPasada(ahora.getTime() + 60 * 60_000);

  assert.equal(tregua.estado().horizonte, antes,
    'una petición más tardía no puede dormir un partido que se está jugando');
});

test('una pasada pedida con basura se ignora', () => {
  tregua.pedirPasada(undefined);
  tregua.pedirPasada(NaN);
  tregua.pedirPasada('mañana');
  assert.equal(tregua.estado().horizonte, null,
    'un valor que no es una fecha no puede dejar el horizonte en un sitio raro');
});

/*
 * El borrador de la próxima jornada de una liga (tajada 3 de §22).
 *
 * ⚠️ Sin base y sin red: `proponer()` es aritmética sobre una lista, como
 * `cobros.js`. Lo que se prueba es la REGLA —cuál toca y por qué— y eso se puede
 * comprobar entero sin levantar nada.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const borradores = require('../src/borradores');

/** Un partido del proveedor, ya traducido por `mapearEvento`. */
const p = (equipo1, fecha, ronda) =>
  ({ equipo1, equipo2: 'Rival', fecha, ronda, apiFixtureId: `${equipo1}-${fecha}` });

/* Las 14:00 del 20 de septiembre en Costa Rica. */
const AHORA = new Date('2026-09-20T20:00:00Z');

/* ==================== Cuál toca ==================== */

test('propone la ronda más temprana que todavía no está metida', async () => {
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('A', '2026-09-27 15:00', '10'),
      p('B', '2026-09-21 15:00', '9'),
      p('C', '2026-09-21 17:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ok, true);
  assert.equal(r.ronda, '9');
  assert.equal(r.nombre, 'Jornada 9');
  assert.deepEqual(r.partidos.map(x => x.equipo1), ['B', 'C'], 'y ordenados por hora');
});

test('⛔ una ronda que ya está en una jornada tuya NO se vuelve a proponer', async () => {
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [p('A', '2026-09-21 15:00', '9'), p('B', '2026-09-27 15:00', '10')],
    rondasUsadas: ['9']
  });

  assert.equal(r.ronda, '10', 'salta a la siguiente');
});

test('⛔ el orden de las rondas lo da la FECHA, no el nombre', async () => {
  /*
   * «10» < «9» alfabéticamente, y «Quarter-finals» no se ordena contra ninguna
   * de las dos de forma que signifique algo. Si esto se ordenara por texto, la
   * jornada propuesta sería la equivocada — y nadie lo vería hasta que los
   * partidos no cuadraran con el calendario.
   */
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('Decima', '2026-09-27 15:00', '10'),
      p('Novena', '2026-09-21 15:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ronda, '9', 'la 9 va antes que la 10 porque se juega antes');
});

test('una ronda de nombre se propone igual, y conserva su nombre', async () => {
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [p('A', '2026-09-22 19:00', 'Quarter-finals')],
    rondasUsadas: []
  });

  assert.equal(r.ronda, 'Quarter-finals');
  assert.equal(r.nombre, 'Quarter-finals', '«Jornada Quarter-finals» no lo dice nadie');
});

/* ==================== Qué cuenta como «ya jugada» ==================== */

test('⛔ una ronda que YA ARRANCÓ no se propone, aunque le queden partidos', async () => {
  /*
   * ⚠️ Esta prueba afirmaba lo CONTRARIO hasta que se probó el borrador contra
   * los datos de verdad. La regla vieja —«vive mientras le quede un partido»—
   * resucitaba jornadas terminadas:
   *
   *   la «jornada 7» de Liga MX tenía tres partidos jugados hacía una semana y
   *   un APLAZADO al 28 de octubre. Se proponía como la jornada que toca, y al
   *   confirmarla habrían quedado dentro tres partidos que nadie puede
   *   pronosticar porque ya se jugaron.
   *
   * Una ronda a medio jugar tampoco sirve: esa jornada nacería con partidos
   * cerrados. Si alguien la quiere igual, el buscador de siempre sigue ahí —
   * pero eso es una decisión suya, no una propuesta nuestra.
   */
  const r = borradores.proponer({
    ahora: AHORA,                                  // 20 sept, 14:00 en Costa Rica
    partidos: [
      p('YaArranco', '2026-09-20 12:00', '7'),     // empezó hace dos horas
      p('Aplazado', '2026-10-28 21:00', '7'),      // el que la «mantenía viva»
      p('Siguiente', '2026-09-27 15:00', '8')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ronda, '8', 'la 7 ya arrancó: se propone la siguiente entera');
});

test('una ronda entera en el futuro sí se propone, aunque dure días', async () => {
  /* El caso normal: viernes a domingo, y todavía no ha empezado. */
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('Viernes', '2026-09-25 19:00', '9'),
      p('Domingo', '2026-09-27 16:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ronda, '9');
  assert.equal(r.partidos.length, 2, 'la ronda entera, no sólo el primero');
});

test('⛔ «ya las creaste todas» y «se acabó la temporada» son motivos distintos', async () => {
  /*
   * La pantalla ofrece cosas distintas según cuál sea: archivar la quiniela
   * tiene sentido al acabarse la liga, y ninguno al ir por delante.
   *
   * ⚠️ Y decirle «ya tienes creadas todas las jornadas» a quien no ha creado
   * NINGUNA —porque la liga terminó— es mentira, de las que hacen dudar de todo
   * lo demás que dice la pantalla.
   */
  const vaPorDelante = borradores.proponer({
    ahora: AHORA,
    partidos: [p('A', '2026-09-27 15:00', '9')],
    rondasUsadas: ['9']
  });
  assert.equal(vaPorDelante.motivo, 'sin_rondas_nuevas');

  const seAcabo = borradores.proponer({
    ahora: AHORA,
    partidos: [p('A', '2026-09-01 15:00', '9')],      // todo en el pasado
    rondasUsadas: []
  });
  assert.equal(seAcabo.motivo, 'temporada_terminada');
  assert.match(borradores.MOTIVOS.temporada_terminada, /se acabó la temporada/);
});

test('una ronda con todos sus partidos jugados se salta', async () => {
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('Vieja', '2026-09-13 15:00', '8'),
      p('Nueva', '2026-09-27 15:00', '10')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ronda, '10');
});

/* ==================== Cuando no hay nada que proponer ==================== */

test('⛔ los tres motivos son distintos, porque llevan a sitios distintos', async () => {
  /*
   * Uno es temporal, otro es un error de elección de liga, y el tercero es el
   * fin de la temporada — que es cuando hay que ofrecer cambiar de liga,
   * archivar la quiniela o seguir a mano. Un único «no hay nada» obligaría a la
   * pantalla a adivinar cuál de los tres es.
   */
  assert.equal(borradores.proponer({ partidos: [], ahora: AHORA }).motivo, 'sin_partidos');

  assert.equal(borradores.proponer({
    ahora: AHORA, partidos: [p('A', '2026-09-21 15:00', '')]
  }).motivo, 'liga_sin_rondas');

  assert.equal(borradores.proponer({
    ahora: AHORA,
    partidos: [p('A', '2026-09-21 15:00', '9')],
    rondasUsadas: ['9']
  }).motivo, 'sin_rondas_nuevas');
});

test('cada motivo tiene un texto que la pantalla puede enseñar tal cual', async () => {
  for (const motivo of ['sin_partidos', 'liga_sin_rondas', 'sin_rondas_nuevas']) {
    assert.ok(borradores.MOTIVOS[motivo], `falta el texto de ${motivo}`);
  }
});

/* ==================== La ronda a medio publicar ==================== */

test('⛔ avisa cuando la ronda trae menos partidos que la anterior', async () => {
  /*
   * Es el riesgo que este borrador introduce y que no existía armando a mano: el
   * proveedor a veces publica seis de nueve. Confirmarla así dejaría a la gente
   * pronosticando seis y los otros tres aparecerían con la jornada ya abierta.
   */
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('a1', '2026-09-13 15:00', '8'), p('a2', '2026-09-13 17:00', '8'),
      p('a3', '2026-09-13 19:00', '8'), p('a4', '2026-09-14 15:00', '8'),
      p('b1', '2026-09-21 15:00', '9'), p('b2', '2026-09-21 17:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ronda, '9');
  assert.match(r.aviso, /4 partidos y ésta trae 2/);
});

test('no avisa cuando la ronda viene completa', async () => {
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('a1', '2026-09-13 15:00', '8'), p('a2', '2026-09-13 17:00', '8'),
      p('b1', '2026-09-21 15:00', '9'), p('b2', '2026-09-21 17:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.aviso, null);
});

test('⚠️ el aviso NO bloquea: la propuesta sale igual', async () => {
  /*
   * Bloquear sería peor. Hay jornadas que de verdad traen menos partidos —una
   * fecha FIFA, un aplazamiento— y entonces la función dejaría de servir justo
   * cuando más falta hace. Se avisa y decide quien confirma.
   */
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('a1', '2026-09-13 15:00', '8'), p('a2', '2026-09-13 17:00', '8'),
      p('b1', '2026-09-21 15:00', '9')
    ],
    rondasUsadas: []
  });

  assert.equal(r.ok, true);
  assert.equal(r.partidos.length, 1);
  assert.ok(r.aviso);
});

/* ==================== El huso ==================== */

test('⛔ «ya jugado» no se mueve con el huso del servidor', async () => {
  /*
   * `fecha` viene en hora de Costa Rica y Render corre en UTC. Comparar con la
   * hora del servidor daría por jugadas seis horas de partidos — o al revés—,
   * sin dar ningún error. Es el fallo de la Entrada 086.
   */
  const partidos = [
    p('Ya', '2026-09-20 12:00', '8'),
    p('Falta', '2026-09-20 19:00', '9')
  ];
  const original = process.env.TZ;

  try {
    for (const zona of ['UTC', 'America/Costa_Rica', 'Asia/Tokyo']) {
      process.env.TZ = zona;
      const r = borradores.proponer({ ahora: AHORA, partidos, rondasUsadas: [] });
      assert.equal(r.ronda, '9', `con TZ=${zona} deberia proponer la 9`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('⛔ los partidos salen ordenados aunque el proveedor los mande revueltos', async () => {
  /*
   * ⚠️ Esta prueba nació de una mutación que no caía: quitar el `sort` de dentro
   * de la ronda no rompía nada, porque las demás pruebas ya le pasaban los
   * partidos en orden. Probaban el resultado sin ejercitar la causa.
   *
   * El proveedor no garantiza ningún orden. Una jornada cuyos partidos salen
   * revueltos se ve mal, y encima confunde a quien la revisa antes de
   * confirmarla — que es justo el momento en que hay que fijarse.
   */
  const r = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('Domingo', '2026-09-22 16:00', '9'),
      p('Viernes', '2026-09-21 19:00', '9'),
      p('Sabado', '2026-09-22 12:00', '9')
    ],
    rondasUsadas: []
  });

  assert.deepEqual(r.partidos.map(x => x.equipo1), ['Viernes', 'Sabado', 'Domingo']);
  assert.equal(r.arranque, '2026-09-21 19:00', 'y el arranque es el del primero');
});

test('⛔ una ronda recortada por la ventana no se cuela como nueva', async () => {
  /*
   * El hueco que abre pedirle al proveedor sólo «de hoy en adelante»: una ronda
   * a medio jugar llega sin sus partidos pasados, y su arranque APARENTE está en
   * el futuro. Sin más, se propondría como nueva.
   *
   * Aquí se comprueba el otro lado: si la ventana SÍ trae los partidos pasados
   * de esa ronda —que es lo que hace la ruta, pidiendo desde hace una semana—,
   * el arranque real se ve y la ronda se descarta.
   */
  const recortada = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('SoloElFuturo', '2026-09-21 19:00', '9'),
      p('Siguiente', '2026-09-28 15:00', '10')
    ],
    rondasUsadas: []
  });
  assert.equal(recortada.ronda, '9', 'sin los pasados, parece nueva');

  const entera = borradores.proponer({
    ahora: AHORA,
    partidos: [
      p('YaJugado', '2026-09-19 15:00', '9'),        // lo que la ventana ancha añade
      p('SoloElFuturo', '2026-09-21 19:00', '9'),
      p('Siguiente', '2026-09-28 15:00', '10')
    ],
    rondasUsadas: []
  });
  assert.equal(entera.ronda, '10',
    'con la ronda entera se ve que ya arrancó, y se propone la siguiente');
});

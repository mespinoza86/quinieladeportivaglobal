/*
 * Las reglas del refresco de resultados.
 *
 * ============================================================================
 * ⛔ POR QUÉ ESTO ES UNA PRUEBA DE NODE Y NO DE NAVEGADOR
 * ============================================================================
 *
 * Comprobar «no pide nada con la pestaña escondida» en un navegador de verdad
 * cuesta setenta segundos de espera —el ciclo es de un minuto— y encima no es
 * fiable: Playwright no esconde una pestaña de forma reproducible cuando corre
 * sin ventana, y el primer intento devolvió una petición donde esperaba cero.
 *
 * ⚠️ Una prueba lenta Y frágil es de las que se acaban borrando. Estas reglas
 * son lógica pura —mirar el reloj, comparar dos textos, decidir si llamar— así
 * que se comprueban donde son: en la lógica, en milisegundos y sin dudas.
 *
 * La prueba de navegador que queda (`test/e2e/refresco-vivo.spec.js`) demuestra
 * lo que esto NO puede: que en una pantalla real, con datos reales, la lista no
 * se repinta sola.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FUENTE = fs.readFileSync(
  path.join(__dirname, '..', 'private', 'js', 'refresco-vivo.js'), 'utf8');

/**
 * Un entorno de mentira con el reloj en la mano.
 *
 * ⭐ `setInterval` se sustituye por algo que guarda la función en vez de
 * programarla: así la prueba decide cuándo pasa un minuto, y no hay que
 * esperarlo. Sin esto cada comprobación costaría sesenta segundos.
 */
function montar({ oficiales = [], escondida = false } = {}) {
  const pedidas = [];
  let tic = null;

  const documento = {
    get hidden() { return escondida; },
    addEventListener() {}
  };

  const contexto = {
    document: documento,
    setInterval(fn) { tic = fn; return 1; },
    clearInterval() { tic = null; },
    Date,
    JSON,
    Math,
    String,
    Array,
    encodeURIComponent,

    async fetch(url) {
      pedidas.push(url);
      return {
        ok: true,
        json: async () => [{ nombre: 'J1', partidos: estado.oficiales }]
      };
    }
  };

  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(FUENTE, contexto, { filename: 'refresco-vivo.js' });

  const estado = { oficiales };

  return {
    contexto,
    pedidas,
    estado,
    /** Cambia lo que devolverá el servidor a partir de ahora. */
    servir(nuevos) { estado.oficiales = nuevos; },
    /** Hace pasar un ciclo completo. */
    async pasaUnMinuto() { if (tic) await tic(); },
    sigueVivo() { return tic !== null; },
    esconder(v) { escondida = v; }
  };
}

const EN_JUEGO = [{ equipo1: 'A', equipo2: 'B', marcador1: 0, marcador2: 0, estado: 'LIVE' }];
const TERMINADO = [{ equipo1: 'A', equipo2: 'B', marcador1: 1, marcador2: 0, estado: 'TC' }];

test('⛔ si no cambió nada, NO se repinta', async () => {
  /*
   * Es la queja exacta de Marco: «se me reinicia todo cada 20 o 30 segundos».
   * Antes cada vuelta borraba y redibujaba lo idéntico, y con ello el sitio
   * donde ibas leyendo.
   */
  const m = montar({ oficiales: EN_JUEGO });

  let repintados = 0;
  m.contexto.refrescoEnVivo(() => 'J1', () => { repintados++; });

  await m.pasaUnMinuto();   // la primera mirada sólo recuerda
  await m.pasaUnMinuto();
  await m.pasaUnMinuto();

  assert.equal(repintados, 0, 'se repintó sin que hubiera nada nuevo');
  assert.equal(m.pedidas.length, 3, 'una consulta por minuto, ni más ni menos');
});

test('⭐ y si SÍ cambió, se repinta una vez', async () => {
  /*
   * El caso de control. Sin él, «cero repintados» no se distingue de «el
   * refresco está roto del todo» — que es como se queda una pantalla congelada
   * sin que nadie se entere.
   */
  const m = montar({ oficiales: EN_JUEGO });

  let repintados = 0;
  m.contexto.refrescoEnVivo(() => 'J1', () => { repintados++; });

  await m.pasaUnMinuto();
  assert.equal(repintados, 0);

  m.servir([{ equipo1: 'A', equipo2: 'B', marcador1: 1, marcador2: 0, estado: 'LIVE' }]);
  await m.pasaUnMinuto();
  assert.equal(repintados, 1, 'llegó un gol y la pantalla no se enteró');

  /* Y no insiste: la vuelta siguiente ya no tiene nada nuevo que contar. */
  await m.pasaUnMinuto();
  assert.equal(repintados, 1);
});

test('⛔ con la pestaña escondida no se pide NADA', async () => {
  /*
   * Un móvil en el bolsillo no necesita el minuto 37. Y cada petición se paga:
   * la cuota de Neon ya se agotó una vez por algo que parecía inofensivo.
   */
  const m = montar({ oficiales: EN_JUEGO, escondida: true });

  m.contexto.refrescoEnVivo(() => 'J1', () => {});

  await m.pasaUnMinuto();
  await m.pasaUnMinuto();

  assert.equal(m.pedidas.length, 0, 'preguntó con la pantalla en el bolsillo');
});

test('⛔ sin jornada que mirar tampoco se pide nada', async () => {
  const m = montar({ oficiales: EN_JUEGO });

  m.contexto.refrescoEnVivo(() => null, () => {});
  await m.pasaUnMinuto();

  assert.equal(m.pedidas.length, 0);
});

test('⛔ cuando todo terminó, el reloj se apaga PARA SIEMPRE', async () => {
  /*
   * Un partido terminado no puede cambiar. Seguir preguntando por él cada
   * minuto, durante todo el tiempo que la pestaña siga abierta, es el coste que
   * crece solo sin que nadie toque nada — el mismo que agotó la cuota.
   */
  const m = montar({ oficiales: TERMINADO });

  m.contexto.refrescoEnVivo(() => 'J1', () => {});

  await m.pasaUnMinuto();

  assert.equal(m.sigueVivo(), false, 'sigue preguntando por un partido acabado');
  assert.equal(m.pedidas.length, 1, 'una sola consulta, y a callar');
});

test('⚠️ la primera mirada recuerda, no repinta', async () => {
  /*
   * Sin esto la primera vuelta comparaba contra `null` —que no es igual a
   * nada— y daba el cambio por bueno SIEMPRE: la pantalla se repintaba al
   * minuto de entrar, que es justo lo que se venía a quitar.
   *
   * Lo destapó la prueba de navegador, no la lectura del código.
   */
  const m = montar({ oficiales: EN_JUEGO });

  let repintados = 0;
  m.contexto.refrescoEnVivo(() => 'J1', () => { repintados++; });

  await m.pasaUnMinuto();

  assert.equal(repintados, 0, 'repintó en la primera vuelta, sin nada que actualizar');
  assert.equal(m.pedidas.length, 1, 'pero sí preguntó: necesita con qué comparar');
});

test('⚠️ un fallo de red no apaga el reloj', async () => {
  /*
   * Una caída pasajera —o el servidor reiniciándose— no puede dejar la pantalla
   * congelada para siempre. Al minuto se vuelve a intentar.
   */
  const m = montar({ oficiales: EN_JUEGO });

  let repintados = 0;
  m.contexto.fetch = async () => { throw new Error('sin red'); };
  m.contexto.refrescoEnVivo(() => 'J1', () => { repintados++; });

  await m.pasaUnMinuto();
  assert.equal(m.sigueVivo(), true, 'un fallo de red lo dejó muerto');
  assert.equal(repintados, 0);
});

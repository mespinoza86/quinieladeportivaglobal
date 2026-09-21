/*
 * El tema de día, y que nada se quede ilegible en él.
 *
 * ============================================================================
 * ⛔ UN COLOR MAL PUESTO NO DA NINGÚN ERROR
 * ============================================================================
 *
 * Ya pasó dos veces en este proyecto: un `<select>` blanco sobre blanco que
 * parecía vacío, y unas tarjetas que se seguían viendo porque una regla tapaba
 * a `hidden`. Nada falla, nada se registra: simplemente no se lee.
 *
 * Con tres temas esa superficie se triplica —39 pantallas por tema— y nadie va
 * a mirarlas todas a mano cada vez. Así que el contraste se mide.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/**
 * Contraste entre dos colores, según la fórmula de la WCAG.
 *
 * ⚠️ NO vale comparar luminancias a ojo ni restar canales: el ojo no responde
 * igual a los tres colores, y un azul oscuro y un rojo oscuro con el mismo
 * «brillo» de media se leen distinto. Ésta es la cuenta que usa todo el mundo.
 */
function medirEnLaPagina() {
  const canal = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  /*
   * ⛔ HEXADECIMAL Y `rgb()`, LAS DOS FORMAS.
   *
   * La primera versión sólo sacaba números con `/[0-9.]+/`, y de `#16a34a`
   * extraía «16» y «34»: dos canales en vez de tres, y la cuenta salía `NaN`.
   *
   * ⚠️ El `NaN` fue una suerte. Con un hexadecimal como `#224466` habría sacado
   * tres números perfectamente creíbles —224, 466 y nada— y la prueba habría
   * dado una cifra de contraste inventada, en verde.
   */
  const numeros = color => {
    const texto = String(color).trim();

    const hex = texto.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const d = hex[1].length === 3
        ? hex[1].split('').map(c => c + c).join('')
        : hex[1];
      return [0, 2, 4].map(i => parseInt(d.slice(i, i + 2), 16));
    }

    const m = texto.match(/[0-9.]+/g);
    if (!m || m.length < 3) throw new Error('no sé leer el color: ' + texto);
    return m.slice(0, 3).map(Number);
  };

  const luminancia = ([r, g, b]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);

  const contraste = (frente, fondo) => {
    const a = luminancia(numeros(frente));
    const b = luminancia(numeros(fondo));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  /*
   * Cada pieza con el fondo REAL sobre el que se pinta. Un color no es legible
   * o ilegible por sí solo: lo es contra lo que tiene detrás.
   */
  const fondoPagina = getComputedStyle(document.body).backgroundColor;

  const piezas = [
    ['texto normal',      'body'],
    ['texto secundario',  '.helper-text'],
    ['rótulo de campo',   '.field-label'],
    ['título',            'h2'],
    ['texto de un panel', '.app-panel']
  ];

  const salida = [];

  for (const [nombre, selector] of piezas) {
    const el = document.querySelector(selector);
    if (!el) { salida.push({ nombre, falta: true }); continue; }
    const color = getComputedStyle(el).color;
    salida.push({ nombre, color, fondo: fondoPagina, ratio: contraste(color, fondoPagina) });
  }

  /* Los campos de formulario, contra su propio fondo y no el de la página. */
  const campo = document.querySelector('input');
  if (campo) {
    const e = getComputedStyle(campo);
    salida.push({
      nombre: 'campo de texto', color: e.color, fondo: e.backgroundColor,
      ratio: contraste(e.color, e.backgroundColor)
    });
  }

  /* Y el botón principal, contra el verde de su degradado. */
  const boton = document.querySelector('button:not(.boton-tema)');
  if (boton) {
    const verde = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary').trim();
    const color = getComputedStyle(boton).color;
    salida.push({ nombre: 'texto del botón', color, fondo: verde, ratio: contraste(color, verde) });
  }

  return salida;
}

test('⛔ el tema de día no deja nada ilegible', async ({ page }) => {
  const datos = await registrarse(page, 'dia');
  await crearQuiniela(page, 'Dia');

  await page.goto('/quinielas.html');
  await page.locator('#panelCrear').waitFor({ state: 'visible' });

  /* Se pulsa el botón de verdad, que es como lo hará una persona. */
  await page.locator('#botonTema').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'dia');

  const medidas = await page.evaluate(medirEnLaPagina);

  for (const m of medidas) {
    expect(m.falta, `no encontré «${m.nombre}»: la prueba tiene un agujero`).toBeFalsy();

    /*
     * ⚠️ 4.5 es el mínimo de la WCAG para texto normal. No es una cifra que me
     * haya inventado: por debajo, mucha gente con la vista algo cansada deja de
     * distinguir las letras del fondo.
     */
    expect(m.ratio,
      `«${m.nombre}» en tema de día: ${m.color} sobre ${m.fondo} da ${m.ratio?.toFixed(2)}, ` +
      'y hace falta 4.5 para que se lea')
      .toBeGreaterThanOrEqual(4.5);
  }
});

test('⛔ el tema elegido sobrevive a cambiar de pantalla', async ({ page }) => {
  /*
   * ⚠️ Esto es lo que separa un botón que funciona de uno que parece funcionar.
   * Sin guardarlo, el tema se pierde en cuanto navegas — y como la primera
   * pantalla sí cambia, parece que va bien.
   */
  const datos = await registrarse(page, 'persiste');
  await crearQuiniela(page, 'Persiste');

  await page.goto('/quinielas.html');
  await page.locator('#botonTema').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'dia');

  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'dia');

  /*
   * ⚠️ El ciclo COMPLETO, y con la vuelta al principio.
   *
   * Esta prueba daba por hecho que había dos temas: pulsaba una vez más y
   * esperaba volver al oscuro. Al añadir la cancha se rompió — y menos mal,
   * porque una prueba que cuenta pulsaciones sin mirar dónde acaba es una
   * prueba que un día audita un tema distinto del que dice.
   */
  await page.locator('#botonTema').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'cancha');

  await page.locator('#botonTema').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'oscuro');

  await page.goto('/quinielas.html');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'oscuro');
});

test('⛔ el botón está en todas las pantallas, no sólo en la portada', async ({ page }) => {
  /*
   * Lo monta `tema.js`, que va en las 39 páginas. Si alguna se quedó sin la
   * etiqueta, ahí el tema no se aplica NI se puede cambiar — y quien entre verá
   * la pantalla en oscuro mientras el resto de la aplicación está en día.
   */
  const datos = await registrarse(page, 'todas');
  await crearQuiniela(page, 'Todas');

  for (const pantalla of ['index.html', 'quinielas.html', 'jornadas.html',
                          'llenar_jornada_user.html', 'ver_jornadas.html',
                          'configuracion-quiniela.html', 'adminmode.html']) {
    await page.goto('/' + pantalla);
    await expect(page.locator('#botonTema'), `${pantalla} se quedó sin el botón`)
      .toBeVisible();
  }
});

/*
 * ============================================================================
 * ⛔ LA AUDITORÍA: TODO EL TEXTO DE TODAS LAS PANTALLAS
 * ============================================================================
 *
 * La prueba de arriba mira cinco piezas escogidas a mano. Marco encontró SEIS
 * fallos que no estaban entre ellas: rótulos blancos sobre velos claros en
 * llenar quiniela, resultados oficiales y puntos.
 *
 * ⚠️ Una prueba que mira lo que ya sabes que falla no encuentra nada nuevo.
 * Ésta recorre cada pantalla y mide CADA texto contra el fondo que de verdad
 * tiene detrás, así que encuentra los que nadie ha mirado todavía.
 */
function auditarContraste() {
  const canal = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  /** Un color a `[r, g, b, alfa]`. */
  const partes = color => {
    const m = String(color).match(/[0-9.]+/g);
    if (!m) return [0, 0, 0, 0];
    return [Number(m[0]), Number(m[1]), Number(m[2]), m.length > 3 ? Number(m[3]) : 1];
  };

  /*
   * ⛔ LAS CAPAS SE MEZCLAN, NO SE MIRAN SUELTAS.
   *
   * Un verde al 25 % sobre blanco NO es verde: es verde pálido, y el texto
   * oscuro se lee perfectamente encima. La sonda anterior comparaba contra el
   * color crudo del tramo y denunciaba media portada.
   *
   * ⚠️ Esto es exactamente lo que hace el navegador al pintar. Sin ello, una
   * sonda de contraste dice que no se lee lo que se lee de sobra — y a la
   * tercera falsa alarma deja de mirarse.
   */
  const mezclar = (encima, debajo) => {
    const [r1, g1, b1, a1] = partes(encima);
    const [r2, g2, b2] = partes(debajo);
    return [
      r1 * a1 + r2 * (1 - a1),
      g1 * a1 + g2 * (1 - a1),
      b1 * a1 + b2 * (1 - a1),
      1
    ];
  };

  const lum = ([r, g, b]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);

  const contraste = (frente, fondo) => {
    /* El texto también puede ser translúcido: se mezcla con su propio fondo. */
    const f = mezclar(frente, fondo);
    const x = lum(f), y = lum(fondo);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  /** Las capas de fondo que declara un elemento, de abajo arriba. */
  const capasDe = el => {
    const est = getComputedStyle(el);
    const capas = [];

    const fondo = est.backgroundColor;
    if (partes(fondo)[3] > 0) capas.push(fondo);

    const img = est.backgroundImage;
    if (img && img.includes('gradient')) {
      for (const c of img.match(/rgba?\([^)]*\)/g) || []) {
        if (partes(c)[3] > 0) capas.push(c);
      }
    }
    return capas;
  };

  /*
   * Todos los fondos posibles bajo un texto: se parte del fondo de la página y
   * se van mezclando las capas de cada antepasado, de fuera hacia dentro.
   *
   * Un degradado da VARIOS resultados —uno por tramo—, y se toma el que peor
   * sale: si el texto se lee sobre el extremo más desfavorable, se lee sobre
   * todo el degradado.
   */
  const fondosBajo = el => {
    const cadena = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) cadena.unshift(n);

    let posibles = [partes(getComputedStyle(document.body).backgroundColor)];

    for (const nodo of cadena) {
      for (const capa of capasDe(nodo)) {
        posibles = posibles.map(base => mezclar(capa, base));
      }
    }
    return posibles;
  };

  /*
   * ⛔ LO PLEGADO TAMBIÉN SE MIDE.
   *
   * La primera versión sólo miraba lo que estaba a la vista, y por eso se le
   * escaparon cinco rótulos dorados: viven dentro de secciones que se abren al
   * pulsar «Ver resultados» y nacen con `display: none`.
   *
   * ⚠️ Marco encontró uno de ellos a mano. Una auditoría que sólo mira la
   * primera pantalla deja fuera justo lo que nadie revisa — que es donde estos
   * fallos sobreviven meses.
   *
   * Se despliega marcándolos, no pulsando: un click de verdad podría navegar o
   * cambiar datos, y esto sólo quiere mirar.
   */
  for (const detalle of document.querySelectorAll('.players-detail, .trivia-detail')) {
    detalle.classList.add('open');
  }
  for (const d of document.querySelectorAll('details')) d.open = true;

  const malos = [];
  const vistos = new Set();

  for (const el of document.querySelectorAll('*')) {
    /* Sólo el elemento que CONTIENE el texto, no sus contenedores. */
    const propio = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!propio) continue;

    const caja = el.getBoundingClientRect();
    if (!caja.width || !caja.height) continue;

    const est = getComputedStyle(el);
    if (est.visibility === 'hidden' || est.opacity === '0') continue;

    const fondos = fondosBajo(el);
    const peor = Math.min(...fondos.map(f => contraste(est.color, f)));
    if (peor >= 4.5) continue;

    const firma = el.tagName + '.' + el.className + '|' + est.color;
    if (vistos.has(firma)) continue;
    vistos.add(firma);

    malos.push({
      pieza: '<' + el.tagName.toLowerCase() + '>'
        + (el.className ? '.' + String(el.className).slice(0, 36) : ''),
      color: est.color,
      fondo: fondos.map(f => 'rgb(' + f.slice(0, 3).map(Math.round).join(',') + ')').join(' / '),
      ratio: Number(peor.toFixed(2)),
      muestra: (el.textContent || '').trim().slice(0, 30)
    });
  }
  return malos;
}

const PANTALLAS_AUDITADAS = [
  'index.html', 'quinielas.html', 'jornadas.html', 'llenar_jornada_user.html',
  'llenar_jornada.html', 'ver_jornadas.html', 'ver-resultados-oficiales.html',
  'agregar-resultados-oficiales.html', 'resultados-totales.html',
  'ver_resultados_totales_de_jugadores.html', 'clasificacion-jornada.html',
  'configuracion-quiniela.html', 'adminmode.html', 'jugadores.html',
  'miembros.html', 'cobros.html', 'llenar_trivia.html'
];

/*
 * ⭐ LA MISMA AUDITORÍA, PARA CADA TEMA QUE NO SEA EL OSCURO.
 *
 * ⚠️ Escribirla una vez para el día y copiarla para la cancha habría sido la
 * forma segura de que se separaran: se arregla un detalle en una y la otra se
 * queda con el fallo. Y el tema nuevo es justo el que menos ojos ha tenido
 * encima.
 *
 * El oscuro no entra porque es el de fábrica y su contraste lleva un año
 * mirándose; lo que hace falta comprobar es lo que se añade encima.
 */
for (const { id, nombre, vueltas } of [
  { id: 'dia',    nombre: 'de día', vueltas: 1 },
  { id: 'cancha', nombre: 'de cancha', vueltas: 2 }
]) {

test(`⛔ ningún texto se queda ilegible en modo ${nombre}, en ninguna pantalla`, async ({ page }) => {
  test.setTimeout(180000);

  const datos = await registrarse(page, 'audita' + id);
  await crearQuiniela(page, 'Audita ' + id);
  await activarAdminMode(page, datos.password);

  await page.evaluate(async () => {
    await fetch('/api/jornadas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'J1', partidos: [
        { equipo1: 'Alfa', equipo2: 'Beta', apiDate: '2020-01-01 15:00', comodin: true },
        { equipo1: 'Gamma', equipo2: 'Delta', apiDate: '2099-01-01 17:00' }
      ] })
    });
    await fetch('/api/resultados-oficiales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jornada: 'J1', resultados: [
        { marcador1: 2, marcador2: 0, final: true }, { marcador1: '', marcador2: '' }
      ] })
    });
  });

  /*
   * El botón va pasando de tema en tema: una pulsación llega al día, dos a la
   * cancha. Se comprueba el resultado, porque contar pulsaciones a ciegas es
   * cómo una prueba acaba auditando un tema distinto del que dice.
   */
  await page.goto('/index.html');
  for (let i = 0; i < vueltas; i++) await page.locator('#botonTema').click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', id);

  const problemas = [];

  for (const pantalla of PANTALLAS_AUDITADAS) {
    const r = await page.goto('/' + pantalla);
    expect(r?.status(), `${pantalla} no se pudo abrir`).toBeLessThan(400);

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    /*
     * ⛔ HAY PANTALLAS QUE NO ENSEÑAN NADA HASTA QUE PULSAS.
     *
     * «Resultados totales» empieza con un desplegable y un botón: sin pulsarlo
     * sólo se ve «Todavía no hay partidos cerrados», y la auditoría daba la
     * pantalla por buena sin haber mirado una sola fila.
     *
     * ⚠️ Fue así como se escaparon cinco rótulos dorados que Marco encontró a
     * mano. Una auditoría que sólo ve la primera pantalla deja fuera justo lo
     * que nadie revisa.
     */
    const verResultados = page.locator('#ver-resultados-btn');
    if (await verResultados.count()) {
      await verResultados.click();
      await page.waitForTimeout(500);
    }

    for (const m of await page.evaluate(auditarContraste)) {
      problemas.push(`${pantalla}  ${m.ratio}  ${m.pieza}  ${m.color} sobre ${m.fondo}  «${m.muestra}»`);
    }
  }

  expect(problemas.join('\n'),
    `textos que no se leen en modo ${nombre}:\n` + problemas.join('\n')).toBe('');
});

}

/*
 * Fase B: qué es "la jornada actual", vista desde las pantallas.
 *
 * La regla —la última jornada que se creó— está probada en la suite rápida.
 * Lo que estas pruebas cubren es lo otro, que era el problema de verdad: que
 * las tres pantallas la CONSUMAN en vez de volver a deducirla cada una por su
 * cuenta, que es como llegaron a discrepar.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/**
 * Un `apiDate` a tantos días de hoy.
 *
 * Relativo y no fijo: una fecha escrita a mano convierte la prueba en una bomba
 * de relojería que pasa hoy y falla el año que viene.
 */
function enDias(dias, hora = 15) {
  const fecha = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  const dd = n => String(n).padStart(2, '0');
  return `${fecha.getUTCFullYear()}-${dd(fecha.getUTCMonth() + 1)}-${dd(fecha.getUTCDate())} ${dd(hora)}:00`;
}

async function crearJornada(page, nombre, partidos) {
  const resultado = await page.evaluate(async ([nombreJornada, listaPartidos]) => {
    const respuesta = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombreJornada, partidos: listaPartidos })
    });
    return { ok: respuesta.ok, cuerpo: await respuesta.json() };
  }, [nombre, partidos]);

  expect(resultado.ok, `No se creó la jornada: ${JSON.stringify(resultado.cuerpo)}`).toBe(true);
}

/**
 * Deja la quiniela con dos jornadas, y la que se crea LA ÚLTIMA es la que tiene
 * los partidos MÁS VIEJOS.
 *
 * Ese cruce es a propósito: distingue qué regla está aplicando el servidor. Si
 * alguien volviera a derivarla de las fechas de los partidos, estas pruebas
 * elegirían la otra y lo dirían.
 */
async function conDosJornadas(page, password) {
  await activarAdminMode(page, password);

  await crearJornada(page, 'Jornada anterior', [
    { equipo1: 'Alfa', equipo2: 'Beta', apiDate: enDias(2) }
  ]);

  await crearJornada(page, 'Jornada nueva', [
    { equipo1: 'Gamma', equipo2: 'Delta', apiDate: enDias(-30) }
  ]);
}

test('llenar quiniela abre en la última jornada creada y deja cambiar a otra', async ({ page }) => {
  const datos = await registrarse(page, 'fbllenar');
  await crearQuiniela(page, 'Fase B Llenar');
  await conDosJornadas(page, datos.password);

  await page.goto('/llenar_jornada_user.html');

  const selector = page.locator('#jornadaSelect');
  await expect(selector).toHaveValue('Jornada nueva');

  // Los partidos que se pintan son los de esa jornada, no los de la otra.
  await expect(page.locator('#partidosContainer')).toContainText('Gamma');

  /*
   * Y se puede ir a una anterior: esto es la petición 1. Antes la pantalla se
   * abría donde se abría y no había manera de llegar a otra jornada.
   */
  await selector.selectOption('Jornada anterior');
  await expect(page.locator('#partidosContainer')).toContainText('Alfa');
  await expect(page.locator('#partidosContainer')).not.toContainText('Gamma');
});

test('resultados oficiales abre en la última jornada creada', async ({ page }) => {
  const datos = await registrarse(page, 'fboficial');
  await crearQuiniela(page, 'Fase B Oficiales');
  await conDosJornadas(page, datos.password);

  await page.goto('/ver-resultados-oficiales.html');

  await expect(page.locator('#jornadaSelect')).toHaveValue('Jornada nueva');
});

test('la tabla por jornada abre en la misma jornada que las demás pantallas', async ({ page }) => {
  const datos = await registrarse(page, 'fbtabla');
  await crearQuiniela(page, 'Fase B Tabla');
  await conDosJornadas(page, datos.password);

  await page.goto('/clasificacion-jornada.html');

  await expect(page.locator('#jornadaSelect')).toHaveValue('Jornada nueva');
  await expect(page.locator('#estadoJornada')).toContainText('Jornada nueva');
});

test('las tres pantallas coinciden: una sola regla, no tres', async ({ page }) => {
  const datos = await registrarse(page, 'fbcoincide');
  await crearQuiniela(page, 'Fase B Coincide');
  await conDosJornadas(page, datos.password);

  /*
   * El fallo que motivó la fase no era que una pantalla se equivocara: era que
   * cada una respondía una cosa distinta. Esta prueba compara las tres entre sí
   * en vez de contra un nombre fijo, así que seguiría cazando el problema
   * aunque la regla cambiara de criterio mañana —como acaba de cambiar—.
   */
  const jornadas = [];

  for (const ruta of ['/llenar_jornada_user.html', '/ver-resultados-oficiales.html', '/clasificacion-jornada.html']) {
    await page.goto(ruta);
    await expect(page.locator('#jornadaSelect')).not.toHaveValue('');
    jornadas.push(await page.locator('#jornadaSelect').inputValue());
  }

  expect(new Set(jornadas).size, `Las pantallas discrepan: ${jornadas.join(', ')}`).toBe(1);
});

test('el podio de la jornada aparece en la portada cuando hay puntos', async ({ page }) => {
  const datos = await registrarse(page, 'fbpodio');
  await crearQuiniela(page, 'Fase B Podio');
  await activarAdminMode(page, datos.password);

  const jornada = 'Jornada con puntos';

  /*
   * El partido va en el FUTURO aunque su resultado se cargue ya. El primer
   * intento lo puso ayer, para que pareciera una jornada jugada, y el pronóstico
   * salió rechazado con «Partidos bloqueados: 1»: desde la Entrada 019 los
   * pronósticos se cierran partido a partido en cuanto empieza. El servidor hizo
   * lo correcto; la prueba pedía algo imposible.
   *
   * Un administrador cargando a mano el resultado de un partido es el caso real
   * y no necesita que la fecha haya pasado.
   */
  await crearJornada(page, jornada, [
    { equipo1: 'Alfa', equipo2: 'Beta', apiDate: enDias(1) }
  ]);

  // Un pronóstico acertado y su resultado oficial, para que haya podio que ver.
  await page.evaluate(async ([nombreJornada, jugador]) => {
    await fetch('/api/resultados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jugador,
        jornada: nombreJornada,
        pronosticos: [{ equipo1: 'Alfa', equipo2: 'Beta', marcador1: 2, marcador2: 1 }]
      })
    });

    await fetch('/api/resultados-oficiales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jornada: nombreJornada,
        resultados: [{ equipo1: 'Alfa', equipo2: 'Beta', marcador1: 2, marcador2: 1 }]
      })
    });
  }, [jornada, datos.username]);

  await page.goto('/index.html');

  /*
   * La tarjeta arranca oculta y se destapa sola al tener contenido, así que se
   * espera a que aparezca en vez de comprobarla de inmediato. El carrusel puede
   * no estar enseñándola todavía —rota cada diez segundos—, y por eso se mira
   * que EXISTA y tenga el podio, no que esté visible en este instante.
   */
  const tarjeta = page.locator('#jornadaPodioCard');
  await expect(tarjeta).toHaveCount(1);
  await expect(page.locator('#jornadaPodioContainer')).toContainText(datos.username, { timeout: 10_000 });
  await expect(page.locator('#jornadaPodioNombre')).toContainText(jornada);
});

test('sin jornadas, las pantallas no se rompen ni inventan una', async ({ page }) => {
  await registrarse(page, 'fbvacio');
  await crearQuiniela(page, 'Fase B Vacia');

  const respuesta = await page.evaluate(async () => {
    const r = await fetch('/api/jornada-actual');
    return { estado: r.status, cuerpo: await r.json() };
  });

  expect(respuesta.estado).toBe(200);
  expect(respuesta.cuerpo.sugerida).toBe(null);
  expect(respuesta.cuerpo.jornadas).toEqual([]);

  /*
   * Y la portada sigue en pie: el podio de jornada simplemente no se enseña.
   * Una quiniela recién creada es el primer estado que ve todo el mundo, y es
   * el que más fácil se olvida de probar.
   */
  await page.goto('/index.html');
  await expect(page.locator('#rankingCard')).toBeVisible();
  await expect(page.locator('#jornadaPodioCard')).toBeHidden();
});

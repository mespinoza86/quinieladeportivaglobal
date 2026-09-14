/*
 * Los niveles de administrador, vistos desde el navegador.
 *
 * ⚠️ Lo que se prueba aquí NO es la seguridad: eso vive en
 * `test/permisos.test.js`, con la rejilla de rutas y peticiones reales. Aquí se
 * prueba la CORTESÍA, que es lo único que esta capa puede prometer: que el menú
 * no le enseña a nadie un montón de puertas cerradas.
 *
 * Merece prueba propia porque `ajustarMenu` es código de navegador y ninguna
 * suite de servidor lo ejecuta: podría estar roto del todo y las 579 pruebas de
 * `npm test` seguirían verdes.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/**
 * Monta una quiniela, mete a un segundo usuario y le pone el rol pedido.
 *
 * Devuelve una página nueva, ya dentro, con el Admin Mode activo.
 */
async function segundoMiembroCon(browser, rol) {
  const contextoDueno = await browser.newContext();
  const dueno = await contextoDueno.newPage();
  const datosDueno = await registrarse(dueno, 'jefe');
  await crearQuiniela(dueno, 'Niveles');
  await activarAdminMode(dueno, datosDueno.password);

  const codigo = (await (await dueno.request.get('/api/quiniela-actual')).json()).codigoIngreso;

  const contextoOtro = await browser.newContext();
  const otro = await contextoOtro.newPage();
  const datosOtro = await registrarse(otro, 'ayud');

  await otro.request.post('/api/quinielas/unirse', { data: { codigoIngreso: codigo } });

  const miembros = await (await dueno.request.get('/api/quiniela-actual/miembros')).json();
  const pendiente = miembros.find(m => m.estado === 'pendiente_ingreso');

  await dueno.request.patch(`/api/quiniela-actual/miembros/${pendiente.id}/aprobar`);
  const cambio = await dueno.request.patch(
    `/api/quiniela-actual/miembros/${pendiente.id}/rol`, { data: { rol } });
  expect(cambio.ok(), `no se pudo poner el rol ${rol}`).toBeTruthy();

  /* La quiniela se selecciona en la sesión del segundo, y entra a Admin Mode. */
  const quinielas = await (await otro.request.get('/api/quinielas')).json();
  const suya = (quinielas.quinielas || quinielas).find(q => q.nombre.startsWith('Niveles'));
  await otro.request.post(`/api/quinielas/${suya.id}/seleccionar`);

  /*
   * ⚠️ Sólo los escalones administrativos entran al Admin Mode: a un `user` la
   * pantalla lo manda a Inicio —y hace bien—, así que intentarlo aquí colgaba
   * el ayudante esperando un formulario que no iba a aparecer.
   */
  if (rol !== 'user') await activarAdminMode(otro, datosOtro.password);

  return { otro, dueno, contextos: [contextoDueno, contextoOtro] };
}

test('el administrador de sólo lectura ve el menú recortado', async ({ browser }) => {
  const { otro, contextos } = await segundoMiembroCon(browser, 'admin_lector');

  try {
    await otro.goto('/adminmode.html');
    await otro.locator('#admin-content').waitFor({ state: 'visible' });

    /* Lo suyo: enviar los partidos al grupo. */
    await expect(otro.locator('#admin-content a[href="compartir.html"]')).toBeVisible();

    /* Y mirar: los cobros se ven, aunque no se toquen. */
    await expect(otro.locator('#admin-content a[href="cobros.html"]')).toBeVisible();

    /* Lo que no es suyo no se le enseña. */
    await expect(otro.locator('#admin-content a[href="jornadas.html"]')).toBeHidden();
    await expect(otro.locator('#admin-content a[href="miembros.html"]')).toBeHidden();
    await expect(otro.locator('#admin-content a[href="configuracion-quiniela.html"]')).toBeHidden();
    await expect(otro.locator('#admin-content a[href="agregar-resultados-oficiales.html"]')).toBeHidden();
  } finally {
    for (const c of contextos) await c.close();
  }
});

test('el administrador de jornadas ve las jornadas y no los cobros ni los marcadores', async ({ browser }) => {
  const { otro, contextos } = await segundoMiembroCon(browser, 'admin_jornadas');

  try {
    await otro.goto('/adminmode.html');
    await otro.locator('#admin-content').waitFor({ state: 'visible' });

    await expect(otro.locator('#admin-content a[href="jornadas.html"]')).toBeVisible();
    await expect(otro.locator('#admin-content a[href="admin_trivias.html"]')).toBeVisible();
    await expect(otro.locator('#admin-content a[href="compartir.html"]')).toBeVisible();

    await expect(otro.locator('#admin-content a[href="agregar-resultados-oficiales.html"]')).toBeHidden();
    await expect(otro.locator('#admin-content a[href="miembros.html"]')).toBeHidden();
  } finally {
    for (const c of contextos) await c.close();
  }
});

test('⛔ escribir a mano la dirección de una pantalla prohibida no entra', async ({ browser }) => {
  /*
   * La prueba que separa la cortesía de la seguridad. Esconder la tarjeta no
   * protege nada: lo que protege es la guardia del servidor, y esto lo
   * comprueba yendo directo a la dirección.
   */
  const { otro, contextos } = await segundoMiembroCon(browser, 'admin_lector');

  try {
    await otro.goto('/configuracion-quiniela.html');
    await otro.waitForURL('**/index.html');
  } finally {
    for (const c of contextos) await c.close();
  }
});

test('el dueño sigue viéndolo todo', async ({ browser }) => {
  /*
   * ⚠️ Control positivo. Sin esto, las tres pruebas de arriba pasarían igual si
   * `ajustarMenu` escondiera SIEMPRE todas las tarjetas, que es la forma exacta
   * en que un centinela deja de servir sin avisar (Entrada 072).
   */
  const contexto = await browser.newContext();
  const dueno = await contexto.newPage();

  try {
    const datos = await registrarse(dueno, 'todo');
    await crearQuiniela(dueno, 'Completa');
    await activarAdminMode(dueno, datos.password);

    await dueno.goto('/adminmode.html');
    await dueno.locator('#admin-content').waitFor({ state: 'visible' });

    for (const destino of ['jornadas.html', 'cobros.html', 'miembros.html',
      'configuracion-quiniela.html', 'compartir.html', 'agregar-resultados-oficiales.html']) {
      await expect(dueno.locator(`#admin-content a[href="${destino}"]`),
        `el dueño debería ver ${destino}`).toBeVisible();
    }
  } finally {
    await contexto.close();
  }
});

test('⛔ el selector de rol se lee: texto oscuro sobre el desplegable claro', async ({ browser }) => {
  /*
   * Marco lo vio antes que ninguna prueba: «se ve todo en blanco, tengo que
   * pasar el mouse por encima para ver que dice».
   *
   * La causa fue ponerle al `select` una clase de BOTÓN, que fija un color casi
   * blanco pensado para el fondo oscuro de las tarjetas. El desplegable nativo
   * pinta sus opciones sobre fondo claro, así que salía blanco sobre blanco;
   * sólo se leían al pasar el ratón, porque el resaltado del sistema le pone
   * fondo propio a la opción.
   *
   * ⚠️ Se comprueba la LUMINANCIA, no un color concreto. Fijar `rgb(15,23,42)`
   * ataría la prueba a la paleta y se rompería al retocarla, sin que nada
   * estuviera mal. Lo que no puede cambiar es que el texto sea oscuro.
   */
  const { dueno, contextos } = await segundoMiembroCon(browser, 'user');

  try {
    await dueno.goto('/miembros.html');
    const selector = dueno.locator('#listaMiembros select').first();
    await selector.waitFor({ state: 'visible' });

    const luminancia = await selector.evaluate(elemento => {
      const [r, v, a] = getComputedStyle(elemento).color
        .match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      return (0.2126 * r + 0.7152 * v + 0.0722 * a) / 255;
    });

    expect(luminancia,
      `el texto del selector es demasiado claro (luminancia ${luminancia.toFixed(2)}): ` +
      'sobre el desplegable nativo, que es claro, no se lee').toBeLessThan(0.5);
  } finally {
    for (const c of contextos) await c.close();
  }
});

/*
 * Administración de jornadas y privacidad de los pronósticos.
 *
 * Son las dos cosas que más han cambiado —el cierre pasó de ser por jornada a
 * ser por partido— y las que se venían comprobando a mano en cada entrega.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/** Crea una jornada por la API, con los partidos que se le pasen. */
async function crearJornada(page, nombre, partidos) {
  const resultado = await page.evaluate(async ([nombreJornada, listaPartidos]) => {
    const respuesta = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombreJornada, partidos: listaPartidos })
    });
    return { ok: respuesta.ok, estado: respuesta.status, cuerpo: await respuesta.json() };
  }, [nombre, partidos]);

  expect(resultado.ok, `No se creó la jornada: ${JSON.stringify(resultado.cuerpo)}`).toBe(true);
}

test('crear una jornada: los partidos salen del API y no se piden a mano', async ({ page }) => {
  const datos = await registrarse(page, 'jorn');
  await crearQuiniela(page, 'Quiniela Jornadas');
  await activarAdminMode(page, datos.password);

  await page.goto('/jornadas.html');

  /*
   * El bloque de fecha y hora de cierre se retiró: el cierre lo marca la hora
   * de inicio de cada partido. Si alguien lo reintroduce, esto lo detecta.
   */
  await expect(page.locator('#fechaCierreInput')).toHaveCount(0);
  await expect(page.locator('#horaCierreInput')).toHaveCount(0);
  await expect(page.locator('#actualizarFechaCierreButton')).toHaveCount(0);

  /*
   * Fase D: tampoco se escriben los equipos a mano. Se decidió el 19-ago-2026
   * que los partidos salen SOLO del API, y con ello se fueron las dos cajas de
   * texto y su autocompletado.
   */
  await expect(page.locator('#equipo1Input')).toHaveCount(0);
  await expect(page.locator('#equipo2Input')).toHaveCount(0);
  await expect(page.locator('#suggestions1')).toHaveCount(0);

  // Se busca en el API y se elige de la lista.
  await expect(page.locator('#torneoSelect optgroup')).toHaveCount(2, { timeout: 10_000 });
  await page.locator('#torneoSelect').selectOption({ label: 'Primera Division (1)' });
  await page.locator('#buscarPartidosButton').click();

  await expect(page.locator('#partidosApiContainer .match-card')).toHaveCount(1, { timeout: 10_000 });
  await page.locator('#partidosApiContainer .partidoCheckbox').first().check();
  await page.getByRole('button', { name: 'Agregar seleccionados a la jornada' }).click();

  const nombre = `Jornada E2E ${Date.now().toString(36)}`;
  await page.locator('#nombreJornadaInput').fill(nombre);
  await page.locator('#guardarJornadaButton').click();

  await expect(page.locator('#mensajeJornada')).toContainText('guardada', { timeout: 10_000 });

  await page.goto('/ver_jornadas.html');
  await expect(page.locator('#jornadaSelect')).toContainText(nombre);
  await expect(page.locator('#partidosJornadaList')).toContainText('Saprissa');
});

test('una jornada existente se abre, se le quita un partido y se elimina entera', async ({ page }) => {
  const datos = await registrarse(page, 'jornmod');
  await crearQuiniela(page, 'Quiniela Modificar');
  await activarAdminMode(page, datos.password);

  const nombre = `Jornada Mod ${Date.now().toString(36)}`;
  await page.goto('/jornadas.html');
  await crearJornada(page, nombre, [
    { equipo1: 'Uno', equipo2: 'Dos', apiDate: '2099-01-01 15:00' },
    { equipo1: 'Tres', equipo2: 'Cuatro', apiDate: '2099-01-02 15:00' }
  ]);

  /*
   * La misma pantalla sirve para ver y modificar: elegir una jornada del
   * desplegable carga sus partidos. Antes esto eran dos secciones distintas con
   * dos desplegables, y una tercera pantalla para traer partidos del API.
   */
  await page.reload();
  await page.locator('#jornadaSelect').selectOption(nombre);

  await expect(page.locator('#partidosJornadaContainer .match-card')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#partidosJornadaContainer')).toContainText('Tres');

  await page.locator('#partidosJornadaContainer [data-quitar]').last().click();
  await expect(page.locator('#partidosJornadaContainer .match-card')).toHaveCount(1);

  await page.locator('#guardarJornadaButton').click();
  await expect(page.locator('#mensajeJornada')).toContainText('guardada', { timeout: 10_000 });

  // Lo quitado se fue de verdad, no solo de la pantalla.
  const tras = await page.evaluate(async jornada => {
    const respuesta = await fetch(`/api/jornadas/${encodeURIComponent(jornada)}`);
    return respuesta.json();
  }, nombre);
  expect(tras.partidos.length).toBe(1);
  expect(tras.partidos[0].equipo1).toBe('Uno');

  // Y la jornada entera se elimina desde la misma pantalla, con confirmación.
  page.once('dialog', dialogo => dialogo.accept());
  await page.locator('#eliminarJornadaButton').click();
  await expect(page.locator('#mensajeJornada')).toContainText('eliminada', { timeout: 10_000 });

  await expect(page.locator('#jornadaSelect')).not.toContainText(nombre);
});

test('la pantalla de importar desapareció y nadie enlaza a ella', async ({ page }) => {
  const datos = await registrarse(page, 'jornimp');
  await crearQuiniela(page, 'Quiniela Sin Importar');
  await activarAdminMode(page, datos.password);

  /*
   * Fase D: importar_partidos.html se retiró y su buscador vive dentro de
   * jornadas.html. Un enlace huérfano no daría error visible —lleva a una
   * pantalla en blanco— así que se comprueba aquí.
   */
  const respuesta = await page.request.get('/importar_partidos.html');
  expect(respuesta.status()).toBe(404);

  await page.goto('/adminmode.html');
  await expect(page.locator('a[href*="importar_partidos"]')).toHaveCount(0);
});

test('una jornada sin nombre o sin partidos se rechaza con su motivo', async ({ page }) => {
  const datos = await registrarse(page, 'val');
  await crearQuiniela(page, 'Quiniela Validacion');
  await activarAdminMode(page, datos.password);
  await page.goto('/jornadas.html');

  const intentar = cuerpo => page.evaluate(async datosEnvio => {
    const respuesta = await fetch('/api/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datosEnvio)
    });
    return { estado: respuesta.status, cuerpo: await respuesta.json() };
  }, cuerpo);

  const sinNombre = await intentar({ partidos: [{ equipo1: 'A', equipo2: 'B' }] });
  expect(sinNombre.estado).toBe(400);
  expect(sinNombre.cuerpo.error).toMatch(/nombre de la jornada es obligatorio/i);

  const sinPartidos = await intentar({ nombre: 'Vacia', partidos: [] });
  expect(sinPartidos.estado).toBe(400);
  expect(sinPartidos.cuerpo.error).toMatch(/al menos un partido/i);

  // Y no queda rastro de los intentos fallidos.
  await page.goto('/ver_jornadas.html');
  await expect(page.locator('#jornadaSelect option')).toHaveCount(0);
});

test('los pronósticos ajenos se destapan partido a partido', async ({ browser }) => {
  const contextoDueno = await browser.newContext();
  const dueno = await contextoDueno.newPage();

  const datosDueno = await registrarse(dueno, 'priv_d');
  await crearQuiniela(dueno, 'Quiniela Privacidad');
  await activarAdminMode(dueno, datosDueno.password);

  const codigo = await dueno.evaluate(async () => {
    const quinielas = await (await fetch('/api/quinielas')).json();
    return quinielas[0].codigoIngreso;
  });

  /*
   * Los dos partidos empiezan por estar en el futuro. Tiene que ser así: el
   * servidor bloquea el pronóstico de un partido que ya empezó, que es la otra
   * cara de la misma regla. Primero se pronostica, y después se adelanta el
   * reloj del primero.
   */
  const nombre = `Jornada Mixta ${Date.now().toString(36)}`;
  const porJugar = [
    { equipo1: 'Jugado', equipo2: 'Rival', apiDate: '2099-01-01 15:00' },
    { equipo1: 'PorJugar', equipo2: 'Rival2', apiDate: '2099-01-01 15:00' }
  ];

  await crearJornada(dueno, nombre, porJugar);

  const guardado = await dueno.evaluate(async ([jornada, jugador]) => {
    const respuesta = await fetch('/api/resultados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jugador,
        jornada,
        pronosticos: [{ marcador1: 3, marcador2: 1 }, { marcador1: 5, marcador2: 4 }]
      })
    });
    return respuesta.json();
  }, [nombre, datosDueno.username]);

  expect(guardado.guardados, 'Los dos pronósticos deben guardarse').toBe(2);

  // Ahora el primer partido pasa a estar jugado.
  await crearJornada(dueno, nombre, [
    { ...porJugar[0], apiDate: '2020-01-01 15:00' },
    porJugar[1]
  ]);

  // Un segundo participante entra en la misma quiniela.
  const contextoMiron = await browser.newContext();
  const miron = await contextoMiron.newPage();
  await registrarse(miron, 'priv_m');

  await miron.goto('/quinielas.html');
  await miron.locator('#codigoIngreso').fill(codigo);
  await miron.getByRole('button', { name: 'Solicitar ingreso' }).click();
  await expect(miron.locator('#mensajeQuinielas')).toContainText(/solicitud/i);

  // El propietario lo aprueba desde la pantalla de miembros.
  await dueno.goto('/miembros.html');
  await dueno.getByRole('button', { name: 'Aprobar' }).first().click();

  await miron.goto('/quinielas.html');
  await miron.locator('article.action-card').getByRole('button', { name: 'Entrar' }).first().click();
  await miron.waitForURL('**/index.html');

  const visto = await miron.evaluate(async ([jornada, jugador]) => {
    const respuesta = await fetch(`/api/resultados/${encodeURIComponent(jugador)}/${encodeURIComponent(jornada)}`);
    return { estado: respuesta.status, pronosticos: await respuesta.json() };
  }, [nombre, datosDueno.username]);

  expect(visto.estado).toBe(200);
  expect(visto.pronosticos[0].marcador1, 'El partido ya jugado se ve').toBe(3);
  expect(visto.pronosticos[1].marcador1, 'El que no ha empezado sigue tapado').toBeNull();
  expect(visto.pronosticos[1].oculto).toBe(true);

  await contextoDueno.close();
  await contextoMiron.close();
});

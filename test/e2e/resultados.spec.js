/*
 * Las pantallas de resultados y trivias: las que más plantillas tienen y las
 * que más se han tocado. Hasta ahora se comprobaban a mano una por una.
 *
 * Lo que se fija aquí no es el aspecto —eso cambiará— sino que **los datos
 * llegan a la pantalla**: los marcadores, las insignias de estado, los puntos y
 * las preguntas de trivia. Si una plantilla se rompe, el contenido desaparece o
 * sale como texto plano, y ambas cosas fallan aquí.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

/**
 * Deja una jornada terminada con un pronóstico del jugador.
 *
 * Los partidos se crean con fecha futura, se pronostica, y solo entonces se
 * cargan los resultados oficiales: el servidor bloquea el pronóstico de un
 * partido que ya empezó, así que el orden importa.
 */
async function jornadaJugada(page, jugador, { conOficiales = true } = {}) {
  const nombre = `Jornada Res ${Date.now().toString(36)}`;

  const partidos = [
    { equipo1: 'Alfa', equipo2: 'Beta', apiDate: '2099-01-01 15:00' },
    { equipo1: 'Gamma', equipo2: 'Delta', apiDate: '2099-01-01 17:00', comodin: true }
  ];

  const resultado = await page.evaluate(async ([nombreJornada, listaPartidos, usuario, cargarOficiales]) => {
    const post = (ruta, cuerpo) => fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });

    const creada = await post('/api/jornadas', { nombre: nombreJornada, partidos: listaPartidos });
    if (!creada.ok) return { paso: 'jornada', cuerpo: await creada.json() };

    // Marcador exacto en el primero, resultado correcto en el segundo.
    const pronosticos = await post('/api/resultados', {
      jugador: usuario,
      jornada: nombreJornada,
      pronosticos: [{ marcador1: 2, marcador2: 1 }, { marcador1: 3, marcador2: 0 }]
    });
    if (!pronosticos.ok) return { paso: 'pronosticos', cuerpo: await pronosticos.json() };

    /*
     * Cargar los oficiales marca los partidos como terminados, y eso BLOQUEA
     * las trivias de esos partidos. Por eso es opcional: la prueba que responde
     * trivias necesita la jornada todavía en juego.
     */
    if (cargarOficiales) {
      const oficiales = await post('/api/resultados-oficiales', {
        jornada: nombreJornada,
        resultados: [
          { equipo1: 'Alfa', equipo2: 'Beta', marcador1: 2, marcador2: 1, comodin: false },
          { equipo1: 'Gamma', equipo2: 'Delta', marcador1: 1, marcador2: 0, comodin: true }
        ]
      });
      if (!oficiales.ok) return { paso: 'oficiales', cuerpo: await oficiales.json() };
    }

    return { paso: 'ok' };
  }, [nombre, partidos, jugador, conOficiales]);

  expect(resultado.paso, `Falló al preparar la jornada: ${JSON.stringify(resultado.cuerpo)}`).toBe('ok');

  return nombre;
}

test('los resultados oficiales se ven con sus marcadores e insignias', async ({ page }) => {
  const datos = await registrarse(page, 'res_of');
  await crearQuiniela(page, 'Quiniela Resultados');
  await activarAdminMode(page, datos.password);

  const jornada = await jornadaJugada(page, datos.username);

  await page.goto('/ver-resultados-oficiales.html');
  await page.locator('#jornadaSelect').selectOption({ label: jornada });
  await page.locator('#searchResultadosOficialesButton').click();

  const contenedor = page.locator('#resultadosOficialesContainer');
  await expect(contenedor).toContainText('Alfa');
  await expect(contenedor).toContainText('Beta');
  await expect(contenedor).toContainText('Gamma');

  /*
   * La insignia de estado y la de comodín son HTML compuesto dentro de otra
   * plantilla: es justo donde un escapado mal puesto haría aparecer las
   * etiquetas como texto.
   */
  await expect(contenedor.locator('.status-pill')).not.toHaveCount(0);
  await expect(contenedor).toContainText('COMODÍN');
  await expect(contenedor).not.toContainText('<span');
});

test('la tabla general suma los puntos y se puede paginar', async ({ page }) => {
  const datos = await registrarse(page, 'res_tot');
  await crearQuiniela(page, 'Quiniela Tabla');
  await activarAdminMode(page, datos.password);

  const jornada = await jornadaJugada(page, datos.username);

  await page.goto('/resultados-totales.html');

  const tabla = page.locator('#resultadosTotalesTable');
  await expect(tabla).toContainText(datos.username);
  await expect(tabla).toContainText(jornada);

  /*
   * 5 por el marcador exacto del primero + 4 por el resultado correcto del
   * segundo, que es comodín. Se comprueba el número y no solo que haya algo:
   * una tabla que pinte ceros por todas partes también "se ve bien".
   */
  const fila = tabla.locator('tbody tr').filter({ hasText: datos.username });
  await expect(fila).toContainText('9');

  /*
   * Con un solo jugador cabe todo en una pagina y los controles no se pintan:
   * es lo correcto, y comprobarlo evita que aparezca un Anterior/Siguiente
   * inutil si alguien cambia la condicion.
   */
  await expect(page.locator('#paginacionResultados')).toBeEmpty();
});

test('las trivias se crean, se responden y se ven en su pantalla', async ({ page }) => {
  const datos = await registrarse(page, 'triv');
  await crearQuiniela(page, 'Quiniela Trivias');
  await activarAdminMode(page, datos.password);

  const jornada = await jornadaJugada(page, datos.username, { conOficiales: false });

  // Dos preguntas sobre el primer partido, aún abiertas.
  const creadas = await page.evaluate(async nombreJornada => {
    const respuesta = await fetch('/api/admin/trivias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jornadaNombre: nombreJornada,
        partidoIndex: 0,
        tipos: ['primer_gol', 'ambos_anotan'],
        fechaCierre: '2099-01-01T15:00:00.000Z'
      })
    });
    return { ok: respuesta.ok, cuerpo: await respuesta.json() };
  }, jornada);

  expect(creadas.ok, JSON.stringify(creadas.cuerpo)).toBe(true);
  expect(creadas.cuerpo.creadas).toHaveLength(2);

  // La pantalla muestra las dos preguntas con sus opciones.
  /*
   * Las preguntas NO se pintan hasta que el jugador se identifica: la pantalla
   * carga sus respuestas previas y solo entonces dibuja. Es la misma
   * comprobación que protege los pronósticos en el móvil de uno delante de los
   * demás.
   */
  await page.goto('/llenar_trivia.html');
  await page.locator('#jugadorSelect').selectOption(datos.username);
  await page.locator('#inputPassword').fill(datos.password);
  await page.locator('#btnPasswordOk').click();

  const preguntas = page.locator('.trivia-question-card');
  await expect(preguntas).toHaveCount(2);
  await expect(page.locator('#triviasContainer')).toContainText('¿Qué equipo anota primero?');
  await expect(page.locator('#triviasContainer')).not.toContainText('<option');

  /*
   * Se responden LAS DOS. Dejar una sin responder saca un confirm de aviso, y
   * ese dialogo extra no aporta nada a lo que se quiere comprobar aqui.
   */
  /*
   * Validar la contrasena dispara la carga de las respuestas previas, que
   * REPINTA las trivias. Seleccionar antes de que asiente hace que el repintado
   * borre la eleccion y el guardado no encuentre nada que enviar.
   */
  await page.waitForLoadState('networkidle');

  const selects = page.locator('select.respuesta-trivia');
  await expect(selects.first()).toBeEnabled();
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 1 });

  const elegida = await selects.nth(0).inputValue();
  expect(elegida, 'La opcion elegida no puede quedar vacia').not.toBe('');

  /*
   * Se recoge el texto del alert en vez de aceptarlo a ciegas: si el guardado
   * falla, el mensaje del error es lo unico que dice por que, y aceptarlo sin
   * mirar convierte un fallo claro en un timeout incomprensible.
   */
  const avisos = [];
  page.on('dialog', dialogo => { avisos.push(dialogo.message()); dialogo.accept(); });

  await page.locator('#guardarBtn').click();
  await expect.poll(() => avisos.length).toBeGreaterThan(0);
  expect(avisos.join(' | ')).toMatch(/guardadas correctamente/i);
  await expect(page.locator('#mensaje')).not.toBeEmpty();

  // Y al volver, la respuesta sigue ahí.
  await page.goto('/llenar_trivia.html');
  await page.locator('#jugadorSelect').selectOption(datos.username);
  await page.locator('#inputPassword').fill(datos.password);
  await page.locator('#btnPasswordOk').click();
  await expect(page.locator('select.respuesta-trivia').first()).toHaveValue(elegida);
});

test('los resultados de trivias muestran quién respondió qué', async ({ page }) => {
  const datos = await registrarse(page, 'triv_res');
  await crearQuiniela(page, 'Quiniela Trivias Vistas');
  await activarAdminMode(page, datos.password);

  const jornada = await jornadaJugada(page, datos.username);

  await page.evaluate(async nombreJornada => {
    await fetch('/api/admin/trivias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jornadaNombre: nombreJornada,
        partidoIndex: 0,
        tipos: ['ambos_anotan'],
        fechaCierre: '2099-01-01T15:00:00.000Z'
      })
    });
  }, jornada);

  await page.goto('/ver_resultados_trivias.html');
  await page.locator('#jornada-select').selectOption({ label: jornada });
  await page.locator('#ver-resultados-btn').click();

  const tarjetas = page.locator('#resultados-cards');
  await expect(tarjetas).toContainText('Alfa');
  await expect(tarjetas).toContainText('¿Ambos equipos anotan?');
  await expect(tarjetas).not.toContainText('<div');
});

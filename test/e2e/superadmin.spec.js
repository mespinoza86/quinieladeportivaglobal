/*
 * La pantalla del superadministrador, por la interfaz.
 *
 * ============================================================================
 * LO QUE SE PRUEBA AQUÍ ES QUIÉN NO ENTRA
 * ============================================================================
 *
 * Las 11 pruebas de ruta ya cubren las reglas. Esto cubre lo que sólo se ve
 * desde el navegador: que la pantalla **no se sirve** a quien no toca, que pide
 * la contraseña aunque tengas el correo en la lista, y que lo que enseña
 * después son las cuentas de verdad.
 *
 * Es la única pantalla que muestra los correos de todo el mundo, así que la
 * pregunta que importa no es «¿funciona?» sino «¿a quién se le abre?».
 *
 * `/e2e/dar-poder` es una puerta que sólo existe en el arnés (ver `arrancar.js`):
 * las cuentas se crean al vuelo, así que su correo no puede estar en la
 * variable de entorno desde el arranque.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela } = require('./ayudas');

/** Deja SIN superadministradores, que es como arranca el arnés. */
async function quitarPoder(page) {
  await page.request.post('/e2e/dar-poder', { data: { email: '' } });
}

test('⛔ sin estar en la lista, la pantalla ni siquiera se sirve', async ({ page }) => {
  const datos = await registrarse(page, 'curioso');
  await crearQuiniela(page, 'La suya');

  await quitarPoder(page);

  await page.goto('/superadmin.html');

  /*
   * Redirige a la portada. No es cosmético: quien no manda no debe poder ni
   * descargar el marcado de esta pantalla.
   */
  await expect(page).toHaveURL(/index\.html$/);

  // Y la tarjeta de la portada tampoco aparece.
  await expect(page.locator('#superadminCard')).toBeHidden();

  /* Los datos tampoco llegan, que es lo que de verdad protege. */
  const respuesta = await page.request.get('/api/superadmin/cuentas');
  expect(respuesta.status()).toBe(403);
});

test('⚠️ con el correo en la lista, pide la contraseña antes de enseñar nada', async ({ page }) => {
  const datos = await registrarse(page, 'jefa');
  await crearQuiniela(page, 'La de la jefa');

  await page.request.post('/e2e/dar-poder', { data: { email: datos.email } });

  await page.goto('/superadmin.html');

  // Se sirve, pero lo único visible es la puerta.
  await expect(page.locator('#confirmarPanel')).toBeVisible();
  await expect(page.locator('#cuentasPanel')).toBeHidden();

  // Una contraseña equivocada no abre nada.
  await page.locator('#password').fill('la-que-no-es');
  await page.locator('#confirmarBtn').click();
  await expect(page.locator('#confirmarError')).toBeVisible();
  await expect(page.locator('#cuentasPanel')).toBeHidden();

  // La buena sí.
  await page.locator('#password').fill(datos.password);
  await page.locator('#confirmarBtn').click();

  await expect(page.locator('#cuentasPanel')).toBeVisible();
  await expect(page.locator('#confirmarPanel')).toBeHidden();

  await quitarPoder(page);
});

test('la lista enseña los correos y las quinielas de cada quien', async ({ browser }) => {
  /*
   * Dos CONTEXTOS y no dos pestañas: las pestañas de un contexto comparten
   * cookies, así que registrar al socio tumbaría la sesión de la jefa. Es la
   * lección de la Entrada 061.
   */
  const contextoJefa = await browser.newContext();
  const contextoSocio = await browser.newContext();

  const paginaJefa = await contextoJefa.newPage();
  const paginaSocio = await contextoSocio.newPage();

  const jefa = await registrarse(paginaJefa, 'mandamas');
  await crearQuiniela(paginaJefa, 'La grande');

  const socio = await registrarse(paginaSocio, 'elsocio');
  await crearQuiniela(paginaSocio, 'La chica');

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: jefa.email } });

  await paginaJefa.goto('/superadmin.html');
  await paginaJefa.locator('#password').fill(jefa.password);
  await paginaJefa.locator('#confirmarBtn').click();
  await expect(paginaJefa.locator('#cuentasPanel')).toBeVisible();

  // El correo del socio sale, y su quiniela con él.
  const listado = paginaJefa.locator('#listado');
  await expect(listado).toContainText(socio.email);
  await expect(listado).toContainText('La chica');

  // Y quien manda se marca, sin botones para retirarse a sí mismo.
  await expect(listado).toContainText('Superadministrador');

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: '' } });
  await contextoJefa.close();
  await contextoSocio.close();
});

test('⚠️ las cuentas sin confirmar se ven y se pueden filtrar', async ({ browser }) => {
  const contextoJefa = await browser.newContext();
  const contextoPendiente = await browser.newContext();

  const paginaJefa = await contextoJefa.newPage();
  const paginaPendiente = await contextoPendiente.newPage();

  const jefa = await registrarse(paginaJefa, 'revisora');
  await crearQuiniela(paginaJefa, 'La de la revisora');

  /*
   * Una cuenta que se registra y NO confirma. `registrarse` confirma siempre,
   * así que este recorrido se hace a mano: es justo el estado que hay que ver.
   */
  const marca = Date.now().toString(36);
  const pendiente = {
    username: `pend${marca}`,
    email: `pend${marca}@ejemplo.com`,
    password: 'contrasena-larga-1'
  };

  await paginaPendiente.goto('/registro.html');
  await paginaPendiente.locator('#username').fill(pendiente.username);
  await paginaPendiente.locator('#email').fill(pendiente.email);
  await paginaPendiente.locator('#password').fill(pendiente.password);
  await paginaPendiente.locator('#confirmarPassword').fill(pendiente.password);
  await paginaPendiente.getByRole('button', { name: 'Crear cuenta' }).click();
  await paginaPendiente.locator('#registroForm').waitFor({ state: 'hidden' });

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: jefa.email } });

  await paginaJefa.goto('/superadmin.html');
  await paginaJefa.locator('#password').fill(jefa.password);
  await paginaJefa.locator('#confirmarBtn').click();
  await expect(paginaJefa.locator('#cuentasPanel')).toBeVisible();

  /*
   * ⛔ Lo que se comprueba es que se VEA, no que el dato exista: el dato ya
   * estaba antes y el usuario no lo encontraba, porque iba de corrido con el
   * resto en gris. Ahora es una insignia propia.
   */
  const tarjetaPendiente = paginaJefa.locator('.info-card', { hasText: pendiente.email });
  await expect(tarjetaPendiente.locator('.status-pill', { hasText: 'SIN CONFIRMAR' })).toBeVisible();

  // La de la jefa, que sí confirmó, no la lleva.
  const tarjetaJefa = paginaJefa.locator('.info-card', { hasText: jefa.email });
  await expect(tarjetaJefa.locator('.status-pill', { hasText: 'SIN CONFIRMAR' })).toHaveCount(0);

  // El resumen lo dice de entrada, sin tener que buscar.
  await expect(paginaJefa.locator('#resumenCuentas')).toContainText('sin confirmar');

  // Y el filtro deja sólo las pendientes.
  await paginaJefa.locator('[data-filtro="sin_confirmar"]').click();

  const listado = paginaJefa.locator('#listado');
  await expect(listado).toContainText(pendiente.email);
  await expect(listado).not.toContainText(jefa.email);

  await paginaJefa.request.post('/e2e/dar-poder', { data: { email: '' } });
  await contextoJefa.close();
  await contextoPendiente.close();
});

test('⚠️ dar un correo por bueno desde la pantalla, y su rastro', async ({ browser }) => {
  const cJefa = await browser.newContext();
  const cPend = await browser.newContext();
  const pJefa = await cJefa.newPage();
  const pPend = await cPend.newPage();

  const jefa = await registrarse(pJefa, 'validadora');
  await crearQuiniela(pJefa, 'La de la validadora');

  const marca = Date.now().toString(36);
  const pendiente = {
    username: `atascado${marca}`,
    email: `atascado${marca}@ejemplo.com`,
    password: 'contrasena-larga-1'
  };

  await pPend.goto('/registro.html');
  await pPend.locator('#username').fill(pendiente.username);
  await pPend.locator('#email').fill(pendiente.email);
  await pPend.locator('#password').fill(pendiente.password);
  await pPend.locator('#confirmarPassword').fill(pendiente.password);
  await pPend.getByRole('button', { name: 'Crear cuenta' }).click();
  await pPend.locator('#registroForm').waitFor({ state: 'hidden' });

  await pJefa.request.post('/e2e/dar-poder', { data: { email: jefa.email } });

  await pJefa.goto('/superadmin.html');
  await pJefa.locator('#password').fill(jefa.password);
  await pJefa.locator('#confirmarBtn').click();
  await expect(pJefa.locator('#cuentasPanel')).toBeVisible();

  /*
   * El motivo se pide con `prompt`, así que hay que contestarlo antes de
   * pulsar: Playwright descarta los diálogos por omisión, y un `prompt`
   * descartado devuelve null, que la pantalla trata como «cancelar».
   */
  pJefa.on('dialog', d => d.accept('no le llegaba el correo'));

  const tarjeta = pJefa.locator('.info-card', { hasText: pendiente.email });
  await tarjeta.getByRole('button', { name: /Dar el correo por bueno/i }).click();

  /*
   * ⛔ Y se queda marcada como confirmada POR EL ADMINISTRADOR, no como una
   * cualquiera: es el único estado en el que nadie ha probado que la dirección
   * exista, y tiene que poder distinguirse después.
   */
  const yaVista = pJefa.locator('.info-card', { hasText: pendiente.email });
  await expect(yaVista.locator('.status-pill', { hasText: 'CONFIRMADO POR TI' })).toBeVisible();
  await expect(yaVista).toContainText('no le llegaba el correo');

  // Y el botón desaparece: ya no hay nada que dar por bueno.
  await expect(yaVista.getByRole('button', { name: /Dar el correo por bueno/i })).toHaveCount(0);

  /*
   * ⚠️ Y deja de salir en el filtro de «sin confirmar».
   *
   * Se comprueba sobre ESTA cuenta y no sobre el contador general: la base es
   * la misma para toda la corrida, así que otras pruebas dejan sus propias
   * cuentas sin confirmar. Una aserción del tipo «ya no queda ninguna» pasa
   * cuando esta prueba corre sola y falla dentro de la suite — y ese fallo
   * parece un problema de la aplicación cuando es de la prueba.
   */
  await pJefa.locator('[data-filtro="sin_confirmar"]').click();
  await expect(pJefa.locator('#listado')).not.toContainText(pendiente.email);

  await pJefa.request.post('/e2e/dar-poder', { data: { email: '' } });
  await cJefa.close();
  await cPend.close();
});

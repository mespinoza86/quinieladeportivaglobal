/*
 * Piezas compartidas por las pruebas de navegador.
 *
 * La base de datos es la misma para toda la corrida, así que cada prueba se
 * crea su propia cuenta y su propia quiniela en vez de reutilizar datos: una
 * prueba que dependa de lo que dejó otra falla según el orden, y esos fallos se
 * persiguen durante horas.
 */
'use strict';

let contador = 0;

/** Credenciales nuevas, distintas en cada llamada. */
function credenciales(prefijo = 'e2e') {
  contador += 1;
  const marca = `${prefijo}${Date.now().toString(36)}${contador}`;

  return {
    username: marca,
    email: `${marca}@ejemplo.com`,
    password: 'contrasena-larga-1'
  };
}

/**
 * Registra una cuenta por la interfaz, **confirma el correo** y entra.
 *
 * ⚠️ Desde la Fase E el registro ya NO abre sesión: la cuenta nace sin
 * confirmar y sin confirmar no se entra. Este ayudante recorre las tres
 * pantallas de verdad —registro, confirmación y login— en vez de saltarse la
 * del medio: si la verificación se rompe, se caen las 62 pruebas y no una.
 *
 * El enlace sale de `/e2e/ultimo-correo`, una puerta que sólo declara el arnés
 * (ver `test/e2e/arrancar.js`). No se puede leer de la base porque allí sólo
 * está el hash del token.
 */
async function registrarse(page, prefijo) {
  const datos = credenciales(prefijo);

  await page.goto('/registro.html');
  await page.locator('#username').fill(datos.username);
  await page.locator('#email').fill(datos.email);
  await page.locator('#password').fill(datos.password);
  await page.locator('#confirmarPassword').fill(datos.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  /*
   * El registro ya no navega. La señal inequívoca de que fue bien es que el
   * formulario se retira: esperar por el TEXTO del mensaje sería frágil, porque
   * ese mismo elemento pinta también los errores.
   */
  await page.locator('#registroForm').waitFor({ state: 'hidden' });

  const correo = await (await page.request.get('/e2e/ultimo-correo')).json();
  const token = correo.texto.match(/token=([a-f0-9]{64})/)[1];

  await page.goto(`/verificar-correo.html?token=${token}`);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.waitForURL('**/login.html');
  await page.locator('#identificador').fill(datos.username);
  await page.locator('#password').fill(datos.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.waitForURL('**/quinielas.html');

  return datos;
}

/**
 * Crea una quiniela y la deja seleccionada.
 *
 * El nombre lleva marca de tiempo por lo mismo que las credenciales: dos
 * quinielas con el mismo nombre en la misma corrida harían ambigua la búsqueda
 * por texto.
 */
async function crearQuiniela(page, nombre) {
  contador += 1;
  const completo = `${nombre} ${Date.now().toString(36)}${contador}`;

  await page.goto('/quinielas.html');
  await page.locator('#nombreQuiniela').fill(completo);
  await page.getByRole('button', { name: 'Crear quiniela' }).click();

  /*
   * Crear una quiniela lleva DIRECTO a la portada: el servidor ya la deja
   * seleccionada como activa en la sesión, así que no hay que volver a la lista
   * ni pulsar «Entrar».
   */
  await page.waitForURL('**/index.html');
  await page.locator('#quinielaActualNombre').waitFor();

  return completo;
}

/**
 * Entra en Admin Mode, que las rutas de administración exigen además del rol.
 *
 * La pantalla no navega a ningún sitio al activarlo: solo cambia qué sección se
 * muestra. Sin esperar a que aparezca la de administración, la prueba seguía
 * antes de que la sesión quedara marcada y el servidor respondía 401.
 */
async function activarAdminMode(page, password) {
  await page.goto('/adminmode.html');
  await page.locator('#adminPassword').waitFor({ state: 'visible' });
  await page.locator('#adminPassword').fill(password);
  await page.getByRole('button', { name: /Entrar a Admin mode/i }).click();
  await page.locator('#admin-content').waitFor({ state: 'visible' });
}

/**
 * Abre el selector de liga de «Cómo se arman las jornadas».
 *
 * ⛔ ESTÁ AQUÍ, Y NO PEGADO EN VEINTICINCO SITIOS.
 *
 * El selector dejó de estar a la vista: ahora hay que pulsar «Armarlas por
 * liga» —o «Cambiar de liga», si ya es de una— antes de poder escribir. Ese
 * paso lo daban veinticinco pruebas repartidas en dos ficheros, cada una por su
 * cuenta; con el cambio se habrían quedado todas buscando una caja escondida.
 *
 * ⚠️ Y el precio VIVE DENTRO del mismo bloque plegado, así que rellenarlo antes
 * de abrir tampoco funciona. Quien llame a esto ya puede escribir en los dos.
 */
async function abrirSelectorDeLiga(page) {
  await page.goto('/configuracion-quiniela.html');
  await page.locator('#panelLiga').waitFor({ state: 'visible' });
  await page.locator('#abrirSelector').click();
  await page.locator('#comboLiga').waitFor({ state: 'visible' });
}

/**
 * Deja la quiniela armándose por la liga que se le diga.
 *
 * El precio va aparte y antes a propósito: viaja en la MISMA petición que la
 * liga, así que ponerlo después no lo guardaría.
 */
async function elegirLiga(page, nombre, { precio = 2000, alAcumulado = 1000 } = {}) {
  await abrirSelectorDeLiga(page);

  await page.locator('#precioPorDefecto').fill(String(precio));
  await page.locator('#alAcumuladoPorDefecto').fill(String(alAcumulado));

  await page.locator('#comboLiga').click();
  await page.locator('#comboLigaLista li', { hasText: nombre }).first().click();
}

module.exports = {
  credenciales, registrarse, crearQuiniela, activarAdminMode,
  abrirSelectorDeLiga, elegirLiga
};

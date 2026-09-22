/*
 * Entrar a resultados y que ya esté lo tuyo.
 *
 * ============================================================================
 * LAS TRES REGLAS
 * ============================================================================
 *
 * Marco: *«cuando uno entra, por default salgan los resultados de la última
 * jornada del user actual»*, y *«si un administrador entra y no está jugando la
 * quiniela, queda entonces como está ahora»*.
 *
 *   1. Si juegas  → sales tú, la última jornada, y pintado sin pulsar nada.
 *   2. Si no juegas → nada se toca: la pantalla espera, como siempre.
 *   3. Mirando lo TUYO no hay cortina: los partidos sin cerrar se ven sin
 *      contraseña, porque el servidor ya te los mandó.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { registrarse, crearQuiniela, activarAdminMode } = require('./ayudas');

const PANTALLAS = ['/verResultados_puntos.html', '/verResultados.html'];

/**
 * Dos jornadas y un pronóstico en la segunda, con un partido SIN cerrar.
 *
 * ⚠️ La primera jornada existe para que «la última» signifique algo: con una
 * sola, cualquier forma de elegirla acierta por casualidad.
 */
async function conDosJornadas(page, username) {
  const estados = await page.evaluate(async ([usuario]) => {
    const r = [];

    for (const [nombre, fecha] of [['J1', '2099-01-01 15:00'], ['J2', '2099-02-01 15:00']]) {
      r.push((await fetch('/api/jornadas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, partidos: [
          { equipo1: 'Alfa', equipo2: 'Beta', apiDate: fecha }
        ] })
      })).status);
    }

    /* El pronóstico va en la SEGUNDA, que es la que debe salir sola. */
    r.push((await fetch('/api/resultados', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador: usuario, jornada: 'J2',
        pronosticos: [{ marcador1: 3, marcador2: 1 }] })
    })).status);

    return r;
  }, [username]);

  expect(estados, 'no se pudo preparar el escenario').toEqual([200, 200, 200]);
}

for (const pantalla of PANTALLAS) {

  test(`⛔ ${pantalla}: al entrar sale lo mío de la última jornada`, async ({ page }) => {
    const datos = await registrarse(page, 'entra');
    await crearQuiniela(page, 'Entra');
    await activarAdminMode(page, datos.password);
    await conDosJornadas(page, datos.username);

    await page.goto(pantalla);

    /*
     * ⚠️ Sin pulsar NADA. Si hiciera falta un click, esta prueba pasaría igual
     * comprobando lo de siempre — y no habría comprobado lo nuevo.
     */
    await expect(page.locator('#jugadorSelect')).toHaveValue(datos.username);
    await expect(page.locator('#jornadaSelect')).toHaveValue('J2');

    await expect(page.locator('#resultadosContainer .match-card').first())
      .toBeVisible({ timeout: 15000 });
  });

  test(`⛔ ${pantalla}: mis partidos SIN cerrar se ven sin contraseña`, async ({ page }) => {
    /*
     * El servidor ya manda tus propios pronósticos aunque el partido no haya
     * cerrado —decide por identidad, no por contraseña—, así que esconderlos
     * hasta que escribas la tuya era un trámite que no protegía nada.
     *
     * ⚠️ El partido es de 2099: NO ha cerrado. Si la cortina siguiera puesta,
     * aquí no habría ninguna tarjeta que ver.
     */
    const datos = await registrarse(page, 'sincortina');
    await crearQuiniela(page, 'SinCortina');
    await activarAdminMode(page, datos.password);
    await conDosJornadas(page, datos.username);

    await page.goto(pantalla);
    await expect(page.locator('#resultadosContainer .match-card').first())
      .toBeVisible({ timeout: 15000 });

    /* Y el marcador está ahí, no escondido tras un aviso. */
    await expect(page.locator('#resultadosContainer')).toContainText('3 - 1');

    /* El modal de contraseña no ha aparecido por ningún lado. */
    const modal = page.locator('#passwordModal');
    if (await modal.count()) {
      await expect(modal).toBeHidden();
    }
  });

  test(`⚠️ ${pantalla}: quien NO sale en la lista la ve como siempre`, async ({ page }) => {
    /*
     * Marco lo pidió así de claro: *«si un administrador entra y no está
     * jugando la quiniela, queda entonces como está ahora»*.
     *
     * ⛔ Y EL PRIMER INTENTO DE PROBARLO ESTABA MAL PLANTEADO.
     *
     * Se creaba una quiniela y no se pronosticaba nada, dando por hecho que eso
     * dejaba a nadie «jugando». Pero `/api/jugadores` devuelve LOS MIEMBROS —no
     * quienes hayan pronosticado—, y quien crea la quiniela es miembro. Así que
     * el escenario nunca llegó a existir y la prueba comprobaba otra cosa.
     *
     * ⭐ Se reproduce donde sí se puede: interceptando quién dice el servidor
     * que eres. Es exactamente lo que ve la pantalla, y ahorra montar el caso
     * raro —un miembro expulsado, un superadministrador de paso— sólo para
     * llegar al mismo estado.
     */
    const datos = await registrarse(page, 'nojuega');
    await crearQuiniela(page, 'NoJuega');
    await activarAdminMode(page, datos.password);
    await conDosJornadas(page, datos.username);

    /* Alguien que no está entre los jugadores de esta quiniela. */
    await page.route('**/api/auth/me', async ruta => {
      const original = await ruta.fetch();
      const cuerpo = await original.json();
      cuerpo.usuario = { ...cuerpo.usuario, username: 'alguien-que-no-juega' };
      await ruta.fulfill({ response: original, json: cuerpo });
    });

    await page.goto(pantalla);
    await expect(page.locator('#jornadaSelect')).toHaveValue('J2', { timeout: 15000 });

    /*
     * ⚠️ Se espera a propósito: la autoselección es asíncrona, y comprobar de
     * inmediato pasaría aunque estuviera a punto de dispararse.
     */
    await page.waitForTimeout(1500);

    /*
     * Nada seleccionado y nada pintado — como antes de este cambio. Y sobre
     * todo: el desplegable NO se queda con un valor que no existe entre sus
     * opciones, que es lo que pasaría sin la comprobación.
     */
    await expect(page.locator('#jugadorSelect')).toHaveValue('');
    await expect(page.locator('#resultadosContainer .match-card')).toHaveCount(0);
  });
}

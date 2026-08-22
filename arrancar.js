/*
 * El punto de entrada de la aplicación. Esto es lo que corre `npm start`.
 *
 * ============================================================================
 * ⚠️ EL SERVIDOR ESCUCHA DE INMEDIATO, SIN ESPERAR A LA BASE
 * ============================================================================
 *
 * Antes hacía lo contrario —y moría si la base no respondía— con dos
 * consecuencias malas: un despliegue fallaba entero por una base momentáneamente
 * indispuesta, y **las sondas de salud nunca llegaban a responder, que es justo
 * cuando más se necesitan**.
 *
 * Ahora `/healthz` responde siempre y `/readyz` devuelve 503 hasta que la base
 * esté disponible. Render usa la segunda para decidir si mandarle tráfico.
 *
 * Con Neon esto importa más que con Atlas: el plan gratuito **suspende el
 * cómputo por inactividad**, así que la primera conexión después de un rato
 * tarda unos segundos. No es un fallo, es el plan.
 */
'use strict';

require('dotenv').config();

const db = require('./src/db');
const { crearApp } = require('./src/servidor');
const planificador = require('./src/planificador');

const PORT = process.env.PORT || 3000;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. La aplicación no puede arrancar sin base de datos.');
    process.exit(1);
  }

  db.iniciar();

  const { app } = crearApp();

  const servidor = app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });

  /*
   * ⛔ La comprobación de rol va DESPUÉS de abrir el puerto, pero se planta si
   * falla. Es la regla 3 de §21.2: si la aplicación se conectara con el rol
   * dueño podría apagar RLS, y entonces el aislamiento entre quinielas no
   * existiría. Preferimos un proceso que no arranca a uno que sirve datos
   * cruzados.
   *
   * Va después de `listen` para que un despliegue con la base dormida no muera
   * antes de poder responder a `/healthz`.
   */
  try {
    const rol = await db.comprobarRol();
    console.log(`   Conectado a PostgreSQL como "${rol}".`);
  } catch (error) {
    console.error('\n⛔ ARRANQUE ABORTADO:', error.message, '\n');
    servidor.close();
    await db.cerrar();
    process.exit(1);
  }

  if (planificador.arrancar()) {
    console.log('   Trabajos periódicos en marcha.');
  }

  /*
   * Render manda SIGTERM antes de reemplazar una instancia. Sin esto, las
   * peticiones en vuelo se cortan a mitad y las conexiones del pool quedan
   * abiertas del lado de Neon hasta que caducan.
   */
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.once(senal, () => {
      console.log(`\n${senal} recibida: cerrando.`);
      planificador.parar();
      servidor.close(async () => {
        await db.cerrar();
        process.exit(0);
      });
    });
  }
}

main().catch(error => {
  console.error('No se pudo arrancar:', error);
  process.exit(1);
});

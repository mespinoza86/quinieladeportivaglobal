/*
 * El service worker: lo único que sigue vivo cuando la pestaña está cerrada.
 *
 * ⛔ VA EN LA RAÍZ DEL SITIO A PROPÓSITO.
 *
 * Un service worker sólo controla lo que cuelga de su propia carpeta. Servido
 * desde `/js/sw.js` gobernaría `/js/` y nada más, y las notificaciones no
 * llegarían: tiene que estar en `/sw.js` para que su alcance sea el sitio
 * entero. Por eso vive en `public/` y no en `private/js/` como el resto.
 *
 * ⚠️ Aquí NO se importa nada ni se usa nada del resto de la aplicación: este
 * archivo se ejecuta en un mundo aparte, sin DOM, sin sesión y sin las
 * utilidades de `private/js/`. Todo lo que necesita tiene que estar escrito
 * dentro.
 */
'use strict';

/*
 * Tomar el mando en cuanto se instala, sin esperar a que se cierren las
 * pestañas abiertas. Sin esto, quien activa las notificaciones y se queda en la
 * página tendría un worker «en espera» que no recibe nada hasta recargar, y
 * parecería que el botón no funcionó.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', evento => {
  /*
   * ⚠️ Si el mensaje no trae datos o vienen rotos, se avisa igual con un texto
   * genérico en vez de no hacer nada. Un push que llega y no enseña nada es
   * peor que uno impreciso: el teléfono ya gastó la batería en despertarse, y
   * la persona no se entera de que su partido empieza.
   */
  let datos = { titulo: 'Tu partido está por empezar', cuerpo: 'Revisa tus pronósticos.', url: '/index.html' };

  try {
    if (evento.data) datos = Object.assign(datos, evento.data.json());
  } catch (error) {
    /* Se queda el texto genérico de arriba. */
  }

  evento.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      /*
       * El escudo de la quiniela, que ya existe. Antes no se ponía ninguno
       * porque apuntar a un archivo ausente deja la notificación con un hueco
       * en vez de con el dibujo por defecto del navegador.
       */
      icon: '/iconos/icono-192.png',
      /*
       * ⚠️ SIGUE SIN `badge`, y es a propósito. El `badge` es el dibujo
       * diminuto de la barra de estado, y Android lo pinta como SILUETA: coge
       * la transparencia y tira el color. Un escudo a todo color acaba ahí
       * como una mancha blanca cuadrada. Hace falta un dibujo aparte, de una
       * sola forma sobre fondo transparente, y ese no lo tenemos.
       */
      /*
       * Une los avisos del mismo partido: si por lo que sea llegaran dos, el
       * teléfono enseña uno solo en vez de apilarlos.
       */
      tag: datos.url + '|' + datos.titulo,
      renotify: false,
      data: { url: datos.url }
    })
  );
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const destino = evento.notification.data?.url || '/index.html';

  /*
   * Si la aplicación ya está abierta en alguna pestaña, se trae esa al frente
   * en vez de abrir otra. Abrir una segunda pestaña de algo que ya está abierto
   * es de las cosas que más molestan de las notificaciones web.
   */
  evento.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const cliente of abiertas) {
      if (cliente.url.includes(destino) && 'focus' in cliente) return cliente.focus();
    }
    if (abiertas.length && 'navigate' in abiertas[0]) {
      await abiertas[0].focus();
      return abiertas[0].navigate(destino);
    }
    return self.clients.openWindow(destino);
  })());
});

/*
 * Extraído del marcado de index.html.
 *
 * Vivía en un <script> dentro del HTML, lo que obligaba a la política de
 * seguridad a permitir `script-src 'unsafe-inline'`. El código es el mismo;
 * lo único que cambia es dónde vive.
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
    const contexto = await fetch('/api/quiniela-actual');
    if (contexto.status === 401) return window.location.href = '/login.html';
    if (contexto.status === 409) return window.location.href = '/quinielas.html';
    if (contexto.ok) {
      const q = await contexto.json();
      document.querySelector('h1').textContent = q.nombre;

      /*
       * ⛔ EL ROL EN CASTELLANO, NO EL DE LA BASE DE DATOS.
       *
       * Esto decía `Mi Quiniela · user`. Se arregló lo mismo en «Mis
       * quinielas» y esta tarjeta se quedó atrás, porque la pinta otro
       * archivo: el fallo se vio recorriendo la aplicación, no leyendo.
       *
       * ⚠️ La tabla viaja en la propia respuesta (`nombresDeRol`), así que no
       * hay que copiarla aquí ni pedirla aparte. Se deja el valor crudo como
       * último recurso: mejor «user» que un hueco en blanco.
       */
      const nombreDelRol = (q.nombresDeRol || {})[q.rol] || q.rol;
      document.getElementById('quinielaActualNombre').textContent = `${q.nombre} · ${nombreDelRol}`;

      /* Una capacidad, no una lista de roles: con escalones la lista envejece. */
      const puedeAdministrar = (q.capacidades || []).includes('admin.ver');

      if (puedeAdministrar) {
        document.getElementById('adminModeCard').style.display = 'flex';
      }

      /*
       * ⛔ EL SUBTÍTULO NO PUEDE HABLARLE DE ADMINISTRAR A QUIEN NO ADMINISTRA.
       *
       * Decía «Administra jornadas, revisa resultados, consulta puntos» a TODO
       * el mundo, incluidos los jugadores que sólo entran a llenar su quiniela
       * y no tienen ni una de esas pantallas. Se vio en el recorrido, mirando
       * la portada con una cuenta recién aprobada.
       */
      const subtitulo = document.querySelector('.hero-text');

      if (subtitulo) {
        subtitulo.textContent = puedeAdministrar
          ? 'Administra jornadas, revisa resultados y consulta puntos.'
          : 'Llena tu quiniela, revisa tus puntos y mira cómo va la tabla.';
      }
    }
    /*
     * La tarjeta del superadministrador.
     *
     * ⚠️ Va aparte del rol de la quiniela a propósito: ser propietaria de una
     * quiniela no tiene nada que ver con administrar el sistema, y mezclarlas
     * en el mismo `if` sería el principio de confundir los dos permisos.
     *
     * Quien decide es el servidor; esto sólo enseña un enlace. Si fallara, la
     * tarjeta se queda oculta —el fallo por defecto es no enseñar—, y quien
     * tenga acceso puede entrar por la dirección igual.
     */
    try {
      const quien = await fetch('/api/superadmin/quien-soy');
      if (quien.ok && (await quien.json()).esSuperadmin) {
        const tarjeta = document.getElementById('superadminCard');
        if (tarjeta) tarjeta.style.display = 'flex';
      }
    } catch (error) {
      console.error('No se pudo comprobar el acceso al sistema:', error);
    }

    const card = document.getElementById('llenarTriviaCard');
    if (!card) return;

    try {
      const res = await fetch('/api/trivias/activas');
      const trivias = await res.json();

      if (Array.isArray(trivias) && trivias.length > 0) {
        card.style.display = 'flex';
      }
    } catch (error) {
      console.error('Error revisando trivias activas:', error);
    }
  });

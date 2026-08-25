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
      document.getElementById('quinielaActualNombre').textContent = `${q.nombre} · ${q.rol}`;
      if (['propietario', 'admin'].includes(q.rol)) {
        document.getElementById('adminModeCard').style.display = 'flex';
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

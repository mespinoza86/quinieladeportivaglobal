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

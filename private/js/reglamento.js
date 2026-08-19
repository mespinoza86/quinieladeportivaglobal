/*
 * Extraído del marcado de reglamento_quiniela.html.
 *
 * Vivía en un <script> dentro del HTML, lo que obligaba a la política de
 * seguridad a permitir `script-src 'unsafe-inline'`. El código es el mismo;
 * lo único que cambia es dónde vive.
 */
'use strict';

fetch('/api/quiniela-actual').then(r => r.json()).then(q => {
  const p = q.configuracion.puntuacion;
  document.getElementById('pExacto').textContent = p.marcadorExacto;
  document.getElementById('pResultado').textContent = p.resultadoCorrecto;
  document.getElementById('pComodinExacto').textContent = p.comodinExacto;
  document.getElementById('pComodinResultado').textContent = p.comodinResultado;
});

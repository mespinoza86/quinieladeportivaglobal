document.addEventListener('DOMContentLoaded', async () => {
  const lista = document.getElementById('listaQuinielas');
  const mensaje = document.getElementById('mensajeQuinielas');
  const escapar = valor => String(valor ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Sesión finalizada.');
    }
    if (!response.ok) throw new Error(data.error || 'La operación no pudo completarse.');
    return data;
  }

  async function cargar() {
    try {
      const [sesion, quinielas] = await Promise.all([api('/api/auth/me'), api('/api/quinielas')]);
      document.getElementById('cuentaActual').textContent = sesion.usuario.username;
      lista.innerHTML = quinielas.length ? '' : '<p class="helper-text">Todavía no tienes quinielas.</p>';
      quinielas.forEach(q => {
        const card = document.createElement('article');
        card.className = 'action-card';
        const puedeEntrar = ['activo', 'pendiente_retiro'].includes(q.estadoMembresia);
        card.innerHTML = `<div><h3>${escapar(q.nombre)}</h3><p>${escapar(q.rol)} · ${escapar(q.estadoMembresia)} · ${escapar(q.estadoQuiniela)}</p>${q.codigoIngreso ? `<p>Código: <strong>${escapar(q.codigoIngreso)}</strong></p>` : ''}</div>`;
        if (puedeEntrar) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = 'Entrar';
          button.addEventListener('click', async () => {
            await api(`/api/quinielas/${q.id}/seleccionar`, { method: 'POST' });
            window.location.href = '/index.html';
          });
          card.appendChild(button);
          if (q.rol !== 'propietario' && q.estadoMembresia === 'activo') {
            const retirar = document.createElement('button');
            retirar.type = 'button'; retirar.className = 'ghost-button'; retirar.textContent = 'Solicitar retiro';
            retirar.addEventListener('click', async () => {
              await api(`/api/quinielas/${q.id}/seleccionar`, { method: 'POST' });
              await api('/api/quiniela-actual/solicitar-retiro', { method: 'POST' });
              mensaje.textContent = 'Solicitud de retiro enviada.'; await cargar();
            });
            card.appendChild(retirar);
          }
        }
        lista.appendChild(card);
      });
    } catch (error) { mensaje.textContent = error.message; }
  }

  document.getElementById('crearQuinielaForm').addEventListener('submit', async event => {
    event.preventDefault(); mensaje.textContent = '';
    try {
      await api('/api/quinielas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: document.getElementById('nombreQuiniela').value }) });
      window.location.href = '/index.html';
    } catch (error) { mensaje.textContent = error.message; }
  });
  document.getElementById('unirseForm').addEventListener('submit', async event => {
    event.preventDefault(); mensaje.textContent = '';
    try {
      const data = await api('/api/quinielas/unirse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigoIngreso: document.getElementById('codigoIngreso').value }) });
      mensaje.textContent = data.message; event.target.reset(); await cargar();
    } catch (error) { mensaje.textContent = error.message; }
  });
  document.getElementById('cerrarSesion').addEventListener('click', async () => { await fetch('/logout', { method: 'POST' }); window.location.href = '/login.html'; });
  await cargar();
});

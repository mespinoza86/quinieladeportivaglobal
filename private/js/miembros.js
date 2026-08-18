document.addEventListener('DOMContentLoaded', async () => {
  const lista = document.getElementById('listaMiembros');
  const mensaje = document.getElementById('mensajeMiembros');
  async function api(url, options) { const r = await fetch(url, options); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); return d; }
  async function accion(id, accion, body) { try { await api(`/api/quiniela-actual/miembros/${id}/${accion}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); await cargar(); } catch (e) { mensaje.textContent = e.message; } }
  async function cargar() {
    try {
      const [q, miembros] = await Promise.all([api('/api/quiniela-actual'), api('/api/quiniela-actual/miembros')]);
      document.getElementById('codigoQuiniela').textContent = `Código para solicitar ingreso: ${q.codigoIngreso}`;
      lista.innerHTML = '';
      miembros.forEach(m => {
        const card = document.createElement('article'); card.className = 'action-card';
        card.innerHTML = html`<div><h3>${m.username || 'Cuenta no disponible'}</h3><p>${m.email || ''}</p><p><strong>${m.rol}</strong> · ${m.estado}</p></div>`;
        const actions = document.createElement('div'); actions.className = 'button-row';
        const add = (texto, fn, clase='secondary-button') => { const b=document.createElement('button'); b.type='button'; b.className=clase; b.textContent=texto; b.onclick=fn; actions.appendChild(b); };
        if (m.estado === 'pendiente_ingreso') { add('Aprobar', () => accion(m.id, 'aprobar')); add('Rechazar', () => accion(m.id, 'rechazar')); }
        if (m.estado === 'pendiente_retiro') { add('Aprobar retiro', () => accion(m.id, 'aprobar-retiro')); add('Rechazar retiro', () => accion(m.id, 'rechazar')); }
        if (m.estado === 'activo' && m.rol !== 'propietario') {
          add(m.rol === 'admin' ? 'Convertir en user' : 'Hacer admin', () => accion(m.id, 'rol', { rol: m.rol === 'admin' ? 'user' : 'admin' }));
          if (q.rol === 'propietario' && m.rol === 'admin') add('Transferir propiedad', async () => { if (!confirm(`¿Transferir la propiedad a ${m.username}?`)) return; try { await api('/api/quiniela-actual/transferir-propiedad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: m.usuarioId }) }); await cargar(); } catch (e) { mensaje.textContent = e.message; } });
          add('Expulsar', () => confirm(`¿Expulsar a ${m.username}?`) && accion(m.id, 'expulsar'));
        }
        card.appendChild(actions); lista.appendChild(card);
      });
    } catch (e) { mensaje.textContent = e.message; }
  }
  await cargar();
});

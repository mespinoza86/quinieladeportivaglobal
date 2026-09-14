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
        const nombreDelRol = (q.nombresDeRol || {})[m.rol] || m.rol;
        card.innerHTML = html`<div><h3>${m.username || 'Cuenta no disponible'}</h3><p>${m.email || ''}</p><p><strong>${nombreDelRol}</strong> · ${m.estado}</p></div>`;
        const actions = document.createElement('div'); actions.className = 'button-row';
        const add = (texto, fn, clase='secondary-button') => { const b=document.createElement('button'); b.type='button'; b.className=clase; b.textContent=texto; b.onclick=fn; actions.appendChild(b); };
        if (m.estado === 'pendiente_ingreso') { add('Aprobar', () => accion(m.id, 'aprobar')); add('Rechazar', () => accion(m.id, 'rechazar')); }
        if (m.estado === 'pendiente_retiro') { add('Aprobar retiro', () => accion(m.id, 'aprobar-retiro')); add('Rechazar retiro', () => accion(m.id, 'rechazar')); }
        if (m.estado === 'activo' && m.rol !== 'propietario') {
          /*
           * ⚠️ El selector sólo se pinta si quien mira puede repartir roles, y
           * eso lo dice el SERVIDOR con una capacidad. Esconderlo no protege
           * nada —la ruta exige `roles.asignar`— pero enseñar un desplegable
           * que siempre responde 403 es peor que no enseñarlo.
           */
          if ((q.capacidades || []).includes('roles.asignar')) {
            const selector = document.createElement('select');
            /*
             * ⛔ SIN clase de botón, y no es cosmética.
             *
             * Llevaba `secondary-button`, que fija `color: var(--text)` —casi
             * blanco, pensado para el fondo oscuro de las tarjetas—. Esa clase
             * gana por especificidad a la regla global del proyecto
             * (`input, select, textarea { background: casi blanco; color: #0f172a }`),
             * y el desplegable NATIVO pinta sus opciones sobre fondo claro: texto
             * blanco sobre blanco. Sólo se leían al pasar el ratón, porque el
             * resaltado del sistema le pone fondo propio a la opción.
             *
             * Un `select` no es un botón. Sin clase hereda lo que ya usan todos
             * los demás desplegables de la aplicación, que se leen bien.
             */
            selector.setAttribute('aria-label', `Rol de ${m.username || 'este miembro'}`);

            for (const rol of (q.rolesAsignables || [])) {
              const opcion = document.createElement('option');
              opcion.value = rol;
              opcion.textContent = (q.nombresDeRol || {})[rol] || rol;
              opcion.selected = rol === m.rol;
              selector.appendChild(opcion);
            }

            selector.onchange = () => accion(m.id, 'rol', { rol: selector.value });
            actions.appendChild(selector);
          }
          if ((q.capacidades || []).includes('quiniela.eliminar') && m.rol === 'admin') add('Transferir propiedad', async () => { if (!confirm(`¿Transferir la propiedad a ${m.username}?`)) return; try { await api('/api/quiniela-actual/transferir-propiedad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: m.usuarioId }) }); await cargar(); } catch (e) { mensaje.textContent = e.message; } });
          add('Expulsar', () => confirm(`¿Expulsar a ${m.username}?`) && accion(m.id, 'expulsar'));
        }
        card.appendChild(actions); lista.appendChild(card);
      });
    } catch (e) { mensaje.textContent = e.message; }
  }
  await cargar();
});

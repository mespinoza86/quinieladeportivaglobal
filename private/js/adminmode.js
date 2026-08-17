document.addEventListener('DOMContentLoaded', async () => {
  const adminContent = document.getElementById('admin-content');
  const adminLogin = document.getElementById('admin-login');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminLoginMessage = document.getElementById('adminLoginMessage');
  const guestContent = document.getElementById('guest-content');
  const logoutForm = document.getElementById('logoutForm');
  const exitAdminMode = document.getElementById('exitAdminMode');
  let esAdmin = false;

  function mostrarEstado(activo) {
    adminContent.style.display = esAdmin && activo ? 'block' : 'none';
    adminLogin.style.display = esAdmin && !activo ? 'block' : 'none';
    guestContent.style.display = esAdmin ? 'none' : 'block';
  }

  try {
    const response = await fetch('/api/quiniela-actual');
    if (response.status === 401) return window.location.href = '/login.html';
    if (response.status === 409) return window.location.href = '/quinielas.html';
    const data = await response.json();
    esAdmin = ['propietario', 'admin'].includes(data.rol);
    if (!esAdmin) return window.location.replace('/index.html');
    const estado = await fetch('/api/admin-mode');
    const adminMode = await estado.json();
    mostrarEstado(Boolean(adminMode.activo));
  } catch (error) {
    console.error('Error al verificar permisos:', error);
  }

  adminLoginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    adminLoginMessage.textContent = '';
    const response = await fetch('/api/admin-mode/activar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('adminPassword').value })
    });
    const data = await response.json();
    if (!response.ok) {
      adminLoginMessage.textContent = data.error || 'No se pudo activar el modo administrador.';
      return;
    }
    adminLoginForm.reset();
    mostrarEstado(true);
  });

  exitAdminMode?.addEventListener('click', async () => {
    await fetch('/api/admin-mode/desactivar', { method: 'POST' });
    mostrarEstado(false);
  });
  logoutForm?.addEventListener('submit', async event => {
    event.preventDefault(); await fetch('/logout', { method: 'POST' }); window.location.href = '/login.html';
  });
});

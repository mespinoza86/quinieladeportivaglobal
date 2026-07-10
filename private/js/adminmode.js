document.addEventListener('DOMContentLoaded', async () => {
  const adminContent = document.getElementById('admin-content');
  const guestContent = document.getElementById('guest-content');
  const logoutForm = document.getElementById('logoutForm');
  try {
    const response = await fetch('/api/quiniela-actual');
    if (response.status === 401) return window.location.href = '/login.html';
    if (response.status === 409) return window.location.href = '/quinielas.html';
    const data = await response.json();
    const esAdmin = ['propietario', 'admin'].includes(data.rol);
    adminContent.style.display = esAdmin ? 'block' : 'none';
    guestContent.style.display = esAdmin ? 'none' : 'block';
  } catch (error) {
    console.error('Error al verificar permisos:', error);
  }
  logoutForm?.addEventListener('submit', async event => {
    event.preventDefault(); await fetch('/logout', { method: 'POST' }); window.location.href = '/login.html';
  });
});

document.addEventListener('DOMContentLoaded', async () => {
  const mensaje = document.getElementById('configMensaje'); let quiniela;
  async function api(url, options) { const r=await fetch(url,options); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Error'); return d; }
  try {
    quiniela=await api('/api/quiniela-actual'); const p=quiniela.configuracion.puntuacion;
    ['marcadorExacto','resultadoCorrecto','comodinExacto','comodinResultado','campeon','puntosTriviaDefault'].forEach(c=>document.getElementById(c).value=p[c]);
    document.getElementById('triviasHabilitadas').checked=p.triviasHabilitadas;
    document.getElementById('incluirExpulsadosEnRanking').checked=quiniela.configuracion.incluirExpulsadosEnRanking;
    if(['propietario','admin'].includes(quiniela.rol)){document.getElementById('cicloPanel').hidden=false;document.getElementById('archivarButton').textContent=quiniela.estado==='archivada'?'Restaurar quiniela':'Archivar quiniela';}
    if(quiniela.rol==='propietario') document.getElementById('eliminarPanel').hidden=false;
  } catch(e){mensaje.textContent=e.message;}
  document.getElementById('configForm').addEventListener('submit',async e=>{e.preventDefault();try{const campos=['marcadorExacto','resultadoCorrecto','comodinExacto','comodinResultado','campeon','puntosTriviaDefault'];const puntuacion=Object.fromEntries(campos.map(c=>[c,Number(document.getElementById(c).value)]));puntuacion.triviasHabilitadas=document.getElementById('triviasHabilitadas').checked;await api('/api/quiniela-actual/configuracion',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({puntuacion,incluirExpulsadosEnRanking:document.getElementById('incluirExpulsadosEnRanking').checked})});mensaje.textContent='Configuración guardada.';}catch(err){mensaje.textContent=err.message;}});
  document.getElementById('archivarButton').addEventListener('click',async()=>{try{await api('/api/quiniela-actual/archivar',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archivada:quiniela.estado!=='archivada'})});window.location.reload();}catch(e){mensaje.textContent=e.message;}});
  document.getElementById('eliminarButton')?.addEventListener('click',async()=>{if(!confirm('Esta acción retirará la quiniela de todos los usuarios. ¿Continuar?'))return;try{await api('/api/quiniela-actual',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmacion:document.getElementById('confirmarEliminacion').value})});window.location.href='/quinielas.html';}catch(e){mensaje.textContent=e.message;}});
});

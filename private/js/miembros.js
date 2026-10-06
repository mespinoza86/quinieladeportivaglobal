/*
 * Los estados de una membresía, dichos en castellano.
 *
 * ⚠️ Son los cinco que admite la base —ver el `CHECK` de `membresias.estado`—
 * y ni uno más. Si algún día se añade otro, el `|| m.estado` de abajo lo deja
 * salir crudo en vez de en blanco: feo, pero no esconde a nadie de la lista.
 */
const ESTADOS = {
  pendiente_ingreso: 'pide entrar',
  activo: 'juega',
  pendiente_retiro: 'pide salirse',
  rechazado: 'rechazado',
  expulsado: 'expulsado'
};

/*
 * ⛔ INVITAR GENTE ERA COPIAR UN CÓDIGO A MANO Y EXPLICARLO.
 *
 * El código salía como texto suelto en la cabecera. Para meter a alguien había
 * que seleccionarlo, copiarlo, y además contarle a cada uno qué hacer con él:
 * que entre al enlace, que cree cuenta, que lo pegue, que espere aprobación.
 *
 * ⭐ Y el patrón YA ESTABA RESUELTO en «Compartir al grupo», que arma el
 * mensaje entero y lo deja listo para pegar. Esto es lo mismo para invitar.
 *
 * ⚠️ El enlace se saca de `window.location.origin`, NO se escribe a mano: así
 * vale igual en Render, en local y el día que cambie el dominio.
 */
function textoDeInvitacion(quiniela) {
  const enlace = `${window.location.origin}/quinielas.html`;

  return `Te invito a la quiniela «${quiniela.nombre}».\n\n`
    + `1. Entra a ${enlace}\n`
    + '2. Crea tu cuenta si no tienes.\n'
    + `3. Mete este código: ${quiniela.codigoIngreso}\n\n`
    + 'Cuando lo hagas te apruebo y ya puedes llenar tus pronósticos.';
}

function prepararInvitacion(quiniela) {
  const acciones = document.getElementById('invitarAcciones');
  const aviso = document.getElementById('invitacionAviso');

  /* Sin código no hay nada que invitar: quien no puede repartirlo no lo recibe. */
  if (!acciones || !quiniela.codigoIngreso) return;

  acciones.hidden = false;

  /*
   * ⛔ UNA SOLA VEZ. `cargar()` se vuelve a llamar cada vez que se aprueba o se
   * rechaza a alguien, y sin esta marca cada repintado añadiría otro oyente
   * encima: al tercer aprobado, un clic en «Copiar» copiaría cuatro veces y
   * abriría cuatro pestañas de WhatsApp. Es el mismo fallo que ya cazaron los
   * botones de marcador en «Llenar quiniela».
   */
  if (acciones.dataset.conectado === 'si') return;
  acciones.dataset.conectado = 'si';

  /*
   * ⚠️ A cambio, los oyentes se quedan con la quiniela de la PRIMERA carga.
   * Da igual aquí: ni el código de ingreso ni el nombre cambian desde esta
   * pantalla. Si algún día se pudiera renombrar sin salir, habría que releerlo
   * al pulsar en vez de quedárselo.
   */

  document.getElementById('copiarInvitacion').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textoDeInvitacion(quiniela));
      window.avisoBien(aviso, 'Invitación copiada. Pégala donde quieras.');
    } catch (error) {
      /*
       * ⚠️ Algunos navegadores niegan el portapapeles si la pestaña no está al
       * frente. En vez de un «no se pudo» sin salida, se enseña el texto para
       * copiarlo a mano.
       */
      window.avisoFallo(aviso, 'Tu navegador no dejó copiar solo. El texto es: '
        + textoDeInvitacion(quiniela));
    }
  });

  document.getElementById('invitarWhatsapp').addEventListener('click', () => {
    const texto = encodeURIComponent(textoDeInvitacion(quiniela));
    window.open(`https://wa.me/?text=${texto}`, '_blank');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const lista = document.getElementById('listaMiembros');
  const mensaje = document.getElementById('mensajeMiembros');
  async function api(url, options) { const r = await fetch(url, options); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); return d; }
  async function accion(id, accion, body) { try { await api(`/api/quiniela-actual/miembros/${id}/${accion}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); await cargar(); } catch (e) { avisoFallo(mensaje, e.message); } }
  async function cargar() {
    try {
      const [q, miembros] = await Promise.all([api('/api/quiniela-actual'), api('/api/quiniela-actual/miembros')]);
      document.getElementById('codigoQuiniela').textContent = `Código para solicitar ingreso: ${q.codigoIngreso}`;
      prepararInvitacion(q);
      lista.innerHTML = '';
      miembros.forEach(m => {
        const card = document.createElement('article'); card.className = 'action-card';
        const nombreDelRol = (q.nombresDeRol || {})[m.rol] || m.rol;

        /*
         * ⛔ EL ESTADO, EN CASTELLANO.
         *
         * El rol ya se traducía, pero el estado salía tal cual de la base:
         * «Dueño · activo», «Fulano · pendiente_ingreso». Con guión bajo y
         * todo, en la pantalla donde se aprueba gente.
         *
         * ⚠️ Aquí NO se esconde cuando es el corriente, al revés que en «Mis
         * quinielas»: esta pantalla existe JUSTO para mirar en qué estado está
         * cada uno y decidir. Quitar «activo» dejaría a medias la única
         * columna que importa.
         */
        const estado = ESTADOS[m.estado] || m.estado;

        card.innerHTML = html`<div><h3>${m.username || 'Cuenta no disponible'}</h3><p>${m.email || ''}</p><p><strong>${nombreDelRol}</strong> · ${estado}</p></div>`;
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
          if ((q.capacidades || []).includes('quiniela.eliminar') && m.rol === 'admin') add('Transferir propiedad', async () => { if (!confirm(`¿Transferir la propiedad a ${m.username}?`)) return; try { await api('/api/quiniela-actual/transferir-propiedad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuarioId: m.usuarioId }) }); await cargar(); } catch (e) { avisoFallo(mensaje, e.message); } });
          add('Expulsar', () => confirm(`¿Expulsar a ${m.username}?`) && accion(m.id, 'expulsar'));
        }
        card.appendChild(actions); lista.appendChild(card);
      });
    } catch (e) { avisoFallo(mensaje, e.message); }
  }
  await cargar();
});

/*
 * Las rutas del superadministrador.
 *
 * ============================================================================
 * ⚠️ SE MONTAN ANTES DEL MIDDLEWARE DE QUINIELA ACTIVA
 * ============================================================================
 *
 * Por la misma razón que `plataforma.sinQuiniela`: todo lo que cuelga de `/api`
 * exige una quiniela seleccionada y responde 409 si no la hay. Un
 * superadministrador **no pertenece a ninguna quiniela en particular** —puede
 * no tener ninguna—, así que montarlas después le daría «Debes seleccionar una
 * quiniela activa» al pedir una lista que no es de ninguna quiniela.
 *
 * ============================================================================
 * ESTA ES LA PANTALLA QUE MÁS PUEDE DOLER SI SE ABRE
 * ============================================================================
 *
 * Es la primera del sistema que enseña **los correos de todo el mundo**. Si la
 * guardia fallara, no sería un bug de funcionalidad: sería una fuga de datos
 * personales de todos los usuarios, de todas las quinielas, de una sola vez.
 *
 * Por eso `requireSuperadmin` va escrita ruta por ruta y hay un centinela que
 * recorre este archivo y **exige que ninguna se quede sin ella**. Es la lección
 * de la Entrada 064: la ruta hermana que se coló sin guardia no fallaba, sólo
 * dejaba pasar.
 */
'use strict';

const superadminMod = require('../superadmin');
const usuariosMod = require('../usuarios');

/** ¿La confirmación de contraseña sigue en pie? Una hora, como el Admin Mode. */
function confirmacionVigente(req) {
  const acceso = req.session?.superadminMode;
  return Boolean(acceso && Date.now() - acceso.verificadoEn < 1000 * 60 * 60);
}

module.exports = function rutasSuperadmin(app, { requireLogin, requireSuperadmin, limiteSuperadmin }) {
  /**
   * ¿Quien pregunta puede entrar aquí?
   *
   * Sólo pide sesión, no `requireSuperadmin`, porque su respuesta ES si lo es o
   * no. La usa la pantalla para decidir si se enseña, y el menú para el enlace.
   *
   * ⚠️ Responde `false` sin más detalle a quien no lo sea: decir «no estás en
   * SUPERADMIN_EMAILS» le confirmaría a cualquiera que esa variable existe y
   * cómo se llama.
   */
  app.get('/api/superadmin/quien-soy', requireLogin, async (req, res) => {
    const usuario = await usuariosMod.porId(req.session.usuarioId);
    const puede = superadminMod.esSuperadmin(usuario);

    res.json({
      esSuperadmin: puede,
      // Para que la pantalla sepa si tiene que pedir la contraseña.
      confirmado: puede && confirmacionVigente(req),
      email: puede ? usuario.email : null
    });
  });

  /**
   * La puerta: confirmar la contraseña.
   *
   * ⚠️ Tener el correo en la variable NO basta para operar. Hace falta volver a
   * escribir la contraseña, igual que el Admin Mode, y por una razón concreta:
   * una sesión olvidada abierta en un teléfono no puede ser la llave para
   * borrar cuentas del sistema entero.
   *
   * Es la puerta más golpeable de la aplicación, así que lleva el limitador más
   * estricto y sólo cuentan los intentos FALLIDOS.
   */
  app.post('/api/superadmin/confirmar', requireLogin, limiteSuperadmin, async (req, res) => {
    const usuario = await usuariosMod.porId(req.session.usuarioId);

    /*
     * ⚠️ Mismo 403 escueto que recibiría cualquiera. Si a quien no es
     * superadministrador se le dijera algo distinto, esta ruta se convertiría
     * en una forma de averiguar quién sí lo es.
     */
    if (!superadminMod.esSuperadmin(usuario)) {
      return res.status(403).json({ error: 'No tienes acceso a esta sección.' });
    }

    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ error: 'Escribe tu contraseña.' });

    if (!(await usuariosMod.autenticar(usuario.username, password))) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    req.session.superadminMode = { verificadoEn: Date.now() };
    res.json({ success: true });
  });

  /** Salir del modo sin cerrar la sesión. */
  app.post('/api/superadmin/salir', requireLogin, (req, res) => {
    delete req.session.superadminMode;
    res.json({ success: true });
  });

  /* ---------- Lectura ---------- */

  app.get('/api/superadmin/cuentas', requireSuperadmin, async (req, res) => {
    const datos = await superadminMod.listarCuentas({
      buscar: req.query.buscar || '',
      limite: req.query.limite,
      desplazamiento: req.query.desde
    });
    res.json(datos);
  });

  app.get('/api/superadmin/cuentas/:id', requireSuperadmin, async (req, res) => {
    const ficha = await superadminMod.cuenta(req.params.id);
    if (!ficha) return res.status(404).json({ error: 'Esa cuenta no existe.' });
    res.json(ficha);
  });

  app.get('/api/superadmin/acciones', requireSuperadmin, async (req, res) => {
    res.json(await superadminMod.historial({ limite: req.query.limite }));
  });

  /* ---------- Las cuatro acciones ---------- */

  /*
   * El actor se arma DESDE LA SESIÓN, nunca desde el cuerpo de la petición.
   * Si viniera de fuera, cualquiera podría firmar el registro con el nombre de
   * otro — y un historial que se puede firmar en falso no vale para nada.
   */
  function actorDe(req) {
    return { id: req.superadmin.id, email: req.superadmin.email };
  }

  app.post('/api/superadmin/cuentas/:id/desactivar', requireSuperadmin, async (req, res) => {
    res.json(await superadminMod.desactivar(req.params.id, {
      actor: actorDe(req), motivo: req.body?.motivo
    }));
  });

  app.post('/api/superadmin/cuentas/:id/reactivar', requireSuperadmin, async (req, res) => {
    res.json(await superadminMod.reactivar(req.params.id, {
      actor: actorDe(req), motivo: req.body?.motivo
    }));
  });

  app.post('/api/superadmin/cuentas/:id/liberar-correo', requireSuperadmin, async (req, res) => {
    res.json(await superadminMod.liberarCorreo(req.params.id, {
      actor: actorDe(req), motivo: req.body?.motivo
    }));
  });

  /*
   * `desvincularJugadores` es una confirmación explícita, no un valor por
   * defecto: sin ella, borrar a alguien con historial se rechaza y se dice qué
   * pasaría. Que la segunda pulsación sea distinta de la primera es
   * intencionado — es la última acción irreversible del sistema.
   */
  app.delete('/api/superadmin/cuentas/:id', requireSuperadmin, async (req, res) => {
    res.json(await superadminMod.borrar(req.params.id, {
      actor: actorDe(req),
      motivo: req.body?.motivo,
      desvincularJugadores: req.body?.desvincularJugadores === true
    }));
  });
};

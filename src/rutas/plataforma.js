/*
 * Rutas de plataforma: elegir quiniela, entrar en ella, administrar sus
 * miembros y su configuración.
 *
 * ============================================================================
 * SE PARTE EN DOS PORQUE EL ORDEN IMPORTA
 * ============================================================================
 *
 * `sinQuiniela` se registra ANTES del middleware que resuelve la quiniela
 * activa: son las rutas que sirven para elegirla, y exigir una quiniela
 * seleccionada para poder seleccionar quiniela dejaría a una cuenta nueva sin
 * forma de entrar a ninguna parte.
 *
 * `conQuiniela` va después, y todo lo de ahí puede dar por hecho que
 * `req.quiniela` y `req.membresia` existen.
 *
 * ============================================================================
 * LAS RUTAS NO TIENEN REGLAS, LAS TRADUCEN
 * ============================================================================
 *
 * Las reglas viven en `src/membresias.js` y `src/quinielas.js`, y devuelven
 * `{ ok: false, motivo, mensaje }` en vez de códigos HTTP. Aquí se traduce el
 * motivo a un número. Es lo que permitió probar esas reglas sin levantar
 * Express (Entrada 041), y lo que hace que estas rutas quepan en cuatro líneas.
 */
'use strict';

const bcrypt = require('bcrypt');
const db = require('../db');
const usuariosMod = require('../usuarios');
const quinielasMod = require('../quinielas');
const membresiasMod = require('../membresias');
const ligas = require('../ligas');
const cobros = require('../cobros');
const pagosMod = require('../pagos');
const jugadoresMod = require('../jugadores');

/** De motivo de negocio a código HTTP. Un solo sitio donde mirarlo. */
const CODIGOS = {
  no_encontrada: 404,
  no_encontrado: 404,
  no_pendiente: 404,
  ya_dentro: 409,
  ya_pendiente: 409,
  sin_admin: 409,
  es_propietario: 409,
  eres_tu: 409,
  destino_invalido: 400,
  rol_invalido: 400
};

const codigoDe = motivo => CODIGOS[motivo] || 409;

/** Responde un `{ ok, motivo, mensaje }` de los módulos de reglas. */
function responder(res, resultado, exito = { success: true }) {
  if (resultado?.ok === false) {
    return res.status(codigoDe(resultado.motivo)).json({ error: resultado.mensaje });
  }
  return res.json(typeof exito === 'function' ? exito(resultado) : exito);
}

/* ==================== Antes de tener quiniela ==================== */

function sinQuiniela(app, { requireLogin }) {
  /** Las quinielas a las que pertenece esta cuenta. */
  app.get('/api/quinielas', requireLogin, async (req, res) => {
    const filas = await quinielasMod.deUsuario(req.session.usuarioId);
    res.json(filas.map(q => ({
      id: q.id,
      nombre: q.nombre,
      // El código sólo para quien puede repartirlo. Un miembro no invita.
      codigoIngreso: q.codigo_ingreso ?? undefined,
      estadoQuiniela: q.estado_quiniela,
      rol: q.rol,
      estadoMembresia: q.estado_membresia
    })));
  });

  app.post('/api/quinielas', requireLogin, async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const error = quinielasMod.validarNombre(nombre);
    if (error) return res.status(400).json({ error });

    const quiniela = await quinielasMod.crear({ nombre, propietarioId: req.session.usuarioId });

    // Quien la crea entra en ella: si no, tendría que seleccionarla a mano.
    req.session.quinielaActivaId = quiniela.id;

    res.status(201).json({
      success: true,
      quiniela: {
        id: quiniela.id,
        nombre: quiniela.nombre,
        codigoIngreso: quiniela.codigo_ingreso,
        estado: quiniela.estado,
        configuracion: quiniela.configuracion
      }
    });
  });

  app.post('/api/quinielas/unirse', requireLogin, async (req, res) => {
    const quiniela = await quinielasMod.porCodigo(req.body.codigoIngreso);
    if (!quiniela) {
      return res.status(404).json({ error: 'Código de quiniela inválido o quiniela no disponible.' });
    }

    const r = await membresiasMod.solicitarIngreso(quiniela.id, req.session.usuarioId);
    if (r.ok === false) return res.status(codigoDe(r.motivo)).json({ error: r.mensaje });

    res.status(202).json({
      success: true,
      message: 'Solicitud enviada. Un administrador debe aprobarla.'
    });
  });

  app.post('/api/quinielas/:id/seleccionar', requireLogin, async (req, res) => {
    const membresia = await membresiasMod.de(req.params.id, req.session.usuarioId);
    if (!membresia || !membresiasMod.DENTRO.includes(membresia.estado)) {
      return res.status(403).json({ error: 'No tienes acceso activo a esta quiniela.' });
    }

    const quiniela = await quinielasMod.porId(req.params.id);
    if (!quiniela || quiniela.estado === 'eliminada') {
      return res.status(404).json({ error: 'Quiniela no encontrada.' });
    }

    req.session.quinielaActivaId = quiniela.id;
    /*
     * ⚠️ El Admin Mode se cae al cambiar de quiniela. Va atado a una quiniela
     * concreta, y arrastrarlo sería conceder permisos administrativos en otra
     * sin haber confirmado nada.
     */
    delete req.session.adminMode;

    res.json({
      success: true,
      quiniela: { id: quiniela.id, nombre: quiniela.nombre },
      rol: membresia.rol
    });
  });
}

/* ==================== Ya dentro de una quiniela ==================== */

function conQuiniela(app, { requireAdmin, limiteAdminMode }) {
  app.get('/api/quiniela-actual', (req, res) => {
    res.json({
      id: req.quiniela.id,
      nombre: req.quiniela.nombre,
      estado: req.quiniela.estado,
      rol: req.membresia.rol,
      codigoIngreso: ['propietario', 'admin'].includes(req.membresia.rol)
        ? req.quiniela.codigo_ingreso : undefined,
      configuracion: req.quiniela.configuracion
    });
  });

  /* ---------- Admin Mode ---------- */

  /*
   * El rol dice quién PUEDES ser; el Admin Mode dice que lo has confirmado con
   * tu contraseña hace menos de una hora. Se separan porque una sesión olvidada
   * abierta en un ordenador compartido no debería poder borrar una jornada.
   */
  app.get('/api/admin-mode', (req, res) => {
    const autorizadoPorRol = ['propietario', 'admin'].includes(req.membresia.rol);
    const acceso = req.session.adminMode;

    const activo = autorizadoPorRol && Boolean(
      acceso &&
      acceso.quinielaId === String(req.quiniela.id) &&
      Date.now() - acceso.verificadoEn < 1000 * 60 * 60);

    res.json({ autorizadoPorRol, activo });
  });

  app.post('/api/admin-mode/activar', limiteAdminMode, async (req, res) => {
    if (!['propietario', 'admin'].includes(req.membresia.rol)) {
      return res.status(403).json({ error: 'No tienes permisos administrativos en esta quiniela.' });
    }

    const usuario = await usuariosMod.porId(req.session.usuarioId);
    if (!usuario?.activo) return res.status(401).json({ error: 'Contraseña incorrecta.' });

    const { rows: [fila] } = await db.consulta(
      'SELECT password FROM usuarios WHERE id = $1', [req.session.usuarioId]);

    const password = String(req.body.password || '');
    if (!password || !(await bcrypt.compare(password, fila.password))) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    req.session.adminMode = { quinielaId: String(req.quiniela.id), verificadoEn: Date.now() };
    res.json({ success: true });
  });

  app.post('/api/admin-mode/desactivar', (req, res) => {
    delete req.session.adminMode;
    res.json({ success: true });
  });

  /* ---------- Miembros ---------- */

  app.get('/api/quiniela-actual/miembros', requireAdmin, async (req, res) => {
    const filas = await membresiasMod.listar(req.quiniela.id);
    res.json(filas.map(m => ({
      id: m.id,
      usuarioId: m.usuario_id,
      username: m.username,
      email: m.email,
      rol: m.rol,
      estado: m.estado,
      solicitadoEn: m.solicitado_en
    })));
  });

  app.patch('/api/quiniela-actual/miembros/:membresiaId/aprobar', requireAdmin, async (req, res) => {
    responder(res, await membresiasMod.aprobarIngreso(req.quiniela.id, req.params.membresiaId));
  });

  app.patch('/api/quiniela-actual/miembros/:membresiaId/rechazar', requireAdmin, async (req, res) => {
    responder(res, await membresiasMod.rechazar(req.quiniela.id, req.params.membresiaId));
  });

  app.patch('/api/quiniela-actual/miembros/:membresiaId/rol', requireAdmin, async (req, res) => {
    responder(res, await membresiasMod.cambiarRol(req.quiniela.id, req.params.membresiaId, req.body.rol));
  });

  app.post('/api/quiniela-actual/solicitar-retiro', async (req, res) => {
    responder(res,
      await membresiasMod.solicitarRetiro(req.quiniela.id, req.session.usuarioId),
      { success: true, message: 'Solicitud de retiro enviada.' });
  });

  app.patch('/api/quiniela-actual/miembros/:membresiaId/aprobar-retiro', requireAdmin, async (req, res) => {
    responder(res, await membresiasMod.aprobarRetiro(req.quiniela.id, req.params.membresiaId));
  });

  app.patch('/api/quiniela-actual/miembros/:membresiaId/expulsar', requireAdmin, async (req, res) => {
    responder(res,
      await membresiasMod.expulsar(req.quiniela.id, req.params.membresiaId, req.session.usuarioId));
  });

  app.post('/api/quiniela-actual/transferir-propiedad', requireAdmin, async (req, res) => {
    if (req.membresia.rol !== 'propietario') {
      return res.status(403).json({ error: 'Solo el propietario puede transferir la propiedad.' });
    }
    responder(res, await membresiasMod.transferirPropiedad(
      req.quiniela.id, req.session.usuarioId, req.body.usuarioId));
  });

  /* ---------- Configuración ---------- */

  const CAMPOS_NUMERICOS = [
    'marcadorExacto', 'resultadoCorrecto', 'comodinExacto', 'comodinResultado', 'puntosTriviaDefault'
  ];

  app.patch('/api/quiniela-actual/configuracion', requireAdmin, async (req, res) => {
    const entrada = req.body.puntuacion || {};
    const puntuacion = {};

    for (const campo of CAMPOS_NUMERICOS) {
      if (entrada[campo] === undefined) continue;
      const valor = Number(entrada[campo]);
      if (!Number.isFinite(valor) || valor < 0) {
        return res.status(400).json({ error: `Puntuación inválida para ${campo}.` });
      }
      puntuacion[campo] = valor;
    }

    if (entrada.triviasHabilitadas !== undefined) {
      puntuacion.triviasHabilitadas = Boolean(entrada.triviasHabilitadas);
    }

    /*
     * ⚠️ Se manda sólo lo que cambia, y `actualizarConfiguracion` lo FUNDE con
     * lo que había. Mandar el bloque entero borraría cualquier ajuste que este
     * cliente no conociera —los de una versión más nueva, por ejemplo—.
     *
     * Y `puntuacion` se funde aparte porque `jsonb ||` es superficial: fundir
     * `{puntuacion:{marcadorExacto:9}}` sobre el bloque sustituiría el objeto
     * `puntuacion` entero y se llevaría por delante los otros cinco campos.
     */
    const parcial = {};
    if (Object.keys(puntuacion).length) {
      parcial.puntuacion = { ...req.quiniela.configuracion.puntuacion, ...puntuacion };
    }
    if (req.body.incluirExpulsadosEnRanking !== undefined) {
      parcial.incluirExpulsadosEnRanking = Boolean(req.body.incluirExpulsadosEnRanking);
    }

    /*
     * El aviso por correo de que hay pronósticos listos para el grupo.
     *
     * ⛔ Nace APAGADO, y esa es la decisión: quien lee la configuración de una
     * quiniela vieja no encuentra el campo, y `compartir.quiereAviso` exige
     * `=== true`. Va al revés que el valor por defecto de los cobros —allí la
     * duda se resuelve COBRANDO— porque la asimetría es la contraria: un correo
     * que nadie pidió es un problema, y uno que falta es una molestia.
     */
    if (req.body.avisarAlCompartir !== undefined) {
      parcial.avisarAlCompartir = Boolean(req.body.avisarAlCompartir);
    }

    /*
     * Las ligas favoritas se sustituyen enteras, no se funden: son una lista, y
     * fundir listas no significa nada. Mandar `[]` es la forma de no tener
     * ninguna, y por eso se distingue «no vino» de «vino vacía».
     */
    if (req.body.ligasFavoritas !== undefined) {
      if (!Array.isArray(req.body.ligasFavoritas)) {
        return res.status(400).json({ error: 'Las ligas favoritas deben venir en una lista.' });
      }

      const limpias = ligas.normalizarFavoritas(req.body.ligasFavoritas);

      /*
       * Se avisa en vez de recortar en silencio: quien marcó veinticinco tiene
       * que enterarse de que cinco no se guardaron, o creerá que sí.
       */
      if (req.body.ligasFavoritas.length > ligas.MAXIMO_FAVORITAS) {
        return res.status(400).json({
          error: `No se pueden marcar más de ${ligas.MAXIMO_FAVORITAS} ligas favoritas.`
        });
      }

      parcial.ligasFavoritas = limpias;
    }

    /*
     * Los cobros: la cuota del torneo y la de por jornada, cada una con su
     * precio. Se sustituye el bloque entero porque son dos ramas pequeñas y
     * fundirlas por partes no aporta nada.
     *
     * ⚠️ Cambiar el precio de la jornada NO toca las jornadas ya creadas: cada
     * una guarda lo que costó. Esto es el precio de las que vengan.
     */
    if (req.body.cobros !== undefined) {
      parcial.cobros = cobros.normalizarCobros({ cobros: req.body.cobros });
    }

    const quiniela = await quinielasMod.actualizarConfiguracion(req.quiniela.id, parcial);
    res.json({ success: true, configuracion: quiniela.configuracion });
  });

  /**
   * Lo que ve el propio jugador de su cuenta.
   *
   * ⚠️ Sólo la SUYA, y no hace falta comprobar de quién es: el jugador se
   * resuelve desde la sesión, no desde un id que venga por la URL. Así no hay
   * forma de pedir la de otro.
   */
  app.get('/api/quiniela-actual/mi-cuenta', async (req, res) => {
    const config = cobros.normalizarCobros(req.quiniela.configuracion);

    // Si la quiniela no cobra nada, no hay cuenta que enseñar.
    if (!config.torneo.activo && !config.jornada.activo) {
      return res.json({ cobra: false });
    }

    const jugador = await jugadoresMod.deUsuario(req.quiniela.id, req.session.usuarioId);

    /*
     * Todavía no es jugador: el dueño de una quiniela no tiene fila en
     * `jugadores` hasta que actúa. No es un error, es que no debe nada.
     */
    if (!jugador) return res.json({ cobra: true, juega: false });

    const cuenta = await pagosMod.cuentaDetallada(
      req.quiniela.id, jugador.id, req.quiniela.configuracion);

    res.json({ cobra: true, juega: true, ...cuenta });
  });

  app.patch('/api/quiniela-actual/archivar', requireAdmin, async (req, res) => {
    const estado = req.body.archivada === false ? 'activa' : 'archivada';
    const quiniela = await quinielasMod.cambiarEstado(req.quiniela.id, estado);
    res.json({ success: true, estado: quiniela.estado });
  });

  app.delete('/api/quiniela-actual', requireAdmin, async (req, res) => {
    if (req.membresia.rol !== 'propietario') {
      return res.status(403).json({ error: 'Solo el propietario puede eliminar la quiniela.' });
    }
    /*
     * Escribir el nombre exacto no es burocracia: esto apaga la quiniela para
     * todos sus miembros, y es la única acción del sistema que no se deshace
     * desde la interfaz.
     */
    if (String(req.body?.confirmacion || '') !== req.quiniela.nombre) {
      return res.status(400).json({ error: 'Escribe exactamente el nombre de la quiniela para confirmar.' });
    }

    await quinielasMod.cambiarEstado(req.quiniela.id, 'eliminada');
    delete req.session.quinielaActivaId;
    res.json({ success: true });
  });
}

module.exports = { sinQuiniela, conQuiniela, codigoDe };

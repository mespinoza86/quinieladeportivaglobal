/*
 * Rutas de dominio: jornadas, partidos, jugadores y equipos.
 *
 * ============================================================================
 * DE CARA AFUERA SE SIGUE HABLANDO POR NOMBRE Y POR POSICIÓN
 * ============================================================================
 *
 * Es la decisión de alcance de §21.1: claves ajenas dentro, nombres en el API.
 * Estas rutas reciben «Jornada 3» y el índice 2, y `src/jornadas.js` los
 * traduce a identificadores una sola vez. El frontend no se entera de que
 * existen los uuid, y por eso los 39 scripts de `private/js/` no se tocan.
 *
 * ============================================================================
 * TODA ESCRITURA DE UNA JORNADA PUEDE MOVER LOS PUNTOS
 * ============================================================================
 *
 * ⚠️ Guardar, agregar un partido, borrar partidos o cambiar un comodín pueden
 * cambiar la clasificación, así que las cuatro llaman a `ranking.actualizar`.
 * Es lo que congela una jornada que acaba de terminar, la recalcula si ya
 * estaba congelada, y la **descongela** si dejó de estarlo.
 *
 * Olvidarlo en una sola de las cuatro no rompería nada visible: la tabla
 * seguiría respondiendo, con un número viejo. Hay un centinela en
 * `architecture.test.js` que lo vigila por eso mismo.
 */
'use strict';

const bcrypt = require('bcrypt');
const db = require('../db');
const jornadasMod = require('../jornadas');
const cobros = require('../cobros');
const jugadoresMod = require('../jugadores');
const rankingMod = require('../ranking');
const usuariosMod = require('../usuarios');
const validacion = require('../validacion');

const {
  normalizarNombreDeJornada, normalizarPartido, normalizarPartidos,
  normalizarIndicesDePartido, MAX_PARTIDOS_POR_JORNADA
} = validacion;

module.exports = function rutasDeDominio(app, { requireAdmin, enQuiniela }) {

  /* ==================== Jugadores ==================== */

  /** Los nombres que juegan: miembros de dentro más históricos sin cuenta. */
  app.get('/api/jugadores', async (req, res) => {
    res.json(await jugadoresMod.nombres(req.quiniela.id, {
      incluirExpulsados: false
    }));
  });

  /*
   * Estas dos existían cuando un administrador daba de alta jugadores a mano.
   * Desde el multi-quiniela, quien juega crea su cuenta y pide ingreso con el
   * código. Responden 410 —«esto ya no está»— y no 404, para que una pantalla
   * vieja que las llame reciba una explicación en vez de un misterio.
   */
  app.post('/api/jugadores', requireAdmin, (req, res) => {
    res.status(410).json({
      error: 'Los jugadores ahora crean su cuenta y solicitan ingreso mediante el código de la quiniela.'
    });
  });

  app.delete('/api/jugadores/:nombre', requireAdmin, (req, res) => {
    res.status(410).json({ error: 'Usa la administración de miembros para expulsar participantes.' });
  });

  /*
   * Las tres de abajo son de la CUENTA, no del jugador, y por eso todas
   * empiezan comprobando que el nombre de la URL es el de quien pide. Sin esa
   * comprobación, cualquiera podría cambiarle la contraseña a cualquiera.
   */
  async function esSuCuenta(req) {
    const usuario = await usuariosMod.porId(req.session.usuarioId);
    return usuario && usuario.username === req.params.nombre ? usuario : null;
  }

  app.get('/api/jugador/:nombre', async (req, res) => {
    const usuario = await esSuCuenta(req);
    if (!usuario) return res.status(403).json({ error: 'Solo puedes utilizar tu propia cuenta.' });
    res.json({ nombre: usuario.username, password: true });
  });

  app.post('/api/jugadores/:nombre/verificar-password', async (req, res) => {
    const usuario = await esSuCuenta(req);
    if (!usuario) return res.status(403).json({ error: 'Solo puedes validar tu propia cuenta.' });

    const autenticado = await usuariosMod.autenticar(usuario.username, String(req.body.password || ''));
    if (!autenticado) return res.status(401).json({ error: 'Contraseña incorrecta.' });

    res.json({ success: true });
  });

  app.post('/api/jugadores/:nombre/cambiar-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (String(newPassword || '').length < 8) {
      return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }

    const usuario = await esSuCuenta(req);
    if (!usuario) return res.status(403).json({ error: 'Solo puedes cambiar tu propia contraseña.' });

    const autenticado = await usuariosMod.autenticar(usuario.username, String(currentPassword || ''));
    if (!autenticado) return res.status(400).json({ message: 'Contraseña actual incorrecta.' });

    await db.consulta(
      'UPDATE usuarios SET password = $2, updated_at = now() WHERE id = $1',
      [usuario.id, await bcrypt.hash(newPassword, usuariosMod.SALT_ROUNDS)]);

    res.json({ message: 'Contraseña cambiada correctamente' });
  });

  /* ==================== Jornadas ==================== */

  /*
   * ⚠️ «La jornada actual» la decide UNA ruta, y las tres pantallas que la
   * necesitan —llenar quiniela, resultados oficiales y la tabla por jornada—
   * la piden aquí. Antes cada una la deducía por su cuenta y discrepaban.
   *
   * Devuelve también la lista de nombres para que una pantalla llene su
   * desplegable y elija el valor por defecto con UNA sola petición.
   */
  app.get('/api/jornada-actual', async (req, res) => {
    res.json(await jornadasMod.actual(req.quiniela.id));
  });

  /*
   * M-26: la mayoría de pantallas sólo quieren los NOMBRES, para llenar un
   * desplegable, y se llevaban la temporada entera con sus partidos. Con
   * cuarenta jornadas de diez partidos son cuatrocientos de más por pantalla.
   */
  app.get('/api/jornadas', async (req, res) => {
    if (req.query.resumen === '1') {
      return res.json(await jornadasMod.resumen(req.quiniela.id));
    }
    res.json(await jornadasMod.listar(req.quiniela.id));
  });

  app.get('/api/jornadas/:nombre', async (req, res) => {
    const jornada = await jornadasMod.porNombre(req.quiniela.id, req.params.nombre);
    if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada.' });
    res.json(jornada);
  });

  app.post('/api/jornadas', requireAdmin, async (req, res) => {
    const nombre = normalizarNombreDeJornada(req.body?.nombre);
    const partidos = normalizarPartidos(req.body?.partidos);

    /*
     * Las dos cosas en la MISMA transacción: guardar la jornada y recalcular
     * sus puntos. A medias, la jornada tendría partidos nuevos y una
     * clasificación calculada con los viejos.
     */
    /*
     * ⚠️ El precio se copia de la configuración AL CREAR, y se queda con la
     * jornada. Si después se sube —"esta vale 5000 porque el premio está
     * grande"—, las que ya existen no se enteran: lo pasado ya quedó.
     */
    const precio = cobros.normalizarCobros(req.quiniela.configuracion).jornada;

    /*
     * ⚠️ El orden se decide AQUÍ, nunca dentro de `guardar`.
     *
     * Si viviera dentro, cada guardado reordenaría también las jornadas viejas
     * —el caso que no queremos, porque mueve de sitio partidos que la gente ya
     * rellenó—. Aquí se hace una vez, con lo que hay en la base a la vista:
     * los guardados conservan su orden y los nuevos se ordenan entre sí por
     * hora de inicio y van al final.
     */
    const guardada = await jornadasMod.porNombre(req.quiniela.id, nombre);
    const enOrden = jornadasMod.ordenarParaGuardar(
      partidos, (guardada?.partidos || []).map(p => p.apiFixtureId));

    const cambio = await enQuiniela(req, async () => {
      const r = await jornadasMod.guardar(req.quiniela.id, nombre, enOrden,
        precio.activo ? precio.precio : 0);
      await rankingMod.actualizar(req.quiniela.id, nombre, req.puntuacion);
      return r;
    });

    /*
     * ⚠️ Se informa de lo que se borró. Antes `guardar` contaba los pronósticos
     * que se llevaba por delante y esta ruta TIRABA ESE NÚMERO sin mirarlo, así
     * que la gente perdía sus marcadores y nadie se enteraba.
     *
     * Borrarlos puede ser correcto —el partido ya no está en la jornada— pero
     * eso no lo hace callable: son datos de otras personas.
     */
    res.json({
      jornadas: await jornadasMod.listar(req.quiniela.id),
      partidosRetirados: cambio.partidosReemplazados,
      pronosticosBorrados: cambio.pronosticosBorrados
    });
  });

  app.post('/api/jornadas/agregar-partido', requireAdmin, async (req, res) => {
    const nombre = normalizarNombreDeJornada(req.body?.jornada);
    const partido = normalizarPartido(req.body?.partido);

    const r = await enQuiniela(req, async () => {
      const alta = await jornadasMod.agregarPartido(
        req.quiniela.id, nombre, partido, MAX_PARTIDOS_POR_JORNADA);
      if (alta.ok) await rankingMod.actualizar(req.quiniela.id, nombre, req.puntuacion);
      return alta;
    });

    if (r.motivo === 'no_encontrada') return res.status(404).json({ error: 'Jornada no encontrada.' });
    if (r.motivo === 'demasiados') {
      throw validacion.errorDeValidacion(
        `Una jornada admite como máximo ${MAX_PARTIDOS_POR_JORNADA} partidos.`);
    }

    res.json({ success: true });
  });

  app.post('/api/jornadas/eliminar-partidos', requireAdmin, async (req, res) => {
    const nombre = normalizarNombreDeJornada(req.body?.jornada);

    const jornada = await jornadasMod.porNombre(req.quiniela.id, nombre);
    if (!jornada) return res.status(404).json({ error: 'Jornada no encontrada.' });

    const indices = normalizarIndicesDePartido(req.body?.indices, jornada.partidos.length);

    await enQuiniela(req, async () => {
      await jornadasMod.eliminarPartidos(req.quiniela.id, nombre, indices);
      await rankingMod.actualizar(req.quiniela.id, nombre, req.puntuacion);
    });

    res.json({ success: true });
  });

  app.post('/api/jornadas/comodin', requireAdmin, async (req, res) => {
    const nombre = normalizarNombreDeJornada(req.body?.jornada);
    const partidos = normalizarPartidos(req.body?.partidos);

    const r = await enQuiniela(req, async () => {
      const cambio = await jornadasMod.fijarComodines(req.quiniela.id, nombre, partidos);
      if (cambio.ok) await rankingMod.actualizar(req.quiniela.id, nombre, req.puntuacion);
      return cambio;
    });

    if (r.motivo === 'no_encontrada') return res.status(404).send('Jornada no encontrada');
    if (r.motivo === 'no_coincide') {
      /*
       * La pantalla manda la lista entera para cambiar una casilla. Si el
       * número de partidos no coincide, lo que llega no es «la misma jornada
       * con otro comodín» sino otra cosa, y aplicarla borraría partidos.
       */
      throw validacion.errorDeValidacion('La lista de partidos no coincide con la jornada.');
    }

    res.send('Estado de comodín actualizado');
  });

  app.delete('/api/jornadas/:nombre', requireAdmin, async (req, res) => {
    /*
     * Los pronósticos, los resultados oficiales y los puntos congelados se van
     * con ella **por clave ajena en cascada**. En Mongo eran cuatro borrados
     * dentro de una transacción, y a medias quedaban puntos congelados de una
     * jornada que ya no existe: la tabla general los seguía sumando al total
     * sin una columna a la que pertenecer.
     */
    const r = await jornadasMod.eliminar(req.quiniela.id, req.params.nombre);
    if (!r.ok) return res.status(404).json({ error: 'Jornada no encontrada' });

    res.json({
      success: true,
      message: 'Jornada, pronósticos y resultados oficiales eliminados'
    });
  });

  /* ==================== Equipos ==================== */

  app.get('/api/equipos', async (req, res) => {
    res.json(await jugadoresMod.equipos(req.quiniela.id));
  });

  /*
   * La pantalla manda la lista completa y ésta queda como la que llega: lo que
   * no venga, se va. Todo en una transacción, porque a medias la lista de
   * equipos quedaría en un estado que nadie pidió.
   */
  app.post('/actualizar-equipos', requireAdmin, async (req, res) => {
    const { equipos } = req.body;
    if (!Array.isArray(equipos)) return res.status(400).json({ error: 'Equipos inválidos' });

    const nombres = equipos.map(e => String(e || '').trim()).filter(Boolean);

    await enQuiniela(req, async cliente => {
      await cliente.query('DELETE FROM equipos WHERE NOT (nombre = ANY($1::text[]))', [nombres]);
      for (const nombre of nombres) {
        await cliente.query(
          `INSERT INTO equipos (quiniela_id, nombre) VALUES ($1, $2)
           ON CONFLICT (quiniela_id, nombre) DO NOTHING`,
          [req.quiniela.id, nombre]);
      }
    });

    res.json({ message: 'Equipos actualizados' });
  });
};

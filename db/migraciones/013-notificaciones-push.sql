-- ===========================================================================
-- 013 · Notificaciones push: «tu partido arranca en 15 minutos»
-- ===========================================================================
--
-- Lo que Marco pidió el 4 de septiembre y llamó «lo que más quiero»: un aviso
-- en el teléfono 15 minutos antes de que empiece un partido, para que a nadie
-- se le pase revisar sus pronósticos.
--
-- Dos piezas, y viven en sitios distintos a propósito:
--
--   `suscripciones_push`  es de PLATAFORMA, como `usuarios` y `membresias`.
--   `partidos.notificado_en` es de QUINIELA, y va con el resto de sus marcas.
--
-- ⛔ POR QUÉ LA SUSCRIPCIÓN NO LLEVA RLS NI CUELGA DE UNA QUINIELA
--
-- Una suscripción push es un NAVEGADOR, no un jugador de una quiniela. La misma
-- persona puede estar en cinco quinielas desde el mismo teléfono: colgarla de
-- la quiniela obligaría a activar las notificaciones cinco veces y guardaría
-- cinco filas con el mismo `endpoint`, y al darse de baja en una seguiría
-- recibiendo por las otras cuatro. El teléfono es de la persona.
--
-- A quién hay que avisar sale del cruce con `membresias` en el momento de
-- avisar, que es donde esa pregunta tiene respuesta.
--
-- Correr en Neon CON EL ROL DUEÑO.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS suscripciones_push (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  -- La dirección que da el navegador. ES la identidad de la suscripción.
  endpoint     text NOT NULL,

  -- Las dos claves con las que se cifra el mensaje para ese navegador.
  p256dh       text NOT NULL,
  auth         text NOT NULL,

  -- Para poder decirle a alguien «este teléfono ya está activado».
  user_agent   text NOT NULL DEFAULT '',

  created_at   timestamptz NOT NULL DEFAULT now(),
  usada_en     timestamptz
);

/*
 * ⛔ UNIQUE sobre el endpoint, no sobre (usuario, endpoint).
 *
 * El navegador reutiliza el mismo endpoint si vuelves a suscribirte sin
 * haberte dado de baja. Sin esto, pulsar «activar» dos veces dejaría dos filas
 * y llegarían DOS notificaciones del mismo partido al mismo teléfono.
 *
 * Y va sobre el endpoint SOLO —no sobre el par con el usuario— porque un
 * endpoint pertenece a un navegador: si esa persona cierra sesión y entra otra
 * en el mismo teléfono, la suscripción tiene que cambiar de dueño, no
 * duplicarse.
 */
CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_push_endpoint
  ON suscripciones_push (endpoint);

CREATE INDEX IF NOT EXISTS suscripciones_push_usuario
  ON suscripciones_push (usuario_id);

-- ---------------------------------------------------------------------------
-- La marca por partido: se avisa UNA vez.
--
-- Es hermana de `compartido_en` (008) y `avisado_en` (009), y por lo mismo: el
-- reloj corre cada minuto y una notificación no es idempotente. Sin la marca,
-- el mismo partido avisaría quince veces durante su ventana.
-- ---------------------------------------------------------------------------

ALTER TABLE partidos
  ADD COLUMN IF NOT EXISTS notificado_en timestamptz;

-- ---------------------------------------------------------------------------
-- Comprobación (con el rol dueño):
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'suscripciones_push' ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'suscripciones_push';
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'partidos' AND column_name = 'notificado_en';
--
-- Y que la aplicación pueda usarla (debe listar SELECT, INSERT, UPDATE, DELETE):
--
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'app_quiniela' AND table_name = 'suscripciones_push';
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- PERMISOS
-- ===========================================================================
--
-- ⛔ Una tabla nueva nace SIN permisos para `app_quiniela`: sin esto la
-- aplicación no podría ni leerla. Lo destapó la 006, que tuvo que traerlos
-- escritos, y no hay privilegio por defecto que los conceda.
--
-- ⚠️ Y aquí SÍ va `DELETE`, al revés que en las tablas de dinero:
--
--   · cuando alguien apaga las notificaciones, su fila se va;
--   · y sobre todo, cuando el servicio de push responde 404 o 410 —«esa
--     suscripción ya no existe»— hay que borrarla. Sin eso la tabla se llena
--     de teléfonos muertos a los que se sigue escribiendo cada partido, para
--     siempre.
--
-- Aquí no hay nada que auditar: una suscripción no es un asiento contable.

GRANT SELECT, INSERT, UPDATE, DELETE ON suscripciones_push TO app_quiniela;

-- =====================================================================
-- MIGRACION 002 - SUPERADMINISTRADOR: el registro de sus acciones
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon. NO con
--    `app_quiniela`: crear tablas exige ser dueno, y la aplicacion se
--    conecta a proposito con un rol que no puede.
--
-- ⛔ Y SE CORRE ANTES DE EMPUJAR EL CODIGO QUE LA NECESITA. Al reves, la
--    version nueva llega a produccion y consulta una tabla que no existe.
--
-- ---------------------------------------------------------------------
-- LAS TRES REGLAS DE UNA MIGRACION EN ESTA CARPETA (de la 001)
-- ---------------------------------------------------------------------
--
--   1. ADITIVA. Crea cosas nuevas; no borra ni reescribe lo que hay.
--   2. IDEMPOTENTE. Correrla dos veces no puede fallar ni duplicar nada.
--   3. LA MISMA VERDAD QUE `db/esquema.sql`, que es lo que monta una base
--      nueva desde cero. Si los dos se separan, una instalacion nueva y una
--      al dia dejan de ser la misma cosa, y eso se descubre tarde y mal.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y QUE NO
-- ---------------------------------------------------------------------
--
-- Solo la tabla del registro. **Quien es superadministrador NO vive en la
-- base**: sale de la variable de entorno `SUPERADMIN_EMAILS`.
--
-- ⚠️ Esa decision es deliberada y es la mitad de la seguridad de todo esto.
-- Con una columna `es_superadmin`, cualquiera que llegue a serlo puede
-- nombrar a otro desde la propia pantalla, y una cuenta comprometida se
-- vuelve permanente. Con la variable hace falta entrar al panel de Render:
-- **el poder total no se concede desde dentro de la aplicacion**. Es la
-- misma logica por la que la aplicacion no se conecta con el rol dueno.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- El registro de acciones.
-- ---------------------------------------------------------------------
--
-- Es la primera cosa del sistema que puede dejar a alguien fuera, asi que
-- tiene que quedar escrito quien, a quien, cuando y por que. Mismo criterio
-- que los abonos (Entrada 061): un historial sin autor no sirve para lo
-- unico que sirve, que es resolver un "y esto quien lo hizo".
--
-- Tabla de PLATAFORMA: no lleva `quiniela_id` y no lleva RLS. Una accion
-- sobre una cuenta no pertenece a ninguna quiniela.
CREATE TABLE IF NOT EXISTS acciones_superadmin (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quien la hizo. Se guarda el correo ademas del id por la misma razon que
  -- abajo: el actor tambien puede desaparecer algun dia.
  actor_usuario_id   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  actor_email        text NOT NULL,

  accion             text NOT NULL
                       CHECK (accion IN ('desactivar','reactivar','liberar_correo','borrar')),

  /*
   * ⛔ EL OBJETIVO VA SIN CLAVE AJENA, Y ES A PROPOSITO.
   *
   * Con `REFERENCES usuarios(id) ON DELETE CASCADE`, borrar una cuenta se
   * llevaria por delante el registro de que la borraste -justo el unico caso
   * en el que esta tabla hace falta de verdad-. Y con `RESTRICT` seria peor:
   * el registro impediria el borrado que el mismo registra.
   *
   * Por eso el id es suelto y el correo y el nombre se COPIAN: el asiento
   * tiene que seguir siendo legible cuando la fila original ya no exista.
   */
  objetivo_usuario_id uuid,
  objetivo_email      text NOT NULL,
  objetivo_username   text NOT NULL,

  -- Obligatorio de verdad: un registro de motivos vacios no explica nada.
  motivo             text NOT NULL CHECK (btrim(motivo) <> ''),

  -- Que se llevo por delante, para poder mirarlo despues: membresias
  -- borradas, jugadores desvinculados, el correo anterior al liberarlo.
  detalle            jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Se consulta por lo mas reciente, y a veces por una persona concreta.
CREATE INDEX IF NOT EXISTS acciones_superadmin_fecha
  ON acciones_superadmin (created_at DESC);

CREATE INDEX IF NOT EXISTS acciones_superadmin_objetivo
  ON acciones_superadmin (objetivo_usuario_id);

-- ---------------------------------------------------------------------
-- Las concesiones al rol de la aplicacion.
-- ---------------------------------------------------------------------
--
-- Se repiten aqui por lo mismo que en la 001: si esta migracion se corre en
-- una base montada de otra forma, sin esto la tabla existe y la aplicacion
-- no puede tocarla, y el error sale en produccion y no aqui.
--
-- ⚠️⚠️ ESTE GRANT NO BASTA, Y ESTA LINEA SE QUEDA COMO ESTABA A PROPOSITO.
--
-- La intencion era "sin DELETE": un registro que la aplicacion puede borrar no
-- es una auditoria. Pero **un GRANT solo suma**: Neon y `poner-al-dia.sql`
-- dejan privilegios por defecto que ya conceden SELECT, INSERT, UPDATE y
-- DELETE sobre toda tabla nueva, asi que la tabla nacio con los cuatro.
--
-- Se comprobo contra la base de verdad DESPUES de correr esto, y salio:
--   Permisos de app_quiniela: DELETE, INSERT, SELECT, UPDATE
--
-- ⛔ Lo arregla `003-auditoria-solo-lectura.sql`, con un REVOKE. Esta migracion
-- NO se edita porque ya se corrio en produccion: cambiarla dejaria el archivo
-- describiendo algo distinto de lo que se ejecuto.
GRANT SELECT, INSERT ON acciones_superadmin TO app_quiniela;

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT count(*) FROM acciones_superadmin;
--   -- 0, y sin error: la tabla existe
--
--   SELECT confrelid::regclass FROM pg_constraint
--    WHERE conrelid = 'acciones_superadmin'::regclass AND contype = 'f';
--   -- SOLO `usuarios` una vez (el actor). Si sale dos veces, el objetivo
--   -- quedo con clave ajena y borrar una cuenta se llevara su registro.
--
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'acciones_superadmin' AND grantee = 'app_quiniela';
--   -- SELECT e INSERT. Si aparece DELETE, la aplicacion puede borrar su
--   -- propio rastro.
--
-- Y se puede volver a correr entera: no debe fallar ni cambiar nada.
-- =====================================================================

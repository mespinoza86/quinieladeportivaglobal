-- =====================================================================
-- MIGRACION 005 - A QUIEN SE LE COBRAN LAS JORNADAS
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita: al reves, la version nueva
--    llega a produccion y consulta una columna que todavia no existe.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y POR QUE
-- ---------------------------------------------------------------------
--
-- `jugadores` ya tenia `juega_torneo`, para eximir a alguien de la cuota del
-- torneo completo. No habia equivalente para la cuota POR JORNADA: si la
-- quiniela las cobraba, se le cobraban a todo el mundo sin excepcion.
--
-- Lo pidio el usuario para poder decidir, persona a persona, quien paga las
-- jornadas y quien no —el caso que lo motivo: que un administrador no tenga
-- que pagar—. Es el mismo mecanismo que ya existia para el torneo, replicado
-- para el otro concepto.
--
-- ---------------------------------------------------------------------
-- ⛔ EL `DEFAULT true` NO ES UN DETALLE
-- ---------------------------------------------------------------------
--
-- Es lo que hace que esta migracion **no cambie nada** para quien ya esta
-- dentro. Con `DEFAULT false`, todas las filas existentes quedarian exentas y
-- la deuda de toda la quiniela desapareceria de golpe.
--
-- ⚠️ Y no fallaria: las cuentas saldrian en cero y todo el mundo apareceria al
-- dia. Un fallo que borra dinero sin dar ningun error es exactamente el que no
-- se descubre hasta que alguien reclama.
--
-- `NOT NULL` por lo mismo: un nulo obligaria a cada consulta a decidir que
-- significa "no se sabe", y ahi es donde se cuelan las respuestas distintas.
-- =====================================================================

BEGIN;

ALTER TABLE jugadores
  ADD COLUMN IF NOT EXISTS juega_jornadas boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN jugadores.juega_jornadas IS
  'Si se le cobra la cuota por jornada. Su gemela es juega_torneo. '
  'Quitarla NO borra sus abonos: lo pagado queda como saldo a favor.';

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'jugadores' AND column_name = 'juega_jornadas';
--   -- juega_jornadas | true | NO
--
-- ⛔ Y LO QUE DE VERDAD IMPORTA: que nadie se haya quedado exento sin querer.
--
--   SELECT count(*) FILTER (WHERE juega_jornadas) AS se_les_cobra,
--          count(*) FILTER (WHERE NOT juega_jornadas) AS exentos
--     FROM jugadores;
--   -- exentos tiene que ser 0 justo despues de la migracion
--
-- ⚠️ Esa consulta hay que correrla CON EL ROL DUENO y sobre todas las filas:
-- `jugadores` lleva RLS, asi que desde la aplicacion habria que ir quiniela por
-- quiniela y una consulta global devolveria cero filas sin fallar.
--
-- Se puede volver a correr entera: `IF NOT EXISTS` la hace idempotente.
-- =====================================================================

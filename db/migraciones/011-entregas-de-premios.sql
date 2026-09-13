-- =====================================================================
-- MIGRACION 011 - LAS ENTREGAS DEJAN DE SER SOLO DEL ACUMULADO
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y POR QUE
-- ---------------------------------------------------------------------
--
-- Marco pidio ver en Cobros "cuanto dinero debe haber en la cuenta para estar
-- al dia con todo". Al ir a calcularlo aparecio que faltaba la mitad de la
-- ecuacion:
--
--   DEBE HABER = todo lo cobrado
--              - premios de jornada entregados   <- NO SE REGISTRABA
--              - entregas del acumulado          <- si
--              - premio de torneo entregado      <- NO SE REGISTRABA
--
-- `botes()` sabia cuanto se COBRO para el premio de cada jornada, pero nada
-- decia si ese premio SALIO. Cada domingo se le paga al ganador y ese dinero
-- se iba de la cuenta sin dejar rastro, asi que la caja no se podia calcular.
--
-- Esta migracion generaliza la tabla que ya existia para el acumulado: pasa a
-- ser el libro de TODAS las salidas de dinero.
--
-- ---------------------------------------------------------------------
-- ⛔ POR QUE UNA ENTREGA NO ES UN `pago` NEGATIVO
-- ---------------------------------------------------------------------
--
-- Es la tentacion obvia -`pagos` ya admite montos negativos para las
-- anulaciones- y romperia las cuentas en silencio.
--
-- `pagos` responde a UNA pregunta: "?cuanto debe esta persona?". Un jugador
-- que gana un premio NO DEBE MENOS. Si el premio entrara ahi, `cuentaDeJugador`
-- lo leeria como que ya pago su cuota y le cobraria de menos la jornada
-- siguiente, sin dar ningun error.
--
-- Marco lo dijo con estas palabras el 13 de septiembre: "al jugador se le
-- entrega el premio completo, eso quiere decir que el premio no se abona a
-- futuras quinielas". Entra dinero por un lado y sale por otro: son dos libros.
--
-- ---------------------------------------------------------------------
-- EL RENOMBRADO, Y POR QUE SE HACE
-- ---------------------------------------------------------------------
--
-- La tabla va a guardar entregas de jornada y de torneo, asi que el nombre
-- `entregas_acumulado` pasaria a ser mentira. Un nombre que miente cuesta mas
-- que el rato de renombrar.
--
-- ⚠️ PostgreSQL arrastra solo la politica de RLS, los indices y los permisos
-- -incluido el REVOKE de la migracion 007-. Lo que NO se arrastra son las
-- listas escritas en el codigo: `SOLO_ESCRITURA` del arnes de pruebas y el
-- centinela que la compara con las migraciones. Esos hay que tocarlos a mano,
-- y el centinela se pone rojo si falta uno.
--
-- ---------------------------------------------------------------------
-- ⚠️ LO DE "PARA ATRAS SE ASUME ENTREGADO" NO ESTA AQUI
-- ---------------------------------------------------------------------
--
-- Los premios de las jornadas anteriores ya se pagaron y no hay registro de
-- ellos. Marco pidio asumirlos entregados y registrar de la jornada en juego
-- en adelante.
--
-- ⛔ Eso NO se resuelve insertando filas inventadas: no se sabe quien gano cada
-- una, y una fila con un ganador falso es peor que no tener fila.
--
-- Se resuelve con un CORTE: `configuracion.premiosRegistradosDesde` guarda la
-- secuencia de la primera jornada cuyo premio se registra. Las anteriores se
-- dan por entregadas por su importe cobrado. Vive en el `jsonb` de
-- `quinielas.configuracion`, asi que NO necesita migracion, y es el mismo
-- patron que `jugadores.cobrar_desde`: "de aqui en adelante".
-- =====================================================================

BEGIN;

ALTER TABLE entregas_acumulado RENAME TO entregas;

ALTER TABLE entregas
  ADD COLUMN IF NOT EXISTS concepto text NOT NULL DEFAULT 'acumulado',
  ADD COLUMN IF NOT EXISTS jornada_id uuid REFERENCES jornadas(id) ON DELETE SET NULL;

-- Las filas que ya existan son del acumulado: el DEFAULT las deja correctas.
ALTER TABLE entregas
  ADD CONSTRAINT entregas_concepto_valido
  CHECK (concepto IN ('jornada', 'acumulado', 'torneo'));

-- ⛔ Una entrega de jornada SIN jornada no se puede imputar a nada, y una del
-- acumulado CON jornada seria una imputacion falsa. La base lo impide.
ALTER TABLE entregas
  ADD CONSTRAINT entregas_jornada_solo_si_es_de_jornada
  CHECK ((concepto = 'jornada') = (jornada_id IS NOT NULL));

-- Un premio de jornada se entrega UNA vez.
CREATE UNIQUE INDEX IF NOT EXISTS entregas_una_por_jornada
  ON entregas (jornada_id) WHERE concepto = 'jornada';

COMMENT ON TABLE entregas IS
  'El libro de SALIDAS de dinero: premios de jornada, del acumulado y de '
  'torneo. Solo INSERT y SELECT. NO es `pagos`: un premio entregado no '
  'reduce lo que el jugador debe.';

COMMENT ON COLUMN entregas.concepto IS
  'jornada | acumulado | torneo. Con jornada, jornada_id dice cual.';

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'entregas' ORDER BY ordinal_position;
--   -- tienen que estar `concepto` (NOT NULL) y `jornada_id` (nulable)
--
-- ⛔ Y LO QUE DE VERDAD IMPORTA: que la tabla siga siendo de SOLO ESCRITURA
-- despues del renombrado. El REVOKE de la 007 se arrastra, pero comprobarlo
-- cuesta un comando y no comprobarlo ya salio caro una vez (Entrada 079):
--
--   SELECT table_name,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'app_quiniela'
--      AND table_name IN ('pagos','acciones_superadmin','entregas')
--    GROUP BY table_name ORDER BY table_name;
--   -- las tres tienen que decir exactamente: INSERT, SELECT
--   -- ⛔ si `entregas` sale con UPDATE o DELETE, corre:
--   --    REVOKE UPDATE, DELETE ON entregas FROM app_quiniela;
--
-- Y que el aislamiento por fila sigue puesto:
--
--   SELECT relrowsecurity, relforcerowsecurity
--     FROM pg_class WHERE relname = 'entregas';
--   -- las dos: true
--
-- Se puede volver a correr entera: el RENAME falla la segunda vez si ya se
-- hizo, asi que si hace falta repetirla, comentar esa linea.
-- =====================================================================

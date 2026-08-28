-- =====================================================================
-- MIGRACION 006 - EL ACUMULADO: dos cuotas, dos botes
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita.
--
-- ---------------------------------------------------------------------
-- QUE TRAE
-- ---------------------------------------------------------------------
--
-- La cuota de jornada se parte en dos, y cada parte va a un sitio distinto:
--
--     ₡2.000 que paga cada quien
--        ├── ₡1.000 -> premio de ESA jornada
--        └── ₡1.000 -> acumulado, para el ganador de la tabla general al final
--
-- El administrador escribe las DOS cuotas por separado, asi que cada quiniela
-- reparte como quiera: mitad y mitad, 1.500/500, o 2.000/0 —que es exactamente
-- como funciona hoy—.
--
--   1. `jornadas.al_acumulado`  - cuanto de esa jornada fue al bote. Congelado
--      al crearla, igual que `precio`: cambiar el reparto manana NO puede
--      reinterpretar lo que ya se jugo (es la leccion de `jornadas.precio`,
--      Entrada 061, y de `puntos_jornada.puntuacion` antes que ella).
--
--   2. `jugadores.juega_acumulado` - quien participa en el bote. Su gemela son
--      `juega_torneo` y `juega_jornadas`. Quien no participe paga solo la parte
--      de jornada.
--
--   3. `entregas_acumulado` - a quien se le entrego el bote, cuanto y cuando.
--      Sin esto el acumulado creceria para siempre y no quedaria rastro de
--      donde fue el dinero.
--
-- ---------------------------------------------------------------------
-- ⛔ LOS VALORES POR DEFECTO NO CAMBIAN NADA PARA QUIEN YA ESTA DENTRO
-- ---------------------------------------------------------------------
--
-- `al_acumulado` nace en 0: las jornadas que ya existen NO aportaron al bote, y
-- su dinero sigue siendo integro el premio de esa jornada. Es la unica lectura
-- que no reinterpreta el pasado.
--
-- ⚠️ Si se quiere que una jornada ya creada aporte al acumulado, se cambia
-- DESDE LA PANTALLA, jornada por jornada y a proposito. Hacerlo aqui en masa
-- cambiaria el significado de premios que quiza ya se repartieron, y sin que
-- nadie lo pidiera para cada caso.
--
-- `juega_acumulado` nace en true: quien ya esta dentro participa, que es lo que
-- se espera. En false, todo el mundo dejaria de aportar al bote **sin dar
-- ningun error**: el acumulado saldria en cero y pareceria correcto.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PASO 1. El desglose de la jornada, congelado al crearla.
-- ---------------------------------------------------------------------
ALTER TABLE jornadas
  ADD COLUMN IF NOT EXISTS al_acumulado numeric(12,2) NOT NULL DEFAULT 0
    CHECK (al_acumulado >= 0);

COMMENT ON COLUMN jornadas.al_acumulado IS
  'Cuanto de `precio` va al bote acumulado. El resto es el premio de esta '
  'jornada. Congelado al crearla: cambiar el reparto no reescribe el pasado.';

/*
 * ⛔ El bote no puede ser mayor que lo que se cobra. Sin esto, un desglose mal
 * escrito daria un premio de jornada NEGATIVO y las cuentas saldrian al reves
 * sin fallar.
 */
ALTER TABLE jornadas
  DROP CONSTRAINT IF EXISTS jornadas_acumulado_cabe_en_el_precio;

ALTER TABLE jornadas
  ADD CONSTRAINT jornadas_acumulado_cabe_en_el_precio
  CHECK (al_acumulado <= precio);

-- ---------------------------------------------------------------------
-- PASO 2. Quien participa en el bote.
-- ---------------------------------------------------------------------
ALTER TABLE jugadores
  ADD COLUMN IF NOT EXISTS juega_acumulado boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN jugadores.juega_acumulado IS
  'Si aporta a la bolsa acumulada. Quien no participe paga solo la parte de '
  'jornada. Gemela de juega_torneo y juega_jornadas.';

-- ---------------------------------------------------------------------
-- PASO 3. La entrega del bote.
-- ---------------------------------------------------------------------
--
-- Cuando el ganador se lo lleva, queda escrito quien, cuanto y cuando, y el
-- acumulado vuelve a empezar. Mismo criterio que los abonos (Entrada 061): un
-- historial de dinero sin autor no sirve para lo unico que sirve.
--
-- ⚠️ `nombre_ganador` se COPIA ademas del id, por lo mismo que en
-- `acciones_superadmin`: el jugador puede desaparecer y el asiento tiene que
-- seguir siendo legible.
CREATE TABLE IF NOT EXISTS entregas_acumulado (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id    uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,

  jugador_id     uuid REFERENCES jugadores(id) ON DELETE SET NULL,
  nombre_ganador text NOT NULL,

  monto          numeric(12,2) NOT NULL CHECK (monto > 0),
  nota           text NOT NULL DEFAULT '',
  registrado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entregas_acumulado_quiniela
  ON entregas_acumulado (quiniela_id, created_at DESC);

-- ---------------------------------------------------------------------
-- PASO 4. El aislamiento. NO ES OPCIONAL.
-- ---------------------------------------------------------------------
--
-- ⛔ Lleva `quiniela_id`, asi que lleva RLS. Sin ella seria una fuga de cuanto
-- se repartio en otra quiniela, y **no fallaria**: devolveria filas de mas.
DO
$blq$
BEGIN
  EXECUTE 'ALTER TABLE entregas_acumulado ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE entregas_acumulado FORCE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'entregas_acumulado'
       AND policyname = 'aislamiento_quiniela'
  ) THEN
    EXECUTE 'CREATE POLICY aislamiento_quiniela ON entregas_acumulado '
         || 'USING (quiniela_id = quiniela_actual()) '
         || 'WITH CHECK (quiniela_id = quiniela_actual())';
  END IF;
END
$blq$;

-- ---------------------------------------------------------------------
-- PASO 5. Las concesiones, y lo que NO se concede.
-- ---------------------------------------------------------------------
--
-- ⚠️ SIN DELETE, y esta vez con un REVOKE detras: un GRANT solo SUMA, y los
-- privilegios por defecto del esquema ya conceden los cuatro permisos a toda
-- tabla nueva. Es la leccion de la migracion 003, que costo descubrirla
-- comprobando la base despues de crearla.
--
-- Una entrega no se borra: si se anoto mal, se corrige con otra. El dinero
-- entregado es historia.
GRANT SELECT, INSERT ON entregas_acumulado TO app_quiniela;
REVOKE UPDATE, DELETE ON entregas_acumulado FROM app_quiniela;

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno:
--
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE (table_name, column_name) IN
--          (('jornadas','al_acumulado'), ('jugadores','juega_acumulado'));
--   -- al_acumulado | 0     · juega_acumulado | true
--
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'entregas_acumulado';
--   -- t | t
--
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'entregas_acumulado' AND grantee = 'app_quiniela'
--    ORDER BY privilege_type;
--   -- INSERT, SELECT   <- si sale DELETE o UPDATE, el REVOKE no quedo
--
-- ⛔ Y que nadie quedo fuera del bote sin querer:
--
--   SELECT count(*) FILTER (WHERE NOT juega_acumulado) AS fuera FROM jugadores;
--   -- 0 justo despues de la migracion
--
-- Se puede volver a correr entera: es idempotente.
-- =====================================================================

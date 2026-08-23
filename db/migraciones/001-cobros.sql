-- =====================================================================
-- MIGRACION 001 - COBROS: cuota de torneo y cuota por jornada
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon. NO con
--    `app_quiniela`: crear tablas y politicas exige ser dueno, y la
--    aplicacion se conecta a proposito con un rol que no puede.
--
-- ---------------------------------------------------------------------
-- LA PRIMERA MIGRACION INCREMENTAL, Y POR QUE EMPIEZA AQUI LA COSTUMBRE
-- ---------------------------------------------------------------------
--
-- Hasta hoy los cambios de esquema se aplicaban recreando la base entera con
-- `db/poner-al-dia.sql`. Ese guion lleva escrito desde el 22 de agosto:
--
--     "⛔ SI ALGUN DIA HAY DATOS DE VERDAD, ESTE GUION NO SIRVE: habria que
--      escribir las migraciones incrementales."
--
-- Ese dia es hoy: en Neon ya hay cuentas y quinielas de verdad. De aqui en
-- adelante, cada cambio de esquema es un archivo numerado en esta carpeta.
--
-- ---------------------------------------------------------------------
-- LAS TRES REGLAS DE UNA MIGRACION EN ESTA CARPETA
-- ---------------------------------------------------------------------
--
--   1. ADITIVA. Crea cosas nuevas; no borra ni reescribe lo que hay. Si algun
--      dia hace falta quitar algo, va en su propia migracion y con su aviso.
--
--   2. IDEMPOTENTE. Correrla dos veces no puede fallar ni duplicar nada. En la
--      practica: `IF NOT EXISTS` en todo, y las politicas comprobadas contra
--      `pg_policies` antes de crearlas. Esto importa porque nadie se acuerda
--      de si ya la corrio.
--
--   3. LA MISMA VERDAD QUE `db/esquema.sql`. Lo que hace esta migracion tiene
--      que quedar tambien en el esquema, que es lo que se usa para montar una
--      base nueva desde cero. Si los dos se separan, una instalacion nueva y
--      una al dia dejan de ser la misma cosa, y eso se descubre tarde y mal.
--
-- ---------------------------------------------------------------------
-- QUE TRAE ESTA
-- ---------------------------------------------------------------------
--
--   * `jornadas.precio` - lo que costo ESA jornada.
--   * `jugadores.cobrar_desde` y `jugadores.juega_torneo`.
--   * la tabla `pagos`, con su aislamiento por quiniela.
--
-- Nada de esto cambia el comportamiento por si solo: los dos cobros nacen
-- APAGADOS en la configuracion de cada quiniela, y las jornadas que ya
-- existen quedan con precio 0. Una quiniela que hoy funciona sigue igual.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PASO 1. El precio vive en la JORNADA, no en la configuracion.
-- ---------------------------------------------------------------------
--
-- ⚠️ ESTA ES LA DECISION QUE SOSTIENE TODO LO DEMAS.
--
-- El administrador puede subir el precio -"esta jornada vale 5000 porque el
-- premio esta grande"- y eso debe afectar SOLO A LO QUE VIENE. Si el precio
-- se leyera de `quinielas.configuracion` al calcular, subirlo recalcularia
-- hacia atras lo que todos debian por las jornadas viejas.
--
-- Asi que cada jornada guarda lo que costo, copiado de la configuracion en el
-- momento de crearla. Es el mismo patron que `puntos_jornada.puntuacion`, que
-- guarda las reglas con las que se congelo para que cambiar la puntuacion en
-- enero no reescriba la clasificacion de marzo.
--
-- Por defecto 0 y no NULL: una jornada de una quiniela que no cobra "cuesta
-- cero", que es la verdad, y ahorra tener que distinguir el nulo en cada suma.
ALTER TABLE jornadas
  ADD COLUMN IF NOT EXISTS precio numeric(12,2) NOT NULL DEFAULT 0;

-- `ADD CONSTRAINT` no admite `IF NOT EXISTS`, asi que se comprueba a mano: la
-- regla 2 de esta carpeta dice que correrla dos veces no puede fallar.
DO
$blq$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jornadas_precio_no_negativo'
  ) THEN
    ALTER TABLE jornadas
      ADD CONSTRAINT jornadas_precio_no_negativo CHECK (precio >= 0);
  END IF;
END
$blq$;

-- ---------------------------------------------------------------------
-- PASO 2. Desde cuando se le cobra a cada jugador, y si entra al torneo.
-- ---------------------------------------------------------------------
--
-- `cobrar_desde` es el numero de secuencia de la primera jornada que se le
-- cobra. Quien entra en la jornada 7 no debe las seis anteriores: no estaba.
--
-- NULL significa "desde siempre", y es lo correcto para las filas que ya
-- existen: sus jornadas valen 0, asi que no les genera ninguna deuda.
--
-- Se guarda la SECUENCIA y no una fecha ni un id de jornada. La secuencia ya
-- es el orden real de las jornadas -la puso la Fase B, porque un uuid es
-- aleatorio y `creada_en` empata dentro de una misma transaccion-, asi que
-- comparar por ella es exactamente "de esta jornada en adelante".
ALTER TABLE jugadores
  ADD COLUMN IF NOT EXISTS cobrar_desde bigint;

-- Si juega el torneo completo, y por tanto debe su cuota.
--
-- No todo el mundo lo juega: quien entra a mitad de temporada entra a jugar
-- por jornada. Sin esta marca, esa persona apareceria como deudora eterna de
-- algo que nunca quiso pagar.
ALTER TABLE jugadores
  ADD COLUMN IF NOT EXISTS juega_torneo boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- PASO 3. Los abonos.
-- ---------------------------------------------------------------------
--
-- Una fila por abono. Cuelga de `jugadores` y NO de `membresias` a proposito:
-- `jugadores.usuario_id` es nulable, asi que hay jugadores sin cuenta -los que
-- migraron de la base anterior, y los que el administrador da de alta porque
-- mandan su quiniela por otro medio-. Colgandolo de las membresias esa gente
-- no se podria controlar, y son justo los que pagan en efectivo.
--
-- ⚠️ DOS CUENTAS SEPARADAS, NO UNA BOLSA COMUN. `concepto` dice para que es
-- cada abono. Con un solo saldo, los 10000 de la cuota del torneo se los irian
-- comiendo las jornadas.
CREATE TABLE IF NOT EXISTS pagos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id    uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jugador_id     uuid NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  concepto       text NOT NULL CHECK (concepto IN ('torneo','jornada')),

  -- Puede ser NEGATIVO: asi se corrige un abono mal anotado. Cero no, porque
  -- un asiento de cero no dice nada y ensucia el historial.
  monto          numeric(12,2) NOT NULL CHECK (monto <> 0),

  nota           text NOT NULL DEFAULT '',

  -- Quien lo anoto. Se conserva aunque la cuenta desaparezca: un historial de
  -- dinero al que se le borran los autores deja de servir para lo unico que
  -- sirve, que es resolver un "yo si pague".
  registrado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,

  -- ⚠️ LOS ABONOS NO SE EDITAN NI SE BORRAN: se corrigen con un asiento
  -- inverso que apunta al original. El dia que alguien diga "yo si pague", la
  -- discusion se resuelve mirando el historial, no la palabra de quien pudo
  -- reescribirlo.
  anula_a        uuid REFERENCES pagos(id) ON DELETE RESTRICT,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pagos_quiniela_jugador
  ON pagos (quiniela_id, jugador_id, concepto);

-- Un abono solo se puede anular UNA vez. Sin esto, dos anulaciones del mismo
-- asiento restarian el doble y la cuenta quedaria mal sin que nada avise.
CREATE UNIQUE INDEX IF NOT EXISTS pagos_una_anulacion_por_abono
  ON pagos (anula_a) WHERE anula_a IS NOT NULL;

-- ---------------------------------------------------------------------
-- PASO 4. El aislamiento. NO ES OPCIONAL.
-- ---------------------------------------------------------------------
--
-- ⛔ Todo el aislamiento entre quinielas se apoya en que NINGUNA tabla con
--    `quiniela_id` se quede sin sus politicas. Una tabla de pagos sin RLS
--    seria una fuga de quien pago cuanto en otra quiniela, y no fallaria:
--    devolveria filas de mas, en silencio.
--
-- FORCE ademas de ENABLE, como las demas: sin FORCE, el dueno de la tabla se
-- salta la politica.
DO
$blq$
BEGIN
  EXECUTE 'ALTER TABLE pagos ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE pagos FORCE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'pagos'
       AND policyname = 'aislamiento_quiniela'
  ) THEN
    EXECUTE 'CREATE POLICY aislamiento_quiniela ON pagos '
         || 'USING (quiniela_id = quiniela_actual()) '
         || 'WITH CHECK (quiniela_id = quiniela_actual())';
  END IF;
END
$blq$;

-- ---------------------------------------------------------------------
-- PASO 5. Las concesiones al rol de la aplicacion.
-- ---------------------------------------------------------------------
--
-- `db/poner-al-dia.sql` deja puestas las concesiones por defecto, asi que en
-- teoria una tabla nueva las hereda. Se repiten aqui a proposito: si esta
-- migracion se corre en una base montada de otra forma, sin esto la tabla
-- existe y la aplicacion no puede tocarla -y el error sale en produccion, no
-- aqui-.
GRANT SELECT, INSERT, UPDATE, DELETE ON pagos TO app_quiniela;

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'jornadas' AND column_name = 'precio';
--   -- una fila
--
--   SELECT relrowsecurity, relforcerowsecurity
--     FROM pg_class WHERE relname = 'pagos';
--   -- t | t   <- las dos en verdadero, o el aislamiento no esta puesto
--
--   SELECT policyname FROM pg_policies WHERE tablename = 'pagos';
--   -- aislamiento_quiniela
--
-- Y se puede volver a correr entera: no debe fallar ni cambiar nada.
-- =====================================================================

-- =====================================================================
-- MIGRACION 010 - CUANDO ENTRASTE POR ULTIMA VEZ A CADA QUINIELA
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita: al reves, la version nueva
--    llega a produccion y consulta una columna que todavia no existe.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y POR QUE
-- ---------------------------------------------------------------------
--
-- La pantalla "Mis quinielas" ensena primero el formulario de CREAR, despues el
-- de UNIRSE y al final las quinielas de la persona. Marco lo reporto el 11 de
-- septiembre: quien entra a jugar se encuentra un formulario de crear como
-- primera cosa, y ha habido gente que, intentando entrar a su quiniela, ha
-- creado otras.
--
-- Lo que pidio es que las quinielas propias vayan PRIMERO, y que entre varias
-- aparezca arriba la ultima con la que interactuo. Esta columna es lo que hace
-- posible la segunda mitad.
--
-- ---------------------------------------------------------------------
-- ⛔ POR QUE NO SE REUTILIZA `updated_at`
-- ---------------------------------------------------------------------
--
-- `membresias` ya tiene `updated_at`, y la consulta que lista las quinielas ya
-- ordena por el. Parece que bastaria con ponerlo al dia al entrar. No.
--
-- `updated_at` significa "cuando cambio ESTA MEMBRESIA": cuando te aprobaron,
-- cuando te cambiaron de rol, cuando pediste el retiro, cuando te expulsaron.
-- Lo escriben ocho sitios de `src/membresias.js` y es el rastro de que algo
-- cambio en tu relacion con la quiniela.
--
-- "Pase por aqui" es otra cosa distinta, y meter las dos en la misma columna
-- dejaria sin respuesta la pregunta original: despues del cambio ya no se
-- podria saber cuando te aprobaron, porque cada visita lo habria machacado.
--
-- ⚠️ Confundir dos significados en un mismo campo es de lo que mas caro ha
-- salido en este proyecto: es la misma familia que `''` contra `NULL` (068) y
-- que los tres estados de `pagada` (081). Son dos hechos, son dos columnas.
--
-- ---------------------------------------------------------------------
-- ⚠️ NULABLE, Y EL ORDEN TIENE QUE CONTAR CON ELLO
-- ---------------------------------------------------------------------
--
-- `NULL` = "no ha entrado desde que esto existe", y es lo que queda en TODAS
-- las membresias actuales. Es correcto: de ninguna consta que se entrara.
--
-- ⛔ Por eso la consulta ordena `ultimo_acceso DESC NULLS LAST, updated_at
-- DESC`. Sin el `NULLS LAST`, PostgreSQL pone los nulos PRIMERO en un DESC
-- -que es su regla, y sorprende-, asi que el dia del despliegue todas las
-- quinielas de todo el mundo apareceran justo al reves de lo que se pretende.
--
-- El segundo criterio conserva el orden de hoy para quien todavia no ha
-- entrado: nadie ve un salto raro mientras la columna se llena sola.
-- =====================================================================

BEGIN;

ALTER TABLE membresias
  ADD COLUMN IF NOT EXISTS ultimo_acceso timestamptz;

COMMENT ON COLUMN membresias.ultimo_acceso IS
  'Cuando esta persona entro por ultima vez a esta quiniela. NULL = no ha '
  'entrado desde que existe la columna. NO es updated_at: ese dice cuando '
  'cambio la membresia, y son hechos distintos.';

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'membresias' AND column_name = 'ultimo_acceso';
--   -- ultimo_acceso | timestamp with time zone | YES
--
-- Y que no invento ninguna fecha:
--
--   SELECT count(*) FILTER (WHERE ultimo_acceso IS NOT NULL) AS con_acceso,
--          count(*)                                         AS total
--     FROM membresias;
--   -- con_acceso = 0 justo despues de la migracion
--
-- ⚠️ `membresias` es tabla de PLATAFORMA y no lleva RLS, asi que esta consulta
-- si dice la verdad desde cualquier rol. Es la excepcion: con `partidos` o
-- `jugadores` haria falta el rol dueno (la leccion de la Entrada 069).
--
-- ---------------------------------------------------------------------
-- Y LOS PERMISOS DE LAS TABLAS DE SOLO ESCRITURA, COMO SIEMPRE
-- ---------------------------------------------------------------------
--
--   SELECT table_name,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'app_quiniela'
--      AND table_name IN ('pagos','acciones_superadmin','entregas_acumulado')
--    GROUP BY table_name ORDER BY table_name;
--   -- las tres tienen que decir exactamente: INSERT, SELECT
--
-- Se puede volver a correr entera: `IF NOT EXISTS` la hace idempotente.
-- =====================================================================

-- =====================================================================
-- MIGRACION 009 - AVISAR POR CORREO CUANDO HAY ALGO QUE COMPARTIR
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita: al reves, la version nueva
--    llega a produccion y consulta una columna que todavia no existe.
--
-- ⚠️ Va APARTE de la 008 a proposito, aunque las dos entraran el mismo dia.
-- Cuando se escribio esta, la 008 podia estar ya corrida en Neon o no, y meterla
-- dentro habria obligado a acordarse de cual era el caso. Dos archivos
-- numerados no obligan a acordarse de nada: se corre el que falte.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y POR QUE NO BASTA LA COLUMNA DE LA 008
-- ---------------------------------------------------------------------
--
-- La 008 trajo `compartido_en`: cuando los pronosticos de ese partido SALIERON
-- al grupo. Esta trae `avisado_en`: cuando se AVISO de que habia que mandarlos.
--
-- ⛔ Son dos hechos distintos y hacen falta los dos. Con una sola columna, el
-- aviso tendria que dispararse con "hay algo pendiente", y eso es cierto cada
-- minuto desde que el partido arranca hasta que alguien comparte:
--
--   15:00  arranca el partido, hay 1 pendiente  -> correo
--   15:01  sigue habiendo 1 pendiente           -> correo
--   15:02  sigue habiendo 1 pendiente           -> correo
--
-- Sesenta correos por hora. El aviso necesita su propia memoria, y "ya lo
-- comparti" no puede servir de memoria del aviso porque son cosas distintas:
-- se avisa ANTES de compartir, que es justo para lo que sirve.
--
-- ---------------------------------------------------------------------
-- ⛔ POR QUE VA EN LA BASE Y NO EN LA MEMORIA DEL PROCESO
-- ---------------------------------------------------------------------
--
-- Recordar a quien ya se aviso en una variable del proceso seria mas barato y
-- estaria mal por dos motivos, los dos reales en Render:
--
--   1. El proceso se reinicia en cada despliegue, y el recuerdo se pierde: al
--      volver, avisa otra vez de lo mismo.
--   2. Puede haber DOS instancias, y cada una tendria su propio recuerdo: dos
--      correos por partido.
--
-- Es la misma razon por la que `compartido_en` vive aqui y no en el navegador.
--
-- ---------------------------------------------------------------------
-- ⚠️ NULABLE, IGUAL QUE SU HERMANA
-- ---------------------------------------------------------------------
--
-- `NULL` = todavia no se aviso. Es lo que queda en todos los partidos que ya
-- existen, y es correcto: de ninguno de ellos se aviso.
--
-- Y tampoco inunda de correos el dia del estreno, por dos motivos encadenados:
-- el aviso solo mira partidos dentro de la ventana de horas (la misma que la
-- pantalla), y ademas el interruptor `avisarAlCompartir` nace APAGADO en la
-- configuracion de cada quiniela. Un correo que nadie pidio es un problema; uno
-- que falta es una molestia.
-- =====================================================================

BEGIN;

ALTER TABLE partidos
  ADD COLUMN IF NOT EXISTS avisado_en timestamptz;

COMMENT ON COLUMN partidos.avisado_en IS
  'Cuando se aviso por correo de que habia que compartir este partido. '
  'NULL = todavia no. Es la memoria del aviso, no la de haberlo compartido: '
  'esa es compartido_en, y son hechos distintos.';

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'partidos'
--      AND column_name IN ('compartido_en', 'avisado_en')
--    ORDER BY column_name;
--   -- avisado_en    | timestamp with time zone | YES
--   -- compartido_en | timestamp with time zone | YES
--
-- ⛔ Las DOS tienen que aparecer. Si sale solo `avisado_en`, la 008 esta sin
-- correr y la aplicacion fallara igual: correla tambien.
--
-- Y que no marco nada por su cuenta:
--
--   SELECT count(*) FILTER (WHERE avisado_en IS NOT NULL) AS ya_avisados
--     FROM partidos;
--   -- 0 justo despues de la migracion
--
-- ⚠️ Con el ROL DUENO: `partidos` lleva RLS, asi que desde la aplicacion una
-- consulta global devuelve cero filas sin fallar y pareceria que todo esta bien
-- (la leccion de la Entrada 069).
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

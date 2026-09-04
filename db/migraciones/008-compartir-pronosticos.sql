-- =====================================================================
-- MIGRACION 008 - COMPARTIR LOS PRONOSTICOS AL ARRANCAR EL PARTIDO
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita: al reves, la version nueva
--    llega a produccion y consulta una columna que todavia no existe.
--
-- ---------------------------------------------------------------------
-- QUE TRAE, Y POR QUE
-- ---------------------------------------------------------------------
--
-- Hasta hoy, mandar al grupo de WhatsApp los pronosticos de un partido eran
-- cinco pasos a mano -abrir la pantalla, elegir jornada, elegir partido,
-- copiar, enviar- repetidos partido por partido. Con cinco partidos un domingo
-- son veinticinco pasos, y lo que se olvida no deja rastro de que se olvido.
--
-- Esta columna es lo unico que hacia falta en la base: la marca de que los
-- pronosticos de ESE partido ya salieron. Con ella, la pantalla nueva puede
-- armar sola la lista de lo que falta por compartir.
--
-- ---------------------------------------------------------------------
-- ⛔ POR QUE UNA MARCA Y NO UNA PANTALLA QUE SE MIRE Y YA
-- ---------------------------------------------------------------------
--
-- Sin la marca, la lista de "lo que falta" tendria que deducirse de algo, y no
-- hay de que: un partido que empezo hace dos horas se ve igual lo hayan
-- compartido o no. El resultado seria una lista que repite lo ya enviado y que
-- obliga a acordarse -que es justo el trabajo que se viene a quitar-.
--
-- Y es lo que hace que un reinicio de Render no vuelva a proponer lo mismo: el
-- estado vive en la base, no en la memoria del proceso ni en el navegador.
--
-- ---------------------------------------------------------------------
-- ⚠️ NULABLE, Y SIN VALOR POR DEFECTO
-- ---------------------------------------------------------------------
--
-- Aqui el defecto va al reves que en la 005: alli un `DEFAULT true` evitaba
-- perdonar deuda sin querer; aqui lo que no se puede es dar por compartido lo
-- que no se compartio.
--
-- `NULL` significa "todavia no", y es lo que queda en los partidos que ya
-- existen. Eso es correcto: de los partidos viejos, en efecto, no consta que se
-- compartieran por aqui.
--
-- ⚠️ Y no inunda la pantalla con toda la temporada porque el filtro de verdad
-- NO es esta columna sola, sino esta columna Y una ventana de horas: solo se
-- proponen los partidos que arrancaron hace poco. Un partido de hace tres
-- semanas no es noticia aunque nunca se compartiera. Ver COMPARTIR_VENTANA_HORAS
-- en src/compartir.js.
-- =====================================================================

BEGIN;

ALTER TABLE partidos
  ADD COLUMN IF NOT EXISTS compartido_en timestamptz;

COMMENT ON COLUMN partidos.compartido_en IS
  'Cuando salieron al grupo los pronosticos de este partido. NULL = todavia no. '
  'La escribe la pantalla de compartir; nadie mas la lee para decidir nada.';

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- Con el rol dueno, despues de correrla:
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'partidos' AND column_name = 'compartido_en';
--   -- compartido_en | timestamp with time zone | YES
--
-- Y que no marco nada por su cuenta:
--
--   SELECT count(*) FILTER (WHERE compartido_en IS NOT NULL) AS ya_compartidos
--     FROM partidos;
--   -- 0 justo despues de la migracion
--
-- ⚠️ Esa consulta hay que correrla CON EL ROL DUENO: `partidos` lleva RLS, asi
-- que desde la aplicacion una consulta global devuelve cero filas sin fallar y
-- pareceria que todo esta bien (la leccion de la Entrada 069).
--
-- ---------------------------------------------------------------------
-- ⛔ Y LOS PERMISOS DE LAS TABLAS DE SOLO ESCRITURA, COMO SIEMPRE
-- ---------------------------------------------------------------------
--
-- Esta migracion no crea tablas ni toca permisos, pero la costumbre de la
-- Entrada 079 es preguntarselo a la base despues de CADA una, no solo despues
-- de las que tocan permisos. Un GRANT solo suma, y una tabla vieja puede llevar
-- meses con un permiso que nadie miro:
--
--   SELECT table_name,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'app_quiniela'
--      AND table_name IN ('pagos','acciones_superadmin','entregas_acumulado')
--    GROUP BY table_name ORDER BY table_name;
--   -- las tres tienen que decir exactamente: INSERT, SELECT
--
-- ⚠️ `partidos` SI necesita UPDATE -esta columna se escribe- y ya lo tiene.
--
-- Se puede volver a correr entera: `IF NOT EXISTS` la hace idempotente.
-- =====================================================================

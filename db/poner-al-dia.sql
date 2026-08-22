-- =====================================================================
-- PONER LA BASE DE NEON AL DIA CON db/esquema.sql
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon. NO con
--    `app_quiniela`: crear tablas y politicas exige ser dueno, y la
--    aplicacion se conecta a proposito con un rol que no puede.
--
-- ---------------------------------------------------------------------
-- POR QUE HACE FALTA
-- ---------------------------------------------------------------------
--
-- La base se monto el 20 de agosto con el Anexo C, y el esquema ha cambiado
-- desde entonces:
--
--   * falta la tabla `sesiones` (connect-pg-simple). Sin ella la aplicacion
--     arranca y deja entrar a la gente, pero NADIE SIGUE DENTRO en la
--     peticion siguiente, y no hay ningun error que lo explique;
--   * falta la columna `jornadas.secuencia`, que es lo que hace que "la
--     jornada actual" sea la ultima CREADA. Sin ella el orden es arbitrario
--     y la ruta sigue devolviendo una jornada, solo que la que no es;
--   * faltan los dos indices unicos nuevos: el de `jugadores` y el parcial de
--     `trivias`, que cierran carreras reales;
--   * sobra `verif_resultados`, que era del banco de pruebas del sondeo.
--
-- ---------------------------------------------------------------------
-- SE RECREA ENTERA, Y ES SEGURO PORQUE ESTA VACIA
-- ---------------------------------------------------------------------
--
-- Comprobado el 21 de agosto: 0 usuarios y 0 quinielas. Recrear es mas simple
-- y mas fiable que ir aplicando diferencias una a una, y no hay nada que
-- perder.
--
-- ⛔ SI ALGUN DIA HAY DATOS DE VERDAD, ESTE GUION NO SIRVE: habria que
--    escribir las migraciones incrementales. La comprobacion de abajo se
--    planta antes de borrar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1. El seguro. Se niega a seguir si hay algo que perder.
-- ---------------------------------------------------------------------
DO
$seguro$
DECLARE
  n_usuarios  bigint := 0;
  n_quinielas bigint := 0;
BEGIN
  IF to_regclass('public.usuarios') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM usuarios'  INTO n_usuarios;
  END IF;
  IF to_regclass('public.quinielas') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM quinielas' INTO n_quinielas;
  END IF;

  IF n_usuarios > 0 OR n_quinielas > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: la base tiene datos (% usuarios, % quinielas). Este guion los borraria.',
      n_usuarios, n_quinielas;
  END IF;

  RAISE NOTICE 'Base vacia (% usuarios, % quinielas): se puede recrear.', n_usuarios, n_quinielas;
END
$seguro$;

-- ---------------------------------------------------------------------
-- PASO 2. Fuera lo viejo, incluida la tabla del banco de pruebas.
-- ---------------------------------------------------------------------
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- ---------------------------------------------------------------------
-- PASO 3. Aqui va, PEGADO ENTERO, el contenido de db/esquema.sql.
--
-- No se puede hacer un \i desde el editor web de Neon: no tiene acceso al
-- sistema de archivos. Se abre db/esquema.sql, se copia entero y se pega
-- justo debajo de esta linea.
-- ---------------------------------------------------------------------

--  <<<<<<  PEGA AQUI db/esquema.sql  >>>>>>

-- ---------------------------------------------------------------------
-- PASO 4. Los permisos de la aplicacion.
--
-- ⚠️ Hay que repetirlos porque el DROP SCHEMA se llevo las tablas y, con
--    ellas, sus concesiones. El rol `app_quiniela` sobrevive -es del cluster,
--    no del esquema- pero se queda sin poder tocar nada.
--
-- `app_quiniela` puede leer y escribir FILAS, y nada mas: no puede crear ni
-- alterar tablas, y por tanto no puede apagar RLS. Esa es la regla 3 de §21.2.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_quiniela;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_quiniela;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_quiniela;

-- Y lo mismo para lo que se cree en el futuro, para no volver a acordarse.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_quiniela;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_quiniela;

-- ---------------------------------------------------------------------
-- PASO 5. Comprobar. Un solo bloque, para que el editor no esconda el error
--         de verdad detras de un "ROLLBACK required" (Entrada 035).
-- ---------------------------------------------------------------------
DO
$verifica$
DECLARE
  faltan text := '';
BEGIN
  IF to_regclass('public.sesiones') IS NULL THEN
    faltan := faltan || 'tabla sesiones; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'jornadas' AND column_name = 'secuencia') THEN
    faltan := faltan || 'columna jornadas.secuencia; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'trivias_partido_tipo_activa') THEN
    faltan := faltan || 'indice trivias_partido_tipo_activa; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'jugadores_quiniela_usuario') THEN
    faltan := faltan || 'indice jugadores_quiniela_usuario; ';
  END IF;

  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity) <> 12 THEN
    faltan := faltan || 'las 12 tablas con RLS; ';
  END IF;

  IF faltan <> '' THEN
    RAISE EXCEPTION 'INCOMPLETO. Falta: %', faltan;
  END IF;

  RAISE NOTICE 'OK: esquema al dia, 12 tablas con RLS y los permisos puestos.';
END
$verifica$;

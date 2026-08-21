-- =====================================================================
-- Paso 3: la prueba de aceptacion de Neon.
--
-- Se pega ENTERO en el editor SQL de Neon, despues de esquema.sql y de
-- neon-preparar.sql. Todo corre dentro de una transaccion que termina en
-- ROLLBACK: no deja ni una fila detras.
--
-- Tiene que terminar con SIETE lineas y todas diciendo PASA. Si alguna dice
-- FALLA, NO sigas: el aislamiento no esta puesto y la aplicacion filtraria
-- datos entre quinielas sin avisar de nada.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _verif (n int, prueba text, resultado text, detalle text) ON COMMIT DROP;
GRANT INSERT ON _verif TO app_quiniela;

-- ---------- 1. El rol de la aplicacion no puede saltarse RLS ----------
INSERT INTO _verif
SELECT 1,
       'El rol app_quiniela no es superusuario ni tiene BYPASSRLS',
       CASE WHEN NOT rolsuper AND NOT rolbypassrls THEN 'PASA' ELSE 'FALLA' END,
       format('superusuario=%s bypassrls=%s', rolsuper, rolbypassrls)
  FROM pg_roles WHERE rolname = 'app_quiniela';

-- ---------- 2. RLS activo y FORZADO en las 12 tablas de dominio ----------
INSERT INTO _verif
SELECT 2,
       'Las 12 tablas de dominio tienen RLS activo y forzado',
       CASE WHEN count(*) = 12 THEN 'PASA' ELSE 'FALLA' END,
       format('%s de 12', count(*))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity;

-- ---------- Datos de dos quinielas que comparten nombre de jornada ----------
INSERT INTO usuarios (id, username, username_normalizado, email, email_normalizado, password)
VALUES ('11111111-1111-1111-1111-111111111111','ana_v','ana_v','ana_v@x','ana_v@x','x'),
       ('22222222-2222-2222-2222-222222222222','beto_v','beto_v','beto_v@x','beto_v@x','x');

INSERT INTO quinielas (id, nombre, codigo_ingreso, propietario_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Quiniela A','VERIF-A','11111111-1111-1111-1111-111111111111'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Quiniela B','VERIF-B','22222222-2222-2222-2222-222222222222');

INSERT INTO jugadores (quiniela_id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ana_v'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','beto_v');

INSERT INTO jornadas (quiniela_id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Jornada 1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Jornada 1');

-- ---------- Desde aqui, como se conecta la aplicacion de verdad ----------
SET LOCAL ROLE app_quiniela;

DO $verif$
DECLARE
  qa uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  qb uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  n  int;
  txt text;
BEGIN
  -- 3. Sin contexto de quiniela no se ve nada.
  PERFORM set_config('app.quiniela_id', '', true);
  SELECT count(*) INTO n FROM jugadores;
  INSERT INTO _verif VALUES (3, 'Sin contexto de quiniela no se ve nada',
    CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END, format('vio %s filas', n));

  PERFORM set_config('app.quiniela_id', qa::text, true);

  -- 4. Un SELECT sin filtro solo ve lo de su quiniela.
  SELECT count(*), string_agg(nombre, ',') INTO n, txt FROM jugadores;
  INSERT INTO _verif VALUES (4, 'Un SELECT sin filtro solo ve la quiniela del contexto',
    CASE WHEN n = 1 AND txt = 'ana_v' THEN 'PASA' ELSE 'FALLA' END,
    format('vio %s: %s', n, coalesce(txt,'-')));

  -- 5. Pedir a proposito la quiniela ajena devuelve vacio.
  SELECT count(*) INTO n FROM jugadores WHERE quiniela_id = qb;
  INSERT INTO _verif VALUES (5, 'Pedir a proposito la quiniela ajena devuelve vacio',
    CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END, format('devolvio %s filas', n));

  -- 6. Un JOIN de dos tablas tampoco cruza. Las dos quinielas tienen una
  --    jornada con el MISMO nombre: es el escenario exacto de C-02.
  SELECT count(*) INTO n FROM jugadores j, jornadas jo WHERE jo.nombre = 'Jornada 1';
  INSERT INTO _verif VALUES (6, 'Un JOIN no cruza quinielas con jornadas del mismo nombre',
    CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END, format('devolvio %s filas', n));

  -- 7. Escribir en una quiniela ajena lo rechaza la BASE, no el codigo.
  BEGIN
    INSERT INTO jugadores (quiniela_id, nombre) VALUES (qb, 'colado');
    INSERT INTO _verif VALUES (7, 'Escribir en una quiniela ajena lo rechaza la base',
      'FALLA', 'la insercion paso, y no debia');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO _verif VALUES (7, 'Escribir en una quiniela ajena lo rechaza la base',
      'PASA', SQLERRM);
  END;
END
$verif$;

RESET ROLE;

SELECT prueba, resultado, detalle FROM _verif ORDER BY n;

ROLLBACK;

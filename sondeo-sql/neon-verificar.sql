-- =====================================================================
-- Paso 3: la prueba de aceptacion de Neon.
--
-- Se pega ENTERO en el editor SQL de Neon, despues de esquema.sql y de
-- neon-preparar.sql.
--
-- Tiene que terminar con OCHO lineas y todas diciendo PASA. Si alguna dice
-- FALLA, la columna `detalle` trae el error exacto de PostgreSQL: eso es lo
-- que hay que mirar, y lo que hay que pegar si se pide ayuda.
--
-- ⚠️ POR QUE ESTA ESCRITO ASI, Y NO COMO UN GUION NORMAL (Entrada 035)
--
-- La primera version era una tanda de sentencias sueltas dentro de un
-- BEGIN...ROLLBACK. Tenia dos problemas en un editor web:
--
--   1. En cuanto UNA sentencia fallaba, PostgreSQL aborta la transaccion y
--      todo lo demas responde "Failed transaction: ROLLBACK required". Ese
--      mensaje NO dice que fallo: es el sintoma de todo lo que vino despues.
--      El error de verdad se perdia de vista.
--   2. No todos los editores web mantienen una transaccion abierta entre
--      sentencias, asi que ni el ROLLBACK del final era de fiar.
--
-- Ahora TODO va dentro de un unico bloque DO, que para el editor es UNA sola
-- sentencia. Cada comprobacion va en su propio BEGIN...EXCEPTION, asi que si
-- una falla, se anota el error y las demas siguen corriendo. Y los datos de
-- prueba se borran al final; si algo revienta antes, el bloque entero se
-- deshace solo y tampoco queda nada.
-- =====================================================================

DROP TABLE IF EXISTS verif_resultados;
CREATE TABLE verif_resultados (n int, prueba text, resultado text, detalle text);
GRANT INSERT ON verif_resultados TO app_quiniela;

DO $verif$
DECLARE
  qa uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  qb uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ua uuid := '11111111-1111-1111-1111-111111111111';
  ub uuid := '22222222-2222-2222-2222-222222222222';
  n   int;
  txt text;
BEGIN

  -- ---------- 1. El rol de la aplicacion no puede saltarse RLS ----------
  BEGIN
    SELECT format('superusuario=%s bypassrls=%s', rolsuper, rolbypassrls)
      INTO txt FROM pg_roles WHERE rolname = 'app_quiniela';
    IF txt IS NULL THEN
      INSERT INTO verif_resultados VALUES (1,
        'El rol app_quiniela existe y no puede saltarse RLS', 'FALLA',
        'el rol app_quiniela no existe: falta ejecutar neon-preparar.sql');
    ELSE
      INSERT INTO verif_resultados
      SELECT 1, 'El rol app_quiniela existe y no puede saltarse RLS',
             CASE WHEN NOT rolsuper AND NOT rolbypassrls THEN 'PASA' ELSE 'FALLA' END,
             txt
        FROM pg_roles WHERE rolname = 'app_quiniela';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (1,
      'El rol app_quiniela existe y no puede saltarse RLS', 'FALLA', SQLERRM);
  END;

  -- ---------- 2. RLS activo y FORZADO en las 12 tablas de dominio ----------
  BEGIN
    SELECT count(*) INTO n
      FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
     WHERE n2.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity;
    INSERT INTO verif_resultados VALUES (2,
      'Las 12 tablas de dominio tienen RLS activo y forzado',
      CASE WHEN n = 12 THEN 'PASA' ELSE 'FALLA' END, format('%s de 12', n));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (2,
      'Las 12 tablas de dominio tienen RLS activo y forzado', 'FALLA', SQLERRM);
  END;

  -- ---------- 3. ¿Puede el dueño asumir el rol de la aplicacion? ----------
  -- Si esto falla, todo lo de abajo mide al dueño y no a la aplicacion, asi
  -- que se marca y se sale: mas vale ninguna respuesta que una respuesta falsa.
  BEGIN
    PERFORM set_config('role', 'app_quiniela', true);
    PERFORM set_config('role', 'none', true);
    INSERT INTO verif_resultados VALUES (3,
      'El dueño puede asumir el rol app_quiniela', 'PASA', '');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (3,
      'El dueño puede asumir el rol app_quiniela', 'FALLA',
      SQLERRM || '  -> arreglo: GRANT app_quiniela TO CURRENT_USER;');
    RETURN;
  END;

  -- ---------- Datos: dos quinielas con una jornada del mismo nombre ----------
  -- `usuarios` y `quinielas` son de plataforma y no llevan RLS.
  INSERT INTO usuarios (id, username, username_normalizado, email, email_normalizado, password)
  VALUES (ua,'ana_v','ana_v','ana_v@x','ana_v@x','x'),
         (ub,'beto_v','beto_v','beto_v@x','beto_v@x','x');

  INSERT INTO quinielas (id, nombre, codigo_ingreso, propietario_id)
  VALUES (qa,'Quiniela A','VERIF-A',ua),
         (qb,'Quiniela B','VERIF-B',ub);

  -- ⚠️ Estas si llevan RLS, y con FORCE ROW LEVEL SECURITY el dueño tambien
  -- esta sujeto a la politica: sin contexto, sus propias inserciones son
  -- rechazadas. No es un estorbo, es la prueba de que FORCE funciona.
  PERFORM set_config('app.quiniela_id', qa::text, true);
  INSERT INTO jugadores (quiniela_id, nombre) VALUES (qa,'ana_v');
  INSERT INTO jornadas  (quiniela_id, nombre) VALUES (qa,'Jornada 1');

  PERFORM set_config('app.quiniela_id', qb::text, true);
  INSERT INTO jugadores (quiniela_id, nombre) VALUES (qb,'beto_v');
  INSERT INTO jornadas  (quiniela_id, nombre) VALUES (qb,'Jornada 1');

  -- ---------- Desde aqui, como se conecta la aplicacion de verdad ----------
  PERFORM set_config('role', 'app_quiniela', true);

  -- 4. Sin contexto de quiniela no se ve nada.
  BEGIN
    PERFORM set_config('app.quiniela_id', '', true);
    SELECT count(*) INTO n FROM jugadores;
    INSERT INTO verif_resultados VALUES (4, 'Sin contexto de quiniela no se ve nada',
      CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END, format('vio %s filas', n));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (4,
      'Sin contexto de quiniela no se ve nada', 'FALLA', SQLERRM);
  END;

  PERFORM set_config('app.quiniela_id', qa::text, true);

  -- 5. Un SELECT sin filtro solo ve lo de su quiniela.
  BEGIN
    SELECT count(*), coalesce(string_agg(nombre, ','),'-') INTO n, txt FROM jugadores;
    INSERT INTO verif_resultados VALUES (5,
      'Un SELECT sin filtro solo ve la quiniela del contexto',
      CASE WHEN n = 1 AND txt = 'ana_v' THEN 'PASA' ELSE 'FALLA' END,
      format('vio %s: %s', n, txt));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (5,
      'Un SELECT sin filtro solo ve la quiniela del contexto', 'FALLA', SQLERRM);
  END;

  -- 6. Pedir a proposito la quiniela ajena devuelve vacio.
  BEGIN
    SELECT count(*) INTO n FROM jugadores WHERE quiniela_id = qb;
    INSERT INTO verif_resultados VALUES (6,
      'Pedir a proposito la quiniela ajena devuelve vacio',
      CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END, format('devolvio %s filas', n));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (6,
      'Pedir a proposito la quiniela ajena devuelve vacio', 'FALLA', SQLERRM);
  END;

  -- 7. Un JOIN no cruza. Las dos quinielas tienen una jornada con el MISMO
  --    nombre: es el escenario exacto de la fuga C-02.
  BEGIN
    SELECT count(*) INTO n FROM jugadores j, jornadas jo WHERE jo.nombre = 'Jornada 1';
    INSERT INTO verif_resultados VALUES (7,
      'Un JOIN no cruza quinielas con jornadas del mismo nombre',
      CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END, format('devolvio %s filas', n));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (7,
      'Un JOIN no cruza quinielas con jornadas del mismo nombre', 'FALLA', SQLERRM);
  END;

  -- 8. Escribir en una quiniela ajena lo rechaza la BASE, no el codigo.
  BEGIN
    INSERT INTO jugadores (quiniela_id, nombre) VALUES (qb, 'colado');
    INSERT INTO verif_resultados VALUES (8,
      'Escribir en una quiniela ajena lo rechaza la base', 'FALLA',
      'la insercion paso, y no debia');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verif_resultados VALUES (8,
      'Escribir en una quiniela ajena lo rechaza la base', 'PASA', SQLERRM);
  END;

  -- ---------- Limpieza ----------
  -- Vuelve a ser el dueño y borra la semilla. Al borrar la quiniela, las
  -- filas de dominio se van en cascada, que no pasa por RLS.
  PERFORM set_config('role', 'none', true);
  DELETE FROM quinielas WHERE id IN (qa, qb);
  DELETE FROM usuarios  WHERE id IN (ua, ub);
END
$verif$;

SELECT n AS "#", prueba, resultado, detalle FROM verif_resultados ORDER BY n;

DROP TABLE verif_resultados;

-- =====================================================================
-- Paso 2 de la preparacion de Neon: el rol de la aplicacion.
--
-- Se ejecuta DESPUES de esquema.sql y con el rol dueño de la base
-- (en Neon, el que viene por defecto: neondb_owner o el que hayas creado).
--
-- ⚠️ POR QUE ESTO NO ES OPCIONAL
--
-- RLS no protege contra quien es dueño de la tabla salvo que la tabla lleve
-- FORCE ROW LEVEL SECURITY -que esquema.sql sí pone- y NO protege en absoluto
-- contra un superusuario o contra un rol con BYPASSRLS. Si la aplicacion se
-- conecta con el rol que Neon da por defecto, ademas de leer y escribir puede
-- APAGAR RLS con un ALTER TABLE. El aislamiento dejaria de ser una garantia
-- para ser una costumbre.
--
-- La aplicacion se conecta con `app_quiniela`, que no puede tocar el esquema.
-- Las migraciones y este archivo se ejecutan con el dueño.
-- =====================================================================

-- ⚠️ CAMBIA LA CONTRASEÑA. No dejes esta, y no la guardes en el repositorio:
-- va en las variables de entorno de Render y en tu gestor de contraseñas.
CREATE ROLE app_quiniela LOGIN PASSWORD 'CAMBIAME-por-algo-largo-y-aleatorio'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE quiniela TO app_quiniela;
GRANT USAGE   ON SCHEMA public     TO app_quiniela;

-- Lo que la aplicacion necesita y nada mas: leer y escribir filas.
-- Ni CREATE, ni ALTER, ni DROP, ni TRUNCATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_quiniela;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_quiniela;

-- Y lo mismo para las tablas que se creen mas adelante, para que nadie tenga
-- que acordarse de volver aqui despues de cada migracion.
-- OJO: esto solo aplica a lo que cree EL ROL QUE EJECUTA ESTA LINEA.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_quiniela;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_quiniela;

-- Que nadie mas pueda crear objetos sueltos en public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

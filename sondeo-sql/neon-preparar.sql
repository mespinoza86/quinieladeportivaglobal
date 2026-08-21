-- =====================================================================
-- Paso 2 de la preparacion de Neon: el rol de la aplicacion.
--
-- Se ejecuta DESPUES de esquema.sql y con el rol dueño de la base
-- (en Neon, el que viene por defecto: neondb_owner o el que hayas creado).
--
-- ⚠️ ESTE ARCHIVO NO LLEVA CONTRASEÑA, Y ES A PROPOSITO.
--
-- La primera version tenia un hueco que decia "CAMBIAME por algo largo y
-- aleatorio", y lo que pasa con esos huecos es que se rellenan con la
-- contraseña de verdad y el archivo esta versionado en git. Un secreto en un
-- archivo del repositorio no se arregla borrandolo despues: si llego a un
-- commit, se queda en el historial para siempre.
--
-- Asi que el rol se crea SIN contraseña, y la contraseña se pone en una linea
-- suelta que no se guarda en ningun archivo. Esta al final, en el paso 2.
--
-- ⚠️ POR QUE ESTE ROL EXISTE
--
-- RLS no protege contra un superusuario ni contra un rol con BYPASSRLS, y el
-- rol dueño puede APAGAR RLS con un ALTER TABLE. Si la aplicacion se conecta
-- con el rol que Neon da por defecto, el aislamiento deja de ser una garantia
-- para ser una costumbre. `app_quiniela` puede leer y escribir filas, y nada
-- mas: ni CREATE, ni ALTER, ni DROP, ni TRUNCATE.
-- =====================================================================

-- ---------- Paso 1: pega y ejecuta todo esto ----------

CREATE ROLE app_quiniela LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE quiniela TO app_quiniela;
GRANT USAGE   ON SCHEMA public     TO app_quiniela;

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


-- ---------- Paso 2: la contraseña, SIN guardarla en ningun archivo ----------
--
-- Genera una contraseña larga y aleatoria (la del gestor de contraseñas, o
-- `openssl rand -base64 24`). Escribe A MANO esta unica linea en el editor SQL
-- de Neon, ejecutala, y guarda la contraseña SOLO en dos sitios: tu gestor de
-- contraseñas y las variables de entorno de Render.
--
--     ALTER ROLE app_quiniela PASSWORD 'la-que-acabas-de-generar';
--
-- ⚠️ No la escribas en este archivo, ni en ningun otro del repositorio.
-- ⚠️ Que no sea una contraseña que uses en otro sitio: esta acaba en una
--    variable de entorno de Render, que es un sitio menos protegido que tu
--    gestor de contraseñas.
--
-- Si alguna vez hay que cambiarla, es la misma linea otra vez.

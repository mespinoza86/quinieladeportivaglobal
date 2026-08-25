-- =====================================================================
-- MIGRACION 003 - LA AUDITORIA NO SE PUEDE BORRAR DESDE LA APLICACION
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
--
-- ---------------------------------------------------------------------
-- POR QUE EXISTE, Y POR QUE NO SE EDITO LA 002
-- ---------------------------------------------------------------------
--
-- La 002 concedia `GRANT SELECT, INSERT ON acciones_superadmin`, con un
-- comentario que decia "SIN DELETE: un registro que la aplicacion puede borrar
-- no es una auditoria".
--
-- ⛔ ERA FALSO, Y SOLO SE SUPO COMPROBANDOLO CONTRA LA BASE DE VERDAD.
--
-- Neon -y `db/poner-al-dia.sql`- dejan puestos PRIVILEGIOS POR DEFECTO
-- (`ALTER DEFAULT PRIVILEGES`) que conceden SELECT, INSERT, UPDATE y DELETE a
-- `app_quiniela` sobre **toda tabla nueva** del esquema. Un `GRANT` mas
-- pequeño no quita nada: solo añade. Asi que la tabla nacio con los cuatro
-- permisos, y la aplicacion podia borrar su propio rastro.
--
-- Medido con el rol de la aplicacion, despues de correr la 002:
--
--     Permisos de app_quiniela: DELETE, INSERT, SELECT, UPDATE
--
-- ⚠️ **Un GRANT no es una politica de permisos: es una suma.** Para que un
-- permiso NO este hay que quitarlo, y hay que comprobarlo mirando la base, no
-- leyendo el guion que se corrio.
--
-- La 002 no se edita porque **ya se corrio en produccion**: cambiarla dejaria
-- el archivo describiendo algo distinto de lo que se ejecuto. Es la regla 1 de
-- la carpeta -si hace falta quitar algo, va en su propia migracion y con su
-- aviso-, y este es exactamente ese caso.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PASO 1. Quitar lo que la aplicacion no debe poder hacer.
-- ---------------------------------------------------------------------
--
-- La aplicacion escribe asientos y los lee. No los corrige ni los borra: un
-- historial que el propio actor puede reescribir no sirve para lo unico que
-- sirve, que es resolver un "y esto quien lo hizo".
--
-- Si algun dia hay que purgarlo, se hace con el rol dueno y a mano, que es
-- exactamente la friccion que se quiere.
REVOKE UPDATE, DELETE ON acciones_superadmin FROM app_quiniela;

-- ---------------------------------------------------------------------
-- PASO 2. Y que las tablas nuevas no vuelvan a heredarlo por sorpresa.
-- ---------------------------------------------------------------------
--
-- No se tocan los privilegios por defecto: son correctos para las 13 tablas de
-- dominio, que la aplicacion si tiene que poder actualizar y borrar. Lo que
-- queda escrito es el aviso:
--
-- ⚠️ CUALQUIER TABLA NUEVA NACE CON LOS CUATRO PERMISOS. Si la siguiente es
--    otra de solo-anadir -un registro, un historial, un log-, su migracion
--    tiene que traer su REVOKE, porque el GRANT no basta.

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
-- ⚠️ Con el rol de la APLICACION (`app_quiniela`), que es lo que importa aqui:
--
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'acciones_superadmin' AND grantee = 'app_quiniela'
--    ORDER BY privilege_type;
--   -- INSERT, SELECT   <- solo esos dos. Si sale DELETE o UPDATE, no quedo.
--
-- Y que la aplicacion sigue pudiendo escribir sus asientos:
--
--   SELECT count(*) FROM acciones_superadmin;   -- responde, no da permiso denegado
--
-- Se puede volver a correr: un REVOKE de algo ya revocado no falla.
-- =====================================================================

-- =====================================================================
-- MIGRACION 007 - LOS ABONOS TAMPOCO SE BORRAN
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ✅ No hace falta desplegar nada con ella: no cambia el codigo, solo quita
--    permisos que el codigo nunca usa. Se puede correr en cualquier momento.
--
-- ---------------------------------------------------------------------
-- QUE ARREGLA
-- ---------------------------------------------------------------------
--
-- `pagos` lleva escrita esta regla desde la migracion 001:
--
--     ⚠️ LOS ABONOS NO SE EDITAN NI SE BORRAN: se corrigen con un asiento
--     inverso que apunta al original.
--
-- Es lo que hace que el historial de dinero sirva para lo unico que sirve:
-- resolver un "yo si pague". Un historial al que se le pueden quitar filas no
-- es prueba de nada.
--
-- ⛔ Pero esa regla vivia SOLO en un comentario y en un centinela que leia el
-- texto de `src/pagos.js` buscando que no dijera DELETE. La base concedia
-- DELETE y UPDATE igual. El dia que alguien escribiera esa ruta, funcionaria.
--
-- Es el mismo agujero de la migracion 003 con la auditoria: **un GRANT solo
-- SUMA**, y los privilegios por defecto del esquema ya conceden los cuatro
-- permisos sobre toda tabla nueva. Se descubrio comprobando la base de verdad,
-- no leyendo el codigo -en el codigo la regla parecia estar puesta-.
--
-- ---------------------------------------------------------------------
-- LO QUE **NO** SE ROMPE
-- ---------------------------------------------------------------------
--
-- Borrar un jugador o una quiniela sigue arrastrando sus abonos: las cascadas
-- de clave ajena las ejecuta PostgreSQL como DUENO de la tabla, no como quien
-- llama, asi que no necesitan este permiso.
--
-- Comprobado a mano contra el banco de pruebas con el REVOKE puesto:
--
--     borrar un abono a mano  -> permission denied for table pagos
--     editar un abono         -> permission denied for table pagos
--     borrar el jugador       -> funciono, y se llevo sus abonos
--     borrar la quiniela      -> funciono
--
-- ---------------------------------------------------------------------
-- ⚠️ Y ENTONCES, ¿COMO SE CORRIGE UN ABONO MAL ANOTADO?
-- ---------------------------------------------------------------------
--
-- Desde la pantalla de Cobros, con el boton "Corregir con asiento inverso":
-- anota un abono del mismo importe en negativo. La cuenta queda bien y los dos
-- asientos quedan a la vista, que es la diferencia entre corregir y tapar.
--
-- Borrar de verdad exige entrar a Neon con el rol dueno. Eso no es un estorbo:
-- es el punto. Borrar dinero tiene que costar hacerlo a proposito.
-- =====================================================================

BEGIN;

REVOKE UPDATE, DELETE ON pagos FROM app_quiniela;

/*
 * Las otras dos ya estaban cerradas -migraciones 003 y 006-, pero se repiten
 * aqui a proposito: REVOKE es idempotente, y asi esta migracion deja las TRES
 * tablas de solo-escritura en el mismo sitio. Si alguien viene dentro de un
 * año a preguntarse cuales son, esta es la lista.
 */
REVOKE UPDATE, DELETE ON acciones_superadmin FROM app_quiniela;
REVOKE UPDATE, DELETE ON entregas_acumulado  FROM app_quiniela;

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
--   SELECT table_name,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'app_quiniela'
--      AND table_name IN ('pagos','acciones_superadmin','entregas_acumulado')
--    GROUP BY table_name ORDER BY table_name;
--
--   -- las tres tienen que decir exactamente: INSERT, SELECT
--   -- si alguna dice DELETE o UPDATE, el REVOKE no quedo
--
-- Se puede volver a correr entera: es idempotente.
-- =====================================================================

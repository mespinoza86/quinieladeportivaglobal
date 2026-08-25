-- =====================================================================
-- MIGRACION 004 - EL REGISTRO ADMITE LA ACCION "verificar"
--
-- ⚠️ SE EJECUTA CON EL ROL DUENO, en el editor SQL de Neon.
-- ⛔ Y ANTES de empujar el codigo que la necesita.
--
-- ---------------------------------------------------------------------
-- POR QUE HACE FALTA UNA MIGRACION PARA ESTO
-- ---------------------------------------------------------------------
--
-- La 002 creo `acciones_superadmin.accion` con una lista cerrada:
--
--     CHECK (accion IN ('desactivar','reactivar','liberar_correo','borrar'))
--
-- El superadministrador gana ahora una quinta accion -dar por verificado un
-- correo a mano, para desatascar a quien no recibe el enlace- y **anadirla en
-- JavaScript no basta**: el INSERT lo rechazaria la base.
--
-- ⚠️ Es el precio de un CHECK con lista cerrada, y aun asi vale la pena: sin
-- el, una accion mal escrita -"desactivada" en vez de "desactivar"- entraria
-- en el registro y solo se descubriria al leerlo meses despues. Se paga una
-- migracion cada vez que se anade una accion, y a cambio el registro no puede
-- contener basura.
--
-- Que quede escrito para la proxima: **anadir una accion del superadministrador
-- cuesta una migracion**. No es un olvido, es el diseno.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Sustituir la restriccion por la misma, con un valor mas.
-- ---------------------------------------------------------------------
--
-- Se hace en dos pasos -quitar y poner- porque PostgreSQL no permite
-- redefinir un CHECK en sitio. `IF EXISTS` para que la migracion se pueda
-- volver a correr sin fallar, que es la regla 2 de esta carpeta.
--
-- El nombre `acciones_superadmin_accion_check` es el que PostgreSQL genera
-- solo al declarar el CHECK en la columna: tabla + columna + "check".
ALTER TABLE acciones_superadmin
  DROP CONSTRAINT IF EXISTS acciones_superadmin_accion_check;

ALTER TABLE acciones_superadmin
  ADD CONSTRAINT acciones_superadmin_accion_check
  CHECK (accion IN ('desactivar','reactivar','liberar_correo','borrar','verificar'));

COMMIT;

-- =====================================================================
-- COMO COMPROBAR QUE QUEDO BIEN
-- =====================================================================
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'acciones_superadmin_accion_check';
--   -- tiene que aparecer 'verificar' entre los valores admitidos
--
-- Y que sigue rechazando lo que no esta en la lista -esto DEBE fallar-:
--
--   INSERT INTO acciones_superadmin
--     (actor_email, accion, objetivo_email, objetivo_username, motivo)
--   VALUES ('x@x.com', 'inventada', 'y@y.com', 'y', 'probando');
--   -- ERROR: new row violates check constraint
--
-- Se puede volver a correr entera: no debe fallar ni cambiar nada.
-- =====================================================================

-- ===========================================================================
-- 012 · Niveles de administrador
-- ===========================================================================
--
-- Hasta aquí `rol` era binario de hecho: administrador (propietario o admin) o
-- jugador. Marco pidió repartir el trabajo sin repartir el riesgo, y eso son
-- escalones:
--
--   propietario     todo. El ÚNICO que elimina la quiniela y reparte roles.
--   admin           todo menos eliminar la quiniela y menos repartir roles.
--   admin_jornadas  arma jornadas y envía partidos. NO marcadores, NO dinero,
--                   NO miembros.
--   admin_lector    envía partidos y mira. No cambia nada más.
--   user            jugador.
--
-- Quién puede qué está en `src/permisos.js`, en una sola tabla. Aquí abajo
-- sólo se amplía lo que la base acepta guardar.
--
-- ⚠️ Esta migración NO toca ninguna fila: los roles que ya existen
-- (`propietario`, `admin`, `user`) siguen significando exactamente lo mismo.
-- Sólo se añaden dos valores nuevos al abanico. Por eso se puede correr con la
-- aplicación en marcha y sin prisa por desplegar detrás.
--
-- Correr en Neon CON EL ROL DUEÑO.
-- ===========================================================================

ALTER TABLE membresias DROP CONSTRAINT IF EXISTS membresias_rol_check;

ALTER TABLE membresias ADD CONSTRAINT membresias_rol_check
  CHECK (rol IN ('propietario', 'admin', 'admin_jornadas', 'admin_lector', 'user'));

-- ---------------------------------------------------------------------------
-- Comprobación (debe listar los cinco valores):
--
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'membresias'::regclass AND conname = 'membresias_rol_check';
--
-- Y que no se haya movido nadie de sitio:
--
--   SELECT rol, count(*) FROM membresias GROUP BY rol ORDER BY rol;
-- ---------------------------------------------------------------------------

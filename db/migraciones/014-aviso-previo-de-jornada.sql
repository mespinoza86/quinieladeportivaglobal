-- ===========================================================================
-- 014 · El aviso de 2 horas antes de que arranque una jornada
-- ===========================================================================
--
-- Marco pidió un segundo aviso, más temprano: dos horas antes del partido MÁS
-- TEMPRANO de la jornada, para quien todavía no ha terminado de llenarla.
--
-- ⛔ LA MARCA VA EN `jornadas`, NO EN `partidos`, Y ESO ES EL DISEÑO
--
-- El aviso de 15 minutos es de un partido: cada uno tiene el suyo, y por eso su
-- marca vive en `partidos.notificado_en` (013).
--
-- Éste no. Es un aviso de la JORNADA —«esto arranca dentro de dos horas»— y se
-- manda UNA vez aunque la jornada tenga catorce partidos. Ponerlo en `partidos`
-- obligaría a elegir un partido para colgarle la marca, y esa elección se
-- rompería sola: si se añade un partido más temprano después de haber avisado,
-- el «primero» cambia, la marca se quedaría en el partido equivocado y la
-- jornada avisaría dos veces.
--
-- En `jornadas` no hay nada que elegir: la jornada es una.
--
-- Correr en Neon CON EL ROL DUEÑO. Es aditiva y no mueve ninguna fila, así que
-- el orden con el despliegue da igual.
-- ===========================================================================

ALTER TABLE jornadas
  ADD COLUMN IF NOT EXISTS avisado_2h_en timestamptz;

-- ---------------------------------------------------------------------------
-- Comprobación:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'jornadas' AND column_name = 'avisado_2h_en';
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 016 · La hora que dice el proveedor, cuando no es la nuestra
-- ===========================================================================
--
-- El 9 de octubre de 2026 Marco estaba viendo Sporting vs Cartaginés por
-- televisión y la aplicación no le enseñaba marcador. El proveedor llevaba unos
-- 70 minutos respondiendo que ese partido era AL DÍA SIGUIENTE a las 15:00 y
-- que no había empezado. Nuestra hora —hoy 20:00— era la correcta.
--
-- ⛔ POR QUÉ NO SE ACTUALIZA LA FECHA SOLA, QUE ERA LA IDEA OBVIA
--
-- Lo vio Marco: *«imagínate que si dejáramos que él lo actualice con la fecha
-- del API, en un caso como estos él abriría la posibilidad de cambiar
-- resultados en un partido que ya se está jugando»*. Y tiene razón: aplicar esa
-- fecha habría REABIERTO los pronósticos de un partido en el minuto 71, con el
-- 1-1 en pantalla. Cualquiera podía cambiar su marcador viendo el resultado.
--
-- Así que la fecha del proveedor NO se aplica nunca sola. Se guarda aparte, se
-- le enseña al administrador, y él decide con el campo de corrección manual que
-- ya existe (entrada 121).
--
-- ⛔ POR QUÉ EN `partidos` Y NO EN `fixtures`
--
-- `fixtures` es la caché COMPARTIDA del proveedor: una fila por partido del
-- mundo, no por partido de una quiniela. Pero la discrepancia no es una
-- propiedad del partido: es la diferencia entre lo que dice el proveedor y lo
-- que tiene guardado ESTA quiniela, y dos quinielas pueden tener horas
-- distintas para el mismo partido —una corregida a mano y la otra no—. Puesta
-- en la caché, la de una pisaría la de la otra.
--
-- ⚠️ Y `partidos` lleva RLS por `app.quiniela_id`, así que el aviso de una
-- quiniela no se puede ver desde otra. En la caché no habría ese aislamiento.
--
-- ⛔ POR QUÉ HACEN FALTA DOS COLUMNAS Y NO UNA
--
-- `fecha_proveedor` es QUÉ dice, para poder enseñarlo sin volver a derivarlo.
-- `fecha_proveedor_desde` es DESDE CUÁNDO lo dice, y es la que evita el ruido:
-- una lectura suelta del proveedor miente —esa noche dio dos respuestas
-- contrarias en quince minutos—, así que el aviso sólo sale cuando la
-- discrepancia lleva un rato aguantando. Es la misma regla de «dos lecturas
-- seguidas» que ya se usa para comprobar un despliegue.
--
-- Las dos se ponen a NULL en cuanto las horas vuelven a coincidir: el aviso
-- desaparece solo si el proveedor se corrige, sin que nadie lo cierre a mano.

ALTER TABLE partidos
  ADD COLUMN IF NOT EXISTS fecha_proveedor       text,
  ADD COLUMN IF NOT EXISTS fecha_proveedor_desde timestamptz;

COMMENT ON COLUMN partidos.fecha_proveedor IS
  'La hora que dice el proveedor cuando NO coincide con api_date. NULL = coinciden. Nunca se aplica sola: la decide el administrador (migración 016).';

COMMENT ON COLUMN partidos.fecha_proveedor_desde IS
  'Desde cuándo discrepan. Sirve para no avisar por una lectura pasajera del proveedor (migración 016).';

-- =====================================================================
-- Sondeo SQL - las 13 colecciones de Mongo modeladas en PostgreSQL.
--
-- Dos cosas que NO son traduccion mecanica y conviene ver de entrada:
--
--   1. Los cinco arreglos incrustados se vuelven tablas hijas, y al hacerlo
--      cada partido y cada pronostico gana identidad propia. Eso es M-02
--      cerrado por obligacion: hoy el vinculo partido<->pronostico es el
--      indice de un array.
--
--   2. El aislamiento por quiniela lo aplica la base con RLS, no el ORM.
--      Una consulta a la que se le olvide el filtro no ve nada ajeno.
-- =====================================================================

-- gen_random_uuid() es de serie desde PostgreSQL 13: no hace falta pgcrypto.

-- ---------------------------------------------------------------------
-- Plataforma: sin quinielaId, igual que hoy. No llevan RLS.
-- ---------------------------------------------------------------------

CREATE TABLE usuarios (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username                      text NOT NULL UNIQUE,
  username_normalizado          text NOT NULL UNIQUE,
  email                         text NOT NULL UNIQUE,
  email_normalizado             text NOT NULL UNIQUE,
  password                      text NOT NULL,
  email_verificado              boolean NOT NULL DEFAULT false,
  activo                        boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

/*
 * Tokens de un solo uso: confirmar el correo, y manana restablecer la
 * contrasena. Una sola tabla para los dos porque la mecanica es IDENTICA: un
 * valor aleatorio, que vence, que se usa una vez y que pertenece a alguien.
 *
 * ⚠️ Se guarda el SHA-256 del token, NUNCA el token. Una filtracion de la base
 * no debe entregar la capacidad de entrar en cuentas ajenas. Por eso estas
 * columnas salieron de `usuarios`, donde `token_verificacion` era `text` en
 * claro.
 */
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proposito  text NOT NULL CHECK (proposito IN ('verificar_email','restablecer_password')),
  token_hash char(64) NOT NULL,
  expira_en  timestamptz NOT NULL,
  usado_en   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- La busqueda siempre entra por el hash, y debe ser unico: dos filas con el
-- mismo hash harian ambiguo a quien pertenece el token.
CREATE UNIQUE INDEX auth_tokens_hash ON auth_tokens (token_hash);

-- Para anular los pendientes de alguien al emitirle uno nuevo.
CREATE INDEX auth_tokens_pendientes ON auth_tokens (usuario_id, proposito)
  WHERE usado_en IS NULL;

CREATE TABLE quinielas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  codigo_ingreso  text NOT NULL UNIQUE,
  propietario_id  uuid NOT NULL REFERENCES usuarios(id),
  estado          text NOT NULL DEFAULT 'activa'
                    CHECK (estado IN ('activa','archivada','eliminada')),
  eliminada_en    timestamptz,
  -- La configuracion es un bloque que se lee y se escribe entero, nunca por
  -- partes. Es exactamente el caso para el que sirve jsonb: no gana nada
  -- desplegado en doce columnas.
  configuracion   jsonb NOT NULL DEFAULT '{"puntuacion":{"marcadorExacto":5,"resultadoCorrecto":3,"comodinExacto":7,"comodinResultado":4,"triviasHabilitadas":true,"puntosTriviaDefault":1},"incluirExpulsadosEnRanking":true}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membresias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id   uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol           text NOT NULL DEFAULT 'user'
                  CHECK (rol IN ('propietario','admin','user')),
  estado        text NOT NULL DEFAULT 'pendiente_ingreso'
                  CHECK (estado IN ('pendiente_ingreso','activo','pendiente_retiro',
                                    'rechazado','expulsado')),
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  aprobado_en   timestamptz,
  retirado_en   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiniela_id, usuario_id)
);

-- La cache compartida de partidos (Fase 4). NO lleva quiniela_id a proposito:
-- es justo la pieza que todas las quinielas comparten.
CREATE TABLE fixtures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave               text NOT NULL UNIQUE,
  api_fixture_id      text NOT NULL DEFAULT '',
  busqueda            jsonb,
  evento              jsonb,          -- era Mixed: la respuesta cruda del API
  estado              text NOT NULL DEFAULT 'DESCONOCIDO',
  api_date            text,
  consultado_en       timestamptz,
  proxima_consulta    timestamptz,    -- NULL = termino, no se pregunta mas
  fallos_consecutivos integer NOT NULL DEFAULT 0,
  ultimo_error        text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fixtures (proxima_consulta);

CREATE TABLE job_locks (
  nombre    text PRIMARY KEY,
  instancia text,
  tomado_en timestamptz,
  expira_en timestamptz NOT NULL
);

/*
 * Las sesiones. La forma la impone `connect-pg-simple`, no nosotros: los tres
 * nombres de columna y sus tipos son los que esa biblioteca espera encontrar.
 *
 * Estaban en Mongo (`connect-mongo`) y no aparecian en el plan de migracion:
 * salieron al revisar package.json en la tajada 1. Sin esta tabla, la
 * aplicacion arranca y deja entrar a la gente, pero nadie sigue dentro en la
 * peticion siguiente.
 *
 * El indice sobre expire lo usa la limpieza periodica de sesiones caducadas.
 */
CREATE TABLE sesiones (
  sid    text PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamptz NOT NULL
);
CREATE INDEX ON sesiones (expire);

-- ---------------------------------------------------------------------
-- Dominio: todas llevan quiniela_id y todas llevan RLS.
-- ---------------------------------------------------------------------

CREATE TABLE jugadores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id  uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  nombre       text NOT NULL,
  usuario_id   uuid REFERENCES usuarios(id),

  -- Cobros (migracion 001). Secuencia de la primera jornada que se le cobra:
  -- quien entra en la jornada 7 no debe las seis anteriores, no estaba. NULL
  -- es "desde siempre". Se guarda la SECUENCIA porque ya es el orden real de
  -- las jornadas; un uuid es aleatorio y `creada_en` empata dentro de una
  -- misma transaccion.
  cobrar_desde bigint,

  -- Si juega el torneo completo, y por tanto debe su cuota. No todo el mundo
  -- lo juega: quien entra a mitad de temporada entra a jugar por jornada, y
  -- sin esta marca apareceria como deudor eterno de algo que nunca quiso.
  juega_torneo boolean NOT NULL DEFAULT true,

  UNIQUE (quiniela_id, nombre)
);

-- Un usuario es UN jugador dentro de una quiniela, y solo uno. Va como indice
-- parcial porque `usuario_id` puede ser nulo: los jugadores historicos que
-- migro el script de la base anterior quedaron como nombres sin cuenta, y de
-- esos puede haber varios. Sostiene el ON CONFLICT del alta al aprobar un
-- miembro.
CREATE UNIQUE INDEX jugadores_quiniela_usuario
  ON jugadores (quiniela_id, usuario_id) WHERE usuario_id IS NOT NULL;

CREATE TABLE jornadas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  /*
   * ⚠️ "La jornada actual es LA ULTIMA QUE SE CREO" (Fase B, Entrada 028), y en
   * Mongo eso se resolvia con `sort({_id: -1})`: un ObjectId lleva la fecha de
   * creacion dentro, asi que ordenar por el era ordenar por creacion.
   *
   * Un uuid es ALEATORIO. Ordenar por `id` aqui daria un orden arbitrario y la
   * regla se romperia EN SILENCIO -seguiria devolviendo una jornada, solo que
   * la que no es-. Y `creada_en` tampoco basta por si solo: `now()` es la hora
   * de la TRANSACCION, asi que dos jornadas creadas en la misma quedarian
   * empatadas.
   *
   * Esta secuencia es estrictamente creciente y es la que manda al ordenar.
   */
  secuencia   bigint GENERATED ALWAYS AS IDENTITY,

  /*
   * ⚠️ Lo que costo ESTA jornada (migracion 001), copiado de la configuracion
   * al crearla. El administrador puede subir el precio -"esta vale 5000 porque
   * el premio esta grande"- y eso debe afectar SOLO A LO QUE VIENE: si el
   * precio se leyera de `quinielas.configuracion` al calcular, subirlo
   * recalcularia hacia atras lo que todos debian por las jornadas viejas.
   *
   * Mismo patron que `puntos_jornada.puntuacion`, que guarda las reglas con
   * las que se congelo para que cambiar la puntuacion en enero no reescriba la
   * clasificacion de marzo.
   */
  precio      numeric(12,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),

  UNIQUE (quiniela_id, nombre)
);
CREATE INDEX ON jornadas (quiniela_id, secuencia DESC);

-- Era Jornada.partidos[]. Cada partido gana id propio: eso es M-02.
CREATE TABLE partidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id    uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jornada_id     uuid NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  orden          integer NOT NULL,      -- conserva el orden que tenia el array
  equipo1        text,
  equipo2        text,
  logo_equipo1   text,
  logo_equipo2   text,
  comodin        boolean NOT NULL DEFAULT false,
  api_fixture_id text,
  api_league_id  text,
  api_date       text,
  api_status     text,
  /*
   * DEFERRABLE porque renumerar hace falta: al borrar el partido de la posicion
   * 2, los de despues bajan una. Si la unicidad se comprobara fila a fila, la
   * renumeracion chocaria consigo misma a mitad. Diferida, se comprueba al
   * cerrar la transaccion, cuando el orden ya es coherente otra vez.
   */
  UNIQUE (jornada_id, orden) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE resultados (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jornada_id  uuid NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  jugador_id  uuid NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  UNIQUE (quiniela_id, jugador_id, jornada_id)
);

-- Era Resultado.pronosticos[]. Ahora apunta al partido por id, no por posicion.
CREATE TABLE pronosticos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id  uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  resultado_id uuid NOT NULL REFERENCES resultados(id) ON DELETE CASCADE,
  partido_id   uuid NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  marcador1    integer,
  marcador2    integer,
  UNIQUE (resultado_id, partido_id)
);

CREATE TABLE resultados_oficiales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jornada_id  uuid NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  UNIQUE (quiniela_id, jornada_id)
);

-- Era ResultadoOficial.resultados[].
CREATE TABLE resultados_oficiales_partidos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id          uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  resultado_oficial_id uuid NOT NULL REFERENCES resultados_oficiales(id) ON DELETE CASCADE,
  partido_id           uuid NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  marcador1            integer,
  marcador2            integer,
  estado               text,
  minuto               text,     -- era Mixed: numero o "HT"
  fecha                text,
  origen               text NOT NULL DEFAULT 'api',
  bloqueado_final      boolean NOT NULL DEFAULT false,
  actualizado_en       timestamptz,
  UNIQUE (resultado_oficial_id, partido_id)
);

CREATE TABLE trivias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id        uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jornada_id         uuid NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  partido_id         uuid REFERENCES partidos(id) ON DELETE CASCADE,  -- era partidoIndex
  api_fixture_id     text,
  tipo               text,
  pregunta           text,
  opciones           text[],   -- lista sin identidad: no necesita tabla
  puntos             integer NOT NULL DEFAULT 1,
  fecha_cierre       timestamptz,
  respuesta_correcta text,
  resuelta           boolean NOT NULL DEFAULT false,
  activa             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Es M-25, que en Mongo sigue pendiente.
CREATE INDEX ON trivias (quiniela_id, jornada_id, partido_id, tipo);

/*
 * Una trivia activa por partido y tipo. No es adorno: la reconciliacion del
 * codigo viejo miraba si existia y, si no, la creaba. Entre mirar y escribir
 * cabe otra peticion, y ahi salian dos preguntas identicas sobre el mismo
 * partido, cada una con sus respuestas y sus puntos. Con el indice, quien
 * decide es la base y el segundo intento choca en vez de duplicar.
 *
 * Parcial porque una trivia sin partido no tiene con quien chocar.
 */
CREATE UNIQUE INDEX trivias_partido_tipo_activa
  ON trivias (quiniela_id, partido_id, tipo)
  WHERE activa AND partido_id IS NOT NULL;

CREATE TABLE respuestas_trivia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id     uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  trivia_id       uuid NOT NULL REFERENCES trivias(id) ON DELETE CASCADE,
  jugador_id      uuid NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  respuesta       text,
  puntos          integer NOT NULL DEFAULT 0,
  fecha_respuesta timestamptz NOT NULL DEFAULT now(),
  -- Es S-10: el doble envio concurrente que daba puntos dobles.
  UNIQUE (quiniela_id, jugador_id, trivia_id)
);

CREATE TABLE equipos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  UNIQUE (quiniela_id, nombre)
);

CREATE TABLE puntos_jornada (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id  uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jornada_id   uuid NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  -- Las reglas con las que se congelo. Bloque entero, igual que configuracion.
  puntuacion   jsonb NOT NULL,
  congelado_en timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiniela_id, jornada_id)
);

-- Era PuntosJornada.puntos[].
CREATE TABLE puntos_jornada_jugador (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id       uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  puntos_jornada_id uuid NOT NULL REFERENCES puntos_jornada(id) ON DELETE CASCADE,
  jugador_id        uuid NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  puntos            integer NOT NULL DEFAULT 0,
  UNIQUE (puntos_jornada_id, jugador_id)
);

-- Los abonos (migracion 001). Una fila por abono.
--
-- Cuelga de `jugadores` y NO de `membresias` a proposito: `usuario_id` es
-- nulable, asi que hay jugadores sin cuenta -los que migraron de la base
-- anterior, y los que el administrador da de alta porque mandan su quiniela
-- por otro medio-. Colgandolo de las membresias esa gente no se podria
-- controlar, y son justo los que pagan en efectivo.
--
-- ⚠️ DOS CUENTAS SEPARADAS, NO UNA BOLSA COMUN. Con un solo saldo, los 10000
-- de la cuota del torneo se los irian comiendo las jornadas.
CREATE TABLE pagos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiniela_id    uuid NOT NULL REFERENCES quinielas(id) ON DELETE CASCADE,
  jugador_id     uuid NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  concepto       text NOT NULL CHECK (concepto IN ('torneo','jornada')),

  -- Puede ser NEGATIVO: asi se corrige un abono mal anotado. Cero no, porque
  -- un asiento de cero no dice nada y ensucia el historial.
  monto          numeric(12,2) NOT NULL CHECK (monto <> 0),

  nota           text NOT NULL DEFAULT '',

  -- Quien lo anoto. Un historial de dinero al que se le borran los autores
  -- deja de servir para lo unico que sirve: resolver un "yo si pague".
  registrado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,

  -- ⚠️ LOS ABONOS NO SE EDITAN NI SE BORRAN: se corrigen con un asiento
  -- inverso que apunta al original.
  anula_a        uuid REFERENCES pagos(id) ON DELETE RESTRICT,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON pagos (quiniela_id, jugador_id, concepto);

-- Un abono solo se puede anular UNA vez. Sin esto, dos anulaciones del mismo
-- asiento restarian el doble y la cuenta quedaria mal sin que nada avise.
CREATE UNIQUE INDEX pagos_una_anulacion_por_abono
  ON pagos (anula_a) WHERE anula_a IS NOT NULL;

-- =====================================================================
-- RLS - el equivalente del tenantPlugin, pero aplicado por la base.
--
-- La diferencia que importa: el plugin de Mongoose engancha find*, update* y
-- delete*, pero NO aggregate, insertMany ni bulkWrite. Hoy no se usa ninguno
-- de los tres, asi que no hay fuga; el dia que alguien escriba el primer
-- aggregate, sale sin filtro y en silencio. Esto no tiene esa puerta.
-- =====================================================================

CREATE FUNCTION quiniela_actual() RETURNS uuid AS
$fn$
  SELECT NULLIF(current_setting('app.quiniela_id', true), '')::uuid;
$fn$ LANGUAGE sql STABLE;

DO
$blq$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'jugadores','jornadas','partidos','resultados','pronosticos',
    'resultados_oficiales','resultados_oficiales_partidos','trivias',
    'respuestas_trivia','equipos','puntos_jornada','puntos_jornada_jugador',
    'pagos'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_quiniela ON %I USING (quiniela_id = quiniela_actual()) WITH CHECK (quiniela_id = quiniela_actual())', t);
  END LOOP;
END
$blq$;

# Avance del Proyecto — Quiniela Deportiva Global

> Documento vivo. Registra el análisis técnico completo del sistema y la bitácora
> paso a paso de todo lo que se vaya construyendo, con el detalle necesario para
> retomar el trabajo en cualquier momento sin perder contexto.

- **Repositorio:** `quinieladeportivaglobal`
- **Rama:** `main`
- **Fecha de inicio del documento:** 14 de agosto de 2026
- **Objetivo declarado:** llevar la aplicación de quiniela deportiva multi-quiniela
  a producción "en grande" (muchas quinielas, muchos usuarios concurrentes).

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Inventario del repositorio](#2-inventario-del-repositorio)
3. [Arquitectura actual](#3-arquitectura-actual)
4. [Modelo de datos MongoDB](#4-modelo-de-datos-mongodb)
5. [Multi-tenancy: aislamiento por quiniela](#5-multi-tenancy-aislamiento-por-quiniela)
6. [Autenticación, sesiones, roles y Admin Mode](#6-autenticación-sesiones-roles-y-admin-mode)
7. [Mapa completo de endpoints](#7-mapa-completo-de-endpoints)
8. [Motor de puntuación](#8-motor-de-puntuación)
9. [Integración con APIFootball](#9-integración-con-apifootball)
10. [Sistema de trivias](#10-sistema-de-trivias)
11. [Frontend](#11-frontend)
12. [Migración desde la base anterior](#12-migración-desde-la-base-anterior)
13. [Pruebas y verificación](#13-pruebas-y-verificación)
14. [Estado de Git y cambios sin confirmar](#14-estado-de-git-y-cambios-sin-confirmar)
15. [Hallazgos clasificados por severidad](#15-hallazgos-clasificados-por-severidad)
16. [Roadmap para escalar "en grande"](#16-roadmap-para-escalar-en-grande)
17. [Anexo A — Acta de continuidad del 9 de julio de 2026 (HANDOFF)](#anexo-a--acta-de-continuidad-del-9-de-julio-de-2026-handoff)
18. [Bitácora de avance](#18-bitácora-de-avance)

---

## 1. Resumen ejecutivo

La aplicación es una **plataforma de quinielas deportivas multi-inquilino** construida
sobre Node.js + Express + MongoDB (Mongoose), con frontend en HTML/CSS/JavaScript
puro sin framework. Ya realizó la transición desde una aplicación de una sola
quiniela (mundialista) hacia un modelo donde cada usuario puede pertenecer a varias
quinielas con roles independientes en cada una.

**Estado de madurez actual:**

| Dimensión | Estado | Comentario |
|---|---|---|
| Funcionalidad de dominio | 🟢 Muy completa | Jornadas, pronósticos, resultados oficiales, trivias, campeón, ranking |
| Multi-tenancy | 🟡 Funciona, con fugas | Aislamiento por `AsyncLocalStorage` correcto en el 95% de rutas; hay fugas en el job de trivias |
| Seguridad | 🟡 Base sólida, faltan capas | bcrypt, sesiones en Mongo, roles, Admin Mode. Faltan rate limiting, headers, verificación de correo |
| Escalabilidad | 🔴 Bloqueante | El auto-sync global con APIFootball no escala más allá de unas pocas quinielas |
| Mantenibilidad | 🔴 Bloqueante | `server.js` monolítico de 3.584 líneas con 96 handlers |
| Observabilidad | 🔴 Ausente | Solo `console.log`; sin métricas, sin trazas, sin health checks |
| Pruebas | 🟡 Mínimas | 6 pruebas arquitectónicas por expresiones regulares sobre el código fuente; cero pruebas de integración |

**Los tres bloqueantes reales para "implementarlo en grande":**

1. **El sincronizador de resultados hace O(total de partidos del sistema) llamadas a
   APIFootball cada 30 segundos.** Con 100 quinielas activas esto son miles de
   llamadas por minuto: se agota la cuota del proveedor y el servidor se satura.
2. **`server.js` es un único archivo de 3.584 líneas.** Cada cambio es riesgoso y
   no hay separación entre rutas, lógica de negocio, modelos e integraciones.
3. **El ranking (`/api/resultados-totales`) recalcula todo en memoria en cada
   petición** leyendo colecciones completas sin paginación ni caché.

---

## 2. Inventario del repositorio

### 2.1 Raíz

| Archivo | Líneas | Rol |
|---|---:|---|
| `server.js` | 3.584 | Servidor completo: middleware, esquemas, 96 rutas, integraciones, jobs |
| `package.json` | 30 | Dependencias y scripts |
| `README.md` | 55 | Instrucciones de instalación, modelo de acceso y migración |
| `HANDOFF.md` | 65 | Acta de decisiones del 9 de julio de 2026. **Superado**: su contenido íntegro vive ahora en el Anexo A de este documento. Se conserva como histórico congelado |
| `.env` | — | Secretos locales (ignorado por Git) |
| `.gitignore` | 3 | Ignora `.env`, `node_modules/`, `npm-debug.log*` |
| `equipos.json` | 12 KB | Volcado heredado de equipos |
| `jornadas.json` | 11 KB | Volcado heredado de jornadas |
| `jugadores.json` | 270 B | Volcado heredado de jugadores |
| `resultados.json` | 165 KB | Volcado heredado de pronósticos |
| `resultados-oficiales.json` | 16 KB | Volcado heredado de resultados oficiales |

> Los cinco `.json` de la raíz son restos de la versión previa a MongoDB. Ninguno
> se lee desde el código actual. Son datos históricos, no configuración.

### 2.2 `scripts/`

| Archivo | Líneas | Rol |
|---|---:|---|
| `migrate-legacy.js` | 101 | Migrador de la base anterior a la nueva. Simulación por defecto |

### 2.3 `test/`

| Archivo | Líneas | Rol |
|---|---:|---|
| `architecture.test.js` | 66 (73 con cambios sin confirmar) | 6 pruebas de invariantes arquitectónicas |

### 2.4 `public/` — 30 páginas HTML

Servidas estáticamente desde `express.static`.

**Públicas / de cuenta:** `login.html`, `registro.html`, `quinielas.html`, `index.html`,
`reglamento_quiniela.html`

**De participante:** `llenar_jornada_user.html`, `llenar_trivia.html`,
`pronostico-campeon.html`, `ver_jornadas.html`, `ver_jugadores.html`,
`verResultados.html`, `verResultados_puntos.html`, `resultados-totales.html`,
`ver-resultados-oficiales.html`, `ver_resultados_trivias.html`,
`ver-pronosticos-campeon.html`, `ver_resultados_totales_de_jugadores.html`

**De administración (listadas en `paginasAdmin`):** `adminmode.html`, `jugadores.html`,
`jornadas.html`, `importar_partidos.html`, `resultados.html`,
`agregar-resultados-oficiales.html`, `generar_reporte.html`, `enviarresultados.html`,
`copiarresultadojugador.html`, `admin_trivias.html`, `enviarresultadostrivias.html`,
`enviarresultadospartido.html`, `enviarresultadostriviaspartido.html`,
`campeon-oficial.html`, `miembros.html`, `configuracion-quiniela.html`

### 2.5 `private/js/` — 39 scripts

Servidos por la ruta `GET /js/:filename`, que lee de `private/js/`. Es un pseudo-ocultamiento:
el navegador los descarga igual. **No hay ningún secreto ahí, pero tampoco hay ninguna
protección real** — la ruta no verifica sesión.

Los más grandes:

| Script | Líneas | Función |
|---|---:|---|
| `jornadas.js` | 1.252 | Panel de administración de jornadas y partidos |
| `importar_partidos.js` | 752 | Buscador e importador de partidos desde APIFootball |
| `llenar_jornada_user.js` | 619 | Formulario de pronósticos del participante |
| `llenar_trivia.js` | 450 | Formulario de respuestas de trivia |
| `ver-resultados_puntos.js` | 446 | Vista de puntos por jornada |
| `ver_resultados_totales_de_jugadores.js` | 386 | Tabla comparativa completa |
| `ver-resultados.js` | 374 | Vista de pronósticos |
| `admin_trivias.js` | 301 | Configuración de trivias por jornada |

### 2.6 `private/css/`

Un único `styles.css` con el sistema visual "mobile shell" (tarjetas, navegación
inferior, paneles de aplicación).

### 2.7 Dependencias

Estado **después de la Fase 0** (16 de agosto de 2026):

```
axios ^1.11.0            → cliente HTTP hacia APIFootball  ⚠️ 29 advisories, ver abajo
bcrypt ^6.0.0            → hash de contraseñas (SALT_ROUNDS = 10)
connect-mongo ^5.1.0     → almacén de sesiones en MongoDB
cors ^2.8.5              → CORS con lista blanca
dotenv ^17.0.1           → variables de entorno
express ^4.21.2          → framework HTTP
express-async-errors     → captura de errores en handlers async
express-session ^1.18.0  → sesiones
mongoose ^8.16.1         → ODM de MongoDB
```

✅ **Eliminadas en la Fase 0** (63 paquetes menos): `canvas` (no se usaba en ningún
archivo, arrastraba compilación nativa), `fs` (paquete basura que suplanta al módulo
nativo homónimo, que se sigue usando sin dependencia) y `body-parser` (redundante
desde Express 4.16).

⚠️ **`npm audit --omit=dev` → 11 vulnerabilidades** (3 bajas, 3 moderadas, 5 altas),
medidas el 16 de agosto de 2026. En julio eran 0. Casi todas provienen de
`axios@1.11.0`, que acumuló ~29 advisories (SSRF, prototype pollution, DoS, fuga de
cabeceras `Proxy-Authorization` en redirecciones). El resto son transitivas de
Express (`body-parser`, `qs`, `path-to-regexp`, `cookie`, `follow-redirects`).
Todas se resuelven con `npm audit fix` sin cambios de ruptura. **No se aplicó en la
Fase 0** porque actualizar `axios` toca directamente el cliente de APIFootball y la
Fase 0 tiene la regla de no alterar comportamiento. Queda como primer punto de la
Fase 1.

### 2.8 Scripts de npm

```json
"start":              "node server.js"
"check":              "node --check server.js"
"test":               "node test/architecture.test.js"
"migrate:legacy:dry": "node scripts/migrate-legacy.js"
"migrate:legacy":     "node scripts/migrate-legacy.js --execute"
```

### 2.9 Variables de entorno

Presentes en `.env`:

| Variable | Obligatoria | Notas |
|---|---|---|
| `MONGO_URI_MULTIQUINIELA` | Sí | Sin ella el proceso termina con `exit(1)` |
| `SESSION_SECRET` | Sí en producción | En desarrollo usa `'solo-desarrollo-cambiar'` |
| `APIFOOTBALL_COM_KEY` | Sí para sincronizar | Sin ella las rutas de fútbol devuelven 500 |
| `PORT` | No | Por defecto 3000 |
| `NODE_EN` | — | ⚠️ **ERRATA**: debe ser `NODE_ENV` (ver hallazgo S-01) |

Variables que el código espera pero no están en `.env` (solo se usan al migrar):
`MONGO_URI_LEGACY_READONLY`, `LEGACY_DB_NAME`, `TARGET_DB_NAME`,
`MIGRATION_OWNER_EMAIL`, `MIGRATION_POOL_NAME`.

⚠️ **`.env.example` fue eliminado del árbol de trabajo** (aparece como ` D` en
`git status`) pero sigue en el último commit. Como el README manda copiarlo, hay
que restaurarlo o actualizar el README.

---

## 3. Arquitectura actual

### 3.1 Panorama

```
Navegador (HTML + JS puro, sin framework)
        │  fetch() con cookies de sesión
        ▼
Express 4  ── server.js (monolito de 3.584 líneas)
        │
        ├── cors (lista blanca de orígenes)
        ├── express.json() + bodyParser.json({limit:'10kb'})
        ├── express-session ── connect-mongo (colección `sesiones`, TTL 14 días)
        ├── guardia de páginas admin (solo verifica sesión, no rol)
        ├── AUTO-SYNC GLOBAL  ← se dispara en casi toda petición
        ├── express.static('public') + rutas /js/:f y /css/:f
        ├── rutas de cuenta y quiniela (fuera del contexto de inquilino)
        ├── MIDDLEWARE DE INQUILINO ── AsyncLocalStorage { quinielaId }
        ├── guardia /api (sesión + quiniela activa + solo-lectura si archivada)
        ├── ~70 rutas de dominio
        └── manejador global de errores
        │
        ▼
MongoDB (Mongoose 8)          APIFootball v3 (apiv3.apifootball.com)
```

### 3.2 Orden del pipeline de middleware

El orden importa mucho y tiene consecuencias:

| # | Línea | Middleware | Observación |
|---|---:|---|---|
| 1 | 22 | `trust proxy` si producción | Nunca se activa por la errata `NODE_EN` |
| 2 | 39 | CORS | Lista blanca apunta al dominio **anterior** |
| 3 | 60 | `express.json()` | Límite por defecto de 100 KB |
| 4 | 61 | `bodyParser.json({limit:'10kb'})` | **Inútil**: el anterior ya consumió el cuerpo |
| 5 | 63 | `express-session` | Cookie `httpOnly`, `sameSite:'strict'`, `secure` solo en producción |
| 6 | 119 | Guardia de `paginasAdmin` | Solo redirige si no hay sesión; **no verifica rol** |
| 7 | 132 | Auto-sync global | Ver §9.3 — el mayor problema de escala |
| 8 | 167 | `/logout`, `/check-auth` | Fuera del contexto de inquilino |
| 9 | 180 | `express.static('public')` | Sirve todos los HTML |
| 10 | 182 | `/js/:filename`, `/css/:filename` | Sin verificación de sesión |
| 11 | 526 | Rutas de cuenta y quinielas | Registro, login, crear/unirse/seleccionar |
| 12 | 677 | **Middleware de inquilino** | Resuelve membresía + quiniela, abre `AsyncLocalStorage` |
| 13 | 710 | Guardia `/api` | Exige sesión + quiniela activa; bloquea escrituras si archivada |
| 14 | 723+ | Rutas de dominio | Todo lo demás |
| 15 | 3564 | Manejador de errores | Traduce 11000 a 409, resto a 500 |

### 3.3 Trabajos en segundo plano

| Job | Disparo | Alcance |
|---|---|---|
| `sincronizarTodasLasJornadasDesdeApi()` | Middleware, si pasaron ≥30 s desde la última | Todas las quinielas del sistema |
| `resolverTriviasPendientes()` | `setInterval` cada 5 min + al final de cada sync | Sin contexto de inquilino → global |

Ambos son **jobs dentro del proceso web**. En cuanto haya más de una instancia
(escalado horizontal), se duplican y compiten entre sí.

---

## 4. Modelo de datos MongoDB

### 4.1 Colecciones de plataforma (sin `quinielaId`)

#### `usuarios` — modelo `Usuario`

| Campo | Tipo | Restricciones |
|---|---|---|
| `username` | String | requerido, único, `trim` |
| `usernameNormalizado` | String | requerido, único, indexado (minúsculas) |
| `email` | String | requerido, único, `trim` |
| `emailNormalizado` | String | requerido, único, indexado (minúsculas) |
| `password` | String | requerido, hash bcrypt |
| `emailVerificado` | Boolean | por defecto `false` |
| `tokenVerificacion` | String | por defecto `null` — **modelo preparado, flujo no implementado** |
| `expiracionTokenVerificacion` | Date | por defecto `null` — ídem |
| `activo` | Boolean | por defecto `true` |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

#### `quinielas` — modelo `Quiniela`

| Campo | Tipo | Restricciones |
|---|---|---|
| `nombre` | String | requerido, `trim`, 3–80 caracteres (validado en la ruta) |
| `codigoIngreso` | String | requerido, único, indexado. 10 hex en mayúsculas |
| `propietarioId` | ObjectId → `Usuario` | requerido |
| `estado` | enum | `activa` \| `archivada` \| `eliminada` |
| `eliminadaEn` | Date | marca de borrado lógico |
| `configuracion.puntuacion.marcadorExacto` | Number | por defecto 5, min 0 |
| `configuracion.puntuacion.resultadoCorrecto` | Number | por defecto 3, min 0 |
| `configuracion.puntuacion.comodinExacto` | Number | por defecto 7, min 0 |
| `configuracion.puntuacion.comodinResultado` | Number | por defecto 4, min 0 |
| `configuracion.puntuacion.campeon` | Number | por defecto 20, min 0 |
| `configuracion.puntuacion.triviasHabilitadas` | Boolean | por defecto `true` |
| `configuracion.puntuacion.puntosTriviaDefault` | Number | por defecto 1, min 0 |
| `configuracion.incluirExpulsadosEnRanking` | Boolean | por defecto `true` |

#### `membresias` — modelo `Membresia`

| Campo | Tipo | Restricciones |
|---|---|---|
| `quinielaId` | ObjectId → `Quiniela` | requerido, indexado |
| `usuarioId` | ObjectId → `Usuario` | requerido, indexado |
| `rol` | enum | `propietario` \| `admin` \| `user` |
| `estado` | enum | `pendiente_ingreso` \| `activo` \| `pendiente_retiro` \| `rechazado` \| `expulsado` |
| `solicitadoEn` | Date | por defecto ahora |
| `aprobadoEn` | Date | |
| `retiradoEn` | Date | |

Índice único compuesto: `{ quinielaId: 1, usuarioId: 1 }`

#### `sesiones`

Gestionada por `connect-mongo`. TTL de 14 días.

### 4.2 Colecciones de dominio (todas con `quinielaId`)

Estas nueve reciben `quinielaId` automáticamente a través de `tenantPlugin`.

#### `jugadors` — modelo `Jugador`

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | String | requerido |
| `usuarioId` | ObjectId → `Usuario` | vínculo con la cuenta |
| `password` | String | **campo muerto**: heredado del modelo anterior |
| `quinielaId` | ObjectId | inyectado |

Índice único: `{ quinielaId: 1, nombre: 1 }`

Se rellena automáticamente al aprobar una membresía (`.../aprobar`). Sirve como
registro de **jugadores históricos** para que las tablas sigan mostrando a quien
ya no es miembro.

#### `jornadas` — modelo `Jornada`

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | String | clave de negocio |
| `partidos[]` | Array de subdocumentos | |
| `partidos[].equipo1` / `equipo2` | String | |
| `partidos[].logoEquipo1` / `logoEquipo2` | String | URL del escudo |
| `partidos[].comodin` | Boolean | duplica valor de puntos |
| `partidos[].apiFixtureId` | String | id del partido en APIFootball |
| `partidos[].apiLeagueId` | String | id de liga |
| `partidos[].apiDate` | String | `"YYYY-MM-DD HH:mm"`, hora de Costa Rica |
| `partidos[].apiStatus` | String | estado crudo del API |
| `fechaCierre` | Date | opcional |

Índice único: `{ quinielaId: 1, nombre: 1 }`

⚠️ **El orden del array `partidos` es la clave primaria de facto.** Los pronósticos,
resultados oficiales y trivias se enlazan por **índice de posición**. Reordenar o
borrar un partido a mitad de jornada desalinea todo.

#### `resultados` — modelo `Resultado` (pronósticos de jugadores)

| Campo | Tipo | Notas |
|---|---|---|
| `jugador` | String | **nombre de usuario, no ObjectId** |
| `jornada` | String | **nombre de jornada, no ObjectId** |
| `pronosticos[].equipo1` / `equipo2` | String | copia denormalizada |
| `pronosticos[].marcador1` / `marcador2` | Number | `null` si no pronosticó |

Índice único: `{ quinielaId: 1, jugador: 1, jornada: 1 }`

#### `resultadooficials` — modelo `ResultadoOficial`

| Campo | Tipo | Notas |
|---|---|---|
| `jornada` | String | |
| `resultados[].equipo1` / `equipo2` | String | |
| `resultados[].logoEquipo1` / `logoEquipo2` | String | |
| `resultados[].marcador1` / `marcador2` | Number | |
| `resultados[].comodin` | Boolean | |
| `resultados[].estado` | String | `PROGRAMADO` \| `LIVE` \| `MT` \| `TC` |
| `resultados[].minuto` | Mixed | número, `"45+"`, `"90+"` o `null` |
| `resultados[].fecha` | String | copia de `apiDate` |
| `resultados[].origen` | String | `api` \| `manual` |
| `resultados[].bloqueadoFinal` | Boolean | `true` cuando el partido terminó |
| `resultados[].actualizadoEn` | Date | |

Índice único: `{ quinielaId: 1, jornada: 1 }`

#### `trivias` — modelo `Trivia`

| Campo | Tipo | Notas |
|---|---|---|
| `jornadaNombre` | String | |
| `partidoIndex` | Number | posición en `jornada.partidos` |
| `apiFixtureId` | String | necesario para autorresolver |
| `equipo1` / `equipo2` | String | copia |
| `tipo` | String | una de las 8 claves de `TIPOS_TRIVIA` |
| `pregunta` | String | texto derivado del tipo |
| `opciones[]` | [String] | generadas por `opcionesTrivia()` |
| `puntos` | Number | por defecto 1, copiado de la configuración al crear |
| `fechaCierre` | Date | |
| `respuestaCorrecta` | String | vacío hasta resolverse |
| `resuelta` | Boolean | |
| `activa` | Boolean | |

⚠️ **Sin índices más allá de `quinielaId`.** Falta `{quinielaId, jornadaNombre, partidoIndex, tipo}`.

#### `respuestatrivias` — modelo `RespuestaTrivia`

| Campo | Tipo | Notas |
|---|---|---|
| `jugador` | String | nombre de usuario |
| `triviaId` | String | **string, no ObjectId con `ref`** |
| `respuesta` | String | |
| `puntos` | Number | 0 hasta resolverse |
| `fechaRespuesta` | Date | |

⚠️ **Sin índice único `{quinielaId, jugador, triviaId}`.** El `findOneAndUpdate`
con `upsert` puede duplicar bajo concurrencia → puntos dobles.

#### `equipos` — modelo `Equipo`

| Campo | Tipo |
|---|---|
| `nombre` | String requerido |

Índice único: `{ quinielaId: 1, nombre: 1 }`

#### `pronosticocampeons` — modelo `PronosticoCampeon`

| Campo | Tipo |
|---|---|
| `jugador` | String requerido |
| `usuarioId` | ObjectId → `Usuario` |
| `campeon` | String requerido |
| `fechaRegistro` | Date |

Índice único: `{ quinielaId: 1, jugador: 1 }`

#### `campeonoficials` — modelo `CampeonOficial`

| Campo | Tipo |
|---|---|
| `campeon` | String requerido |
| `puntos` | Number, por defecto 20 |

Un solo documento por quiniela (se usa `findOne({})` + `findOneAndUpdate({})`).

### 4.3 Diagrama de relaciones

```
Usuario ──1:N── Membresia ──N:1── Quiniela
   │                                  │
   │  (por username, string)          │  (por quinielaId, ObjectId)
   │                                  │
   └──> Jugador                       ├──> Jornada ──(por índice de array)──┐
   └──> Resultado.jugador             ├──> Resultado ────────────────────────┤
   └──> RespuestaTrivia.jugador       ├──> ResultadoOficial ─────────────────┤
   └──> PronosticoCampeon.jugador     ├──> Trivia ───────────────────────────┘
                                      ├──> RespuestaTrivia ──(por triviaId string)
                                      ├──> Equipo
                                      ├──> PronosticoCampeon
                                      └──> CampeonOficial
```

**Dos debilidades estructurales del modelo:**

1. **El vínculo con el jugador es por cadena de texto (`username`), no por
   `ObjectId`.** Si algún día se permite renombrar la cuenta, se rompen los
   pronósticos, respuestas de trivia, ranking e histórico de todas sus quinielas.
2. **El vínculo partido↔pronóstico↔resultado es por posición en el array.** No hay
   identidad estable del partido.

---

## 5. Multi-tenancy: aislamiento por quiniela

### 5.1 Mecanismo

```js
const tenantContext = new AsyncLocalStorage();

function tenantPlugin(schema) {
  schema.add({ quinielaId: { type: ObjectId, ref: 'Quiniela', required: true, index: true } });

  const aplicarFiltro = function (next) {
    const store = tenantContext.getStore();
    if (store?.quinielaId) this.where({ quinielaId: store.quinielaId });
    next();
  };

  schema.pre(/^find/, aplicarFiltro);          // find, findOne, findOneAndUpdate, findOneAndDelete…
  schema.pre('countDocuments', aplicarFiltro);
  schema.pre('deleteMany', aplicarFiltro);
  schema.pre('deleteOne', aplicarFiltro);
  schema.pre('updateMany', aplicarFiltro);
  schema.pre('updateOne', aplicarFiltro);

  schema.pre('validate', function (next) {     // asigna quinielaId al crear
    const store = tenantContext.getStore();
    if (!this.quinielaId && store?.quinielaId) this.quinielaId = store.quinielaId;
    next();
  });
}
```

El middleware de la línea 677 abre el contexto:

```js
tenantContext.run({ quinielaId: quiniela._id }, next);
```

**Es un buen diseño.** Cualquier consulta a los nueve modelos de dominio queda
filtrada automáticamente sin que el desarrollador tenga que acordarse de añadir
`quinielaId` a cada `find`.

### 5.2 Puerta de contexto interno

Para que el auto-sync pueda escribir en cualquier quiniela, existe una puerta trasera:

```js
if (req.get('x-internal-sync-token') === INTERNAL_SYNC_TOKEN &&
    mongoose.isValidObjectId(req.get('x-quiniela-id'))) {
  req.membership = { rol: 'admin', estado: 'activo', internal: true };
  return tenantContext.run({ quinielaId: quiniela._id }, next);
}
```

`INTERNAL_SYNC_TOKEN` es `crypto.randomBytes(32)` generado al arrancar el proceso.
Es seguro contra un atacante externo, pero acopla el diseño a un proceso único.

### 5.3 Fugas de aislamiento detectadas

**FUGA 1 — `resolverTriviasPendientes()` desde `setInterval` (línea 2846).**

El `setInterval` invoca la función **fuera de cualquier `tenantContext.run`**, así que
`tenantContext.getStore()` devuelve `undefined` y el filtro no se aplica:

```js
const trivias = await Trivia.find(filtro);                                  // TODAS las quinielas ✓ (intencional)
const oficial = await ResultadoOficial.findOne({ jornada: trivia.jornadaNombre }); // ✗ SIN FILTRO
```

Si dos quinielas tienen una jornada llamada `"Jornada1"` —lo cual será la norma—,
`findOne` devuelve el documento de **la primera quiniela que MongoDB encuentre**. La
trivia de la quiniela A puede resolverse (o quedarse sin resolver) según el estado del
partido de la quiniela B. Es un error de corrección real y silencioso.

**FUGA 2 — la misma función en la ruta de sync.** Cuando se llama desde
`/api/sync-resultados-oficiales/:jornada` sí hay contexto, así que ahí funciona bien.
El comportamiento por tanto es **inconsistente según la vía de entrada**.

**Corrección propuesta:** iterar quinielas y envolver cada una en su propio
`tenantContext.run({ quinielaId })`.

---

## 6. Autenticación, sesiones, roles y Admin Mode

### 6.1 Registro (`POST /api/auth/registro`)

Validaciones aplicadas:
- Los cuatro campos son obligatorios.
- `username`: `/^[a-zA-Z0-9_.-]{3,30}$/`
- `email`: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- `password`: mínimo 8 caracteres
- `password === confirmarPassword`
- Unicidad global de `usernameNormalizado` y `emailNormalizado`

Guarda hash bcrypt con `SALT_ROUNDS = 10` e **inicia sesión inmediatamente**
(`req.session.usuarioId = ...`).

⚠️ **No regenera la sesión tras el registro** (a diferencia del login), lo que deja
una ventana teórica de fijación de sesión.

### 6.2 Login (`POST /api/auth/login` y `POST /login`)

- Acepta `identificador`, `username` o `email` indistintamente.
- Busca por `$or: [usernameNormalizado, emailNormalizado]` con `activo: true`.
- Compara con `bcrypt.compare`.
- **Regenera la sesión** correctamente (previene fijación).
- Mensaje de error genérico: no revela si el usuario existe. ✓

⚠️ **Sin limitación de intentos.** Fuerza bruta libre.

### 6.3 Sesiones

```js
store:  connect-mongo, colección 'sesiones', ttl 14 días
resave: false
saveUninitialized: false
cookie: { secure: NODE_ENV==='production', sameSite:'strict', httpOnly:true, maxAge:14 días }
```

`sameSite: 'strict'` proporciona una protección CSRF razonable. `secure` depende de
`NODE_ENV`, que por la errata `NODE_EN` **nunca vale `'production'`** → la cookie se
enviaría por HTTP plano.

### 6.4 Roles por quiniela

| Rol | Puede |
|---|---|
| `propietario` | Todo lo de `admin` + transferir propiedad + eliminar la quiniela |
| `admin` | Aprobar/rechazar ingresos y retiros, expulsar, cambiar roles, archivar, configurar puntuación, gestionar jornadas/trivias/resultados |
| `user` | Pronosticar, responder trivias, elegir campeón, ver rankings |

**Invariantes protegidas en el código:**
- No se puede degradar al último administrador (`administradores <= 1` → 409).
- No se puede expulsar ni retirar al propietario.
- No se puede autoexpulsar.
- El propietario debe transferir antes de solicitar retiro.
- El nuevo propietario debe ser un `admin` activo.

Este conjunto de reglas está **bien implementado** y coincide con lo acordado en
`HANDOFF.md`.

### 6.5 Admin Mode (reautenticación)

Capa extra: tener rol de admin no basta; hay que reconfirmar la contraseña.

```
GET  /api/admin-mode            → { autorizadoPorRol, activo }
POST /api/admin-mode/activar    → verifica contraseña, guarda { quinielaId, verificadoEn }
POST /api/admin-mode/desactivar → borra la marca
```

`requireAdmin` exige que la marca exista, corresponda a **la quiniela activa** y tenga
**menos de 1 hora**. Al cambiar de quiniela (`/seleccionar`) se borra la marca. ✓

Es una buena decisión de seguridad, comparable a un "sudo mode".

### 6.6 Guardia de páginas administrativas

```js
app.use((req, res, next) => {
  if (paginasAdmin.includes(req.path)) {
    if (!req.session?.usuarioId) return res.redirect('/login.html');
  }
  next();
});
```

⚠️ Solo comprueba **sesión**, no rol. Cualquier usuario autenticado puede descargar
el HTML de `/jornadas.html`. No es una fuga de datos porque las APIs sí exigen
`requireAdmin`, pero es una filtración de superficie y una mala experiencia.

---

## 7. Mapa completo de endpoints

96 registros de `app.*` en total. 84 rutas concretas.

### 7.1 Autenticación y cuenta (sin contexto de quiniela)

| Método | Ruta | Guardia | Descripción |
|---|---|---|---|
| POST | `/api/auth/registro` | — | Crear cuenta e iniciar sesión |
| POST | `/api/auth/login` | — | Iniciar sesión |
| POST | `/login` | — | Alias heredado |
| POST | `/logout` | — | Destruir sesión |
| GET | `/check-auth` | — | `{ authenticated, quinielaActivaId }` |
| GET | `/api/auth/me` | `requireLogin` | Datos de la cuenta |

### 7.2 Gestión de quinielas

| Método | Ruta | Guardia | Descripción |
|---|---|---|---|
| GET | `/api/quinielas` | `requireLogin` | Mis quinielas y mi rol en cada una |
| POST | `/api/quinielas` | `requireLogin` | Crear quiniela (me hace propietario) |
| POST | `/api/quinielas/unirse` | `requireLogin` | Solicitar ingreso por código |
| POST | `/api/quinielas/:id/seleccionar` | `requireLogin` | Fijar quiniela activa en sesión |

### 7.3 Quiniela actual y membresías

| Método | Ruta | Guardia | Descripción |
|---|---|---|---|
| GET | `/api/quiniela-actual` | `/api` gate | Nombre, estado, rol, código, configuración |
| GET | `/api/admin-mode` | `/api` gate | Estado del modo administrador |
| POST | `/api/admin-mode/activar` | rol admin | Reautenticación |
| POST | `/api/admin-mode/desactivar` | `/api` gate | Salir del modo |
| GET | `/api/quiniela-actual/miembros` | `requireAdmin` | Lista de miembros |
| PATCH | `.../miembros/:id/aprobar` | `requireAdmin` | Aprobar ingreso + crear `Jugador` |
| PATCH | `.../miembros/:id/rechazar` | `requireAdmin` | Rechazar ingreso o retiro |
| PATCH | `.../miembros/:id/rol` | `requireAdmin` | Cambiar entre `admin` y `user` |
| PATCH | `.../miembros/:id/aprobar-retiro` | `requireAdmin` | Aprobar salida |
| PATCH | `.../miembros/:id/expulsar` | `requireAdmin` | Expulsar |
| POST | `/api/quiniela-actual/solicitar-retiro` | `/api` gate | Pedir salir |
| POST | `/api/quiniela-actual/transferir-propiedad` | `requireAdmin` + propietario | Transferir |
| PATCH | `/api/quiniela-actual/configuracion` | `requireAdmin` | Puntuación y opciones |
| PATCH | `/api/quiniela-actual/archivar` | `requireAdmin` | Archivar / restaurar |
| DELETE | `/api/quiniela-actual` | `requireAdmin` + propietario | Borrado lógico con confirmación textual |

### 7.4 Jugadores

| Método | Ruta | Guardia | Descripción |
|---|---|---|---|
| GET | `/api/jugadores` | `/api` gate | Miembros activos + históricos |
| POST | `/api/jugadores` | `requireAdmin` | **410 Gone** — obsoleto |
| DELETE | `/api/jugadores/:nombre` | `requireAdmin` | **410 Gone** — obsoleto |
| GET | `/api/jugador/:nombre` | `/api` gate | Solo la propia cuenta |
| POST | `/api/jugadores/:nombre/verificar-password` | `/api` gate | Solo la propia cuenta |
| POST | `/api/jugadores/:nombre/cambiar-password` | `/api` gate | Solo la propia cuenta |

### 7.5 Jornadas

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/jornadas` | `/api` gate |
| GET | `/api/jornadas/:nombre` | `/api` gate |
| POST | `/api/jornadas` | `requireAdmin` |
| POST | `/api/jornadas/importar-api` | `requireAdmin` |
| POST | `/api/jornadas/agregar-partido` | `requireAdmin` |
| POST | `/api/jornadas/eliminar-partidos` | `requireAdmin` |
| POST | `/api/jornadas/comodin` | `requireAdmin` |
| DELETE | `/api/jornadas/:nombre` | `requireAdmin` (borra en cascada pronósticos y oficiales) |

### 7.6 APIFootball

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/football/fixtures` | `/api` gate |
| GET | `/api/football/leagues` | `/api` gate |
| GET | `/api/football/leagues-test` | `/api` gate — **duplicado de la anterior** |
| POST | `/api/sync-resultados-oficiales/:jornada` | `requireAdmin` o token interno |

### 7.7 Pronósticos y resultados

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/resultados` | `/api` gate — filtra por privacidad |
| POST | `/api/resultados` | `/api` gate — solo los propios, respeta bloqueo por inicio |
| POST | `/api/admin/resultados` | `requireAdmin` — sin bloqueo |
| GET | `/api/resultados/:jugador/:jornada` | `/api` gate — privacidad hasta cierre |
| GET | `/api/resultados-con-equipos/:jugador/:jornada` | `/api` gate |
| POST | `/api/resultados-seguros/:jugador/:jornada` | `/api` gate — pide contraseña |
| GET | `/api/resultados-oficiales` | `/api` gate |
| POST | `/api/resultados-oficiales` | `requireAdmin` — marca `origen:'manual'` |
| GET | `/api/resultados-oficiales/:jornada` | `/api` gate |
| GET | `/api/resultados-totales` | `/api` gate — ranking completo |

### 7.8 Trivias

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/tipos-trivia` | `/api` gate |
| POST | `/api/admin/trivias` | `requireAdmin` |
| GET | `/api/admin/trivias/:jornadaNombre` | `requireAdmin` |
| PUT | `/api/admin/trivias/:jornadaNombre` | `requireAdmin` — reconciliación completa |
| DELETE | `/api/admin/trivias/:triviaId` | `requireAdmin` |
| POST | `/api/admin/trivias/resolver` | `requireAdmin` |
| GET | `/api/admin/respuestas-trivias-jornada/:jornadaNombre` | `requireAdmin` |
| GET | `/api/trivias` | `/api` gate |
| GET | `/api/trivias/activas` | `/api` gate |
| GET | `/api/trivias/latest` | `/api` gate |
| GET | `/api/trivias/:jornadaNombre` | `/api` gate |
| GET | `/api/trivias-jornadas` | `/api` gate |
| GET | `/api/respuestas-trivia/:jugador/:jornadaNombre` | `/api` gate |
| POST | `/api/respuestas-trivia` | `/api` gate |
| GET | `/api/resultados-trivias/:jornadaNombre` | `/api` gate |

⚠️ **Colisión de rutas:** `/api/trivias/activas` y `/api/trivias/latest` están
registradas **antes** de `/api/trivias/:jornadaNombre`, así que funcionan. Pero es
frágil: una jornada llamada literalmente `"activas"` sería inalcanzable.

### 7.9 Equipos y campeón

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/equipos` | `/api` gate |
| POST | `/actualizar-equipos` | `requireAdmin` |
| GET | `/api/equipos-mundial` | `/api` gate — **lista de 48 selecciones incrustada en el código** |
| GET | `/api/pronostico-campeon/:jugador` | `/api` gate |
| POST | `/api/pronostico-campeon` | `/api` gate — exige contraseña, cierra con `Jornada1` |
| GET | `/api/pronosticos-campeon-publicos` | `/api` gate |
| GET | `/api/pronosticos-campeon` | `requireAdmin` |
| GET | `/api/campeon-oficial` | `/api` gate |
| POST | `/api/campeon-oficial` | `requireAdmin` |

### 7.10 Depuración (todas con `requireAdmin`)

| Método | Ruta |
|---|---|
| GET | `/api/debug/estado-partido/:status` |
| GET | `/api/debug/api-football-match/:matchId` |
| GET | `/api/debug/jornadas` |
| GET | `/debug/trivia-goles/:matchId` |
| GET | `/api/admin/debug-partido-api/:matchId` |

`/debug/trivia-goles/:matchId` **no está bajo `/api`**, así que se salta el guardia
de quiniela activa; solo depende de `requireAdmin`, que a su vez depende de
`req.membership`. Sin quiniela activa `req.membership` es `undefined` → 403. Funciona,
pero por accidente.

---

## 8. Motor de puntuación

Implementado íntegramente en `GET /api/resultados-totales` (líneas 3299–3422).

### 8.1 Reglas

Por cada partido de cada jornada, comparando el pronóstico del jugador con el
resultado oficial **en la misma posición del array**:

| Condición | Puntos |
|---|---|
| Marcador exacto, partido normal | `configuracion.puntuacion.marcadorExacto` (5) |
| Marcador exacto, comodín | `configuracion.puntuacion.comodinExacto` (7) |
| Solo acierta el signo (ganó/perdió/empató), normal | `configuracion.puntuacion.resultadoCorrecto` (3) |
| Solo acierta el signo, comodín | `configuracion.puntuacion.comodinResultado` (4) |
| Cualquier marcador no numérico | 0 (se omite el partido) |

Más dos bloques adicionales:

- **Campeón Mundial:** si `PronosticoCampeon.campeon` coincide (sin distinguir
  mayúsculas ni espacios) con `CampeonOficial.campeon`, suma `campeonOficial.puntos`
  (que se fijó al guardar el campeón oficial desde la configuración).
- **Trivias:** suma de `RespuestaTrivia.puntos` de todas las respuestas del jugador.

### 8.2 Forma de la respuesta

```json
{
  "Marco":  { "Campeón Mundial": 20, "Trivias": 3, "Jornada1": 12, "Jornada2": 8, "total": 43 },
  "Andrea": { "Campeón Mundial": 0,  "Trivias": 5, "Jornada1": 9,  "Jornada2": 15, "total": 29 }
}
```

### 8.3 Problemas del motor

| # | Problema | Impacto |
|---|---|---|
| P-1 | Lee **seis colecciones completas** sin proyección ni paginación en cada petición | Con 10.000 pronósticos ya se nota; con 100.000 es inviable |
| P-2 | Recalcula desde cero cada vez; sin caché ni materialización | CPU desperdiciada; la tabla general es la pantalla más visitada |
| P-3 | Empareja pronóstico y oficial por **índice de array** | Si el admin borra un partido a mitad de jornada, todos los puntos se desalinean silenciosamente |
| P-4 | Los puntos de trivia se suman de `RespuestaTrivia` global del jugador, no por jornada | La columna "Trivias" es un único total, no se puede desglosar |
| P-5 | Si se cambia la configuración de puntuación, **todo el histórico se recalcula** con los valores nuevos | Cambiar `marcadorExacto` a mitad de temporada reescribe el pasado |
| P-6 | Los puntos de trivia sí quedan congelados en `RespuestaTrivia.puntos` | Inconsistente con P-5: unos puntos son históricos y otros no |

**P-5 y P-6 juntos son una incoherencia de diseño que hay que resolver antes de
crecer**: o todo se congela al cerrar la jornada, o todo se recalcula.

---

## 9. Integración con APIFootball

Proveedor: `https://apiv3.apifootball.com/` (no confundir con `api-sports.io`, cuyo
cliente está comentado en las líneas 200–207).

### 9.1 Acciones usadas

| Acción | Uso |
|---|---|
| `get_events` con `from`/`to` (+ `league_id`) | Buscar partidos para importar |
| `get_events` con `match_id` | Consultar un partido concreto |
| `get_leagues` | Listar ligas |

Zona horaria fijada a `America/Costa_Rica` en la mayoría de llamadas.

### 9.2 Normalización de estados — `obtenerEstadoPartido()`

| Estado crudo del API | Estado interno | Minuto |
|---|---|---|
| `finished`, `ft`, `after pen.`, `after et`, `awarded`, `penalties` | `TC` | `null` |
| `half time`, `halftime`, `ht` | `MT` | `null` |
| `45+…` | `LIVE` | `"45+"` |
| `90+…` | `LIVE` | `"90+"` |
| Número ≥ 90 | `LIVE` | `"90+"` |
| Número | `LIVE` | ese número |
| Cualquier otra cosa | `PROGRAMADO` | `null` |

⚠️ La rama `if (minuto >= 45 && minuto < 46)` es **código muerto**: `estadoRaw` ya pasó
`/^\d+$/`, así que `minuto` es entero y la única forma de entrar sería `minuto === 45`,
que es correcto pero el rango sobra y confunde.

### 9.3 Marcador a 90 minutos — `obtenerMarcador90Minutos()`

Lógica en cascada, pensada para que un partido decidido en penales no altere el
pronóstico del tiempo reglamentario:

1. Si el partido está `LIVE` o `MT` → marcador en vivo directo.
2. Si existen `match_hometeam_ft_score` y `match_awayteam_ft_score` → usarlos.
3. Si no, reconstruir desde `goalscorer[]`, **descartando** goles con
   `score_info_time === 'penalty'` o que contengan `'extra time'`, y tomar el
   `score` del último gol regular.
4. Como último recurso, el marcador actual.

Es una solución bien pensada al problema real de las eliminatorias.

### 9.4 El auto-sync global — EL PROBLEMA DE ESCALA

```js
let ultimaSyncGlobal = 0;
let syncEnProceso = false;

app.use((req, res, next) => {
  const CINCO_MINUTOS = 1 * 30 * 1000;   // ← en realidad son 30 SEGUNDOS
  if (esArchivoEstatico) return next();
  if (!syncEnProceso && Date.now() - ultimaSyncGlobal > CINCO_MINUTOS) {
    syncEnProceso = true;
    ultimaSyncGlobal = Date.now();
    sincronizarTodasLasJornadasDesdeApi().finally(() => { syncEnProceso = false; });
  }
  next();
});
```

Y la función:

```js
async function sincronizarTodasLasJornadasDesdeApi() {
  const jornadas = await Jornada.find({ 'partidos.apiFixtureId': { $exists: true, $ne: '' } });
  for (const jornada of jornadas) {
    await axios.post(`http://localhost:${PORT}/api/sync-resultados-oficiales/${jornada.nombre}`,
      {}, { headers: { 'x-internal-sync-token': …, 'x-quiniela-id': jornada.quinielaId } });
  }
}
```

Y dentro de cada sync, **una llamada a APIFootball por partido** (a veces dos, si hay
que recurrir al fallback por fecha y equipos).

**Cálculo del costo:**

| Escala | Jornadas con `apiFixtureId` | Partidos | Llamadas a APIFootball cada 30 s | Por hora |
|---|---:|---:|---:|---:|
| Hoy (1 quiniela) | 3 | 30 | 30 | 3.600 |
| 20 quinielas | 60 | 600 | 600 | 72.000 |
| 100 quinielas | 300 | 3.000 | 3.000 | 360.000 |
| 1.000 quinielas | 3.000 | 30.000 | 30.000 | 3.600.000 |

Los planes típicos de APIFootball rondan las 30.000 peticiones **al mes**. Con
20 quinielas la cuota se agota en menos de media hora.

**Problemas adicionales del diseño:**

- Se ejecuta **dentro del proceso web**: bloquea el event loop con I/O masivo.
- Se autollama por HTTP a `localhost`, pagando serialización, TCP y todo el pipeline
  de Express por cada jornada, cuando podría ser una llamada de función directa.
- No distingue entre jornadas **cuyos partidos ya terminaron** (`TC` en todos) y
  jornadas en curso. Resincroniza partidos de hace tres meses eternamente.
- No distingue entre quinielas **activas** y **archivadas/eliminadas**.
- Es un `for` secuencial: un timeout de APIFootball retrasa todas las jornadas
  siguientes.
- `syncEnProceso` es una variable en memoria: con dos instancias, dos syncs
  simultáneos.
- El nombre de la constante (`CINCO_MINUTOS`) miente sobre su valor (30 s).

**Rediseño necesario (detallado en §16):** planificador desacoplado, agrupación de
partidos por `apiFixtureId` para deduplicar entre quinielas, y ventanas de
sincronización basadas en la hora real de los partidos.

---

## 10. Sistema de trivias

### 10.1 Los ocho tipos

| Clave | Pregunta | Opciones generadas |
|---|---|---|
| `primer_gol` | ¿Qué equipo anota primero? | equipo1, equipo2, "Nadie anotará" |
| `mas_amarillas` | ¿Qué equipo tendrá más tarjetas amarillas? | equipo1, equipo2, "Empate", "No habrá tarjetas amarillas" |
| `mas_rojas` | ¿Qué equipo tendrá más tarjetas rojas? | equipo1, equipo2, "Empate", "No habrá tarjetas rojas" |
| `ambos_anotan` | ¿Ambos equipos anotan? | Sí / No |
| `gol_primer_tiempo` | ¿Habrá gol en el primer tiempo? | Sí / No |
| `gol_segundo_tiempo` | ¿Habrá gol en el segundo tiempo? | Sí / No |
| `hubo_tiempo_extra` | ¿Habrá tiempo extra? | Sí / No |
| `hubo_penales` | ¿Habrá penales? | Sí / No |

### 10.2 Autorresolución

`resolverTriviasPendientes()` se ejecuta cada 5 minutos y al final de cada sync.
Para cada trivia activa, no resuelta, con `fechaCierre` pasada:

1. Exige `apiFixtureId`.
2. Exige que el `ResultadoOficial` del partido esté en estado `TC`.
3. Descarga el evento completo de APIFootball.
4. Calcula la respuesta con `resolverRespuestaTrivia()`.
5. Marca `resuelta = true` y guarda `respuestaCorrecta`.
6. Recorre las `RespuestaTrivia` y asigna `puntos` (todo o nada).

**Detalles finos bien resueltos:**

- `esGolApiFootball()` descarta goles anulados: `info` que contenga `cancel`,
  `disallow` o `var`, y penales de tanda (`score_info_time === 'penalty'`).
- Detecta si el API devuelve los equipos invertidos (`apiInvertido`) comparando
  nombres normalizados, y corrige la asignación.
- Para amarillas usa `cards[]` y, si sale 0-0, cae a `statistics[]` buscando
  `"yellow cards"`.
- `minutoApiFootball()` convierte `"45+2"` en `45.2` para poder ordenar y separar
  primer tiempo (`≤ 45.99`) de segundo (`≥ 46`).

**Puntos débiles:**

- Si el API nunca devuelve datos utilizables, la trivia queda `resuelta: false`
  para siempre y **nadie recibe puntos**. No hay resolución manual de respaldo ni
  alerta.
- La resolución es **todo o nada**, sin puntuación parcial.
- El filtro `info.includes('var')` es demasiado amplio: un anotador llamado
  "Varela" o "Varane" hace que su gol se descarte. Bug real y sutil.
- El bucle guarda cada `RespuestaTrivia` de una en una (`await respuesta.save()`)
  en vez de un `bulkWrite`.

### 10.3 Cierre de trivias

Doble mecanismo:

- `fechaCierre` explícita (una sola por jornada, se aplica a todas sus trivias).
- `partidoYaInicio(partido, oficial)`: bloquea si el estado oficial es `LIVE`/`MT`/`TC`
  o si `apiDate` ya pasó.

La ruta `POST /api/respuestas-trivia` valida el segundo mecanismo por cada respuesta
enviada, con **una consulta de `Jornada` y otra de `ResultadoOficial` por respuesta**
(problema N+1).

### 10.4 Reconciliación (`PUT /api/admin/trivias/:jornadaNombre`)

Recibe la configuración completa deseada y:
- Borra las trivias que ya no están seleccionadas, **junto con sus respuestas**.
- Actualiza `fechaCierre` de las que siguen.
- Si la fecha cambió, **reabre la trivia** (`resuelta = false`, respuesta vacía) y
  **pone a cero los puntos de todas las respuestas**.
- Crea las nuevas.

Es correcto pero destructivo: borrar una trivia elimina respuestas ya puntuadas sin
confirmación ni registro de auditoría.

---

## 11. Frontend

### 11.1 Enfoque

HTML servido estáticamente + un archivo JS por página, sin framework, sin bundler,
sin sistema de plantillas. Cada página repite su propia navegación y su propio
`fetch` de contexto.

### 11.2 Patrón de arranque

Casi todas las páginas hacen:

```js
const contexto = await fetch('/api/quiniela-actual');
if (contexto.status === 401) return window.location.href = '/login.html';
if (contexto.status === 409) return window.location.href = '/quinielas.html';
```

Es un patrón coherente y correcto, pero **está copiado y pegado en ~25 archivos**.

### 11.3 Página principal (`index.html`)

- Renombra el `<h1>` con el nombre de la quiniela activa.
- Muestra la tarjeta "Admin mode" solo si el rol es `propietario` o `admin`.
- Muestra "Llenar Trivia" solo si `/api/trivias/activas` devuelve algo.
- Rotador entre "Top 3 Ranking" (`index-ranking.js`) y "Partidos en vivo"
  (`index-live.js`).
- Navegación inferior fija de 4 elementos.

### 11.4 Riesgos del frontend

| # | Riesgo |
|---|---|
| F-1 | **XSS**: solo `quinielas.js` escapa la salida. El resto usa `innerHTML` con datos del servidor sin escapar. Nombres de equipo, de jugador o de quiniela son vectores |
| F-2 | Toda la autorización visual es del lado del cliente (`style.display`). Correcto para UX, pero se acompaña —bien— de guardias en el servidor |
| F-3 | Sin caché de peticiones: `index.html` dispara 3+ `fetch` al cargar |
| F-4 | Sin estados de carga ni de error consistentes |
| F-5 | Sin control de versiones de assets: un cambio en `styles.css` no invalida caché |
| F-6 | `private/js/` sugiere privacidad que no existe. La ruta `/js/:filename` no valida sesión |
| F-7 | `GET /js/:filename` y `/css/:filename` construyen la ruta con `path.join(__dirname, 'private', 'js', req.params.filename)`. Express decodifica el parámetro, pero al ser un solo segmento no puede contener `/`. **No es explotable**, aunque conviene añadir una lista blanca por robustez |

---

## 12. Migración desde la base anterior

`scripts/migrate-legacy.js` (101 líneas).

### 12.1 Salvaguardas

- **Simulación por defecto.** Solo escribe con `--execute`.
- Exige `LEGACY_DB_NAME !== TARGET_DB_NAME`.
- Exige `MONGO_URI_LEGACY_READONLY !== MONGO_URI_MULTIQUINIELA`.
- Abre el origen con `readPreference: 'secondaryPreferred'`.
- Exige que el propietario **ya esté registrado** en la base nueva.
- Idempotente: usa `marcadorMigracion` en la quiniela y `legacyId` en cada documento
  con `upsert`, así que repetirlo no duplica.

### 12.2 Qué copia

Las nueve colecciones de dominio: `jugadors`, `jornadas`, `resultados`,
`resultadooficials`, `trivias`, `respuestatrivias`, `equipos`, `pronosticocampeons`,
`campeonoficials`.

Cada documento recibe `quinielaId`, `legacyId` y `migratedAt`; se descarta el `_id`
original.

### 12.3 Limitaciones conocidas

- Los jugadores históricos **no tienen cuenta**. Quedan solo como nombres. El propio
  script lo advierte por consola. Hace falta un flujo posterior de vinculación
  nombre→cuenta.
- No verifica que la quiniela destino no exista con otro `marcadorMigracion`.
- No hay reversión.

### 12.4 Estado

**No se ha ejecutado.** `HANDOFF.md` es explícito: la base original nunca ha sido
conectada ni modificada.

---

## 13. Pruebas y verificación

### 13.1 Suite actual

`npm test` → 6 pruebas, todas pasan (verificado el 14 de agosto de 2026):

```
✔ el servidor solo acepta la URI multi-quiniela
✔ los modelos deportivos reciben aislamiento por quiniela
✔ existen las rutas principales de cuenta y membresía
✔ el modo administrador exige rol y confirmación de contraseña
✔ la migración es simulación por defecto y separa origen de destino
✔ todas las referencias locales JS y CSS de HTML existen
ℹ tests 6  ℹ pass 6  ℹ fail 0  ℹ duration_ms 28.98
```

### 13.2 Naturaleza de las pruebas

Cinco de las seis son **expresiones regulares sobre el texto de `server.js` y
`migrate-legacy.js`**. Son guardarraíles útiles contra regresiones arquitectónicas
(por ejemplo, que alguien vuelva a añadir el fallback a `MONGO_URI`), pero **no
ejercitan una sola línea de código en ejecución**.

La sexta sí es útil de verdad: verifica que ningún HTML referencia un `.js` o `.css`
inexistente.

### 13.3 Cobertura ausente

- Cero pruebas de integración HTTP.
- Cero pruebas del motor de puntuación (lo más crítico del negocio).
- Cero pruebas del aislamiento multi-inquilino en ejecución.
- Cero pruebas de la normalización de estados y marcadores de APIFootball.
- Cero pruebas de la autorresolución de trivias.
- Cero pruebas de las invariantes de roles.

**El motor de puntuación y el aislamiento por quiniela son los dos lugares donde un
error silencioso destruye la confianza de los usuarios. Ambos están sin probar.**

---

## 14. Estado de Git y cambios sin confirmar

### 14.1 Historial

Al **16 de agosto de 2026**, rama `fase-0-higiene`:

```
c17d131  Fase 0: higiene previa al trabajo de escalado
05a8054  Completar el flujo de Admin Mode en la interfaz
04f6de0  Dejar de rastrear node_modules
f92462b  Implementar arquitectura multi-quiniela
c0d2ad1  Version inicial basada en quiniela mundialista
```

Árbol de trabajo **limpio**. La rama `fase-0-higiene` está lista para fusionarse a
`main` (`git checkout main && git merge fase-0-higiene`).

### 14.2 `node_modules` estaba versionado — hallazgo de la Fase 0

Descubierto al preparar el primer commit: **2.531 de los 2.615 archivos rastreados
eran `node_modules`**, el 97 % del repositorio. Estaba listado en `.gitignore`, pero
la regla no le aplicaba porque los archivos ya estaban versionados desde antes de
que ese `.gitignore` existiera — Git ignora únicamente lo que aún no rastrea.

No era solo ruido: `bcrypt` y `canvas` son módulos nativos, así que el repositorio
llevaba binarios compilados para Windows que **habrían roto un despliegue en Linux**
en lugar de acelerarlo. Corregido con `git rm -r --cached node_modules`; los archivos
siguen en disco y la instalación reproducible ya la garantizaba `package-lock.json`.

### 14.3 Contenido de los cambios que estaban sin confirmar (histórico)

> Confirmados el 16 de agosto de 2026 en el commit `05a8054`. Se conserva la tabla
> como registro de qué contenía aquel trabajo pendiente.

Todos pertenecen a **una misma unidad de trabajo: terminar el flujo de Admin Mode
en la interfaz.**

| Archivo | Cambio |
|---|---|
| `server.js` | +48/−3. Endpoints `/api/admin-mode`, `/activar`, `/desactivar`; `requireAdmin` pasa a exigir la marca de sesión con caducidad de 1 h |
| `public/adminmode.html` | Nueva sección `#admin-login` con formulario de contraseña; botón "Salir de Admin mode" |
| `private/js/adminmode.js` | Máquina de estados de 3 vistas (invitado / pedir contraseña / panel); redirige a `/index.html` si no es admin |
| `public/index.html` | +6. Tarjeta "Admin mode" visible solo para propietario/admin |
| `test/architecture.test.js` | +7. Prueba nueva que fija las invariantes del Admin Mode |
| `.env.example` | **Eliminado** — ⚠️ el README todavía manda copiarlo |

**Valoración:** el trabajo está completo y coherente, las pruebas pasan.
**Recomendación:** restaurar `.env.example` y confirmar todo en un commit.

---

## 15. Hallazgos clasificados por severidad

### 🔴 Críticos — bloquean el crecimiento

| ID | Hallazgo | Ubicación | Efecto |
|---|---|---|---|
| **C-01** | El auto-sync consulta APIFootball una vez por partido de **todo el sistema** cada 30 s | `server.js:132-163`, `1350-1371`, `1489-1656` | Cuota del proveedor agotada con ~20 quinielas; saturación del proceso web |
| **C-02** | `resolverTriviasPendientes()` desde `setInterval` corre **sin contexto de inquilino** y consulta `ResultadoOficial` sin filtrar por quiniela | `server.js:2781-2833`, `2846-2850` | Fuga entre quinielas: trivias resueltas con datos de otra quiniela cuando comparten nombre de jornada |
| **C-03** | `/api/resultados-totales` lee 6 colecciones completas y recalcula todo el ranking en cada petición | `server.js:3299-3422` | Latencia creciente y consumo de memoria proporcional al histórico total |
| **C-04** | `server.js` monolítico de 3.584 líneas con 96 handlers | todo el archivo | Cada cambio es riesgoso; imposible dividir el trabajo entre varias personas |
| **C-05** | Los jobs viven dentro del proceso web con estado en variables de módulo (`ultimaSyncGlobal`, `syncEnProceso`) | `server.js:129-130` | Impide el escalado horizontal: N instancias = N syncs simultáneos |
| **C-06** | La base vive en un clúster **MongoDB Atlas M0 gratuito**, que Atlas **pausa automáticamente** tras un periodo de inactividad | infraestructura | La aplicación queda muerta sola, sin aviso y sin recuperación. Detectado en producción el 16-ago-2026, ver bitácora 004 |

> **Nota sobre las referencias de línea:** los números de `server.js` de estas tablas
> corresponden al estado analizado el 14 de agosto de 2026 (commit `f92462b`).
> Tras la Fase 0 están desplazados unas pocas líneas en la zona de cabecera del
> archivo. El resto de las referencias sigue siendo válido.

### 🟠 Altos — corregir antes de abrir al público

| ID | Hallazgo | Ubicación | Efecto |
|---|---|---|---|
| **S-01** | `.env` define `NODE_EN` en lugar de `NODE_ENV` | `.env` | `trust proxy` desactivado, cookie **sin `secure`**, `SESSION_SECRET` no obligatorio. Las cookies de sesión viajarían en claro tras un proxy TLS |
| **S-02** | Sin limitación de intentos en `/api/auth/login`, `/login`, `/api/auth/registro` ni `/api/admin-mode/activar` | rutas de auth | Fuerza bruta sin fricción, incluso contra el Admin Mode |
| **S-03** | Sin `helmet` ni cabeceras de seguridad (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`) | ausente | Superficie de XSS y clickjacking innecesaria |
| **S-04** | XSS potencial: el frontend inyecta datos del servidor con `innerHTML` sin escapar (salvo `quinielas.js`) | `private/js/*.js` | Un nombre de equipo o de quiniela con `<script>` se ejecuta en el navegador de otros |
| **S-05** | La lista blanca de CORS apunta al dominio **anterior** (`quinieladeportivamundialista.onrender.com`) y acepta `origin` nulo | `server.js:39-58` | Al desplegar el dominio nuevo, CORS lo rechaza; mientras tanto autoriza el viejo |
| **S-06** | `bodyParser.json({limit:'10kb'})` no tiene efecto porque `express.json()` ya consumió el cuerpo con límite de 100 KB | `server.js:60-61` | El límite pretendido no existe |
| **S-07** | El registro no regenera la sesión | `server.js:573` | Ventana de fijación de sesión |
| **S-08** | Verificación de correo modelada pero **no implementada** | `UsuarioSchema` | Cuentas con correos falsos; sin recuperación de contraseña posible |
| **S-09** | Sin recuperación de contraseña | ausente | Cada olvido requiere intervención manual en la base de datos |
| **S-10** | `RespuestaTrivia` sin índice único `{quinielaId, jugador, triviaId}` | `server.js:375-381` | Doble envío concurrente duplica la respuesta → **puntos dobles** |
| **S-11** | La guardia de `paginasAdmin` verifica sesión pero no rol | `server.js:119-125` | Cualquier usuario descarga el HTML administrativo |
| **S-12** | El servidor termina con `process.exit(1)` si falla la **conexión inicial** a MongoDB: sin reintentos, sin retroceso exponencial | `server.js:24-33` | Cualquier indisponibilidad momentánea de la base —pausa del clúster, mantenimiento de Atlas, corte de red— deja la aplicación caída de forma permanente hasta que alguien la reinicie a mano |
| **S-13** | El mensaje de error de conexión no distingue causas | `server.js:29-33` | `DNS inexistente`, `credenciales inválidas`, `IP no autorizada` y `red caída` son cuatro problemas con cuatro soluciones distintas, y los cuatro imprimen lo mismo. Diagnosticar la caída del 16-ago tomó varias comprobaciones manuales de DNS |

### 🟡 Medios — deuda técnica con impacto

| ID | Hallazgo | Ubicación |
|---|---|---|
| **M-01** | El vínculo con el jugador es por `username` (cadena), no por `ObjectId` | modelos `Resultado`, `RespuestaTrivia`, `PronosticoCampeon`, `Jugador` |
| **M-02** | El vínculo partido↔pronóstico es por índice de array, sin identidad estable | `Jornada.partidos[]` |
| **M-03** | Cambiar la configuración de puntuación **reescribe el histórico** de jornadas ya jugadas | `server.js:3378-3407` |
| **M-04** | Incoherencia: los puntos de trivia sí quedan congelados; los de partido no | `Trivia`/`RespuestaTrivia` vs. `/api/resultados-totales` |
| **M-05** | `EQUIPOS_MUNDIAL_2026`: 48 selecciones **incrustadas en el código** | `server.js:3115-3164` |
| **M-06** | El cierre del pronóstico de campeón depende de una jornada llamada literalmente `"Jornada1"` | `server.js:3191`, `3242` |
| **M-07** | `partidoYaInicio()` y `parseFechaPartido()` están **definidas dos veces**; gana la segunda | `server.js:1687-1708` vs. `1738-1768` |
| **M-08** | `/generar_reporte` registrada dos veces | `server.js:911` y `3560` |
| **M-09** | `/api/football/leagues` y `/api/football/leagues-test` son idénticas | `server.js:1180-1209` |
| **M-10** | Rama muerta `if (minuto >= 45 && minuto < 46)` | `server.js:1468` |
| **M-11** | `esGolApiFootball()` descarta cualquier gol cuyo `info` contenga `"var"` → anula goles de "Varela", "Varane"… | `server.js:2589` |
| **M-12** | N+1 en `/api/trivias/activas`: una consulta de `Jornada` y otra de `ResultadoOficial` por trivia | `server.js:2303-2334` |
| **M-13** | N+1 en `POST /api/respuestas-trivia`: dos consultas por respuesta enviada | `server.js:2498-2538` |
| **M-14** | Guardado uno a uno en `resolverTriviasPendientes` en lugar de `bulkWrite` | `server.js:2824-2827` |
| **M-15** | Constante `CINCO_MINUTOS` con valor de 30 segundos | `server.js:134` |
| **M-16** | Comentario `/* Middleware */` duplicado | `server.js:35-37` |
| **M-17** | Dependencias sin usar: `canvas` (nativa, pesada), `fs` (paquete basura), `body-parser` (redundante) | `package.json` |
| **M-18** | Cinco `.json` heredados en la raíz sin uso | raíz del repositorio |
| **M-19** | Campo muerto `password` en `JugadorSchema` | `server.js:302-306` |
| **M-20** | 5 endpoints `/debug/*` activos en producción | `server.js:3426-3553` |
| **M-21** | El borrado de trivias elimina respuestas puntuadas sin auditoría | `server.js:2187-2197`, `2272-2298` |
| **M-22** | `.env.example` eliminado pero el README lo exige | árbol de trabajo |
| **M-23** | Sin `healthcheck` (`/healthz`, `/readyz`) | ausente |
| **M-24** | Sin logging estructurado, métricas ni trazas | ausente |
| **M-25** | Falta índice `{quinielaId, jornadaNombre, partidoIndex, tipo}` en `Trivia` | `server.js:358-372` |
| **M-26** | Sin paginación en ningún listado | todas las rutas de lectura |
| **M-27** | El código de ingreso no caduca ni se puede rotar | `Quiniela.codigoIngreso` |
| **M-28** | Sin registro de auditoría de acciones administrativas | ausente |
| **M-29** | Sin notificaciones (correo/push) para solicitudes, aprobaciones o cierres | ausente |

### 🟢 Bajos — pulido

| ID | Hallazgo |
|---|---|
| **B-01** | 25 páginas repiten el mismo bloque de arranque de contexto |
| **B-02** | Sin invalidación de caché de assets (`styles.css` sin hash) |
| **B-03** | Mezcla de convenciones de nombres: `verResultados.html` vs. `ver_resultados_trivias.html` vs. `ver-resultados-oficiales.html` |
| **B-04** | Comentarios en inglés y español mezclados (`/* Code added to modify the jorney per match*/`) |
| **B-05** | Bloques grandes de código comentado (`footballApi`, `obtenerMarcador90Minutos` v1, `obtenerEstadoVisual`) |
| **B-06** | Comentarios tipo `////////borrar borrar` |
| **B-07** | Indentación inconsistente en varios bloques (p. ej. `server.js:1963-1979`, `2506-2519`) |
| **B-08** | `/debug/trivia-goles/:matchId` fuera del prefijo `/api` |
| **B-09** | Sin `engines` en `package.json` pese a que el README exige Node 20+ |
| **B-10** | Sin `LICENSE` real (`"license": "ISC"` sin archivo) |

---

## 16. Roadmap para escalar "en grande"

Ordenado por dependencias, no solo por urgencia. Cada fase deja el sistema en un
estado desplegable.

### ✅ Fase 0 — Higiene inmediata — COMPLETADA el 16 de agosto de 2026

*Nada aquí cambia el comportamiento; todo reduce riesgo.* Ver bitácora, entrada 003.

| # | Tarea | Estado |
|---:|---|---|
| 1 | Corregir `NODE_EN` → `NODE_ENV` en `.env`. **(S-01)** | ✅ Hecho |
| 2 | Restaurar `.env.example` con todas las variables actuales. **(M-22)** | ✅ Hecho, ampliado con `NODE_ENV` y `ALLOWED_ORIGINS` |
| 3 | Confirmar el trabajo pendiente de Admin Mode en un commit. | ✅ Commit `05a8054` |
| 4 | Actualizar la lista blanca de CORS al dominio real y quitar el antiguo. **(S-05)** | ✅ Hecho, ahora configurable por `ALLOWED_ORIGINS` |
| 5 | Eliminar `express.json()` duplicado y dejar solo el límite de 10 KB. **(S-06)** | ✅ Hecho |
| 6 | Desinstalar `canvas`, `fs` y `body-parser`. **(M-17)** | ✅ Hecho, −63 paquetes |
| 7 | Añadir `"engines": { "node": ">=20" }`. **(B-09)** | ✅ Hecho |
| 8 | Mover los cinco `.json` heredados a `legacy-data/`. **(M-18)** | ✅ Hecho, con README explicativo |
| + | Dejar de rastrear `node_modules` (hallazgo nuevo, ver §14.2) | ✅ Commit `04f6de0` |
| + | Reejecutar `npm audit --omit=dev` | ✅ Ejecutado: **11 vulnerabilidades**, no corregidas aquí → Fase 1 |

**Pendiente de la Fase 0 (requiere al usuario):** arrancar la aplicación contra la
base real y hacer la prueba de humo. No se pudo verificar de forma automática porque
arrancar el servidor dispara el auto-sync, que **escribe** resultados oficiales y
consume cuota de APIFootball.

### Fase 1 — Seguridad de base y resiliencia (1–2 sesiones)

8-bis. **`npm audit fix`** — 11 vulnerabilidades pendientes, la mayoría de
    `axios@1.11.0`. Se dejó fuera de la Fase 0 por su regla de no alterar
    comportamiento; aquí sí, con la prueba de importación de partidos como
    verificación. Ver §2.7.

8-ter. **Resiliencia de la conexión a MongoDB** *(nuevo tras el incidente del
    16-ago, ver bitácora 004)*:
    - Reintentos con retroceso exponencial en lugar de `process.exit(1)` al primer
      fallo. **(S-12)**
    - Mensajes de error que distingan DNS inexistente, credenciales inválidas, IP no
      autorizada y red caída. **(S-13)**
    - Decidir el plan del clúster: un M0 gratuito que se auto-pausa no sostiene el
      objetivo de producción. **(C-06)**

9. Añadir `helmet` con CSP ajustada. **(S-03)**
10. Añadir `express-rate-limit`: login, registro y `admin-mode/activar` con límites
    estrictos por IP y por cuenta. **(S-02)**
11. Regenerar la sesión también en el registro. **(S-07)**
12. Índice único `{quinielaId, jugador, triviaId}` en `RespuestaTrivia`. **(S-10)**
13. Índice `{quinielaId, jornadaNombre, partidoIndex, tipo}` en `Trivia`. **(M-25)**
14. Verificar el rol —no solo la sesión— en la guardia de `paginasAdmin`. **(S-11)**
15. Mover los endpoints `/debug/*` detrás de una bandera de entorno. **(M-20)**
16. Endpoints `/healthz` y `/readyz`. **(M-23)**

### Fase 2 — Corregir la fuga de inquilino y los bugs de dominio (1 sesión)

17. **Reescribir `resolverTriviasPendientes()`** para iterar quinielas y envolver
    cada una en su propio `tenantContext.run`. **(C-02)** ← *lo más urgente
    funcionalmente*
18. Eliminar las definiciones duplicadas de `partidoYaInicio` y `parseFechaPartido`.
    **(M-07)**
19. Arreglar `esGolApiFootball`: sustituir `info.includes('var')` por una comprobación
    de palabra completa. **(M-11)**
20. Quitar la ruta `/generar_reporte` duplicada y `leagues-test`. **(M-08, M-09)**
21. Renombrar `CINCO_MINUTOS` a lo que realmente es. **(M-15)**

### Fase 3 — Red de seguridad de pruebas (2 sesiones)

*Prerrequisito indispensable antes de refactorizar.*

22. Montar `mongodb-memory-server` + `supertest`.
23. **Pruebas del motor de puntuación**: exacto, resultado, comodín, marcadores
    nulos, campeón, trivias.
24. **Pruebas de aislamiento multi-inquilino**: dos quinielas con nombres de jornada
    idénticos; verificar que ninguna consulta cruza.
25. **Pruebas de las invariantes de roles**: último administrador, expulsión del
    propietario, transferencia.
26. **Pruebas de normalización de APIFootball** con respuestas guardadas como
    fixtures: estados, marcador a 90', equipos invertidos.
27. **Pruebas de autorresolución de trivias** para los 8 tipos.

### Fase 4 — Rediseño del sincronizador (2–3 sesiones) ← *el bloqueante real*

28. **Extraer el sync a un proceso separado** (`worker.js`) o a un planificador
    con bloqueo distribuido en MongoDB. **(C-05)**
29. **Sustituir la autollamada HTTP por una llamada de función directa** envuelta en
    `tenantContext.run`. **(C-01)**
30. **Deduplicar por `apiFixtureId`**: si 40 quinielas siguen el mismo partido, es
    **una** llamada al API, no 40. Introducir una colección `fixtures` global
    (sin `quinielaId`) como caché compartida del estado real del partido.
31. **Ventanas de sincronización inteligentes**:
    - Partido `TC` y `bloqueadoFinal` → nunca más se consulta.
    - Partido a más de 2 h de su inicio → cada 6 h.
    - Partido dentro de las 2 h previas → cada 15 min.
    - Partido `LIVE`/`MT` → cada 60 s.
    - Quinielas archivadas o eliminadas → nunca.
32. **Paralelismo controlado** con un limitador de concurrencia y reintentos con
    retroceso exponencial.
33. **Registrar el consumo de cuota** de APIFootball y exponerlo como métrica.

**Efecto esperado:** de ~3.000 llamadas cada 30 s con 100 quinielas a **decenas de
llamadas por minuto**, independientemente del número de quinielas.

### Fase 5 — Rendimiento del ranking (1–2 sesiones)

34. **Materializar los puntos por jornada** en una colección `PuntosJornada`
    `{quinielaId, jugador, jornada, puntos, calculadoEn}`, recalculada solo cuando
    cambia un resultado oficial de esa jornada. **(C-03)**
35. Decidir y aplicar la política de congelamiento: **congelar los puntos al cerrar
    la jornada** resuelve M-03 y M-04 de una vez.
36. Caché en memoria (o Redis) del ranking con invalidación por evento.
37. Paginación en todos los listados. **(M-26)**

### Fase 6 — Modularizar el monolito (3–4 sesiones)

*Solo con la Fase 3 terminada.*

38. Estructura objetivo:

```
src/
  config/         env.js, db.js, constants.js
  models/         usuario.js, quiniela.js, membresia.js, jornada.js, …
  middleware/     auth.js, tenant.js, adminMode.js, rateLimit.js, errors.js
  services/       apifootball.js, sync.js, trivias.js, puntuacion.js, ranking.js
  routes/         auth.js, quinielas.js, miembros.js, jornadas.js, resultados.js,
                  trivias.js, campeon.js, football.js, debug.js
  jobs/           syncScheduler.js, triviaResolver.js
  app.js
server.js         → solo arranque
worker.js         → solo jobs
```

39. Migrar ruta por ruta, con las pruebas de la Fase 3 como red.
40. Capa de validación de entrada (`zod` o `joi`) en todos los `req.body`.

### Fase 7 — Funcionalidades para "en grande" (continuo)

41. **Verificación de correo** (el modelo ya está listo). **(S-08)**
42. **Recuperación de contraseña.** **(S-09)**
43. **Configuración de campeonato por quiniela**: sustituir `EQUIPOS_MUNDIAL_2026`
    por una lista configurable, y `"Jornada1"` por una `fechaCierreCampeon` explícita.
    **(M-05, M-06)**
44. **Identidad estable**: migrar los vínculos de `username` a `usuarioId`, y de
    índice de array a `partidoId`. **(M-01, M-02)**
45. **Registro de auditoría** de acciones administrativas. **(M-28)**
46. **Notificaciones** por correo o push: solicitud de ingreso, aprobación, cierre
    de jornada, resultados publicados. **(M-29)**
47. **Rotación y caducidad del código de ingreso.** **(M-27)**
48. **Resolución manual de trivias** cuando el API falla.
49. **Escapado sistemático en el frontend**: función `escapar()` compartida o
    migración a `textContent`. **(S-04)**
50. **Observabilidad**: `pino` para logs estructurados, métricas Prometheus,
    Sentry para errores. **(M-24)**

### Resumen de prioridades

| Prioridad | Fases | Por qué |
|---|---|---|
| **Ahora** | 0, 1, 2 | Riesgo real, esfuerzo bajo, sin refactorización |
| **Antes de crecer** | 3, 4 | Sin la Fase 4 el sistema no soporta la escala; sin la 3 la 4 es imprudente |
| **Al crecer** | 5, 6 | Rendimiento y mantenibilidad |
| **Continuo** | 7 | Producto |

---

## Anexo A — Acta de continuidad del 9 de julio de 2026 (HANDOFF)

> Este anexo **absorbe íntegramente el contenido de `HANDOFF.md`** (fecha original:
> 9 de julio de 2026), que era el acta de decisiones tomada al convertir la
> aplicación de quiniela única en plataforma multi-quiniela. Se conserva aquí
> palabra por palabra para que `avance_proyecto.md` sea la única fuente de verdad
> del proyecto, y se añade en cada bloque una **columna de estado verificado al 16
> de agosto de 2026**.

### A.1 Objetivo acordado (texto original)

> Convertir la aplicación original de una sola quiniela en una plataforma
> multi-quiniela con cuentas personales y roles independientes por quiniela.

**Estado:** ✅ Cumplido. Verificado en §3 (arquitectura), §4 (modelo de datos) y
§5 (aislamiento por quiniela).

### A.2 Decisiones confirmadas (texto original) y su verificación

| # | Decisión acordada el 9-jul-2026 | Estado al 16-ago-2026 | Evidencia |
|---:|---|---|---|
| 1 | Registro con nombre de usuario, correo, contraseña y confirmación | ✅ Implementado | §6.1 — valida los 4 campos y `password === confirmarPassword` |
| 2 | Usuario y correo deben ser globalmente únicos | ✅ Implementado | §4.1 — índices únicos en `usernameNormalizado` y `emailNormalizado` |
| 3 | Inicio de sesión con usuario o correo | ✅ Implementado | §6.2 — `$or` sobre ambos campos normalizados |
| 4 | No se verifica el correo todavía, pero el modelo queda preparado | ⚠️ Sigue igual | §4.1 — `tokenVerificacion` y `expiracionTokenVerificacion` existen, sin flujo. Hallazgo **S-08** |
| 5 | Roles: `propietario`, `admin` y `user` | ✅ Implementado | §6.4 |
| 6 | El creador de la quiniela es su propietario | ✅ Implementado | `POST /api/quinielas` (§7.2) |
| 7 | Solo el propietario puede transferir la propiedad y eliminar la quiniela | ✅ Implementado | §7.3 — ambas rutas exigen `requireAdmin` + propietario |
| 8 | Propietarios y administradores pueden archivarla y restaurarla | ✅ Implementado | `PATCH /api/quiniela-actual/archivar` |
| 9 | El ingreso requiere código y aprobación administrativa | ✅ Implementado | `POST /api/quinielas/unirse` + `.../aprobar`. Pendiente: el código no caduca (**M-27**) |
| 10 | El retiro se solicita y debe aprobarlo un administrador | ✅ Implementado | `solicitar-retiro` + `aprobar-retiro` |
| 11 | Los administradores pueden expulsar miembros y cambiar roles | ✅ Implementado | `.../expulsar`, `.../rol` |
| 12 | Una quiniela nunca puede quedar sin propietario/administración | ✅ Implementado | §6.4 — invariantes: no degradar al último admin (409), no expulsar al propietario, transferencia obligatoria antes del retiro |
| 13 | Cada quiniela configura su puntuación y decide si utiliza trivias | ✅ Implementado | §4.1 — `configuracion.puntuacion.*` + `triviasHabilitadas`. Efecto secundario no previsto: cambiar la configuración **reescribe el histórico** (**M-03**) |
| 14 | Todas usan APIFootball, pero cada administrador elige partidos, ligas y equipos | ✅ Implementado | §9 — importador por liga y rango de fechas. Es justamente el origen del cuello de botella **C-01** |
| 15 | La base anterior no se modifica. La versión nueva usa otra base | ✅ Respetado | §12.4 — la migración nunca se ha ejecutado |

### A.3 Implementación realizada (texto original) y su verificación

| # | Punto declarado como hecho el 9-jul-2026 | Estado al 16-ago-2026 |
|---:|---|---|
| 1 | Modelos `Usuario`, `Quiniela` y `Membresia` | ✅ Confirmado (§4.1) |
| 2 | Aislamiento automático mediante `quinielaId` en todos los modelos deportivos | ⚠️ Confirmado en los 9 modelos, **pero con dos fugas** en la autorresolución de trivias (§5.3, hallazgo **C-02**) |
| 3 | Conexión obligatoria mediante `MONGO_URI_MULTIQUINIELA`; no existe fallback a `MONGO_URI` | ✅ Confirmado y **protegido por prueba automática** (§13.1) |
| 4 | Sesiones persistentes mediante `connect-mongo` | ✅ Confirmado, colección `sesiones`, TTL 14 días (§6.3) |
| 5 | Registro, login, logout y consulta de cuenta | ✅ Confirmado (§7.1). Falta regenerar sesión en el registro (**S-07**) |
| 6 | Crear, solicitar ingreso y seleccionar quinielas | ✅ Confirmado (§7.2) |
| 7 | Aprobación/rechazo, retiro, expulsión, roles y transferencia | ✅ Confirmado (§7.3) |
| 8 | Puntuación configurable, trivias opcionales, archivo y eliminación lógica | ✅ Confirmado |
| 9 | Pantallas nuevas: registro, mis quinielas, miembros y configuración | ✅ Confirmado (§2.4) |
| 10 | Pantallas deportivas adaptadas a la cuenta y quiniela activa | ✅ Confirmado (§11.2 — patrón de arranque replicado en ~25 páginas) |
| 11 | Protección de pronósticos y trivias ajenas antes del cierre | ✅ Confirmado y aplicado de forma consistente (§7.7) |
| 12 | Migrador seguro, en simulación por defecto, desde conexión antigua de solo lectura | ✅ Confirmado (§12.1) |
| 13 | README, `.env.example`, `.gitignore` y pruebas arquitectónicas | ⚠️ **`.env.example` fue borrado del árbol de trabajo** y el README aún manda copiarlo (**M-22**) |

### A.4 Verificación realizada (texto original) y su estado actual

| Verificación declarada el 9-jul-2026 | Estado al 16-ago-2026 |
|---|---|
| `npm test`: 5 pruebas aprobadas | 🔄 **Ahora son 6** — se añadió la prueba de invariantes del Admin Mode, aún sin confirmar en Git (§13.1, §14.3) |
| `npm run check`: sintaxis del servidor válida | ✅ Sigue válida |
| Todos los scripts JavaScript pasaron `node --check` | ✅ Sin cambios estructurales que lo rompan |
| No hay referencias locales JS/CSS ausentes | ✅ Cubierto por la sexta prueba automática |
| `npm audit --omit=dev`: 0 vulnerabilidades | ⏳ **Pendiente de reverificar** en esta etapa |
| Se verificó que el servidor no arranca sin la nueva base | ✅ Confirmado y protegido por prueba |

### A.5 Siguiente paso declarado el 9-jul-2026 y su cumplimiento

| # | Paso original | Estado al 16-ago-2026 |
|---:|---|---|
| 1 | Crear una base MongoDB nueva | ✅ Hecha — `MONGO_URI_MULTIQUINIELA` existe en `.env` |
| 2 | Crear `.env` a partir de `.env.example` | ✅ Hecho, ⚠️ pero con la errata `NODE_EN` en lugar de `NODE_ENV` (**S-01**) y `.env.example` ya no existe |
| 3 | Configurar `MONGO_URI_MULTIQUINIELA`, `SESSION_SECRET` y `APIFOOTBALL_COM_KEY` | ✅ Las tres presentes (§2.9) |
| 4 | Arrancar la aplicación | ✅ Hecho |
| 5 | Probar de extremo a extremo con al menos dos cuentas y dos quinielas | ❓ **Sin evidencia registrada.** No hay bitácora de esa prueba ni pruebas de integración (§13.3) |
| 6 | Corregir cualquier detalle encontrado en la prueba integrada | 🔄 En curso — el trabajo sin confirmar de Admin Mode parece ser resultado de ese uso real (§14.3) |
| 7 | Registrar la cuenta propietaria definitiva | ❓ Sin evidencia registrada |
| 8 | Ejecutar primero `npm run migrate:legacy:dry` y revisar conteos antes de cualquier copia | ⏳ **No ejecutado** — ni la simulación (§12.4) |

### A.6 Seguridad de la base anterior (texto original)

> No se ha conectado ni modificado la base original. La migración no se ha
> ejecutado. Cuando se haga, `MONGO_URI_LEGACY_READONLY` debe usar credenciales de
> solo lectura y el destino debe ser una base diferente.

**Estado al 16-ago-2026:** ✅ **Sigue siendo cierto.** Las variables
`MONGO_URI_LEGACY_READONLY`, `LEGACY_DB_NAME`, `TARGET_DB_NAME`,
`MIGRATION_OWNER_EMAIL` y `MIGRATION_POOL_NAME` ni siquiera están definidas en
`.env` (§2.9), lo que confirma que el migrador nunca se ha usado. Esta condición es
**invariante del proyecto** y debe seguir respetándose: la base original es el
respaldo histórico y no debe recibir jamás una escritura.

### A.7 Lo que el HANDOFF **no** cubría

El acta de julio documentó *decisiones de producto y alcance funcional*, pero no
tocó ninguno de estos ejes, que es exactamente el hueco que llena este documento:

| Eje no cubierto por el HANDOFF | Dónde se cubre ahora |
|---|---|
| Escalabilidad y costo de la integración con APIFootball | §9.4, hallazgo **C-01** |
| Rendimiento del ranking | §8.3, hallazgo **C-03** |
| Mantenibilidad del monolito de 3.584 líneas | §2.1, hallazgo **C-04** |
| Escalado horizontal y jobs en el proceso web | §3.3, hallazgo **C-05** |
| Endurecimiento de seguridad (rate limiting, cabeceras, XSS) | §15, hallazgos **S-02 … S-04** |
| Observabilidad, health checks, métricas | Hallazgos **M-23**, **M-24** |
| Cobertura real de pruebas (integración, motor de puntuación, aislamiento) | §13.3, Fase 3 del roadmap |
| Plan por fases hacia producción "en grande" | §16 |

> **Nota de mantenimiento:** con este anexo, `HANDOFF.md` queda **superado**. Se
> conserva en el repositorio como documento histórico con su fecha original, pero
> **no debe seguir actualizándose**: toda continuidad se registra a partir de ahora
> en la bitácora de §18 de este archivo.

---

## 18. Bitácora de avance

> Registro cronológico. Cada entrada documenta qué se hizo, por qué, qué archivos se
> tocaron y cómo se verificó.

---

### 📌 Entrada 001 — 14 de agosto de 2026 — Análisis integral del sistema

**Objetivo:** entender a fondo todo el proyecto antes de tocar una línea, y dejar el
conocimiento por escrito.

**Qué se hizo:**

1. Inventario completo del repositorio: 84 archivos versionados, 14.336 líneas de
   código entre `server.js`, 39 scripts de frontend y 30 páginas HTML.
2. Lectura íntegra de `server.js` (3.584 líneas), `scripts/migrate-legacy.js`,
   `test/architecture.test.js`, `README.md`, `HANDOFF.md` y `package.json`.
3. Mapeo de las 84 rutas HTTP y sus guardias de autorización.
4. Documentación de las 13 colecciones de MongoDB con todos sus campos e índices.
5. Análisis del mecanismo multi-inquilino basado en `AsyncLocalStorage`.
6. Análisis del motor de puntuación y de la integración con APIFootball.
7. Revisión del estado de Git y de los 6 archivos con cambios sin confirmar.
8. Ejecución de la suite de pruebas.

**Comandos ejecutados y su resultado:**

```
npm test        → 6/6 pruebas pasan, 28,98 ms
git status      → 6 archivos modificados, +111/−18
git log         → 2 commits
```

**Hallazgos principales:**

- **5 críticos**, **11 altos**, **29 medios**, **10 bajos**. Ver §15.
- El bloqueante número uno es el auto-sync con APIFootball: hace una llamada al API
  externo **por cada partido de cada quiniela cada 30 segundos**. Con 20 quinielas se
  agota una cuota mensual típica en menos de media hora.
- Existe una **fuga real de aislamiento entre quinielas** en la autorresolución de
  trivias cuando corre desde el `setInterval` (sin contexto de inquilino).
- `.env` tiene `NODE_EN` en lugar de `NODE_ENV`, lo que deja la cookie de sesión sin
  la marca `secure` en producción.
- Los cambios sin confirmar (flujo de Admin Mode en la interfaz) están completos y
  coherentes; solo falta restaurar `.env.example` y hacer commit.

**Lo que está bien y hay que conservar:**

- El diseño multi-inquilino con `AsyncLocalStorage` + plugin de Mongoose es elegante
  y evita la clase de error más común en sistemas multi-tenant.
- El Admin Mode con reautenticación y caducidad de 1 hora es una decisión de
  seguridad acertada.
- Las invariantes de roles (nunca sin administrador, no expulsar al propietario,
  transferencia obligatoria antes de retirarse) están correctamente implementadas.
- El cálculo del marcador "a 90 minutos" descartando penales y tiempo extra
  resuelve bien un problema real de las eliminatorias.
- El migrador es prudente: simulación por defecto, origen de solo lectura,
  idempotente.
- La protección de privacidad de pronósticos ajenos antes del cierre está aplicada
  de forma consistente en todas las rutas de lectura.

**Archivos creados:** `avance_proyecto.md` (este documento).

**Archivos modificados:** ninguno. Análisis puramente de lectura.

**Siguiente paso propuesto:** ejecutar la **Fase 0 — Higiene inmediata** (§16), que
son 8 cambios de bajo riesgo y ningún cambio de comportamiento, y confirmar el
trabajo pendiente de Admin Mode.

---

### 📌 Entrada 002 — 16 de agosto de 2026 — Consolidación documental: HANDOFF absorbido

**Objetivo:** unificar la documentación de continuidad del proyecto en un solo
archivo, para que no haya dos fuentes de verdad que se contradigan.

**Motivo:** `HANDOFF.md` (9 de julio de 2026) registraba las decisiones de producto
y el alcance funcional del salto a multi-quiniela, mientras que
`avance_proyecto.md` (14 de agosto de 2026) registraba el análisis técnico y el
plan de escalado. Al quedar separados, algunos puntos del HANDOFF ya no reflejaban
la realidad (por ejemplo, "5 pruebas aprobadas" cuando ya son 6, o `.env.example`
como archivo existente cuando ya estaba borrado del árbol de trabajo).

**Qué se hizo:**

1. Lectura íntegra de `HANDOFF.md` (65 líneas) y de `avance_proyecto.md`
   (1.502 líneas).
2. Incorporación del **contenido completo del HANDOFF** como **Anexo A**, ubicado
   entre el roadmap (§16) y la bitácora.
3. Cada bloque original (objetivo, 15 decisiones, 13 puntos de implementación,
   6 verificaciones, 8 siguientes pasos y la nota de seguridad de la base anterior)
   se conservó textualmente y se le añadió una **columna de estado verificado al 16
   de agosto de 2026**, con enlace al hallazgo correspondiente de §15 cuando hay
   desviación.
4. Se añadió §A.7 con los ejes que el HANDOFF **no** cubría (escalabilidad, coste de
   API, rendimiento, mantenibilidad, seguridad, observabilidad, pruebas), que son
   precisamente los que motivan este documento.
5. Renumeración: la bitácora pasa de §17 a §18; el índice se actualizó.

**Contraste HANDOFF ↔ realidad — desviaciones detectadas:**

| Punto del HANDOFF | Desviación encontrada |
|---|---|
| "`npm test`: 5 pruebas aprobadas" | Ahora son 6 (la sexta, del Admin Mode, sigue sin confirmar en Git) |
| "README, `.env.example`, `.gitignore` y pruebas arquitectónicas" | `.env.example` fue borrado del árbol de trabajo; el README sigue mandando copiarlo (**M-22**) |
| "Aislamiento automático mediante `quinielaId` en todos los modelos deportivos" | Cierto en los 9 modelos, pero con fuga real en `resolverTriviasPendientes()` desde `setInterval` (**C-02**) |
| "Crear `.env` a partir de `.env.example`" | Hecho, pero con la errata `NODE_EN` en lugar de `NODE_ENV` (**S-01**) |
| Paso 5: "Probar de extremo a extremo con dos cuentas y dos quinielas" | Sin evidencia registrada de que se completara |
| Paso 7: "Registrar la cuenta propietaria definitiva" | Sin evidencia registrada |
| Paso 8: "Ejecutar `npm run migrate:legacy:dry`" | No ejecutado, ni siquiera la simulación |
| "No se verifica el correo todavía, pero el modelo queda preparado" | Sigue exactamente igual 5 semanas después (**S-08**) |

**Confirmaciones importantes (nada que corregir):**

- La invariante de seguridad más importante del proyecto **se mantiene intacta**: la
  base de datos anterior nunca se ha conectado ni modificado. Las variables de
  migración ni siquiera están definidas en `.env`.
- Las 15 decisiones de producto acordadas en julio están implementadas; solo la
  número 4 (verificación de correo) sigue deliberadamente pendiente, tal como se
  acordó.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `avance_proyecto.md` | +Anexo A completo (contenido del HANDOFF + verificación de estado), índice actualizado, bitácora renumerada a §18, esta entrada |

**Archivos sin tocar:** `HANDOFF.md` se conserva en el repositorio como documento
histórico con su fecha original. Queda **congelado**: no debe volver a editarse.

**Verificación:**

```
git status  → sin cambios nuevos fuera de avance_proyecto.md (sigue sin versionar)
git log     → 2 commits, sin cambios
```

**Pendiente / siguiente paso:** sin cambios respecto a la entrada 001 — ejecutar la
**Fase 0 — Higiene inmediata** (§16). El Anexo A añade dos tareas de verificación
que conviene incluir en esa fase:

- Reejecutar `npm audit --omit=dev` (la última verificación es de julio).
- Cerrar formalmente los pasos 5 y 7 del HANDOFF: prueba de extremo a extremo con
  dos cuentas y dos quinielas, y registro de la cuenta propietaria definitiva.

---

### 📌 Entrada 003 — 16 de agosto de 2026 — Fase 0: higiene inmediata

**Objetivo:** ejecutar las 8 tareas de la Fase 0 (§16). Regla autoimpuesta: **ningún
cambio puede alterar el comportamiento del dominio.**

**Rama:** `fase-0-higiene`, creada desde `main` en `f92462b`.

**Verificación previa (antes de tocar nada):**

| Qué se verificó | Resultado |
|---|---|
| Diff de los 6 archivos sin confirmar | El flujo de Admin Mode está completo y coherente: endpoints, caducidad de 1 h, borrado de la marca al cambiar de quiniela, exención del token interno de sync y prueba nueva |
| Valor real de `NODE_EN` en `.env` | `development` — por lo tanto renombrarlo a `NODE_ENV` es un no-op en local; el efecto real es en producción |
| Uso real de `canvas` | Cero referencias en todo el código |
| Uso real de `body-parser` | Solo dos líneas: el `require` y el segundo parser inútil |
| Uso real de `fs` | La línea 8 usa el módulo **nativo** de Node; el paquete npm `fs` es un stub vacío que no interviene |

**Qué se hizo — las 8 tareas:**

1. **`NODE_EN` → `NODE_ENV`** en `.env`. La letra faltante dejaba `trust proxy`
   desactivado y la cookie de sesión sin `secure`. **(S-01)**
2. **`.env.example` restaurado** y ampliado: documenta ahora `NODE_ENV` (con
   advertencia explícita sobre la errata) y la nueva `ALLOWED_ORIGINS`. **(M-22)**
3. **Trabajo de Admin Mode confirmado** en el commit `05a8054`, aislado del resto.
4. **CORS**: la lista blanca dejaba fuera el dominio nuevo y seguía autorizando el
   de la aplicación anterior. Ahora los orígenes se leen de `ALLOWED_ORIGINS`, con
   `https://quinieladeportivaglobal.onrender.com` por defecto; los orígenes locales
   quedan siempre permitidos y respetan `PORT`. **(S-05)**
5. **Un solo parser de cuerpo**: `express.json({ limit: '10kb' })`. Antes había dos
   encadenados y el límite de 10 KB no se aplicaba nunca. **(S-06)**
6. **`canvas`, `fs` y `body-parser` desinstalados**: 63 paquetes menos. **(M-17)**
7. **`"engines": { "node": ">=20" }`** declarado. **(B-09)**
8. **Los cinco `.json` heredados** movidos a `legacy-data/` con un README que aclara
   que ningún código los lee y que la migración real no los usa. **(M-18)**

**Hallazgo nuevo, no previsto en el análisis: `node_modules` estaba versionado.**

Al preparar el primer commit apareció que **2.531 de los 2.615 archivos rastreados
eran dependencias** (97 % del repositorio). `.gitignore` lo listaba, pero no surtía
efecto porque Git solo ignora lo que aún no rastrea. Además de inflar el historial,
era activamente dañino: `bcrypt` y `canvas` son módulos nativos, así que había
binarios de Windows versionados que **romperían un despliegue en Linux**. Corregido
con `git rm -r --cached node_modules`. Detalle en §14.2.

**Reejecución de `npm audit --omit=dev`:** de **0 vulnerabilidades en julio a 11**
(3 bajas, 3 moderadas, 5 altas). El grueso viene de `axios@1.11.0`, con ~29
advisories acumuladas (SSRF vía bypass de `NO_PROXY`, prototype pollution, DoS, fuga
de `Proxy-Authorization` en redirecciones). El resto son transitivas de Express.
Todas se resuelven con `npm audit fix` sin cambios de ruptura. **Deliberadamente no
se aplicó**: actualizar `axios` toca el cliente de APIFootball y habría violado la
regla de la Fase 0. Pasa a ser el primer punto de la Fase 1.

**Commits:**

| SHA | Commit |
|---|---|
| `04f6de0` | Dejar de rastrear node_modules |
| `05a8054` | Completar el flujo de Admin Mode en la interfaz |
| `c17d131` | Fase 0: higiene previa al trabajo de escalado |

Se rehízo el historial una vez: los renombrados a `legacy-data/` se habían colado en
el commit de `node_modules` porque `git mv` los dejó en el índice. Se corrigió con
`git reset --mixed` y reconstrucción de los tres commits, verificando que el diff de
Admin Mode siguiera siendo exactamente el original (+111 inserciones).

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `.env` | `NODE_EN` → `NODE_ENV` (no versionado) |
| `.env.example` | Restaurado y ampliado |
| `server.js` | CORS configurable, parser único, `require` de `body-parser` retirado |
| `package.json` | −3 dependencias, `engines` añadido |
| `package-lock.json` | Regenerado |
| `legacy-data/*` | Cinco `.json` movidos + README |
| `avance_proyecto.md` | §2.7, §14, §16 y esta entrada |
| `node_modules/` | 2.531 archivos dejan de rastrearse |

**Verificación:**

```
npm run check              → sintaxis válida
npm test                   → 6/6 pruebas pasan
git status                 → árbol limpio
npm audit --omit=dev       → 11 vulnerabilidades (documentadas, no corregidas)
node server.js             → ✗ NO VERIFICADO
```

⚠️ **El arranque real no se pudo verificar.** El entorno de trabajo bloquea la salida
de red hacia MongoDB Atlas (`querySrv ECONNREFUSED`). El proceso llegó a cargar todos
los módulos y el pipeline completo de middleware —lo que confirma que retirar
`body-parser` no rompe la carga— y falló únicamente al conectar. No se forzó el
arranque fuera del entorno restringido porque **iniciar el servidor dispara el
auto-sync global, que escribe resultados oficiales en la base real y consume cuota de
APIFootball**.

**Pendiente / siguiente paso:**

1. **Prueba de humo manual** (bloquea el cierre formal de la Fase 0): `npm start`,
   iniciar sesión, entrar a Admin mode, guardar un pronóstico y ver el ranking.
2. Fusionar `fase-0-higiene` a `main`.
3. En Render, definir `NODE_ENV=production` y `ALLOWED_ORIGINS` en las variables de
   entorno del servicio. Sin `NODE_ENV=production` la corrección de S-01 no surte
   efecto en el despliegue, que es justamente donde importa.
4. Iniciar la **Fase 1 — Seguridad de base**, empezando por `npm audit fix`.

---

### 📌 Entrada 004 — 16 de agosto de 2026 — Incidente: la base dejó de resolver

**Síntoma:** la aplicación no arranca. `❌ No se pudo conectar a la base
multi-quiniela: querySrv ECONNREFUSED _mongodb._tcp.cluster0.fjjzrhl.mongodb.net`

**Causa raíz:** el clúster de MongoDB Atlas estaba **pausado**. Atlas pausa
automáticamente los clústeres M0 gratuitos tras un periodo de inactividad y, al
hacerlo, **retira sus registros DNS**. Por eso el fallo no se manifestó como un
error de conexión sino como un nombre inexistente.

**Cómo se diagnosticó** *(el orden importa: cada paso descarta una familia de
causas)*:

| # | Comprobación | Resultado | Qué descarta |
|---:|---|---|---|
| 1 | Integridad de `.env`: variables presentes, sin `\r`, URI bien formada | ✅ Correcto | Descarta configuración corrupta y descarta que lo hubiera roto la Fase 0 |
| 2 | `dns.getServers()` dentro del entorno restringido | `127.0.0.1`, `ECONNREFUSED` | **Falso positivo**: el entorno de trabajo tiene su propio resolutor. No concluir nada desde aquí |
| 3 | `Resolve-DnsName ... -Server 8.8.8.8` desde Windows | `DNS name does not exist` | Descarta red local, ISP y resolutor |
| 4 | `Resolve-DnsName mongodb.net -Server 8.8.8.8` | SOA de AWS ✅ | Confirma que el DNS funciona y que la respuesta es autoritativa |
| 5 | Registros A, TXT y SRV del host del clúster | Los tres NXDOMAIN | El nombre no está publicado, no es un problema de conectividad |
| 6 | Estado del clúster en la consola de Atlas | **Paused** | Causa raíz |

**La distinción que resuelve el caso:**

> **NXDOMAIN no es un error de conexión.** Si el problema fuera la lista de IPs
> permitidas, las credenciales o la red, el nombre **sí resolvería** y el fallo
> ocurriría después, al conectar o autenticar. Un nombre que no existe significa que
> Atlas no está publicando el clúster.

**Dos hipótesis que resultaron falsas y por qué:**

1. *"Las entradas de IP Access List salen como Inactive, ese es el problema."* No:
   la lista de acceso vive en el proyecto, no en el clúster. Sin clúster corriendo,
   las reglas no tienen dónde aplicarse y se marcan inactivas. Era **otro síntoma de
   la misma causa**, no la causa.
2. *"Un clúster pausado conserva sus registros DNS."* **Incorrecto**, y este error
   desvió el diagnóstico: en M0 Atlas los retira. Queda corregido aquí para que no
   se repita el razonamiento equivocado.

**Solución:** *Database → Resume* en la consola de Atlas. Tarda entre 2 y 10 minutos;
las entradas de IP Access List vuelven a *Active* solas. No hay que recrear IPs ni
cambiar la URI: el host se vuelve a publicar con el mismo nombre.

**Hallazgos nuevos que deja el incidente:**

| ID | Hallazgo |
|---|---|
| **C-06** | El plan M0 gratuito se auto-pausa. Para el objetivo de producción es un bloqueante: la aplicación puede morir sola, sin aviso y sin recuperarse |
| **S-12** | El servidor hace `process.exit(1)` al primer fallo de conexión, sin reintentos. Cualquier indisponibilidad momentánea lo deja caído de forma permanente |
| **S-13** | El mensaje de error no distingue DNS inexistente, credenciales inválidas, IP no autorizada y red caída — cuatro problemas con cuatro soluciones distintas |

Los tres se incorporan a §15 y a la Fase 1 del roadmap.

**Archivos modificados:** solo `avance_proyecto.md`. Ningún cambio de código: el
incidente era de infraestructura.

**Pendiente / siguiente paso:** reanudar el clúster y ejecutar la prueba de humo de
la Fase 0, que sigue bloqueada.

---

<!--
PLANTILLA PARA LAS SIGUIENTES ENTRADAS

### 📌 Entrada NNN — fecha — título

**Objetivo:**

**Qué se hizo:**
1.

**Archivos modificados:**
| Archivo | Cambio |
|---|---|

**Verificación:**
```
comando → resultado
```

**Hallazgos nuevos:**

**Pendiente / siguiente paso:**

---
-->

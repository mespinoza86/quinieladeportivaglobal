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

## 🔖 PUNTO DE PARTIDA — última actualización: 19 de agosto de 2026

> **Lee esto primero al retomar.** Resume dónde quedó todo y qué hacer a
> continuación. El detalle de cada paso está en la bitácora (§19).

### ⚠️ Lo primero, en un minuto

```bash
git log --oneline -3     # debe empezar por 61f3dae
git status               # debe estar limpio
npm test                 # 129/129
npm run test:e2e         # 58/58
```

**`main` y `origin/main` están a la par.** Los siete commits que quedaron sin
subir del 18 de agosto —el plan de producto, las fases A y B, el cambio de regla
de la jornada actual y la puesta al día de este documento— se subieron el 19 de
agosto, junto con el trabajo de la Entrada 029.

> El `gh` CLI **no está instalado** en esta máquina, así que el resultado del CI
> hay que mirarlo en GitHub a mano. No hay forma de consultarlo desde aquí.

### Dónde estamos

**Toda la deuda técnica planificada está cerrada** —fases 0 a 5, más el
endurecimiento y las cinco prioridades altas de la auditoría (Entrada 015)— y el
trabajo ha pasado a ser **producto**: el plan de las diez peticiones de §20, del
que van hechas las fases A y B.

| Qué | Estado |
|---|---|
| Pruebas rápidas | **129** (46 de arquitectura + 83 de integración), ~12 s |
| Pruebas de navegador | **58** (29 × escritorio y móvil), ~2 min |
| Integración continua | En verde, en cada empujón y cada PR contra `main` |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `server.js` | 5.162 líneas; `src/` tiene 291 en tres módulos |

Tres cambios de producto que conviene tener presentes antes de tocar nada:

- **El cierre es POR PARTIDO, no por jornada.** La jornada no tiene
  `fechaCierre`: un partido se cierra a su hora de inicio, y ahí mismo su
  pronóstico deja de poder editarse y pasa a ser visible para los demás. Una sola
  regla para las dos cosas (Entrada 019).
- **La jornada actual es LA ÚLTIMA QUE SE CREÓ**, y se ordena por `_id`, no por
  `createdAt` —ese campo no existe en `Jornada`—. La decide el servidor en
  `GET /api/jornada-actual` y las tres pantallas la consumen (Entradas 027 y 028).
- **El módulo de Campeón del Mundo se retiró** (Entrada 013). Sus dos colecciones
  siguen en Mongo, inertes.

### Lo que se hizo antes (fases 0 a 6, del 14 al 18 de agosto)

| Fase | Qué se hizo | Bitácora |
|---|---|---|
| **0** | Higiene: `NODE_ENV`, CORS, parser único, −63 paquetes, `legacy-data/` | 003 |
| **1** | Seguridad: helmet, rate limiting, índices, sondas de salud, reintentos de conexión | 006 |
| **2** | **Cerrada la fuga C-02** entre quinielas + 4 bugs de dominio | 007 |
| **3** | Red de pruebas: de **6 a 53 pruebas**, con MongoDB en memoria | 008, 009 |
| **4** | **Cerrados C-01 y C-05**: caché de partidos compartida, ventanas por estado, cerrojo distribuido | 010 |
| **5** | Ranking materializado (`PuntosJornada`), caché por quiniela y paginación de la tabla general | 012 |
| **6.1** | Endurecimiento: plazos del sincronizador y robustez de la lectura | 016 |
| **6.2** | Validación de dominio y privacidad por defecto de los pronósticos | 017 |
| **6.3** | Ojo para ver la contraseña; cierre por partido en vez de por jornada | 018, 019 |
| **6.4** | La caché del ranking sobrevive a los ciclos que no mueven puntos | 020 |
| **6.5** | **Cerrado S-04**: construcción de HTML sin agujeros de inyección | 021 |
| **6.6** | Transacciones en las secuencias de varias escrituras | 022 |
| **6.7** | Primeras pruebas de navegador (Playwright), escritorio y móvil | 023 |
| **6.8** | E2E de resultados y trivias; **CSP cerrada**; CI; M-26; primera tajada de módulos | 024 |
| **6.9** | El CI en verde: el comodín de `node --test` no funciona en Node 20 | 025 |

También se resolvieron dos incidentes de infraestructura (bitácoras 004 y 005) y
se absorbió `HANDOFF.md` en el Anexo A (bitácora 002).

**El consumo de APIFootball dejó de crecer con el número de quinielas.** Antes,
cien quinielas siguiendo los mismos partidos costaban cien veces más cuota que
una; ahora cuestan lo mismo, porque el partido se consulta una vez y todas leen
de la misma caché. Ver §9.4 y la bitácora 010.

### Lo que se hizo el 18 de agosto por la tarde

| Fase | Qué se hizo | Bitácora | Commit |
|---|---|---|---|
| **A** | La tarjeta *Llenar Quiniela* dejó de estirarse a 411×261 px en escritorio, y la tabla por jornada tiene tarjeta propia en la portada | 026 | `b8ce1dd` |
| **B** | Una sola regla para "la jornada actual", servida por `GET /api/jornada-actual` y consumida por las tres pantallas. Selector de jornadas en llenar quiniela; resultados oficiales abre en la sugerida; podio de la jornada en la portada | 027 | `623a6ee` |
| **B (corrección)** | La regla pasa de derivarse de las fechas de los partidos a ser el orden de creación, por decisión del usuario | 028 | `61f3dae` |

Lo que hay que recordar de la Fase B, porque no es evidente leyendo el código:

- **Lo valioso no era la regla, era que hubiera UNA.** El criterio cambió a mitad
  de camino y no importó: el endpoint, el selector y el podio siguieron en pie. Si
  mañana cambia otra vez, se toca `calcularJornadaActual()` en `server.js` y nada
  más.
- **El carrusel de la portada ahora recorre una lista**, no un booleano
  (`private/js/index-rotador.js`). El acuerdo con los paneles es uno solo: **un
  panel oculto es un panel sin nada que enseñar, y se salta**. Los paneles
  arrancan ocultos y se destapan al tener contenido.
- **Las pruebas cruzan las fechas a propósito**: la jornada más nueva lleva los
  partidos más viejos. Si se "arreglan" para que vayan alineadas, dejan de
  distinguir qué regla aplica el servidor y pasarían con cualquiera.

### Estado de Git

```
79aa6a8 Fase C: el buscador de ligas deja de ser una lista fija  ← main = origin/main
73ca4f7 La prueba de humo que faltaba, y la barra amarilla
5cca387 Poner al dia el punto de partida y el inventario
61f3dae La jornada actual pasa a ser la ultima creada
623a6ee Fase B: una sola respuesta a "cual es la jornada actual"
b8ce1dd Fase A: la tarjeta que se estiraba y la que faltaba
3cad275 Detallar cada fase del plan para poder arrancar sin volver a pensarlo
6b5876b Plan de producto: las diez peticiones analizadas y ordenadas (S20)
```

> ⚠️ Esta lista es una foto y envejece. **Comprueba con `git log --oneline` y
> `git status -sb` dónde está `main` de verdad** antes de fiarte de ella.

**Las ocho ramas de trabajo están ya contenidas en `main`** —verificado con
`git branch --merged main`, ninguna queda fuera— y se pueden borrar cuando se
quiera:

```bash
git branch -d arreglo-ci cache-ranking cinco-puntos e2e-playwright \
              fase-4-sincronizador fase-6-endurecimiento s04-xss transacciones
```

> ⚠️ **Al cambiar de rama entre `main` y cualquier commit anterior a `04f6de0`,
> `node_modules` desaparece.** Estuvo versionado hasta ese commit, así que git lo
> borra del árbol al retroceder. El síntoma es `Cannot find module 'mongoose'`.
> La cura es `npm install`, no reinstalar nada más.

### ⚠️ Antes de arrancar la aplicación, lee esto

Dos peculiaridades de este entorno que ya costaron una tarde. Ambas están
documentadas en detalle en las bitácoras 004 y 005.

1. **El clúster de Atlas es M0 gratuito y se auto-pausa.** Si la aplicación no
   conecta, lo primero es mirar en [cloud.mongodb.com](https://cloud.mongodb.com) si
   dice *Paused*, y pulsar **Resume**. Atlas **retira los registros DNS** al pausar,
   así que el síntoma es `querySrv ECONNREFUSED`, que parece un problema de red y no
   lo es. Es el hallazgo **C-06** y sigue abierto.
2. **Node no resuelve consultas SRV en esta máquina.** c-ares no consigue leer la
   configuración DNS de este Windows y cae a `127.0.0.1`, donde no hay nada
   escuchando. Por eso `.env` usa la **URI sin SRV**, con los tres nodos nombrados
   directamente. La original quedó comentada en el mismo archivo.
   **En Render (Linux) el SRV funciona bien: el despliegue debe usar
   `mongodb+srv://`.**

### Comandos habituales

```bash
npm start                  # arranca la aplicación
npm test                   # las 129 pruebas rápidas (~12 s, sin red, sin tocar la base real)
npm run test:arquitectura  # solo las 46 de arquitectura
npm run test:integracion   # solo las 83 de integración
npm run test:e2e           # las 58 de navegador (~2 min, escritorio y móvil)
npm run test:e2e:ui        # las mismas, con el inspector de Playwright
npm run check              # comprobación de sintaxis
npm audit --omit=dev       # 0 vulnerabilidades, verificado el 18-ago
```

**Las pruebas de navegador necesitan `npx playwright install chromium`** una vez
por máquina; los navegadores no van en el repositorio. No hace falta levantar
nada a mano: Playwright arranca la aplicación con una base en memoria
(`test/e2e/arrancar.js`).

---

## 🎯 LO QUE QUEDA PENDIENTE

Ordenado por lo que conviene hacer antes. Nada de esto está empezado.

### 1. Pendiente inmediato de las sesiones anteriores

**Cerrado el 19 de agosto (Entrada 029).** `main` está subido y la prueba de humo
que arrastraba la Entrada 024 dejó de ser una revisión manual pendiente: se
automatizó en `test/e2e/navegacion.spec.js`, que pulsa los **23 botones** en
escritorio y móvil y comprueba además que ninguna pantalla pinta tarjetas de
aviso vacías. Se miraron también, con capturas, el selector de jornada, el podio
de la portada, los resultados oficiales y la tabla por jornada.

Lo único que sigue sin mirarse a fondo son los **resultados de trivias**: las
pruebas de `resultados.spec.js` cubren que los datos llegan a la pantalla, pero
nadie ha vuelto a verlos con datos de verdad desde la Entrada 024.

### 2. Plan de producto (§20) — lo que falta

| Orden | Fase | Peticiones | Qué hace falta antes de empezar |
|---|---|---|---|
| ✅ | **A — Retoques de interfaz** | 4, 6 | Hecha (Entrada 026) |
| ✅ | **B — Qué es "la jornada actual"** | 1, 2, 5 | Hecha (Entradas 027 y 028) |
| ✅ | **C — Buscador de ligas dinámico** | 9 | Hecha (Entrada 030). Se buscan **7 días hacia adelante** |
| **3.º** | **D — Administración de jornadas unificada** | 3 | ⚠️ **Confirmar que se acepta perder el alta manual** de partidos. Es irreversible en la práctica. La Fase C ya está, así que es lo siguiente |
| **4.º** | **E — Verificación de correo** | 8 | ⚠️ **Elegir proveedor de correo** (tiene coste y configuración en Render). Media parte ya está hecha: el modelo `Usuario` ya tiene los campos |
| **5.º** | **F — Sugerencias de partidos destacados** | 10 | ⚠️ **Definir las heurísticas**: qué cuenta como "igualados", qué es un "clásico". Lo más especulativo y lo más caro |
| — | **Aparte 1** | 7 (SQL) | Respondida en §20.8: **no migrar** por ahora. No bloquea nada |

El detalle de cada fase —qué archivos se tocan y cómo se comprueba— está en §20.
No hay que volver a pensarlo.

### 3. Deuda técnica que sigue abierta

1. **Terminar la Fase 6 de modularización.** `server.js` sigue en **5.162
   líneas**. Hecho: `src/transacciones.js`, `src/validacion.js` y `src/fechas.js`
   (291 líneas en total). Faltan **las rutas, los modelos y el sincronizador**,
   que sí tocan Express y merecen su propia sesión con prueba de humo.
   **Dos invariantes** que hay que respetar en cada tajada: lo extraído **se
   reexporta** desde `server.js`, y los módulos de `src/` **no pueden depender de
   `server.js`** —sería un ciclo y el troceado dejaría de servir—.
2. **`style-src` conserva `unsafe-inline`.** Se cerraron `script-src` y
   `script-src-attr` (Entrada 024); los estilos no.
3. **Paginación del resto de listados (M-26).** La tabla general sí está
   paginada, y tres endpoints aceptan acotarse; el resto es deuda transversal.
4. **`Jornada` es el único esquema de dominio sin `timestamps`** (cinco de siete
   lo llevan). No se añadió porque el `_id` resuelve lo que hacía falta, pero si
   alguna vez hay que saber cuándo se **tocó** una jornada —no cuándo se creó—,
   ahí está el hueco (Entrada 028).
5. **Medios de la Entrada 015 sin resolver:** una jornada aplazada o cancelada
   queda provisional para siempre, y no hay política escrita sobre los miembros
   que entran a mitad de temporada.

### 4. Decisiones abiertas que dependen del usuario

| # | Decisión | Por qué importa |
|---|---|---|
| **C-06** | ¿Se sube el clúster de Atlas a un plan que no se pause? | Un M0 gratuito significa que la aplicación puede morir sola, sin aviso. Incompatible con el objetivo de producción |
| **M-30** | ¿Se deja la base llamándose `test` o se migra a un nombre propio? | Funciona, pero si alguien "corrige" la URI la aplicación arrancaría vacía y parecería que se perdieron los datos |
| **Render** | Definir `NODE_ENV=production`, `ALLOWED_ORIGINS` y `DEBUG_ENDPOINTS=false`, y poner `/readyz` como health check | Sin esto el despliegue no está bien configurado |

*(M-03/M-04 ya no está abierta: se congela al quedar definitivos todos los
partidos, y las correcciones conservan las reglas originales.)*

### 5. Cosas que vigilar cuando haya tráfico real

- **`/api/admin/sync-metricas` tras el primer despliegue de la Fase 4.** Es la
  forma de comprobar en producción que la deduplicación hace lo que dice:
  `consultasAhorradasPorDeduplicacion` debe crecer en cuanto haya dos quinielas
  siguiendo los mismos partidos. Desde la Entrada 016 conviene mirar también
  `ciclosAbandonadosPorTiempo`: si crece, el proveedor tarda más que el plazo del
  ciclo y hay que revisar `APIFOOTBALL_TIMEOUT_MS`.
- **`syncsSinCambioDePuntos`** en el primer domingo con partidos en vivo: debe
  crecer mucho más deprisa que `jornadasReescritas`. Si no, la caché del ranking
  se está tirando sin motivo (Entrada 020).
- **Anexo B, procedimiento C**: auditar si la fuga C-02 dañó datos. Hoy no hay
  nada que auditar (0 trivias, 0 respuestas, una sola quiniela). Repetir cuando
  haya varias quinielas y dos coincidan en el nombre de una jornada.

### 6. Trampas conocidas del entorno de trabajo

Cuestan tiempo cada vez que se olvidan:

- **El heredoc del shell se come las barras invertidas.** Editar expresiones
  regulares por `bash <<'EOF'` las corrompe en silencio. Mordió en la Entrada 024
  y tres veces más en la 027. La salida: anclar por posición y traer el texto
  nuevo desde un archivo.
- **Los archivos del repositorio mezclan finales de línea.** `server.js` y
  `avance_proyecto.md` son CRLF; `private/css/styles.css` va mezclado. Una
  búsqueda con `\n` no encuentra nada en ellos.
- **Las capturas de página completa mienten sobre la barra inferior.** Sale
  flotando a media página porque es `position: fixed`. No es un fallo de
  maquetación; no hay que "arreglarlo" (Entrada 026).
- **Los pronósticos se cierran partido a partido.** Cualquier prueba que mande un
  pronóstico a un partido cuya hora ya pasó recibirá «Partidos bloqueados» y
  parecerá un fallo del servidor. No lo es (Entrada 028).

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
18. [Anexo B — Verificación de C-02 (fuga entre quinielas)](#anexo-b--verificación-de-c-02-fuga-de-aislamiento-entre-quinielas)
19. [Bitácora de avance](#19-bitácora-de-avance)
20. [Plan de producto — las diez peticiones del 18 de agosto](#20-plan-de-producto--las-diez-peticiones-del-18-de-agosto)

---

## 1. Resumen ejecutivo

La aplicación es una **plataforma de quinielas deportivas multi-inquilino** construida
sobre Node.js + Express + MongoDB (Mongoose), con frontend en HTML/CSS/JavaScript
puro sin framework. Ya realizó la transición desde una aplicación de una sola
quiniela (mundialista) hacia un modelo donde cada usuario puede pertenecer a varias
quinielas con roles independientes en cada una.

> **Esta sección es la foto del 14 de agosto de 2026**, el día del análisis
> inicial. Se conserva tal cual porque es el punto de comparación. El estado
> vigente está en el **punto de partida**, arriba del todo, y el resumen de qué
> cambió, en la tabla del final de esta sección.

**Estado de madurez el 14 de agosto de 2026:**

| Dimensión | Estado | Comentario |
|---|---|---|
| Funcionalidad de dominio | 🟢 Muy completa | Jornadas, pronósticos, resultados oficiales, trivias y ranking |
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

**Cómo ha cambiado ese cuadro, al 17 de agosto de 2026:**

| Dimensión | 14 de agosto | Hoy |
|---|---|---|
| Multi-tenancy | 🟡 Funciona, con fugas | 🟢 Fuga C-02 cerrada y **verificada en ejecución** (Fases 2 y 3) |
| Seguridad | 🟡 Base sólida, faltan capas | 🟢 helmet, rate limiting, índices únicos, sesión regenerada, `/debug/*` tras bandera (Fase 1). Quedan S-04, S-08 y S-09 |
| Escalabilidad | 🔴 Bloqueante | 🟢 Sincronizador rediseñado: el coste dejó de depender del número de quinielas (Fase 4) |
| Mantenibilidad | 🔴 Bloqueante | 🔴 Sin cambios: `server.js` sigue siendo un solo archivo, ahora de más de 4.500 líneas. Es la Fase 6 |
| Observabilidad | 🔴 Ausente | 🟡 `/healthz`, `/readyz` y `/api/admin/sync-metricas`. Faltan logs estructurados y trazas (M-24) |
| Pruebas | 🟡 Mínimas | 🟢 **66 pruebas**, 45 de ellas de integración contra MongoDB en memoria |

De los tres bloqueantes de arriba, **el primero está resuelto** (Fase 4) y los
otros dos son las Fases 6 y 5.

---

## 2. Inventario del repositorio

> **Puesto al día el 18 de agosto de 2026 (noche).** El resto de este documento a
> partir de §3 es el análisis original del 14 de agosto y describe el sistema tal
> como estaba entonces; los cambios posteriores viven en la bitácora (§19). Este
> inventario sí se mantiene al día, porque es lo primero que se consulta al
> retomar.

### 2.1 Raíz

| Archivo | Líneas | Rol |
|---|---:|---|
| `server.js` | 5.162 | El monolito: middleware, esquemas, rutas, integraciones y jobs. La Fase 6 lo está troceando hacia `src/` |
| `avance_proyecto.md` | — | Este documento |
| `package.json` | 41 | Dependencias y scripts |
| `package-lock.json` | — | Necesario para `npm ci`, que es lo que usa el CI |
| `playwright.config.js` | 62 | Pruebas de navegador: dos proyectos —escritorio y móvil—, en serie y con un solo trabajador |
| `README.md` | 55 | Instrucciones de instalación, modelo de acceso y migración |
| `HANDOFF.md` | 65 | Acta del 9 de julio de 2026. **Superado**: su contenido íntegro vive en el Anexo A. Se conserva como histórico congelado |
| `.env` | — | Secretos locales (ignorado por Git). Usa la URI **sin SRV**; ver el punto de partida |
| `.env.example` | — | Plantilla de configuración con todas las variables |
| `.gitignore` | 6 | Ignora `.env`, `node_modules/`, `test-results/`, informes de Playwright |

**Directorios:** `src/` (módulos extraídos), `public/` (32 pantallas HTML),
`private/` (CSS y JS servidos), `test/`, `scripts/`, `legacy-data/`,
`.github/workflows/`.

> Los cinco volcados `.json` de la versión anterior a MongoDB **se movieron a
> `legacy-data/` en la Fase 0**. Ninguno se lee desde el código actual: son datos
> históricos, no configuración.

### 2.2 `src/` — lo extraído del monolito (Fase 6)

| Archivo | Líneas | Rol |
|---|---:|---|
| `validacion.js` | 143 | Validadores de dominio: marcadores, nombres de jornada, partidos, índices |
| `transacciones.js` | 89 | `enTransaccion` y la detección de bases sin soporte de transacciones |
| `fechas.js` | 59 | `parseFechaPartidoCostaRica` y `extraerFechaApi`. Costa Rica es UTC−6 todo el año |
| `ligas.js` | 160 | Fase C: rango de búsqueda, tope de días, competiciones bloqueadas y agrupado por país |

**Dos invariantes para las tajadas siguientes:** lo extraído **se reexporta**
desde `server.js` —que es la superficie pública que piden las pruebas—, y los
módulos de `src/` **no pueden depender de `server.js`**: sería un ciclo y el
troceado dejaría de servir.

### 2.3 `scripts/`

| Archivo | Líneas | Rol |
|---|---:|---|
| `migrate-legacy.js` | 101 | Migrador de la base anterior a la nueva. Simulación por defecto |

### 2.4 `test/` — 129 pruebas rápidas y 58 de navegador

| Archivo | Líneas | Rol |
|---|---:|---|
| `architecture.test.js` | 981 | **46 pruebas** que inspeccionan el TEXTO del código: invariantes que una prueba de comportamiento no ve —que no haya funciones duplicadas, que las rutas retiradas no vuelvan, que las pantallas no lleven manejadores en atributo— |
| `integracion.test.js` | 2.372 | **73 pruebas** que ejecutan el servidor de verdad contra MongoDB en memoria |
| `plantillas.js` | 87 | Utilidades compartidas de plantillas para las pruebas |

**`test/e2e/` — navegador, con Playwright.** Se lanzan aparte con
`npm run test:e2e` porque necesitan navegador y tardan más; la suite rápida debe
seguir siendo rápida.

| Archivo | Líneas | Qué cubre |
|---|---:|---|
| `arrancar.js` | 59 | Levanta la aplicación con base en memoria. Lo llama Playwright, no al revés |
| `ayudas.js` | 83 | Registro, creación de quiniela y Admin Mode. Cada prueba crea su propia cuenta |
| `csp.spec.js` | 76 | Recorre **las 32 pantallas** registrando violaciones de CSP. Necesario porque una violación **no da error visible**: el botón carga, se pulsa y no hace nada |
| `cuenta.spec.js` | 94 | Registro, sesión, creación de quiniela, ojo de la contraseña |
| `inyeccion.spec.js` | 95 | El marcado en nombres se muestra como texto y no se ejecuta (S-04) |
| `jornadas.spec.js` | 161 | Administración de jornadas y privacidad partido a partido |
| `jornada-actual.spec.js` | 202 | Fase B: las tres pantallas abren en la misma jornada |
| `importar-partidos.spec.js` | 110 | Fase C: el desplegable dinámico, las exclusiones y el proveedor caído |
| `navegacion.spec.js` | 133 | Pulsa **los 23 botones** `data-ir-a` de todas las pantallas y comprueba que ninguna pinta tarjetas de aviso vacías (Entrada 029) |
| `portada.spec.js` | 83 | Fase A: la tarjeta nueva y que ninguna se estire |
| `resultados.spec.js` | 237 | Resultados oficiales, tabla general paginada y trivias |

### 2.5 `public/` — 32 páginas HTML

Servidas estáticamente desde `express.static`.

**Públicas / de cuenta:** `login.html`, `registro.html`, `quinielas.html`, `index.html`,
`reglamento_quiniela.html`

**De participante:** `llenar_jornada_user.html`, `llenar_trivia.html`,
`ver_jornadas.html`, `ver_jugadores.html`,
`verResultados.html`, `verResultados_puntos.html`, `resultados-totales.html`,
`clasificacion-jornada.html`,
`ver-resultados-oficiales.html`, `ver_resultados_trivias.html`,
`ver_resultados_totales_de_jugadores.html`

**De administración (listadas en `paginasAdmin`):** `adminmode.html`, `jugadores.html`,
`jornadas.html`, `importar_partidos.html`, `resultados.html`,
`agregar-resultados-oficiales.html`, `generar_reporte.html`, `enviarresultados.html`,
`copiarresultadojugador.html`, `admin_trivias.html`, `enviarresultadostrivias.html`,
`enviarresultadospartido.html`, `enviarresultadostriviaspartido.html`,
`miembros.html`, `configuracion-quiniela.html`

### 2.6 `private/js/` — 39 scripts

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

### 2.7 `private/css/`

Un único `styles.css` con el sistema visual "mobile shell" (tarjetas, navegación
inferior, paneles de aplicación).

### 2.8 Dependencias

Estado **después de la Fase 1** (16 de agosto de 2026):

```
axios 1.19.0             → cliente HTTP hacia APIFootball
bcrypt ^6.0.0            → hash de contraseñas (SALT_ROUNDS = 10)
connect-mongo ^5.1.0     → almacén de sesiones en MongoDB
cors ^2.8.5              → CORS con lista blanca configurable
dotenv ^17.0.1           → variables de entorno
express ^4.21.2          → framework HTTP
express-async-errors     → captura de errores en handlers async
express-rate-limit ^8.6  → limitación de intentos (añadida en Fase 1)
express-session ^1.18.0  → sesiones
helmet ^8.3.0            → cabeceras de seguridad (añadida en Fase 1)
mongoose ^8.16.1         → ODM de MongoDB
```

✅ **`npm audit --omit=dev` → 0 vulnerabilidades** (16 de agosto de 2026, tras la
Fase 1). `axios` subió de 1.11.0 a 1.19.0 dentro del mismo rango semver, sin cambios
de ruptura.

✅ **Eliminadas en la Fase 0** (63 paquetes menos): `canvas` (no se usaba en ningún
archivo, arrastraba compilación nativa), `fs` (paquete basura que suplanta al módulo
nativo homónimo, que se sigue usando sin dependencia) y `body-parser` (redundante
desde Express 4.16).

> **Histórico:** el 16 de agosto, antes de la Fase 1, `npm audit` reportaba 11
> vulnerabilidades (3 bajas, 3 moderadas, 5 altas); en julio eran 0. Casi todas
> provenían de `axios@1.11.0`, que acumuló ~29 advisories (SSRF, prototype
> pollution, DoS, fuga de `Proxy-Authorization` en redirecciones). Se resolvieron
> con `npm audit fix` en la Fase 1.

### 2.9 Scripts de npm

```json
"start":              "node server.js"
"check":              "node --check server.js"
"test":               "node --test test/architecture.test.js test/integracion.test.js"
"test:arquitectura":  "node --test test/architecture.test.js"
"test:integracion":   "node --test test/integracion.test.js"
"test:e2e":           "playwright test"
"test:e2e:ui":        "playwright test --ui"
"migrate:legacy:dry": "node scripts/migrate-legacy.js"
"migrate:legacy":     "node scripts/migrate-legacy.js --execute"
```

> Los dos archivos de `test` van **nombrados uno a uno** y no con un comodín.
> `node --test test/*.test.js` funciona en la máquina de siempre y falla en el
> CI: el comodín lo expande el shell, y el de Windows no lo expande igual que
> el de Linux. Se descubrió al estrenar la integración continua (Entrada 025).

### 2.10 Variables de entorno

Presentes en `.env`:

| Variable | Obligatoria | Notas |
|---|---|---|
| `MONGO_URI_MULTIQUINIELA` | Sí | Sin ella el proceso termina con `exit(1)` |
| `SESSION_SECRET` | Sí en producción | En desarrollo usa `'solo-desarrollo-cambiar'` |
| `APIFOOTBALL_COM_KEY` | Sí para sincronizar | Sin ella las rutas de fútbol devuelven 500 |
| `PORT` | No | Por defecto 3000 |
| `NODE_EN` | — | ⚠️ **ERRATA** corregida en la Fase 0. Hoy es `NODE_ENV` (hallazgo S-01) |
| `ALLOWED_ORIGINS` | No | Añadida en la Fase 0. Orígenes CORS separados por comas |
| `DEBUG_ENDPOINTS` | No | Añadida en la Fase 1. Con cualquier valor distinto de `true`, los `/debug/*` responden 404 |
| `SYNC_INTERVALO_MS` | No | **Fase 4.** Cada cuánto corre un ciclo del planificador. Por defecto 60.000 |
| `SYNC_CONCURRENCIA` | No | **Fase 4.** Consultas simultáneas al proveedor. Por defecto 4 |
| `JOBS_HABILITADOS` | No | **Fase 4.** Si esta instancia ejecuta los trabajos periódicos. Por defecto `true` |
| `RANKING_CACHE_TTL_MS` | No | **Fase 5.** Vida máxima de la caché de ranking por quiniela; por defecto 60.000. Las escrituras relevantes la invalidan antes |

Variables que el código espera pero no están en `.env` (solo se usan al migrar):
`MONGO_URI_LEGACY_READONLY`, `LEGACY_DB_NAME`, `TARGET_DB_NAME`,
`MIGRATION_OWNER_EMAIL`, `MIGRATION_POOL_NAME`.

> **Nota histórica:** cuando se escribió este inventario, `.env.example` estaba
> eliminado del árbol de trabajo pese a que el README manda copiarlo. Se restauró
> y amplió en la Fase 0 (hallazgo M-22), y desde la Fase 4 documenta también las
> tres variables del sincronizador.

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

**Estado vigente (Fases 2 y 4):**

| Job | Disparo | Alcance |
|---|---|---|
| `ejecutarCicloDeSincronizacion()` | `setInterval` cada `SYNC_INTERVALO_MS` (60 s), con **cerrojo distribuido** | Recorre las quinielas **activas**, cada una en su contexto. Los partidos se consultan una sola vez, deduplicados, y solo si su ventana venció |
| `resolverTriviasDeTodasLasQuinielas()` | `setInterval` cada 5 min | Itera las quinielas activas y resuelve **dentro del contexto de cada una** |
| `sincronizarJornadaDesdeApi()` | Al final de cada ciclo, y desde la ruta manual | Una jornada, **exige contexto de inquilino** |

Siguen siendo jobs **dentro del proceso web**, pero ya no se estorban entre
instancias: el cerrojo de `joblocks` garantiza que solo una sincronice a la vez.
La bandera `JOBS_HABILITADOS` permite, cuando convenga, dejarlos en una única
instancia trabajadora sin tocar el código.

**Cómo era antes (14 de agosto de 2026):**

| Job | Disparo | Alcance |
|---|---|---|
| `sincronizarTodasLasJornadasDesdeApi()` | Middleware, si pasaron ≥30 s desde la última | Todas las quinielas del sistema |
| `resolverTriviasPendientes()` | `setInterval` cada 5 min + al final de cada sync | Sin contexto de inquilino → global |

Ambos eran **jobs dentro del proceso web** cuyo estado vivía en variables de
módulo: en cuanto hubiera más de una instancia se duplicaban y competían entre
sí. Ese era el hallazgo C-05.

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

#### `fixtures` — modelo `Fixture` *(Fase 4)*

Caché compartida del estado real de cada partido según APIFootball. **No lleva
`quinielaId` a propósito:** es justo la pieza que debe compartirse entre
quinielas, y aislarla reintroduciría el hallazgo C-01.

| Campo | Tipo | Notas |
|---|---|---|
| `clave` | String | requerida, única, indexada. Identidad compartida del partido |
| `apiFixtureId` | String | id del proveedor, vacío si el partido se importó sin él |
| `busqueda.fecha` | String | lo mínimo para volver a buscar el partido si el id no da resultado |
| `busqueda.ligaId` | String | |
| `busqueda.equipo1` / `equipo2` | String | |
| `evento` | Mixed | la respuesta cruda del proveedor, tal cual |
| `estado` | String | `TC` | `LIVE` | `MT` | `PROGRAMADO` | `DESCONOCIDO` |
| `apiDate` | String | fecha y hora de inicio, en formato del proveedor |
| `consultadoEn` | Date | |
| `proximaConsulta` | Date | indexada. **`null` significa "nunca más": el partido terminó** |
| `fallosConsecutivos` | Number | alimenta el espaciado tras un error |
| `ultimoError` | String | |

La **clave** es el `apiFixtureId` cuando existe y, si no, una clave sintética
`sin-id:<fecha>:<equipo1>|<equipo2>` con los nombres normalizados. Así, dos
quinielas que importaron el mismo partido sin id tampoco lo consultan por
separado.

#### `joblocks` — modelo `JobLock` *(Fase 4)*

Cerrojo distribuido de los trabajos periódicos. Tampoco lleva `quinielaId`.

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | String | requerido, único. Hoy solo `sincronizacion-global` |
| `instancia` | String | `<pid>-<aleatorio>`, para que cada quien suelte lo suyo |
| `tomadoEn` | Date | |
| `expiraEn` | Date | requerido. **Caduca solo**: una instancia que muere no deja el sistema bloqueado |

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

#### `puntosjornadas` — modelo `PuntosJornada` *(Fase 5)*

Materializado histórico de una jornada ya terminada. Lleva `quinielaId` mediante
`tenantPlugin` y tiene índice único `{ quinielaId, jornada }`.

| Campo | Tipo | Notas |
|---|---|---|
| `jornada` | String | nombre de la jornada congelada |
| `puntos[]` | `{ jugador, puntos }` | una entrada por jugador, sin `_id` interno para limitar tamaño |
| `puntuacion` | Object | las cuatro reglas de marcador usadas al congelar |
| `congeladoEn` | Date | cuándo se fijó o recalculó por una corrección oficial |

Se guarda **un documento por jornada**, no uno por jugador. El ranking lee pocos
documentos (uno por jornada) y pagina la salida HTTP; al corregirse un resultado se
reescribe el arreglo de esa jornada con la configuración histórica almacenada.

### 4.3 Diagrama de relaciones

```
Usuario ──1:N── Membresia ──N:1── Quiniela
   │                                  │
   │  (por username, string)          │  (por quinielaId, ObjectId)
   │                                  │
   └──> Jugador                       ├──> Jornada ──(por índice de array)──┐
   └──> Resultado.jugador             ├──> Resultado ────────────────────────┤
   └──> RespuestaTrivia.jugador       ├──> ResultadoOficial ─────────────────┤
                                      ├──> Trivia ───────────────────────────┘
                                      ├──> RespuestaTrivia ──(por triviaId string)
                                      ├──> Equipo
                                      └──> PuntosJornada
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

**✅ CORREGIDO en la Fase 2** (16 de agosto de 2026, commit de la rama
`fase-2-correccion`). La solución aplicada:

- `resolverTriviasPendientes()` pasa a ser **estrictamente por quiniela** y
  **lanza un error si se la invoca sin contexto**. La invariante deja de depender
  de que quien la llame se acuerde.
- Se añade `resolverTriviasDeTodasLasQuinielas()`, que itera las quinielas
  **activas** y envuelve cada una en su propio `tenantContext.run`.
- El `setInterval` llama al barrido global, nunca a la función por quiniela.
- Las quinielas archivadas y eliminadas quedan fuera del barrido: nadie va a
  puntuar ahí y recorrerlas solo gastaba llamadas al API externo.
- El fallo de una quiniela ya no interrumpe el barrido de las demás.

> ⚠️ **Alcance de la verificación:** la corrección está fijada por pruebas
> estructurales y el servidor arranca limpio, pero **no está probada en
> ejecución con dos quinielas reales que compartan nombre de jornada**. Esa
> prueba es precisamente el punto 24 de la Fase 3.

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
| `user` | Pronosticar, responder trivias y ver rankings |

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
| GET | `/api/clasificacion-jornada?jornada=…` | `/api` gate — clasificación de una jornada; sin parámetro usa la más reciente |

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

### 7.9 Equipos

| Método | Ruta | Guardia |
|---|---|---|
| GET | `/api/equipos` | `/api` gate |
| POST | `/actualizar-equipos` | `requireAdmin` |

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

Más un bloque adicional: **Trivias**, suma de `RespuestaTrivia.puntos` de todas las
respuestas del jugador.

### 8.2 Forma de la respuesta

```json
{
  "Marco":  { "Trivias": 3, "Jornada1": 12, "Jornada2": 8, "total": 23 },
  "Andrea": { "Trivias": 5, "Jornada1": 9,  "Jornada2": 15, "total": 29 }
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

> ✅ **RESUELTO en la Fase 4** (17 de agosto de 2026, bitácora 010). Lo que sigue
> describe el mecanismo **anterior** y se conserva porque explica *por qué* el
> rediseño era necesario y qué medía cada número. El diseño vigente
> —caché compartida de partidos, ventanas por estado y cerrojo distribuido— está
> en §16, Fase 4, y en la bitácora 010.

#### Cómo era antes

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

#### Cómo es ahora

Los siete problemas de la lista de arriba están cerrados:

| Problema anterior | Qué lo resuelve |
|---|---|
| Se dispara con el tráfico de los usuarios | `setInterval` propio, `SYNC_INTERVALO_MS` |
| Una llamada al API por partido **y por quiniela** | Caché compartida `fixtures`, con clave por partido |
| Se autollama por HTTP a `localhost` | `sincronizarJornadaDesdeApi()` dentro de `tenantContext.run` |
| Resincroniza partidos terminados eternamente | Estado `TC` → `proximaConsulta = null`, nunca más |
| No distingue quinielas activas de archivadas | El ciclo solo recorre las `activa` |
| `for` secuencial: un timeout retrasa todo | Limitador de concurrencia, `SYNC_CONCURRENCIA` |
| `syncEnProceso` en memoria: dos instancias, dos syncs | Cerrojo distribuido en `joblocks` |

Y el token interno que existía solo para que la autollamada se saltara su propia
autenticación —una vía que concedía rol de administrador sin sesión— se eliminó
con ella.

**El coste dejó de depender del número de quinielas.** Con 100 quinielas
siguiendo los mismos 30 partidos se pasa de ~360.000 llamadas por hora a menos de
1.800, y a **cero** cuando esos partidos han terminado.

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

Las siete colecciones de dominio migrables: `jugadors`, `jornadas`, `resultados`,
`resultadooficials`, `trivias`, `respuestatrivias` y `equipos`.

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

### 13.1 Suite actual — 75 pruebas

Estado tras añadir la clasificación por jornada (17 de agosto de 2026). Corren en **~14 segundos, sin red y
sin tocar la base real**. La primera corrida en una máquina nueva tarda más:
`mongodb-memory-server` descarga su binario una sola vez.

```bash
npm test                   # las dos suites: 75 pruebas
npm run test:arquitectura  # 25 sobre el texto del código
npm run test:integracion   # 50 contra un MongoDB en memoria
```

| Suite | Pruebas | Qué comprueba |
|---|---:|---|
| `test/architecture.test.js` | 25 | Invariantes estructurales por expresiones regulares sobre `server.js` y `migrate-legacy.js` |
| `test/integracion.test.js` | 50 | El servidor en ejecución: HTTP real con `supertest` contra `mongodb-memory-server` |

### 13.2 Las dos naturalezas, y para qué sirve cada una

**Las de arquitectura** no ejecutan una línea de código: comprueban que ciertas
decisiones no se reviertan por descuido. Suenan pobres pero han demostrado su valor —
por ejemplo, la que fija `scriptSrcAttr: 'unsafe-inline'` explica *por qué* está ahí,
de modo que nadie lo "endurezca" y deje la interfaz inerte.

Cuidado con una trampa ya vista dos veces: las comprobaciones del tipo *"esto ya no
está en el código"* fallaban al encontrar el texto viejo **en los comentarios que
explican el cambio**. Para eso existe `serverSinComentarios`; úsalo en toda
aserción negativa.

**Las de integración** sí ejercitan el sistema: registran cuentas, crean quinielas,
abren sesiones, escriben en la base y leen la respuesta HTTP.

### 13.3 Cobertura actual

| Área | Estado |
|---|---|
| Aislamiento multi-inquilino (C-02) | ✅ Verificado en ejecución, incluidas escrituras y borrados |
| Motor de puntuación | ✅ Las cuatro reglas, marcadores nulos y trivias |
| Invariantes de roles | ✅ Último administrador, autoexpulsión, Admin Mode, transferencia |
| Autenticación | ✅ Unicidad, mensajes que no filtran, login por usuario o correo |
| Índices únicos | ✅ S-10 verificado en ejecución |
| Normalización de APIFootball | ✅ Estados, filtro de goles, marcador a 90', equipos invertidos |
| Autorresolución de trivias | ✅ Los 8 tipos |
| Deuda documentada | ✅ M-03 fijado con una prueba, para que congelar los puntos sea deliberado |

### 13.4 Lo que sigue sin cubrirse

- **El frontend.** 39 scripts sin ninguna prueba. Ligado al hallazgo S-04 (XSS).
- **Concurrencia real**: dos usuarios escribiendo a la vez el mismo pronóstico.

---

## 14. Estado de Git y cambios sin confirmar

### 14.1 Historial

> **El historial vigente está al principio del documento**, en
> [🔖 PUNTO DE PARTIDA](#-punto-de-partida--última-actualización-16-de-agosto-de-2026),
> junto con el comando para fusionar la cadena de ramas. Se mantiene ahí y no aquí
> para que haya un solo sitio que actualizar.

Al cierre del 16 de agosto de 2026: **11 commits**, cinco ramas encadenadas, árbol
de trabajo limpio, `main` todavía en `f92462b`.

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

### ✅ Hallazgos ya resueltos

| ID | Hallazgo | Resuelto en |
|---|---|---|
| **S-01** | `NODE_EN` en lugar de `NODE_ENV` | Fase 0 |
| **S-05** | Lista blanca de CORS apuntando al dominio anterior | Fase 0 |
| **S-06** | Límite de 10 KB del cuerpo que no se aplicaba | Fase 0 — verificado: ahora devuelve 413 |
| **M-17** | Dependencias sin usar (`canvas`, `fs`, `body-parser`) | Fase 0 |
| **M-18** | Cinco `.json` heredados en la raíz | Fase 0 |
| **M-22** | `.env.example` eliminado | Fase 0 |
| **B-09** | Sin `engines` en `package.json` | Fase 0 |
| **S-02** | Sin limitación de intentos | Fase 1 — verificado: 429 al superar la cuota |
| **S-03** | Sin `helmet` ni cabeceras de seguridad | Fase 1 |
| **S-07** | El registro no regeneraba la sesión | Fase 1 |
| **S-10** | `RespuestaTrivia` sin índice único → puntos dobles | Fase 1 |
| **S-11** | Guardia de páginas admin sin verificar rol | Fase 1 — verificado: redirige |
| **S-12** | `process.exit(1)` al primer fallo de conexión | Fase 1 |
| **S-13** | Error de conexión sin distinguir causas | Fase 1 |
| **M-20** | Endpoints `/debug/*` activos en producción | Fase 1 — verificado: 404 con la bandera apagada |
| **M-23** | Sin health checks | Fase 1 — `/healthz` y `/readyz` |
| **M-25** | Falta índice en `Trivia` | Fase 1 |
| **M-32** | El manejador de errores convertía los 4xx en 500 | Fase 1 — *hallazgo nuevo, ver bitácora 006* |
| **C-02** | Fuga de aislamiento en la resolución de trivias | Fase 2 — ⚠️ falta prueba en ejecución (Fase 3) |
| **M-07** | `partidoYaInicio` y `parseFechaPartido` duplicadas | Fase 2 |
| **M-08** | `/generar_reporte` registrada dos veces | Fase 2 |
| **M-09** | `/api/football/leagues-test` duplicada | Fase 2 |
| **M-11** | `esGolApiFootball` anulaba goles de "Varela", "Varane"… | Fase 2 |
| **M-15** | Constante `CINCO_MINUTOS` con valor de 30 segundos | Fase 2 |
| **C-01** | El auto-sync consultaba el API una vez por partido **y por quiniela** | Fase 4 — caché compartida, ventanas por estado y fin de la autollamada HTTP |
| **C-05** | Los trabajos vivían en el proceso web con estado en variables de módulo | Fase 4 — cerrojo distribuido en `joblocks` y bandera `JOBS_HABILITADOS` |

### 🔴 Críticos — bloquean el crecimiento

| ID | Hallazgo | Ubicación | Efecto |
|---|---|---|---|
| **C-03** | `/api/resultados-totales` lee 6 colecciones completas y recalcula todo el ranking en cada petición | `server.js:3299-3422` | Latencia creciente y consumo de memoria proporcional al histórico total |
| **C-04** | `server.js` monolítico de más de 4.500 líneas | todo el archivo | Cada cambio es riesgoso; imposible dividir el trabajo entre varias personas |
| **C-06** | La base vive en un clúster **MongoDB Atlas M0 gratuito**, que Atlas **pausa automáticamente** tras un periodo de inactividad | infraestructura | La aplicación queda muerta sola, sin aviso y sin recuperación. Detectado en producción el 16-ago-2026, ver bitácora 004 |

> **Nota sobre las referencias de línea:** los números de `server.js` de estas
> tablas corresponden al estado analizado el 14 de agosto de 2026 (commit
> `f92462b`). **Ya no son fiables**: tras la Fase 4 el archivo creció de 3.584 a
> más de 4.500 líneas y zonas enteras se reescribieron. Sirven para saber *en qué
> parte* del archivo mirar, no como coordenada exacta; para localizar algo, busca
> por nombre de función.

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
| **M-01** | El vínculo con el jugador es por `username` (cadena), no por `ObjectId` | modelos `Resultado`, `RespuestaTrivia`, `Jugador` |
| **M-02** | El vínculo partido↔pronóstico es por índice de array, sin identidad estable | `Jornada.partidos[]` |
| **M-03** | Cambiar la configuración de puntuación **reescribe el histórico** de jornadas ya jugadas | `server.js:3378-3407` |
| **M-04** | Incoherencia: los puntos de trivia sí quedan congelados; los de partido no | `Trivia`/`RespuestaTrivia` vs. `/api/resultados-totales` |
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
| **M-30** | **La base de datos se llama `test`.** La URI nunca especificó nombre, así que MongoDB usó su valor por defecto. Las 13 colecciones y todos los datos reales viven ahí | `.env` |
| **M-31** | La URI de desarrollo usa el formato sin SRV, que **fija los nombres de los tres nodos** del clúster. Si Atlas cambia la topología, dejan de ser válidos | `.env`, ver bitácora 005 |

**Sobre M-30:** no es urgente —funciona— pero tiene una trampa. Si alguien "corrige"
la URI poniéndole un nombre propio (`/quiniela`), la aplicación arrancaría contra una
base vacía y **parecería que se perdieron todos los datos**. No se perderían, seguirían
en `test`, pero la reacción instintiva sería restaurar un respaldo encima. Dos salidas:
dejarlo y escribir `/test` de forma explícita en la URI (ya hecho en desarrollo), o
copiar las colecciones a una base con nombre propio y cambiar la URI a la vez.

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
| **B-11** | `sincronizarJornadaDesdeApi` reescribe el array completo de `ResultadoOficial.resultados` aunque solo cambie un partido. Correcto, pero desperdicia escritura; se resuelve con la Fase 5 |

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

### ✅ Fase 1 — Seguridad de base y resiliencia — COMPLETADA el 16 de agosto de 2026

Ver bitácora, entrada 006.

| # | Tarea | Estado |
|---:|---|---|
| 8-bis | `npm audit fix` **(11 vulnerabilidades)** | ✅ 0 vulnerabilidades; `axios` 1.11.0 → 1.19.0 |
| 8-ter | Reintentos con retroceso exponencial **(S-12)** | ✅ Hasta 60 s entre intentos, sin techo de reintentos |
| 8-ter | Diagnóstico diferenciado del error de conexión **(S-13)** | ✅ Distingue DNS, credenciales, lista de IPs, red y rechazo |
| 8-ter | Decidir el plan del clúster **(C-06)** | ⏳ **Decisión de negocio, sigue pendiente** |
| 9 | `helmet` con CSP ajustada **(S-03)** | ✅ Verificado en respuesta real |
| 10 | `express-rate-limit` **(S-02)** | ✅ Login 10/15 min (solo fallos), registro 5/h, Admin Mode 5/15 min |
| 11 | Regenerar la sesión en el registro **(S-07)** | ✅ Hecho |
| 12 | Índice único en `RespuestaTrivia` **(S-10)** | ✅ Hecho |
| 13 | Índice en `Trivia` **(M-25)** | ✅ Hecho |
| 14 | Verificar rol en la guardia de `paginasAdmin` **(S-11)** | ✅ Verificado: redirige según sesión, quiniela y rol |
| 15 | `/debug/*` tras bandera de entorno **(M-20)** | ✅ `DEBUG_ENDPOINTS`, responde 404 |
| 16 | `/healthz` y `/readyz` **(M-23)** | ✅ Declarados antes de la sesión |
| + | Manejador de errores que respeta los 4xx **(M-32)** | ✅ *Hallazgo nuevo durante las pruebas* |

**Único punto pendiente de la Fase 1: C-06**, que no es trabajo de código sino una
decisión sobre el plan de MongoDB Atlas. Un clúster M0 gratuito se auto-pausa, y eso
es incompatible con el objetivo de producción.

### ✅ Fase 2 — Fuga de inquilino y bugs de dominio — COMPLETADA el 16 de agosto de 2026

Ver bitácora, entrada 007.

| # | Tarea | Estado |
|---:|---|---|
| 17 | Reescribir `resolverTriviasPendientes()` **(C-02)** | ✅ Función por quiniela que **exige contexto**, más barrido global que itera quinielas activas. ⚠️ Falta prueba en ejecución (Fase 3) |
| 18 | Eliminar `partidoYaInicio` y `parseFechaPartido` duplicadas **(M-07)** | ✅ Eran código muerto: las declaraciones de función se elevan y ganaba siempre la segunda |
| 19 | Arreglar `esGolApiFootball` **(M-11)** | ✅ `/\bvar\b/` en lugar de `includes('var')` |
| 20 | Quitar `/generar_reporte` duplicada y `leagues-test` **(M-08, M-09)** | ✅ Verificado: `/generar_reporte` sigue devolviendo 200 |
| 21 | Renombrar `CINCO_MINUTOS` **(M-15)** | ✅ `INTERVALO_MINIMO_ENTRE_SYNCS_MS` |

### ✅ Fase 3 — Red de seguridad de pruebas — COMPLETADA el 16 de agosto de 2026

*Prerrequisito indispensable antes de refactorizar.* Ver bitácora, entradas 008 y 009.

| # | Tarea | Estado |
|---:|---|---|
| 22 | Montar `mongodb-memory-server` + `supertest` | ✅ Arnés funcionando, ~8 s por corrida |
| 23 | Pruebas del motor de puntuación | ✅ Las cuatro reglas, marcadores nulos y trivias |
| 24 | **Pruebas de aislamiento multi-inquilino** | ✅ **C-02 verificado en ejecución**, ver Anexo B |
| 25 | Pruebas de las invariantes de roles | ✅ Último administrador, autoexpulsión, Admin Mode y transferencia de propiedad |
| 26 | Pruebas de normalización de APIFootball | ✅ Estados, filtro de goles, marcador a 90' y equipos invertidos |
| 27 | Pruebas de autorresolución de trivias para los 8 tipos | ✅ Los 8, con eventos sintéticos del proveedor |

**Total: 53 pruebas** (17 de arquitectura + 36 de integración), de **6** al empezar
el día. Sin red y sin tocar la base real.

### ✅ Fase 4 — Rediseño del sincronizador — COMPLETADA el 17 de agosto de 2026

*Era el bloqueante real de escala.* Ver bitácora, entrada 010.

| # | Tarea | Estado |
|---:|---|---|
| 28 | Planificador con bloqueo distribuido **(C-05)** | ✅ Colección `joblocks`, cerrojo con caducidad de 5 min. Se optó por el cerrojo en vez de `worker.js`: mismo efecto, sin partir el despliegue. La bandera `JOBS_HABILITADOS` deja la puerta abierta a separarlo |
| 29 | Llamada de función directa en vez de autollamada HTTP **(C-01)** | ✅ `sincronizarJornadaDesdeApi()` dentro de `tenantContext.run`. La ruta quedó como envoltura fina |
| + | Retirar `INTERNAL_SYNC_TOKEN` y su puerta | ✅ *Consecuencia del punto 29:* concedía rol de administrador sin sesión y solo existía para la autollamada |
| 30 | Deduplicar por partido | ✅ Colección global `fixtures`, con clave sintética para los partidos sin `apiFixtureId` |
| 31 | Ventanas de sincronización | ✅ Terminado nunca, en vivo 60 s, inminente 15 min, lejano 6 h, más un tope que impide saltarse el inicio y un umbral de abandono |
| 32 | Paralelismo controlado | ✅ Limitador propio, `SYNC_CONCURRENCIA`. El retroceso tras un fallo es la ventana de error de 10 min |
| 33 | Registrar el consumo de cuota | ✅ `GET /api/admin/sync-metricas`, con `consultasAhorradasPorDeduplicacion`. Contadores por instancia: consolidarlos es M-24 |
| + | Pruebas del sincronizador | ✅ 13 nuevas, de 53 a **66** |

**Efecto medido:** con 100 quinielas siguiendo los mismos 30 partidos, de ~360.000
llamadas por hora a menos de 1.800, y a **cero** cuando esos partidos terminaron.
Lo importante no es el factor: es que **el coste dejó de depender del número de
quinielas**.

### Fase 5 — Rendimiento del ranking (1–2 sesiones)

34. **Materializar los puntos por jornada** en una colección `PuntosJornada`
    `{quinielaId, jugador, jornada, puntos, calculadoEn}`, recalculada solo cuando
    cambia un resultado oficial de esa jornada. **(C-03)** ✅ Implementado en el
    árbol local como un documento por jornada con un arreglo de jugadores; las
    ediciones de jornada, pronósticos y oficiales lo recalculan o invalidan.
35. Decidir y aplicar la política de congelamiento: **congelar los puntos al cerrar
    la jornada** resuelve M-03 y M-04 de una vez. ✅ **Implementada localmente:**
    todos los partidos deben ser definitivos; una corrección posterior conserva
    las reglas originales.
36. Caché en memoria (o Redis) del ranking con invalidación por evento. ✅ Caché
    en memoria por quiniela, TTL configurable e invalidación tras mutaciones.
37. Paginación en todos los listados. **(M-26)** 🟡 La tabla general ya usa
    paginación de servidor; el resto de listados queda como deuda transversal.

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
                  trivias.js, football.js, debug.js
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
43. **Identidad estable**: migrar los vínculos de `username` a `usuarioId`, y de
    índice de array a `partidoId`. **(M-01, M-02)**
44. **Registro de auditoría** de acciones administrativas. **(M-28)**
45. **Notificaciones** por correo o push: solicitud de ingreso, aprobación, cierre
    de jornada, resultados publicados. **(M-29)**
46. **Rotación y caducidad del código de ingreso.** **(M-27)**
47. **Resolución manual de trivias** cuando el API falla.
48. **Escapado sistemático en el frontend**: función `escapar()` compartida o
    migración a `textContent`. **(S-04)**
49. **Observabilidad**: `pino` para logs estructurados, métricas Prometheus,
    Sentry para errores. **(M-24)**

### Resumen de prioridades

| Prioridad | Fases | Por qué |
|---|---|---|
| ✅ **Hecho** | 0, 1, 2, 3, 4 | Riesgo real cerrado, red de pruebas puesta y escala desbloqueada |
| **Ahora** | 5 | El ranking es el siguiente cuello de botella, y arrastra una decisión de producto (M-03, M-04) |
| **Al crecer** | 6 | Mantenibilidad: el monolito sigue siendo un solo archivo |
| **Continuo** | 7 | Producto |

---

## 20. Plan de producto — las diez peticiones del 18 de agosto

> **Estado: analizado y ordenado. Las Fases A y B están completadas** (Entradas
> 026 y 027, 18 de agosto de 2026); el resto sigue sin empezar. Se aborda una
> fase a la vez.

Las diez peticiones se agrupan en **cinco fases más dos apartes**. El criterio
para agrupar no es el tema sino la **dependencia**: cosas que comparten una
decisión de fondo se hacen juntas, porque implementarlas por separado significa
resolver esa decisión dos o tres veces y arriesgarse a resolverla distinto.

### 20.1 Resumen del orden propuesto

| Orden | Fase | Peticiones | Por qué aquí |
|---|---|---|---|
| ✅ **1.º** | **A — Retoques de interfaz** | 4, 6 | Pequeñas, visibles y sin riesgo. Valor inmediato con la red de pruebas ya montada. **Completada el 18-ago-2026** |
| ✅ **2.º** | **B — Qué es "la jornada actual"** | 1, 2, 5 | Las tres dependen de la MISMA decisión sin tomar. Hacerlas juntas la resuelve una sola vez. **Completada el 18-ago-2026** |
| ✅ **3.º** | **C — Buscador de ligas** | 9 | Habilita la fase D. Hacerla después dejaría la pantalla nueva peor que la actual. **Completada el 19-ago-2026** |
| **4.º** | **D — Administración de jornadas unificada** | 3 | El cambio estructural grande, y necesita que buscar partidos ya funcione bien |
| **5.º** | **E — Verificación de correo** | 8 | Independiente de todo lo demás; se puede adelantar o retrasar sin coste |
| **6.º** | **F — Sugerencias de partidos** | 10 | Lo más especulativo y lo más caro. Depende de C |
| — | **Aparte 1** | 7 (SQL) | Es una pregunta, no una tarea. Respondida abajo; no bloquea nada |
| — | **Aparte 2** | — | Terminar la Fase 6 y cerrar `style-src`, cuando convenga |

**Por qué no en el orden en que se pidieron.** Tres razones concretas:

1. **La petición 3 iba antes que la 9**, y es al revés. Si los partidos van a
   venir **solo** del API, encontrarlos tiene que ser bueno *antes* de quitar la
   alternativa manual. Al revés se entrega una pantalla peor que la de hoy.
2. **Las peticiones 1, 2 y 5 estaban separadas** y en realidad son la misma:
   las tres preguntan "¿cuál es la jornada actual?", y hoy nadie lo tiene
   decidido.
3. **La 7 no es una tarea.** Contestarla no cuesta nada y no bloquea a nadie.

---

### ✅ 20.2 Fase A — Retoques de interfaz *(peticiones 4 y 6)* — COMPLETADA el 18 de agosto de 2026

| # | Petición |
|---|---|
| **4** | El escritorio se ve mal: el botón de *llenar jornada* es desproporcionado |
| **6** | La tabla por jornada solo se alcanza desde la barra inferior; que tenga también su tarjeta |

Ambas tocan solo maquetación y una tarjeta en Inicio. Van primero porque son
baratas, se ven de inmediato y no arrastran ninguna decisión.

**Ojo con una cosa:** la interfaz está construida sobre `mobile-shell` y el móvil
es el caso principal. Cualquier arreglo de escritorio no puede empeorar el móvil,
y las pruebas de navegador corren en ambos, así que lo detectarían.

**Qué se toca**

| Archivo | Cambio |
|---|---|
| `private/css/styles.css` | Puntos de ruptura para escritorio; que las tarjetas grandes dejen de estirarse |
| `public/index.html` | Tarjeta nueva hacia `clasificacion-jornada.html` |

**Cómo se comprueba:** las pruebas de navegador ya corren en escritorio y móvil.
Se añade una que fije que la tarjeta nueva existe y navega, y otra que el botón
de llenar jornada no ocupa toda la anchura en escritorio.

**Sin decisiones pendientes.** Se puede empezar tal cual.

**Cómo quedó (Entrada 026).** El diagnóstico del plan era el equivocado: la
tarjeta no ocupaba toda la anchura —eso ya estaba bien—, sino que medía
**411×261 px** de alto contra los 88 de sus compañeras, porque compartía fila de
rejilla con el panel del rotador y se estiraba hasta su altura. Se arregla
haciendo que el rotador ocupe la fila entera a partir de 720 px. La tarjeta de
`clasificacion-jornada.html` va junto a la Tabla General. Cuatro pruebas nuevas
en `test/e2e/portada.spec.js`, verificadas reintroduciendo ambos fallos.

---

### ✅ 20.3 Fase B — Qué es "la jornada actual" *(peticiones 1, 2 y 5)* — COMPLETADA el 18 de agosto de 2026

| # | Petición |
|---|---|
| **1** | En *llenar jornada*, abrir siempre la última pero **poder elegir anteriores**: puede haber dos jornadas jugándose a la vez |
| **2** | En *resultados oficiales*, abrir la última por defecto |
| **5** | En Inicio, junto al top 3 general y los partidos en vivo, mostrar el **top 3 de la jornada** |

**La decisión de fondo, que es lo que hay que resolver primero.** Hoy "la última
jornada" se decide de tres maneras distintas y ninguna es buena:

| Dónde | Cómo se elige hoy |
|---|---|
| Tabla por jornada | `sort({ createdAt: -1 })` — la creada más recientemente |
| Llenar jornada | `data[data.length - 1]` — la última del arreglo, sin orden garantizado |
| Resultados oficiales | No hay: el usuario elige a mano |

`createdAt` es la **fecha en que se creó el registro**, no cuándo se juega. Una
jornada importada tarde se convierte en "la última" aunque sus partidos sean de
la semana pasada. Esto ya estaba anotado como pendiente en la Entrada 015, y la
petición 1 lo vuelve urgente: **con dos jornadas jugándose a la vez, "la última"
deja de ser una pregunta con una sola respuesta.**

Lo que hay que decidir, y es decisión de producto:

- ¿La jornada actual es **la que tiene partidos jugándose ahora**? ¿Y si hay dos?
- ¿O la que tiene **el próximo partido por empezar**?
- ¿Hace falta un **número de orden** explícito en la jornada, puesto por quien la
  crea, en vez de deducirlo de las fechas?

**Recomendación original (NO es lo que se hizo — ver la decisión más abajo):**
derivarla de las fechas de los partidos, no de `createdAt`
ni de un número que haya que mantener a mano. "Jornada actual" = la que contiene
el partido más próximo (hacia adelante o hacia atrás) sin resultado definitivo. Y
como la petición 1 dice que puede haber dos a la vez, la pantalla **siempre**
lleva selector: se abre en la sugerida y se puede cambiar.

Una vez decidido, la regla vive en **un solo sitio** del servidor y las tres
pantallas la consumen. Es lo mismo que se hizo con el cierre por partido en la
Entrada 019, y por la misma razón: tres copias de una regla acaban discrepando.

**Qué se toca**

| Pieza | Cambio |
|---|---|
| `server.js` | Una función `jornadaActual()` —o `jornadasEnCurso()`, si se admite más de una— derivada de las fechas de los partidos |
| `GET /api/jornadas` | Un campo que diga cuál es la sugerida, o un endpoint `/api/jornada-actual` |
| `GET /api/clasificacion-jornada` | Deja de usar `createdAt` |
| `llenar_jornada_user.js` | Abre en la sugerida y **añade selector** de jornadas anteriores |
| `ver-resultados-oficiales.js` | Abre en la sugerida en vez de dejar el desplegable vacío |
| `index.html` + script | Tarjeta con el top 3 de la jornada, consumiendo `/api/clasificacion-jornada` |

**Cómo se comprueba:** pruebas de integración con dos jornadas solapadas y con
una importada tarde —el caso que hoy rompe `createdAt`—, más pruebas de
navegador de que cada pantalla abre en la correcta y el selector funciona.

**Decisión tomada el 18-ago-2026:** la jornada actual es **la última que se
creó**. Se descartó la recomendación de derivarla de las fechas: quien administra
la quiniela crea las jornadas en orden según avanza la temporada, así que el
orden de creación es el orden real, y una regla que se explica en una frase vale
más que una que acierte en algún caso raro más. Las pantallas se abren en ella y
**siempre** llevan selector.

**Lo que se acepta a cambio:** una jornada importada tarde se presenta como la
actual aunque sus partidos ya se hayan jugado. Se corrige en un clic con el
selector.

**Cómo quedó (Entradas 027 y 028).** El servidor sirve la jornada actual en
`GET /api/jornada-actual`, junto con la lista de nombres, y las **tres pantallas
la consumen**: eso era lo que había que arreglar, y es lo que se queda pase lo
que pase con el criterio.

El criterio, tras la Entrada 028, es el orden de creación, y se ordena por
**`_id`, no por `createdAt`**: el esquema de `Jornada` nunca declaró
`timestamps`, así que ese campo **no existe** y el `sort({ createdAt: -1 })` que
había ordenaba por un campo ausente —no ordenaba nada, y de ahí salía buena parte
de la discrepancia entre pantallas—. El `_id` de Mongo lleva dentro la marca de
creación, así que sirve también para las jornadas que ya existen, sin migración.

La Entrada 027 había implementado la regla por fechas de los partidos, con tres
grupos y distancia absoluta. Se retiró al cambiar la decisión; el módulo
`src/jornada-actual.js` ya no existe.

---

### ✅ 20.4 Fase C — Buscador de ligas dinámico *(petición 9)* — COMPLETADA el 19 de agosto de 2026

> Que sea fácil buscar ligas: mexicana, tica, torneos centroamericanos… que el
> combobox se llene con **las ligas que de verdad tienen partidos ese día**.

**Hoy el combobox es una lista fija escrita a mano** en
`public/importar_partidos.html`: unas veinte opciones con el país y el nombre de
la liga incrustados. Si el proveedor cambia el nombre de una competición, la
opción deja de encontrar nada y nadie se entera.

La petición ya trae la solución correcta dentro: **consultar los partidos del día
y derivar de ahí las ligas disponibles**. Se acaba la lista fija, se acaban las
opciones muertas, y aparecen automáticamente los torneos que hoy no están.

Puntos a resolver:

- **Cuota del proveedor.** Es una consulta por día consultado; conviene apoyarse
  en la caché de `Fixture` que ya existe desde la Fase 4.
- **El filtro de exclusiones se queda.** Hay una lista de palabras bloqueadas
  (sub-20, reservas, femenil…) que seguirá haciendo falta.
- **Agrupar por país**, que es como la gente busca.

**Qué se toca**

| Pieza | Cambio |
|---|---|
| `server.js` | Endpoint que devuelva las ligas con partidos en un rango de fechas, apoyado en la caché de `Fixture` |
| `public/importar_partidos.html` | Fuera la lista fija de ~20 torneos |
| `private/js/importar_partidos.js` | El desplegable se llena de la respuesta; el filtro de exclusiones se conserva |

**Cómo se comprueba:** pruebas de integración con un proveedor simulado —el
arnés `proveedorFalso` ya existe— comprobando que se agrupan por país, que las
exclusiones siguen aplicándose y que un día sin partidos no rompe la pantalla.

**Decisión tomada el 19-ago-2026: se consultan 7 días hacia adelante.** Una
semana cubre la jornada completa de casi cualquier liga sin disparar el consumo
del proveedor, y es el rango con el que se arma una jornada normal.

**Cómo quedó (Entrada 030).** El arreglo de fondo no fue la lista sino **con qué
se identifica una liga**: el desplegable trae ahora el `league_id` del propio
proveedor, así que renombrar una competición ya no deja la opción muerta.
`src/ligas.js` guarda la parte pura —rango, tope de días, exclusiones, agrupado
por país— y `GET /api/football/ligas-disponibles` la sirve, con caché de diez
minutos y `requireAdmin`.

Tres cosas que no estaban en el plan y conviene saber: **el filtro de
exclusiones subió al servidor y ahora se aplica siempre** —antes solo si había
torneo elegido—; **hay un tope de 300 partidos** en pantalla; y **si el
proveedor falla el desplegable no se queda vacío**, quedan «Todos los torneos» y
«Buscar por texto» y un mensaje que dice qué pasó.

---

### 20.5 Fase D — Administración de jornadas unificada *(petición 3)*

> Que *agregar jornada* pase a ser **agregar / modificar / eliminar / ver**, y que
> los partidos salgan **solo del API**: desaparece *importar desde API* como
> pantalla aparte.

Es el cambio estructural más grande de la lista. Hoy hay **dos pantallas** que
hacen lo mismo por caminos distintos: `jornadas.html` (a mano, con autocompletado
de equipos) e `importar_partidos.html` (desde el API). Unificarlas simplifica de
verdad.

**Lo que hay que confirmar antes de empezar**, porque es irreversible en la
práctica: quitar la entrada manual significa que **no se podrá crear una jornada
con un partido que el API no tenga**. Si alguna vez hace falta un amistoso, un
torneo local o un partido que el proveedor no cubre, deja de ser posible. Con el
buscador de la fase C funcionando el riesgo baja mucho, pero conviene decirlo en
voz alta antes y no descubrirlo un domingo.

**Qué se toca**

| Pieza | Cambio |
|---|---|
| `public/jornadas.html` | Pasa a ser la única pantalla: crear, modificar, eliminar y ver |
| `public/importar_partidos.html` | Desaparece; su buscador se integra en la anterior |
| `private/js/jornadas.js` | Absorbe lo de `importar_partidos.js`; se retira el alta manual y el autocompletado de equipos |
| `server.js` | Las rutas ya sirven; `/api/jornadas/importar-api` puede fusionarse con `POST /api/jornadas` |
| Barras de navegación | Fuera el enlace a importar |

**Cómo se comprueba:** las pruebas de navegador de la fase B ya cubren crear y
editar; se amplían al flujo completo en una sola pantalla. La prueba de
arquitectura que exige que toda referencia a un archivo exista detectaría un
enlace huérfano a la pantalla retirada.

**Decisión pendiente (producto):** confirmar que se acepta perder el alta manual.

---

### 20.6 Fase E — Verificación de correo electrónico *(petición 8)*

> Cambiar el registro para que se verifique el correo.

**Media parte ya está hecha sin saberlo:** el modelo `Usuario` ya tiene
`emailVerificado`, `tokenVerificacion` y `expiracionTokenVerificacion`. Los
campos existen y no se usan.

Lo que falta:

1. Generar el token al registrarse y guardarlo con su caducidad.
2. **Enviar el correo** — y aquí está la única dependencia externa de todo el
   plan: hace falta un proveedor de envío (Resend, SendGrid, SMTP propio). Es una
   decisión con coste y con configuración en Render.
3. La ruta de confirmación y su pantalla.
4. **Decidir qué se bloquea sin verificar.** ¿Se puede entrar y no unirse a
   quinielas? ¿No se puede ni entrar? Esto es producto, no técnica.
5. Reenvío del correo, porque siempre se pierde alguno.

Va después de las fases A–D porque **no bloquea a ninguna** y porque su
dependencia externa puede tardar. Si el proveedor se decide pronto, puede
adelantarse sin tocar nada de lo demás.

**Qué se toca**

| Pieza | Cambio |
|---|---|
| `POST /api/auth/registro` | Genera token y caducidad; envía el correo |
| `server.js` | Ruta de confirmación y de reenvío |
| `public/` | Pantalla de "revisa tu correo" y de confirmación |
| `.env.example` | Credenciales del proveedor y URL pública para los enlaces |
| Middleware | El bloqueo que se decida para las cuentas sin verificar |

**Cómo se comprueba:** pruebas de integración con el envío simulado —token
válido, caducado, ya usado y reenvío—, más una de navegador del alta completa.

**Decisiones pendientes:** proveedor de correo (tiene coste y configuración en
Render) y **qué se bloquea sin verificar**.

---

### 20.7 Fase F — Sugerencias de partidos destacados *(petición 10)*

> Al elegir una liga, sugerir partidos interesantes: clásicos, equipos igualados
> en puntos, pelea por el liderato o por el descenso.

Es la petición más ambiciosa y la más cara, y va última por eso. Necesita algo que
hoy la aplicación **no tiene ni consulta**: la **tabla de posiciones** de cada
liga.

- Los clásicos no se pueden deducir de los datos: son cultura, no estadística.
  Requieren una lista mantenida a mano (Saprissa–Alajuelense, América–Chivas…).
- "Igualados en puntos", "pelea por el liderato" y "pelea por el descenso" **sí**
  se pueden calcular, pero solo con la clasificación de la liga, que es otra
  consulta al proveedor y otra caché.

Conviene empezar por lo barato —los clásicos con una lista— y ver si aporta antes
de construir lo de la clasificación.

**Qué se toca**

| Pieza | Cambio |
|---|---|
| Datos | Lista de clásicos por liga, mantenida a mano |
| `server.js` | Consulta y caché de la clasificación de la liga; heurísticas de "igualados", "liderato" y "descenso" |
| Pantalla de jornadas | Marcar los partidos sugeridos, con el motivo visible |

**Cómo se comprueba:** las heurísticas son funciones puras y se prueban sueltas,
igual que el motor de puntuación.

**Decisiones pendientes:** qué cuenta como "igualados" (¿misma puntuación?,
¿menos de N de diferencia?) y cuántos puestos se consideran zona de descenso o de
liderato. Depende de cada liga.

---

### 20.8 Aparte — ¿Pasar de MongoDB a SQL? *(petición 7)*

**Respuesta corta: es caro, y hoy no hay ningún problema que lo justifique.**

Qué implicaría, concretamente:

| Pieza | Qué habría que rehacer |
|---|---|
| **Modelos** | Todo lo que hoy va incrustado se convierte en tablas: los partidos dentro de la jornada, los resultados dentro de `ResultadoOficial`, los puntos dentro de `PuntosJornada`, los pronósticos dentro de `Resultado` |
| **Aislamiento multi-quiniela** | El `tenantPlugin` mete el filtro por `quinielaId` automáticamente en toda consulta. En SQL habría que reimplementarlo, y **es la pieza donde ya hubo una fuga (C-02)** |
| **~100 rutas** | Todas hablan Mongoose |
| **Sincronizador** | Caché de partidos, cerrojo distribuido y métricas |
| **113 pruebas + arnés** | `mongodb-memory-server` no sirve |

Es, en la práctica, **reescribir la capa de datos entera**. Y lo importante: los
problemas de escala que sí existían —el consumo del API, el recálculo del ranking
en cada petición— **se resolvieron sin cambiar de base**, con deduplicación,
materialización y caché.

**Cuándo sí valdría la pena:** si aparecieran consultas relacionales complejas
(informes cruzando varias temporadas), si hiciera falta integridad referencial
estricta, o si el equipo fuera a ser mayoritariamente de perfil SQL.

**Recomendación:** no hacerlo por ahora. Si hay un problema concreto detrás de la
pregunta —lentitud, un informe que no sale, incomodidad al consultar— conviene
nombrarlo: casi seguro tiene solución mucho más barata dentro de MongoDB.

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

## Anexo B — Verificación de C-02 (fuga de aislamiento entre quinielas)

> **Qué se verifica:** que la resolución automática de trivias de una quiniela
> nunca use los datos de otra, aunque ambas tengan una jornada con el mismo
> nombre —que es lo normal: `"Jornada1"` se repite en todas—.
>
> Hay tres procedimientos, con propósitos distintos. **El C es el único urgente**,
> porque el fallo estuvo activo en producción y pudo dejar datos mal.

---

### B.1 — Procedimiento A: la prueba automática *(la vía normal)*

Desde la carpeta del proyecto:

```bash
npm run test:integracion
```

Deben pasar las cuatro pruebas que empiezan por `C-02:` y la de escrituras:

```
✔ C-02: dos quinielas con el mismo nombre de jornada no se contaminan
✔ C-02: sin contexto, la consulta SÍ cruza — de ahí la necesidad del guardia
✔ C-02: resolverTriviasPendientes se niega a correr sin contexto de quiniela
✔ C-02: el barrido global recorre cada quiniela en su propio contexto
✔ el aislamiento se aplica también a las escrituras y los borrados
```

No necesita conexión a internet ni a tu base: levanta un MongoDB en memoria y lo
tira al terminar. **No toca los datos reales.** Tarda unos 7 segundos.

Si alguna falla, el aislamiento está roto y **no debe desplegarse nada**.

---

### B.2 — Procedimiento B: verificación manual de extremo a extremo

Sirve para confirmar el comportamiento **en un entorno real**, con Atlas y
APIFootball de verdad, que es lo único que la prueba automática no cubre.

> ⚠️ Hazlo en una base de pruebas, no en la de producción. Si no tienes otra,
> usa quinielas desechables y bórralas al final (paso 7).

**Paso 1 — Preparar dos cuentas y dos quinielas**

1. Registra dos cuentas: `pruebaA` y `pruebaB`.
2. Con `pruebaA`, crea la quiniela **"Prueba Aislamiento A"**.
3. Con `pruebaB`, crea la quiniela **"Prueba Aislamiento B"**.

No hace falta que una cuenta pertenezca a las dos: el fallo no dependía de eso,
sino de los nombres de jornada repetidos.

**Paso 2 — Crear en AMBAS una jornada con el mismo nombre**

En las dos quinielas, crea una jornada llamada exactamente **`Jornada1`**. El
nombre idéntico es el corazón de la prueba: es lo que hacía que la consulta sin
filtro devolviera el documento equivocado.

**Paso 3 — Poner partidos en estados opuestos**

Es lo que hace la prueba concluyente:

| Quiniela | Partido a importar | Estado que debe tener |
|---|---|---|
| **A** | Uno que **ya terminó** (busca una fecha pasada en *Importar partidos*) | `TC` |
| **B** | Uno que **aún no se juega** (fecha futura) | `PROGRAMADO` |

Tras importarlos, entra a *Ver resultados oficiales* en cada quiniela y confirma
que A muestra el partido terminado y B el pendiente.

**Paso 4 — Crear una trivia en la quiniela B**

En **B**, entra a *Admin trivias* y crea una trivia sobre su partido (el que no se
ha jugado). Cualquier tipo sirve; `¿Ambos equipos anotan?` es el más simple.

Pon una **fecha de cierre ya pasada** (ayer). Esto la deja *vencida pero sin
resolver*, que es exactamente el estado que el barrido periódico intenta procesar.

**Paso 5 — Provocar el barrido**

El barrido corre solo cada 5 minutos. Tienes dos opciones:

- **Esperar 5 minutos** con el servidor levantado, o
- **Reiniciar el servidor** y esperar los 5 minutos del primer disparo.

**Paso 6 — Comprobar el resultado**

Vuelve a *Admin trivias* en la quiniela **B**.

| Resultado | Interpretación |
|---|---|
| La trivia de B **sigue sin resolver** | ✅ **Correcto.** El partido de B no ha terminado, así que no debe resolverse. El aislamiento funciona |
| La trivia de B **aparece resuelta** | ❌ **La fuga sigue viva.** Se resolvió usando el partido *terminado* de la quiniela A. No despliegues; reabre C-02 |

También puedes comprobarlo directamente en la base:

```javascript
// En mongosh, sobre la base de la aplicación
db.trivias.find(
  { jornadaNombre: "Jornada1" },
  { quinielaId: 1, jornadaNombre: 1, resuelta: 1, respuestaCorrecta: 1 }
)
```

La trivia cuya `quinielaId` sea la de **B** debe tener `resuelta: false` y
`respuestaCorrecta` vacía.

**Paso 7 — Limpiar**

Borra las dos quinielas de prueba desde *Configuración de quiniela → Eliminar*.
El borrado es lógico (marca `estado: 'eliminada'`), así que no se pierde nada del
resto.

---

### B.3 — Procedimiento C: auditoría de los datos existentes ⚠️

**Este es el único urgente.** Los procedimientos A y B comprueban que el fallo ya
no ocurre; este comprueba **si alcanzó a hacer daño mientras estuvo activo**.

Ejecuta en `mongosh`, sobre la base de la aplicación. **Es de solo lectura.**

```javascript
// ¿Hay nombres de jornada repetidos entre quinielas? Si no los hay,
// la fuga nunca tuvo ocasión de manifestarse.
db.resultadooficials.aggregate([
  { $group: { _id: "$jornada", quinielas: { $addToSet: "$quinielaId" } } },
  { $project: { jornada: "$_id", cuantasQuinielas: { $size: "$quinielas" } } },
  { $match: { cuantasQuinielas: { $gt: 1 } } }
])
```

- **Sin resultados** → ninguna jornada compartía nombre entre quinielas, así que
  la fuga **no pudo activarse**. No hay nada que reparar.
- **Con resultados** → esos nombres de jornada son los sospechosos. Sigue con la
  consulta de abajo.

```javascript
// Trivias resueltas cuyo propio partido NO está terminado en su quiniela.
// Cada documento que salga aquí es una trivia resuelta con datos ajenos.
db.trivias.aggregate([
  { $match: { resuelta: true } },
  { $lookup: {
      from: "resultadooficials",
      let: { q: "$quinielaId", j: "$jornadaNombre" },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ["$quinielaId", "$$q"] },
          { $eq: ["$jornada", "$$j"] }
        ] } } }
      ],
      as: "oficialPropio"
  } },
  { $addFields: { partido: {
      $first: { $filter: {
        input: { $ifNull: [{ $first: "$oficialPropio.resultados" }, []] },
        cond: { $or: [
          { $and: [ { $eq: ["$$this.equipo1", "$equipo1"] }, { $eq: ["$$this.equipo2", "$equipo2"] } ] },
          { $and: [ { $eq: ["$$this.equipo1", "$equipo2"] }, { $eq: ["$$this.equipo2", "$equipo1"] } ] }
        ] }
      } }
  } } },
  { $match: { $or: [
      { partido: null },
      { "partido.estado": { $ne: "TC" } }
  ] } },
  { $project: { quinielaId: 1, jornadaNombre: 1, equipo1: 1, equipo2: 1,
                tipo: 1, respuestaCorrecta: 1, estadoPropio: "$partido.estado" } }
])
```

**Si devuelve documentos**, cada uno es una trivia que se resolvió sin que su
propio partido hubiera terminado — la firma exacta de la fuga. Reparación:

```javascript
// 1) Anotar los _id afectados antes de tocar nada.
// 2) Reabrir esas trivias y poner a cero los puntos de sus respuestas:
const afectadas = [ /* pega aquí los _id del paso anterior */ ];
db.trivias.updateMany(
  { _id: { $in: afectadas } },
  { $set: { resuelta: false, respuestaCorrecta: "" } }
);
db.respuestatrivias.updateMany(
  { triviaId: { $in: afectadas.map(String) } },
  { $set: { puntos: 0 } }
);
```

El barrido corregido las volverá a resolver, ahora con los datos de su propia
quiniela.

**Estado conocido al 16 de agosto de 2026:** en la base actual hay **0 trivias y
0 respuestas de trivia**, y una sola quiniela. La fuga, por tanto, **no llegó a
corromper nada**. Esta auditoría cobra sentido cuando haya varias quinielas en
marcha, y conviene repetirla la primera vez que dos quinielas coincidan en el
nombre de una jornada.

---

## 19. Bitácora de avance

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

### 📌 Entrada 005 — 16 de agosto de 2026 — Segundo incidente: Node no resuelve SRV

**Síntoma:** reanudado el clúster y con las IPs en *Active*, la aplicación **seguía**
sin conectar, con el mismo mensaje que en el incidente anterior:
`querySrv ECONNREFUSED _mongodb._tcp.cluster0.fjjzrhl.mongodb.net`

Mismo mensaje, **causa distinta**. El incidente 004 fue el clúster pausado; este es un
problema del resolutor DNS de Node en esta máquina Windows.

**Cómo se aisló:**

| # | Comprobación | Resultado |
|---:|---|---|
| 1 | SRV vía `Resolve-DnsName -Server 8.8.8.8` | ✅ Resuelve 3 nodos — el clúster ya está publicado |
| 2 | IP pública vs. IP autorizada en Atlas | ✅ `186.15.21.132` coincide exactamente |
| 3 | TCP al puerto 27017 de los tres nodos | ✅ Los tres conectan |
| 4 | Conexión real con el driver | ❌ `querySrv ECONNREFUSED` |
| 5 | `dns.getServers()` en Node | `127.0.0.1` |
| 6 | `dns.resolveSrv` forzando `dns.setServers(['8.8.8.8'])` | ✅ Funciona |

**La contradicción que lo explica todo:** el TCP a los nodos funcionaba mientras la
consulta SRV fallaba. Node usa **dos resolutores distintos**: `getaddrinfo` del sistema
operativo para `lookup()` y para abrir sockets —que funciona— y **c-ares con su propia
lista de servidores** para `resolveSrv()`, `resolve4()` y demás. Solo el segundo estaba
roto. Como `mongodb+srv://` obliga a una consulta SRV, la conexión moría antes de
intentar nada.

**Causa raíz:** c-ares no consigue enumerar la configuración DNS de este Windows y cae
a su valor por defecto, `127.0.0.1`, donde no hay ningún servidor escuchando — de ahí
el `ECONNREFUSED` inmediato. Windows funciona con normalidad porque usa su propia API:
`Resolve-DnsName` y `nslookup` responden bien, y por eso el problema parece invisible
desde fuera de Node. Node v24.18.0 y c-ares 1.34.6, ambos actuales: **no se arregla
actualizando**.

**Hipótesis descartada por el camino:** se pensó que la causa era que los DNS llegaban
por DHCP (`DhcpNameServer` con valores, `NameServer` vacío en el registro) y que c-ares
solo leía el segundo. Se fijaron los DNS de forma estática con
`Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses 8.8.8.8,1.1.1.1`;
el registro quedó correcto y **c-ares siguió reportando `127.0.0.1`**. La teoría era
falsa: c-ares no lee el registro, usa `GetAdaptersAddresses`. El cambio de DNS puede
revertirse con `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses`.

**Solución aplicada:** cambiar la URI de desarrollo al **formato sin SRV**, que nombra
los tres nodos del clúster directamente y por tanto no necesita consulta SRV:

```
mongodb://<credenciales>@ac-8j5wktv-shard-00-00.fjjzrhl.mongodb.net:27017,
                        ac-8j5wktv-shard-00-01.fjjzrhl.mongodb.net:27017,
                        ac-8j5wktv-shard-00-02.fjjzrhl.mongodb.net:27017
        /test?ssl=true&replicaSet=atlas-z3r9e6-shard-0&authSource=admin
             &retryWrites=true&w=majority&appName=Cluster0
```

Es un formato soportado por Atlas (*Connect → Drivers*, opción de driver antiguo). La
URI original quedó **comentada dentro del propio `.env`** para poder volver atrás.

**Alcance del problema:** afecta solo a esta máquina de desarrollo. En Render (Linux)
la resolución SRV funciona con normalidad, así que **el despliegue debe seguir usando
`mongodb+srv://`**. Es una diferencia deliberada entre entornos.

**Hallazgos nuevos:**

| ID | Hallazgo |
|---|---|
| **M-30** | La base de datos se llama `test`: la URI nunca especificó nombre. Todos los datos reales viven ahí |
| **M-31** | La URI sin SRV fija los nombres de los tres nodos; si Atlas cambia la topología del clúster, dejan de ser válidos |

**Endurecimiento colateral:** `.gitignore` solo ignoraba `.env` exactamente. Cualquier
variante (`.env.backup`, `.env.local`) se habría versionado **con las credenciales
dentro**. Ahora ignora `.env.*` con excepción explícita para `.env.example`.

**Estado de los datos, verificado durante el diagnóstico:**

```
usuarios 8 · membresias 7 · resultados 7 · jugadors 6
jornadas 1 · quinielas 1 · resultadooficials 1 · resto 0
```

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `.env` | URI al formato sin SRV, original comentada (no versionado) |
| `.gitignore` | Ignora `.env.*`, salvo `.env.example` |
| `avance_proyecto.md` | M-30, M-31 y esta entrada |

**Pendiente / siguiente paso:** prueba de humo de la Fase 0, ya desbloqueada.

---

### 📌 Entrada 006 — 16 de agosto de 2026 — Fase 1: seguridad de base y resiliencia

**Objetivo:** cerrar los hallazgos de seguridad de severidad alta y dar a la
aplicación capacidad de sobrevivir a una base momentáneamente indispuesta.

**Rama:** `fase-1-seguridad`, creada desde `fase-0-higiene`.

**Precondición:** la prueba de humo de la Fase 0 la confirmó el usuario.

**Qué se hizo:**

1. **`npm audit fix`** → de 11 vulnerabilidades a **0**. `axios` 1.11.0 → 1.19.0,
   dentro del mismo rango semver, sin cambios de ruptura.
2. **`helmet`** con CSP a medida. Ver más abajo la trampa que casi rompe la interfaz.
3. **`express-rate-limit`** en las cuatro rutas de autenticación, con cuotas
   independientes por ruta:
   - Login: 10 por 15 min, **contando solo los intentos fallidos**. Un usuario
     legítimo nunca consume cuota.
   - Registro: 5 por hora, contando todos, contra creación masiva de cuentas.
   - Admin Mode: 5 por 15 min. Es el punto más rentable para un atacante, porque
     quien llega ahí ya tiene sesión y rol; solo le falta la contraseña.
4. **Regeneración de sesión en el registro**, igual que ya hacía el login.
5. **Índice único** `{quinielaId, jugador, triviaId}` en `RespuestaTrivia`. Sin él,
   dos envíos simultáneos duplicaban la respuesta y el jugador cobraba **el doble de
   puntos**. Se pudo crear sin migración porque la colección está vacía.
6. **Índice** `{quinielaId, jornadaNombre, partidoIndex, tipo}` en `Trivia`.
7. **Guardia de páginas administrativas con verificación de rol.** Antes solo
   comprobaba que hubiera sesión, así que cualquier usuario descargaba el HTML
   administrativo. Corre antes del middleware de inquilino, así que consulta la
   membresía a mano; el coste es una consulta indexada en 15 rutas.
8. **`/debug/*` tras la bandera `DEBUG_ENDPOINTS`.** Responden **404**, no 403: así
   no revelan siquiera que la ruta existe.
9. **Conexión a MongoDB con reintentos** y retroceso exponencial hasta 60 s, más
   `diagnosticarErrorMongo()`, que traduce el error crudo a una de cinco causas
   accionables. El servidor **escucha de inmediato** sin esperar a la base.
10. **`/healthz` y `/readyz`**, declarados deliberadamente **antes** del middleware
    de sesión: con la base caída, el almacén de sesiones bloquearía la petición, y
    una sonda que se cuelga no diagnostica nada.

**La trampa de helmet que casi rompe la aplicación:**

> `helmet` **fusiona** las directivas que le pasas con sus valores por defecto, y
> entre esos defaults está **`script-src-attr 'none'`**, que bloquea los manejadores
> en atributo. El frontend tiene **63 `onclick`**, así que la interfaz habría
> cargado con normalidad y los botones simplemente no habrían respondido: un fallo
> silencioso, sin error visible en pantalla. `'unsafe-inline'` en `script-src` **no**
> cubre este caso; son directivas independientes.
>
> Se corrigió con `scriptSrcAttr: ["'unsafe-inline'"]` y quedó fijado por una prueba
> con el porqué explicado, para que nadie lo revierta creyendo que endurece la
> política. También se retiró `upgrade-insecure-requests` en desarrollo, que helmet
> añadía por defecto.

**Hallazgo nuevo (M-32): el manejador de errores convertía los 4xx en 500.** Apareció
al enviar por error un JSON malformado durante las pruebas: la respuesta fue `500`
en lugar de `400`. El manejador global ignoraba `error.status`, así que cualquier
error de cliente —JSON inválido, cuerpo demasiado grande— se reportaba como fallo del
servidor, ensuciando los registros y despistando el diagnóstico. Corregido.

**Verificación — contra el servidor realmente en ejecución, no solo por regex:**

```
/healthz                        → 200 {"estado":"vivo"}
/readyz                         → 200 {"estado":"listo","mongo":"conectado"}
CSP                             → script-src-attr 'unsafe-inline' presente ✓
                                  upgrade-insecure-requests ausente en desarrollo ✓
X-Frame-Options, nosniff,
Referrer-Policy, Origin-Agent-Cluster → presentes ✓
/debug/trivia-goles/123         → 404 (bandera apagada)
/jornadas.html sin sesión       → 302 a /login.html
login con credenciales falsas   → 401, mensaje genérico
login, intentos 1-4             → 401 · intento 11 en adelante → 429
cuotas independientes           → login 10/15min, registro 5/h ✓
JSON malformado                 → 400 (antes 500)
cuerpo de 20 KB                 → 413  ← confirma que el límite de la Fase 0 es real
npm run check                   → válido
npm test                        → 13/13
npm audit --omit=dev            → 0 vulnerabilidades
```

> El **413** merece mención aparte: confirma que el arreglo S-06 de la Fase 0
> funciona de verdad. Antes de esa corrección el límite de 10 KB era decorativo.

**Nota de la sesión:** las pruebas se hicieron en el puerto 3100 para no interferir
con la instancia que el usuario tenía en el 3000. Al terminar no quedó ningún proceso
`node` vivo; los comandos de parada apuntaban solo al 3100, así que no está claro qué
detuvo la instancia del usuario. Sin consecuencias: se recupera con `npm start`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Conexión con reintentos, diagnóstico, helmet, limitadores, sondas de salud, guardia de rol, bandera de depuración, regeneración de sesión, índices, manejador de errores |
| `test/architecture.test.js` | 7 pruebas nuevas: 6 → 13 |
| `package.json` | `helmet`, `express-rate-limit` |
| `.env.example` | `DEBUG_ENDPOINTS` documentada |
| `avance_proyecto.md` | §2.7, §15, §16 y esta entrada |

**Pendiente / siguiente paso:**

1. **C-06 sigue abierto** y es decisión del usuario: el plan M0 se auto-pausa.
2. Definir `DEBUG_ENDPOINTS=false` en Render junto con `NODE_ENV` y `ALLOWED_ORIGINS`.
3. Configurar `/readyz` como health check del servicio en Render.
4. **Fase 2**: la fuga de aislamiento entre quinielas en las trivias (C-02) es el
   único fallo de corrección conocido y está corrompiendo datos en silencio.

---

### 📌 Entrada 007 — 16 de agosto de 2026 — Fase 2: fuga de inquilino y bugs de dominio

**Objetivo:** cerrar el único fallo de corrección conocido (C-02) y los bugs de
dominio que lo acompañaban.

**Rama:** `fase-2-correccion`, creada desde `fase-1-seguridad`.

**C-02 — la fuga de aislamiento entre quinielas.**

El barrido periódico de trivias corría desde un `setInterval`, **fuera de todo
`tenantContext.run`**. Sin contexto, el plugin de inquilino no aplica filtro, así que
esta consulta buscaba en **todas** las quinielas:

```js
const oficial = await ResultadoOficial.findOne({ jornada: trivia.jornadaNombre });
```

Como los nombres de jornada se repiten entre quinielas —`"Jornada1"` va a ser la
norma—, `findOne` devolvía el documento de la primera que MongoDB encontrara. La
trivia de una quiniela se resolvía, o se quedaba sin resolver, **según el estado del
partido de otra**. Nadie veía un error: simplemente los puntos salían mal.

Lo agravaba que el comportamiento era **inconsistente según la vía de entrada**: por
la ruta `/api/sync-resultados-oficiales/:jornada` sí había contexto y funcionaba
bien; por el `setInterval` no.

**Corrección aplicada:**

1. `resolverTriviasPendientes()` es ahora estrictamente **por quiniela** y **lanza un
   error si se la invoca sin contexto**. La invariante deja de depender de que quien
   la llame se acuerde de envolverla: si alguien lo olvida, falla de inmediato y con
   un mensaje que dice qué usar en su lugar.
2. Se añade `resolverTriviasDeTodasLasQuinielas()`, que itera las quinielas **activas**
   y envuelve cada una en su propio `tenantContext.run`.
3. El `setInterval` llama al barrido global.
4. Las **archivadas y eliminadas quedan fuera**: nadie va a puntuar ahí, y recorrerlas
   solo gastaba llamadas al API externo.
5. El fallo de una quiniela ya no interrumpe el barrido de las demás.

**Los otros cuatro arreglos:**

| Hallazgo | Qué pasaba |
|---|---|
| **M-07** | `partidoYaInicio` y `parseFechaPartido` estaban declaradas **dos veces**. Como las declaraciones de función se elevan, ganaba siempre la segunda, así que el primer par era código muerto — y además engañoso al leer, porque interpretaba `apiDate` en la zona horaria del servidor en vez de la de Costa Rica. Eliminado el par muerto |
| **M-11** | `esGolApiFootball` descartaba cualquier gol cuyo `info` contuviera `"var"` como subcadena. Un gol de **Varela, Varane, Álvarez o Navarro** se anulaba: gol legítimo, jugador sin sus puntos de trivia, ningún error visible. Ahora es `/\bvar\b/`, palabra completa |
| **M-08, M-09** | `/generar_reporte` registrada dos veces y `/api/football/leagues-test` copia literal de `/api/football/leagues`. Ninguna usada por el frontend. Eliminadas las dos muertas |
| **M-15** | La constante `CINCO_MINUTOS` valía **30 segundos**. Ese desfase entre nombre y valor es justo lo que ocultaba el coste real del auto-sync: son 10 disparos cada cinco minutos, no uno. Renombrada a `INTERVALO_MINIMO_ENTRE_SYNCS_MS` |

**Pruebas nuevas:** 13 → **17**. Cuatro pruebas que fijan cada invariante, incluida
una que comprueba que el `setInterval` llame al barrido global y nunca a la función
por quiniela.

**Mejora en la propia suite de pruebas.** Tres pruebas fallaron contra su propia
documentación: las comprobaciones del tipo "esto ya no está en el código" encontraban
el texto viejo **en los comentarios que explican qué se cambió y por qué**. Ya había
pasado en la Fase 1 con `process.exit(1)`, donde se resolvió reformulando el
comentario; al repetirse, se atacó la causa. Ahora existe `serverSinComentarios`, que
elimina bloques `/* */` y líneas íntegramente de comentario, y las comprobaciones
negativas se hacen contra esa versión. Solo se descartan líneas que son comentario
completo, así que nunca se oculta código real ni se ablanda la comprobación.

**Verificación:**

```
npm run check                 → válido
npm test                      → 17/17
arranque del servidor         → limpio, /readyz 200 mongo:conectado
/generar_reporte              → 200 (sigue sirviendo desde el bloque de rutas HTML)
/api/football/leagues-test    → ya no responde como ruta propia
```

⚠️ **Límite de la verificación de C-02:** la corrección está fijada por pruebas
estructurales y el servidor arranca limpio, pero **no está probada en ejecución con
dos quinielas reales que compartan nombre de jornada**. Hacerlo exigiría crear datos
de prueba en la base de producción. Esa prueba es el punto 24 de la Fase 3, y hasta
entonces C-02 debe considerarse *corregido estructuralmente, no verificado en
comportamiento*.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Barrido por quiniela, guardia de contexto, `\bvar\b`, par de funciones muertas eliminado, dos rutas duplicadas eliminadas, constante renombrada |
| `test/architecture.test.js` | 4 pruebas nuevas + `serverSinComentarios` |
| `avance_proyecto.md` | §5.3, §15, §16 y esta entrada |

**Pendiente / siguiente paso:** **Fase 3 — red de seguridad de pruebas**, que además
es la que permite verificar de verdad C-02. Es prerrequisito de la Fase 4, donde está
el bloqueante real de escala (C-01, el auto-sync con APIFootball).

---

### 📌 Entrada 008 — 16 de agosto de 2026 — Fase 3: red de seguridad de pruebas

**Objetivo:** pasar de 6 pruebas que solo leen el texto del código a una suite que
ejecuta el servidor de verdad, y **verificar C-02 en comportamiento**, no solo en
estructura.

**Rama:** `fase-3-pruebas`, creada desde `fase-2-correccion`.

**El obstáculo previo:** `server.js` abría el puerto y se conectaba a Mongo al
importarse, así que `supertest` no podía usarlo. Se resolvió con el mínimo
imprescindible, sin partir el monolito —eso es Fase 6—:

- `EJECUTADO_DIRECTAMENTE` (`require.main === module`) envuelve el `app.listen` y la
  conexión: al importar, el módulo no abre puerto, no conecta y no arranca trabajos.
- `ENTORNO_DE_PRUEBAS` (`NODE_ENV === 'test'`) apaga el auto-sync —que si no
  golpearía APIFootball de verdad y se autollamaría a un puerto cerrado—, el
  `setInterval` de trivias y los limitadores de tasa, que si no bloquearían las
  propias pruebas a la sexta cuenta creada.
- `module.exports` expone 21 símbolos: `app`, `tenantContext`, los 12 modelos y las
  funciones de dominio bajo prueba.

**Qué se cubrió (22 pruebas de integración):**

| Área | Pruebas |
|---|---|
| **Aislamiento C-02** | Dos quinielas con jornada homónima no se contaminan; sin contexto la consulta sí cruza (documenta el fallo original); `resolverTriviasPendientes` se niega a correr sin contexto; el barrido recorre cada quiniela en la suya; el aislamiento cubre escrituras y borrados |
| **Motor de puntuación** | Las cuatro reglas de una pasada (exacto 5, signo 3, exacto con comodín 7, signo con comodín 4); marcadores nulos; campeón normalizando mayúsculas y espacios; suma de trivias |
| **Roles y Admin Mode** | No se puede degradar al último administrador ni expulsar al propietario; el Admin Mode exige contraseña correcta y **no se arrastra al cambiar de quiniela**; las rutas administrativas rechazan a quien no lo ha confirmado |
| **Autenticación** | Unicidad global de usuario y correo; mensaje de error idéntico exista o no la cuenta; login con usuario o con correo; 409 sin quiniela activa |
| **Índices** | **S-10 verificado en ejecución**: la segunda respuesta a la misma trivia choca contra el índice único |
| **APIFootball** | Normalización de los 10 estados crudos; **M-11**: los goles de Varela, Varane, Álvarez y Navarro ya no se anulan |
| **Deuda documentada** | **M-03**: cambiar la puntuación reescribe el histórico. No es una corrección: fija el comportamiento actual para que, cuando la Fase 5 decida congelar, el cambio sea deliberado y esta prueba falle a propósito |

**La trampa que costó entender — y que conviene no olvidar:**

> La primera versión de la prueba de aislamiento **falló**, y parecía que la
> corrección de la Fase 2 no servía: escribiendo desde el contexto de B y leyendo
> desde el contexto de B, `findOne` devolvía el documento de **A**.
>
> No era el código: era la prueba. **Las consultas de Mongoose son perezosas.**
> `Model.findOne()` construye la consulta pero no la ejecuta, y el gancho
> `pre(/^find/)` que aplica el filtro por quiniela corre en la **ejecución**. El
> ayudante estaba escrito como `run(store, () => Model.findOne(...))`, así que
> `run` devolvía la consulta sin ejecutar y el `await` ocurría ya **fuera** del
> contexto: `AsyncLocalStorage` devolvía `undefined`, el filtro no se aplicaba y la
> consulta veía todas las quinielas.
>
> La corrección es poner el `await` **dentro** del `run`. El código de producción
> nunca tuvo este problema, porque el middleware envuelve `next()` y los
> manejadores async empiezan a ejecutarse ya dentro del contexto; lo mismo vale
> para `resolverTriviasDeTodasLasQuinielas`, que invoca una función async y por
> tanto arranca en contexto.
>
> Queda como advertencia porque es una forma silenciosa de escribir una prueba de
> aislamiento que **siempre falla**, o peor, de escribir código de producción que
> **nunca filtra**.

**Cambios en la ejecución de pruebas:**

```
npm test               → las dos suites (39 pruebas)
npm run test:arquitectura
npm run test:integracion
```

El patrón es `node --test "test/**/*.test.js"`. Con `node --test test/` Node
intenta resolver `test` como módulo y falla.

**Verificación:**

```
npm run check          → válido
npm test               → 39/39  (17 arquitectura + 22 integración)
duración               → ~7 s, sin red y sin tocar la base real
```

**C-02 pasa de "corregido estructuralmente" a "verificado en comportamiento".**

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Importable sin efectos secundarios, `module.exports`, apagados de pruebas |
| `test/integracion.test.js` | **Nuevo**, 22 pruebas |
| `package.json` | `mongodb-memory-server` y `supertest` como dependencias de desarrollo; scripts de prueba |
| `avance_proyecto.md` | **Anexo B** con los tres procedimientos de verificación de C-02, §16 y esta entrada |

**Pendiente / siguiente paso:**

1. Cerrar lo que falta de la Fase 3: autorresolución de trivias para los 8 tipos
   (lo más grande), marcador a 90 minutos y transferencia de propiedad.
2. **Anexo B, procedimiento C** — auditar si la fuga alcanzó a dañar datos. Hoy no:
   hay 0 trivias y 0 respuestas. Repetir cuando haya varias quinielas activas.
3. **Fase 4 — el rediseño del sincronizador**, que es el bloqueante real de escala
   (C-01). Ya con red de seguridad debajo.

---

### 📌 Entrada 009 — 16 de agosto de 2026 — Cierre de la Fase 3

**Objetivo:** completar los tres huecos que quedaban de la entrada 008.

**De 39 a 53 pruebas.** Las 14 nuevas:

**Autorresolución de trivias, los 8 tipos (punto 27).** Se cubren con eventos
sintéticos que reproducen la forma real de la respuesta de APIFootball
(`goalscorer`, `cards`, `statistics`), así que no hace falta ni red ni clave del
proveedor. Casos cubiertos:

| Tipo | Qué se comprueba |
|---|---|
| `primer_gol` | Gana el gol de **menor minuto**, aunque venga después en el arreglo; sin goles responde "Nadie anotará" |
| `primer_gol` invertido | **Equipos invertidos por el API**: si el proveedor pone de local al que se guardó como visitante, el gol se sigue atribuyendo al equipo correcto |
| `ambos_anotan` | Exige gol de los dos; con goles de uno solo, o sin goles, responde "No" |
| `gol_primer_tiempo` / `gol_segundo_tiempo` | El corte está en el 45, y un gol en el **45+2** cuenta como primer tiempo |
| `mas_amarillas` | Conteo por `cards`, empate y ausencia de tarjetas |
| `mas_amarillas` respaldo | Si `cards` viene vacío recurre a `statistics`, que evita resolver "no hubo amarillas" cuando sí las hubo |
| `mas_rojas` | Ausencia de rojas y victoria por conteo |
| `hubo_tiempo_extra` / `hubo_penales` | Detección por `score_info_time` |
| Los 8 sin evento | Devuelven cadena vacía: **no se resuelve a ciegas** cuando el API no responde |

**Marcador a 90 minutos (punto 26).** Tres pruebas sobre la lógica en cascada, que
resuelve un problema real de eliminatorias: un partido decidido en la prórroga o en
penales no debe alterar el pronóstico del tiempo reglamentario.

- En `LIVE` y `MT` manda el marcador en vivo.
- Terminado, mandan los campos de tiempo reglamentario, no el marcador que incluye
  la tanda.
- Sin esos campos, se reconstruye desde `goalscorer` **descartando los goles de
  prórroga y de tanda**: un 1-1 al 90 con gol en el 105 y penales sigue siendo 1-1.

**Transferencia de propiedad (punto 25).** Flujo completo: el socio solicita
ingreso, el propietario lo aprueba, se rechaza la transferencia mientras el socio es
`user`, se le asciende a `admin` y entonces sí procede. Se comprueba que queda
**exactamente un propietario**, que los roles se intercambian y que
`Quiniela.propietarioId` también se actualiza.

**Un detalle que la prueba destapó:** la ruta de transferencia identifica al
destinatario por **id de usuario** (`req.body.usuarioId`), no por id de membresía,
que es lo que parecía natural viniendo del resto de rutas de miembros —todas usan
`/miembros/:id` con el id de la membresía—. La primera versión de la prueba pasaba
la comprobación de "rechaza a un `user`" **por el motivo equivocado**: fallaba por
nombre de campo incorrecto, no por el rol. Corregido para que la prueba compruebe lo
que dice comprobar.

**Verificación:**

```
npm run check     → válido
npm test          → 53/53  (17 arquitectura + 36 integración)
duración          → ~8 s, sin red y sin tocar la base real
```

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Exporta `resolverRespuestaTrivia`, `obtenerMarcador90Minutos`, `minutoApiFootball` y `TIPOS_TRIVIA` |
| `test/integracion.test.js` | 14 pruebas nuevas: 22 → 36 |
| `avance_proyecto.md` | §16 y esta entrada |

**Pendiente / siguiente paso:** **Fase 4 — rediseño del sincronizador (C-01)**, el
bloqueante real de escala, ya con red de seguridad debajo.

---

### 📌 Entrada 010 — 17 de agosto de 2026 — Fase 4: rediseño del sincronizador

**Objetivo:** cerrar **C-01** —el consumo de APIFootball crecía con el número de
quinielas— y **C-05** —los trabajos periódicos guardaban su estado en variables
de módulo, que impiden escalar horizontalmente—. Era el bloqueante real de
escala y el trabajo más grande del roadmap.

**Antes que nada, la fusión pendiente.** Las cinco ramas encadenadas se llevaron
a `main` con avance rápido (`git merge --ff-only fase-3-pruebas`) y se borraron
las cuatro intermedias. `main` pasó de `f92462b` a `e2f8d3f`.

> **Efecto colateral que conviene recordar:** al cambiar a `main`, git **borró
> `node_modules`**. Estaban versionados hasta el commit `04f6de0`, así que
> retroceder por debajo de ese punto los elimina del árbol de trabajo. El
> síntoma fue `Cannot find module 'mongoose'` en la siguiente corrida de
> pruebas, que parece corrupción del entorno y no lo es. Se arregla con
> `npm install`.

---

#### Lo que se cambió

**1. El disparador ya no es el tráfico de los usuarios.**

Desapareció el `app.use` que, en cada petición, comprobaba si habían pasado
treinta segundos para lanzar una sincronización de todo el sistema. Lo sustituye
un `setInterval` propio (`SYNC_INTERVALO_MS`, 60 s por defecto).

El cambio no es cosmético. Atar el consumo del API externo al tráfico entrante
significaba que el coste dependía de cuánta gente estuviera navegando, y que un
sistema sin visitas no se sincronizaba nunca.

**2. Una caché de partidos compartida entre quinielas — el corazón del arreglo.**

Nueva colección global `fixtures`, **deliberadamente sin `quinielaId`**. Cada
documento es el estado real de un partido según el proveedor, identificado por
una **clave compartida**: el `apiFixtureId` cuando existe y, si no, una clave
sintética de fecha y equipos normalizados.

Si cuarenta quinielas siguen el mismo partido del Mundial, el partido sigue
siendo uno y se consulta **una vez**. Antes se consultaba cuarenta.

> Es el único sitio del sistema donde compartir datos entre quinielas es lo
> correcto, y por eso hay una prueba de arquitectura que **falla si alguien
> añade `FixtureSchema` a la lista de `tenantPlugin`**. Aislarlo "por
> coherencia" reintroduciría C-01 sin que nadie se diera cuenta.

**3. Ventanas de consulta según el estado real del partido.**

| Estado del partido | Cada cuánto se consulta |
|---|---|
| Terminado (`TC`) | **Nunca más** |
| En vivo (`LIVE`, `MT`) | 60 s |
| A menos de 2 h del inicio | 15 min |
| A más de 2 h | 6 h |
| Sin fecha conocida | 30 min |
| Tras un fallo del proveedor | 10 min |

**El detalle que no es obvio:** la próxima consulta nunca se pospone más allá
del pitido inicial. Un partido que empieza en tres horas cae en la ventana
"lejano" de seis y, sin ese tope, se habría consultado por primera vez **tres
horas después de haber empezado**. La prueba lo fija explícitamente.

También hay un umbral de abandono: un partido cuya hora de inicio pasó hace más
de cuatro horas y que el proveedor sigue sin dar por empezado —aplazado,
cancelado o mal enlazado— vuelve a la ventana lenta, en vez de consultarse cada
minuto para siempre.

**4. Se acabó la autollamada HTTP, y con ella una puerta trasera.**

El sincronizador se llamaba a sí mismo por `http://localhost:PORT/...`, una vez
por jornada. Para poder saltarse su propia autenticación llevaba un
`INTERNAL_SYNC_TOKEN` que, presentado en una cabecera junto a un `x-quiniela-id`,
concedía **rol de administrador sin sesión** sobre la quiniela indicada.

El cuerpo de la ruta se extrajo a `sincronizarJornadaDesdeApi(nombre)`, que
**exige contexto de inquilino** igual que `resolverTriviasPendientes()`. El
planificador la invoca dentro de `tenantContext.run`, y la ruta HTTP quedó como
una envoltura fina de cuatro líneas.

Con la autollamada fuera, el token y su puerta se eliminaron por completo. Una
vía que concede permisos de administrador sin sesión es superficie de ataque que
ya no hay que mantener; hay una prueba de arquitectura que impide que vuelva.

**5. Cerrojo distribuido (C-05).**

Nueva colección global `joblocks`. El cerrojo se toma con un `findOneAndUpdate`
filtrando por `expiraEn` vencido y con `upsert`: si otra instancia lo tiene vivo,
el filtro no encuentra nada, el upsert intenta insertar y **choca contra el
índice único**. Ese choque —código 11000— *es* la respuesta "lo tiene otro", no
un error que haya que propagar.

Caduca a los cinco minutos, porque una instancia que muere a mitad de ciclo no
suelta nada y sin caducidad la sincronización quedaría parada para siempre.

Se añadió además la bandera `JOBS_HABILITADOS`. Hoy los trabajos corren dentro
del proceso web y el cerrojo basta; la bandera existe para poder separar el
despliegue —unas instancias solo atienden peticiones, otra hace de trabajador—
**sin tener que partir el código antes**.

**6. Paralelismo controlado y métricas de cuota.**

Las consultas al proveedor van por un limitador de concurrencia propio
(`SYNC_CONCURRENCIA`, 4 por defecto): diez líneas en vez de una dependencia. Sin
él, un ciclo con doscientos partidos abriría doscientas peticiones simultáneas y
el proveedor respondería con limitación de tasa.

`GET /api/admin/sync-metricas` (requiere Admin Mode) expone ciclos, llamadas al
API, errores, partidos seguidos, fixtures únicos, consultas evitadas por ventana
y duración del último ciclo. El campo **`consultasAhorradasPorDeduplicacion`** es
la medida directa de C-01: cuántas llamadas se habrían hecho de más por seguir el
mismo partido desde varias quinielas.

Los contadores son **por instancia** y se reinician con el proceso. Consolidarlos
es trabajo de la observabilidad (M-24).

---

#### El efecto, en números

Con 100 quinielas siguiendo los mismos 30 partidos:

| | Antes | Ahora |
|---|---:|---:|
| Llamadas al API por ciclo | 3.000 | ≤ 30 |
| Ciclos por hora | 120 | 60 |
| Llamadas por hora | **360.000** | **≤ 1.800** |
| …con los partidos ya terminados | 360.000 | **0** |

La última fila es la que más pesa en la práctica: una jornada que terminó hace
tres meses se resincronizaba eternamente. Ahora, en cuanto un partido llega a
`TC`, no se vuelve a consultar jamás.

Y lo importante no es el factor de reducción, sino que **el coste dejó de
depender del número de quinielas**: cien quinielas siguiendo los mismos partidos
cuestan hoy lo mismo que una.

---

**Verificación:**

```
npm run check            → válido
npm test                 → 66/66  (21 arquitectura + 45 integración)
duración                 → ~14 s, sin red y sin tocar la base real
npm audit --omit=dev     → 0 vulnerabilidades
```

**De 53 a 66 pruebas.** Las 13 nuevas:

| Prueba | Qué fija |
|---|---|
| **C-01 en ejecución** | Dos quinielas siguen el mismo partido → el proveedor se consulta **una vez**, y **las dos** quedan con su resultado escrito, cada una en su documento |
| Partido terminado | Con estado `TC`, cero consultas: la cuota no se gasta en algo que no puede cambiar |
| Ventana vigente | Dentro de su ventana no se consulta; con `forzar` —el botón "sincronizar" del administrador— sí |
| Cálculo de ventanas | Los seis casos, incluido el tope que impide saltarse el pitido inicial |
| Cerrojo | Dos tomas seguidas: la segunda falla; un ciclo con el cerrojo ajeno se retira sin hacer nada |
| Cerrojo caducado | Se puede volver a tomar, sin esperas reales en la prueba |
| Contexto obligatorio | `sincronizarJornadaDesdeApi` se niega a correr sin quiniela |
| Limitador | Con tope 4 y veinte tareas, nunca hay más de 4 a la vez, y hay paralelismo real |
| Fallo del proveedor | Un `ECONNRESET` **no borra** el último marcador conocido, cuenta el fallo y espacia el reintento |
| Arquitectura (5) | Ni middleware por petición, ni autollamada, ni token interno; caché y cerrojo sin `quinielaId`; ventanas declaradas; cerrojo con caducidad |

**La costura que hizo posible probar esto:** el sincronizador habla con el
proveedor por un único punto, `proveedorDeEventos`, que las pruebas sustituyen
por eventos sintéticos **que cuentan las consultas**. Ese conteo *es* el objeto
de la prueba: C-01 nunca fue un error de resultado —los marcadores salían
bien— sino un error de **cuántas veces se preguntaba**. Una prueba que solo
mirara el resultado habría pasado igual antes y después.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Modelos globales `Fixture` y `JobLock`; núcleo del sincronizador (~430 líneas); `sincronizarJornadaDesdeApi` extraída de la ruta; retirados el middleware de auto-sync, `INTERNAL_SYNC_TOKEN` y su puerta; planificador, `JOBS_HABILITADOS` y `/api/admin/sync-metricas` |
| `test/architecture.test.js` | La prueba de la constante vieja sustituida por 5 nuevas |
| `test/integracion.test.js` | 8 pruebas nuevas del sincronizador |
| `.env.example` | `SYNC_INTERVALO_MS`, `SYNC_CONCURRENCIA`, `JOBS_HABILITADOS` |
| `avance_proyecto.md` | §2.9, §4.1, §9.4, §13, §15, §16, punto de partida y esta entrada |

**Hallazgos nuevos:**

- **B-11 (bajo):** `sincronizarJornadaDesdeApi` sigue reescribiendo el array
  completo de `ResultadoOficial.resultados` aunque solo haya cambiado un partido.
  Es correcto, pero desperdicia escritura; se resuelve solo cuando la Fase 5
  materialice los puntos por jornada.
- El volcado `===== SYNC LIVE =====` por consola se conservó. Con el mecanismo
  anterior era ruido constante; ahora solo aparece cuando un partido está de
  verdad en curso, así que pasa a ser útil. Cuando llegue el logging
  estructurado (M-24) debe convertirse en un evento con nivel.

**Pendiente / siguiente paso:** **Fase 5 — rendimiento del ranking (C-03)**, que
arranca con una decisión de producto: si los puntos de una jornada se congelan al
cerrarla (M-03, M-04).

---

### 📌 Entrada 011 — 17 de agosto de 2026 — Auditoría de continuidad y Fase 5 en curso

**Objetivo:** releer íntegramente la fuente de verdad del proyecto, contrastarla
con el repositorio real y dejar un punto de reanudación exacto antes de continuar.

**Qué se hizo:**

1. Se leyeron completas las 3.052 líneas de `avance_proyecto.md`, incluidos el
   análisis original, los dos anexos, las diez entradas anteriores y la plantilla
   de mantenimiento.
2. Se contrastaron rama, historial, árbol de trabajo, dependencias, scripts,
   modelos, rutas críticas, sincronizador, ranking y pruebas con lo documentado.
3. Se confirmó que `main` y `origin/main` están en `e2f8d3f`, mientras
   `fase-4-sincronizador` está dos commits por delante, en `73b6ca0`.
4. Se encontró trabajo local **sin confirmar** posterior a la Entrada 010:
   553 inserciones y 91 eliminaciones en `server.js` y las dos suites de pruebas.
   No se descartó ni se modificó ese trabajo.
5. Se identificó que ese diff inicia la Fase 5: añade el modelo multi-inquilino
   `PuntosJornada`, extrae la regla de puntos a funciones reutilizables, congela
   jornadas terminadas y hace que el ranking lea el materializado en vez de las
   colecciones completas de pronósticos y oficiales.
6. Se verificó la política codificada: una jornada se congela cuando todos sus
   partidos están en `TC` o `bloqueadoFinal`; cambiar después la configuración no
   reescribe el pasado, y corregir un marcador recalcula usando la puntuación
   guardada de esa jornada.
7. Se actualizó el punto de partida y el roadmap para distinguir claramente lo
   completado, lo que está en curso y lo que aún no se inició.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `avance_proyecto.md` | Estado real de Git y pruebas, Fase 5 marcada en curso, hallazgos de revisión y esta entrada |

> Los cambios ya existentes de `server.js`, `test/architecture.test.js` y
> `test/integracion.test.js` fueron únicamente inspeccionados; esta auditoría no
> los creó ni los alteró.

**Verificación:**

```
git diff --check          → limpio
npm run check             → sintaxis válida
npm test                  → 71/71 (23 arquitectura + 48 integración)
duración                  → ~8,2 s, sin red y sin tocar la base real
npm audit --omit=dev      → 0 vulnerabilidades
git status                → Fase 5 local sin confirmar + este documento modificado
```

**Hallazgos nuevos:**

- **Invalidación incompleta de la Fase 5:** el materializado se actualiza al
  cambiar pronósticos o resultados oficiales y se borra al eliminar la jornada,
  pero no al modificar `Jornada.partidos` desde las rutas de crear/importar,
  agregar, eliminar partidos o cambiar comodín. Como `puntosDeJornada()` depende
  del orden, cantidad y bandera `comodin` de ese arreglo, una jornada ya congelada
  puede mostrar puntos obsoletos. Debe corregirse o impedir esas mutaciones una vez
  cerrada antes de confirmar la Fase 5.
- **Forma de `PuntosJornada` por decidir:** el roadmap proponía un documento por
  jugador y jornada; el trabajo local usa un documento por jornada con todos los
  jugadores dentro. Reduce el número de documentos leídos, pero hace crecer un
  solo documento, reescribe todo su arreglo en cada corrección y condiciona la
  paginación del punto 37. No es necesariamente incorrecto, pero sí una decisión
  de escala que debe ser explícita.
- **C-03 está mitigado, no cerrado:** con todo congelado ya no se leen
  `Resultado` ni `ResultadoOficial`, pero el endpoint todavía arma y devuelve la
  clasificación completa. Faltan la caché con invalidación (punto 36) y la
  paginación (punto 37).
- La cifra vigente es **71 pruebas**, no 66. El documento conservaba correctamente
  66 como cierre histórico de la Fase 4, pero el punto de partida ya necesitaba
  reflejar el árbol local.

**Pendiente / siguiente paso:** terminar la primera parte de la Fase 5 sobre el
trabajo local existente: cerrar todas las invalidaciones de `PuntosJornada`, decidir
su forma de almacenamiento pensando en la paginación, añadir las pruebas de esas
decisiones y solo entonces documentar/confirmar los puntos 34 y 35. Después siguen
la caché del ranking y la paginación; la Fase 5 todavía no debe marcarse completa.

---

### 📌 Entrada 012 — 17 de agosto de 2026 — Fase 5: ranking materializado, caché y paginación

**Objetivo:** cerrar el cuello de botella C-03 de la tabla general, fijar una
política histórica coherente de puntuación y protegerla frente a todas las rutas
que pueden modificar una jornada.

**Qué se hizo:**

1. Se completó `PuntosJornada`, con un documento aislado por quiniela y jornada.
   Guarda los puntos de todos los jugadores, la configuración que los produjo y
   la fecha de congelamiento. Los subdocumentos de puntos no llevan `_id`, para no
   desperdiciar espacio por jugador.
2. Se consolidó la política de producto: una jornada se congela cuando todos sus
   partidos están `TC` o `bloqueadoFinal`. Cambiar la puntuación después no mueve
   el histórico; una corrección oficial recalcula con las reglas guardadas de la
   propia jornada.
3. Se cerró la invalidación que detectó la Entrada 011. Crear/importar jornadas,
   agregar o quitar partidos y cambiar comodines ahora llaman a
   `actualizarPuntosDeJornada()`. Si la jornada deja de estar completa, se elimina
   el materializado; si sigue terminada, se recalcula con su configuración histórica.
4. Se añadió caché en memoria por quiniela para `/api/resultados-totales`, con TTL
   configurable mediante `RANKING_CACHE_TTL_MS` (60 s por defecto). Se invalida en
   cambios de resultados, jornadas, pronósticos, membresías, trivias y campeón.
5. Se añadió paginación de servidor opcional al ranking:
   `GET /api/resultados-totales?pagina=1&limite=25`. Sin parámetros conserva la
   respuesta histórica de objeto para no romper consumidores existentes.
6. La interfaz `resultados-totales.html` consume la versión paginada, ordenada por
   total descendente, y muestra controles Anterior/Siguiente. El límite máximo por
   petición es 100.
7. Se añadieron cuatro pruebas de arquitectura y dos de integración: edición de
   jornada congelada, caché, invalidación y paginación.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | `PuntosJornada`, congelamiento, invalidación completa, caché y respuesta paginada del ranking |
| `private/js/resultados-totales.js` | Carga paginada y controles de navegación |
| `public/resultados-totales.html` | Contenedor accesible de paginación |
| `test/architecture.test.js` | Invariantes de edición de jornada, caché y paginación |
| `test/integracion.test.js` | Casos reales de descongelamiento, caché e interfaz API paginada |
| `.env.example` | `RANKING_CACHE_TTL_MS` |
| `avance_proyecto.md` | Modelo, configuración, roadmap, pruebas y esta entrada |

**Verificación:**

```
npm run check             → sintaxis válida
node --check private/js/resultados-totales.js → sintaxis válida
npm test                  → 75/75 (25 arquitectura + 50 integración)
duración                  → ~18 s, sin red y sin tocar la base real
npm audit --omit=dev      → 0 vulnerabilidades
git diff --check          → limpio
```

**Hallazgos nuevos:**

- **M-26 sigue parcialmente abierto.** La tabla general, que era el punto crítico
  de C-03, ya pagina en el servidor. Los demás listados de la aplicación siguen
  devolviendo colecciones completas y requieren una fase transversal propia para
  paginarse sin romper sus interfaces.
- La caché es **por instancia**, igual que las métricas del sincronizador. Para un
  despliegue con varias instancias es correcta gracias a la invalidación local y
  al TTL corto, pero Redis sería el siguiente paso si se necesita coherencia
  inmediata entre procesos.

**Pendiente / siguiente paso:** confirmar este trabajo de la Fase 5 en Git tras una
prueba de humo visual de la tabla general. Después, decidir si la paginación del
resto de listados se convierte en una subfase específica de M-26 o se aborda junto
con la modularización de la Fase 6. C-03, M-03 y M-04 quedan resueltos en el árbol
local; M-26 no se debe cerrar todavía.

---

### 📌 Entrada 013 — 17 de agosto de 2026 — Retiro del módulo de Campeón del Mundo

**Objetivo:** eliminar la funcionalidad específica del Mundial que ya no forma
parte del producto, sin dejar rutas, puntuaciones ni pantallas huérfanas.

**Qué se hizo:**

1. Se retiraron los modelos `PronosticoCampeon` y `CampeonOficial`, sus índices y
   las dos colecciones de la lista de migración heredada.
2. Se eliminaron las siete rutas HTTP asociadas, incluida la lista fija de equipos
   del Mundial y toda la lógica de puntos extra en el ranking.
3. Se quitó el campo `campeon` de la configuración de puntuación y de la interfaz
   de configuración de quiniela.
4. Se eliminaron las tres páginas, sus tres scripts, los accesos desde Inicio y
   Admin Mode, y los estilos exclusivos de esa tabla.
5. Se actualizó el ranking para que solo priorice Trivias como columna especial y
   se retiró la prueba específica de campeón.
6. Se conservan intactos los filtros de importación que mencionan competiciones
   mundialistas: sirven para buscar partidos y no pertenecen al módulo eliminado.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Modelos, rutas, configuración y cálculo de campeón eliminados |
| `scripts/migrate-legacy.js` | Ya no importa colecciones de campeón |
| `public/*` y `private/js/*` | Tres pantallas/scripts eliminados; enlaces y configuración limpiados |
| `private/css/styles.css` | Estilos exclusivos retirados |
| `test/*` | Pruebas y expectativas de campeón retiradas |
| `README.md` | Descripción de producto actualizada |
| `avance_proyecto.md` | Inventario, modelo, endpoints, ranking, roadmap y esta entrada |

**Verificación:**

```
npm run check             → sintaxis válida
npm test                  → 74/74 (25 arquitectura + 49 integración)
duración                  → ~14 s, sin red y sin tocar la base real
```

**Hallazgos nuevos:**

- El código ya no lee ni escribe `pronosticocampeons` ni `campeonoficials`, pero
  **los documentos históricos existentes no se borraron de MongoDB**. Eliminar
  datos de producción es una operación irreversible y requiere una orden
  explícita separada; mientras tanto son datos inactivos e inocuos.
- Las referencias al campeón en entradas históricas previas se conservan como
  bitácora de lo que existió. El estado vigente del documento ya no lo incluye.

**Pendiente / siguiente paso:** prueba de humo visual de Inicio, Admin Mode,
Configuración de quiniela y Tabla General. Si después se quiere limpiar también las
dos colecciones históricas de Atlas, primero se debe confirmar explícitamente la
base y el alcance del borrado.

---

### 📌 Entrada 014 — 17 de agosto de 2026 — Clasificación por jornada

**Objetivo:** añadir una tabla independiente para consultar quién ganó cada
jornada, sin mezclar puntos de trivias con los pronósticos de partidos.

**Qué se hizo:**

1. Se creó `GET /api/clasificacion-jornada`. Sin parámetro selecciona la jornada
   creada más recientemente; `?jornada=…` permite consultar cualquiera de la
   quiniela activa.
2. La respuesta indica `estado: 'provisional'` mientras quede algún partido sin
   resultado definitivo y `estado: 'confirmada'` cuando todos estén `TC` o
   bloqueados como finales. Una jornada confirmada reutiliza `PuntosJornada` y se
   materializa si aún no existía; una provisional calcula el estado actual.
3. La clasificación considera **solo puntos de pronósticos de partidos**. Las
   trivias no se leen ni se suman en esta pantalla, por decisión de producto.
4. Los empates conservan exactamente los mismos puntos y el mismo puesto. Para
   ordenar visualmente filas con igual puntaje se usan, en este orden: más
   marcadores exactos, más resultados correctos y menor diferencia total de goles
   pronosticados respecto al marcador oficial. Si todo coincide, siguen empatados.
5. Se añadió `clasificacion-jornada.html`, con selector de jornada, estado visible,
   puestos 1.º, 2.º, 3.º…, criterios de orden y enlace de regreso.
6. La barra inferior de las pantallas existentes sustituye **Reglamento** por
   **Por jornada**. El reglamento sigue disponible desde la tarjeta de Inicio;
   no se eliminó su página.
7. Se añadió una prueba de integración que cubre la jornada más reciente por
   defecto, el estado provisional, un empate ordenado por marcador exacto, la
   exclusión de trivia y la confirmación/materialización al cerrar la jornada.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Estadísticas de desempate visual y endpoint de clasificación por jornada |
| `public/clasificacion-jornada.html` | Nueva pantalla de consulta y tabla de posiciones |
| `private/js/clasificacion-jornada.js` | Carga inicial, selector y renderizado seguro de la clasificación |
| `public/*.html` | Barra inferior actualizada de Reglamento a Por jornada |
| `test/integracion.test.js` | Caso provisional, empate, exclusión de trivias y jornada confirmada |
| `avance_proyecto.md` | Endpoint, contador de pruebas, estado vigente y esta entrada |

**Verificación:**

```
npm run check                              → sintaxis válida
node --check private/js/clasificacion-jornada.js → sintaxis válida
npm test                                   → 75/75 (25 arquitectura + 50 integración)
```

**Hallazgos nuevos:**

- El estado provisional se calcula directamente a partir de los marcadores
  oficiales disponibles; no congela puntos ni altera el histórico.
- Los criterios de desempate solo ordenan la vista. No cambian puntos, puestos ni
  declaran un ganador único cuando existe igualdad de puntaje.

**Pendiente / siguiente paso:** realizar una prueba de humo visual con una jornada
en curso y una finalizada. Si más adelante se necesita otra política de desempate,
debe añadirse como configuración explícita de administración, no cambiar esta regla
por defecto silenciosamente.

---

### 📌 Entrada 015 — 17 de agosto de 2026 — Auditoría integral y prioridades de mejora

**Objetivo:** revisar el repositorio completo sin modificar funcionalidad y dejar
una lista priorizada, verificable y accionable antes de continuar agregando
características.

**Qué se revisó:**

1. Código de servidor, modelos, rutas, middleware de sesión/roles, aislamiento
   multi-quiniela, motor de puntuación, sincronizador y migrador.
2. Las 32 pantallas HTML y los 33 scripts del frontend, con especial atención a
   interpolación de datos, referencias de assets y navegación.
3. Pruebas, dependencias, auditoría de paquetes, estado de Git y preparación de
   despliegue.

**Verificación:**

```
npm test                         → 75/75 (25 arquitectura + 50 integración)
npm audit --omit=dev             → 0 vulnerabilidades conocidas
revisión individual con `node --check` → 33/33 scripts con sintaxis válida
git status                       → limpio antes de registrar esta entrada
HEAD                             → 64ec3ce, rama fase-4-sincronizador
```

**Hallazgos y recomendación priorizada:**

| Prioridad | Hallazgo | Recomendación concreta |
|---|---|---|
| Alta | **S-04 sigue abierto:** numerosos scripts interpolan nombres de usuarios, jornadas y equipos mediante `innerHTML`/`insertAdjacentHTML`; la CSP vigente permite scripts y manejadores inline. | Sustituir renderizados por nodos DOM + `textContent` o aplicar una única función de escape estricta. La nueva tabla por jornada es el patrón correcto. |
| Alta | Varias rutas administrativas y de pronósticos convierten marcadores con `Number()` sin exigir enteros no negativos, y crean/actualizan jornadas sin validación estructural centralizada. | Crear validadores de dominio para marcador, fecha, partido y jornada; rechazar negativos, decimales, valores no finitos, fechas inválidas y arreglos vacíos. |
| Alta | Una jornada sin `fechaCierre` se considera cerrada para consultar pronósticos ajenos en `/api/resultados`, `/api/resultados/:jugador/:jornada` y `/api/resultados-seguros/...`. | Definir privacidad por defecto: sin fecha debe seguir privada, o debe usar el inicio real de cada partido. No dejar que una omisión de administración revele pronósticos. |
| Alta | Crear quiniela/membresía, transferir propiedad, borrar jornada y editar trivias son secuencias de varias escrituras sin transacción. | Usar sesiones/`withTransaction` de MongoDB y pruebas de fallo intermedio para no dejar propietarios, puntos o respuestas inconsistentes. |
| Alta | APIFootball se consulta con Axios sin `timeout`; el cerrojo de sincronización vence a los cinco minutos sin renovación. | Configurar timeout, reintentos con espera y renovación de lease del cerrojo; evitar ciclos simultáneos si una llamada externa queda bloqueada. |
| Media | Una jornada aplazada, cancelada o abandonada puede quedar provisional para siempre porque el cierre exige resultados definitivos. | Modelar estados de anulación/aplazamiento y añadir una acción administrativa explícita que defina cómo puntúan. |
| Media | La “última jornada” se elige por `createdAt`, no por orden competitivo ni fecha. | Añadir orden/fecha de jornada y elegir la más reciente según esa regla, para que una importación tardía no cambie el valor predeterminado. |
| Media | Los miembros que ingresan después pueden aparecer con 0 en clasificaciones históricas; no hay política registrada para ello. | Decidir si las tablas históricas muestran participantes de ese momento o todos los miembros actuales, y guardar el criterio. |
| Media | La tabla por jornada conserva empates con puestos `1.º, 1.º, 3.º`; los desempates solo ordenan visualmente. | Confirmar que se desea ranking de competición y documentarlo como regla de producto. Si se prefiere `1.º, 1.º, 2.º`, cambiar el algoritmo de puesto. |
| Media | Quedan consultas completas o N+1: por ejemplo trivias activas consulta jornada y oficial por cada trivia; varios listados no tienen paginación. | Agrupar consultas por jornada, añadir índices según medición y planificar M-26 para paginar los listados restantes. |
| Media | Las 75 pruebas son sólidas para backend, pero el frontend no tiene pruebas de navegador ni un reporte de cobertura. | Añadir pruebas E2E con Playwright para registro, roles, privacidad, móvil, navegación y regresiones XSS. |
| Media | No hay CI, backups, alertas, logging estructurado ni configuración declarativa de despliegue en el repositorio. | Incorporar pipeline que ejecute pruebas/auditoría, backups de Atlas, monitor de `/readyz`, registro estructurado y alertas. |
| Baja | `server.js` supera 4.700 líneas, contiene bloques/comentarios heredados y el marcador `////////////borrar borrar`. | Ejecutar Fase 6: dividir por dominios y limpiar código muerto después de cubrirlo con pruebas. |

**Decisión recomendada de orden:** primero S-04, validación y privacidad de
pronósticos; después transacciones y robustez del sincronizador; luego pruebas E2E,
operación de producción y modularización. No conviene sumar nuevas funciones antes
de cerrar al menos las cinco prioridades altas.

**Pendiente / siguiente paso:** elegir si se autoriza implementar el primer bloque
de endurecimiento (XSS, validación y privacidad) como una fase separada con pruebas
de regresión. La rama contiene el commit local `64ec3ce`, pero sigue pendiente de
fusión a `main` y envío a `origin`.

---

### 📌 Entrada 016 — 18 de agosto de 2026 — Endurecimiento: plazos del sincronizador y robustez de la lectura

**Objetivo:** cerrar el único modo de fallo permanente y silencioso del sistema, y
quitar de la tabla por jornada la lectura completa y el 500 por carrera que la
auditoría de la Entrada 015 dejó señalados.

**Qué se hizo:**

1. **Timeout en el cliente de APIFootball.** El valor por defecto de axios es 0
   —esperar para siempre—. Una petición colgada dejaba sin resolver la promesa
   del ciclo de sincronización; como `cicloEnCurso` solo se libera en el
   `finally` de ese ciclo, el auto-sync de esa instancia se apagaba **hasta el
   siguiente reinicio**, sin ningún error visible: `ultimoCiclo` simplemente
   dejaba de moverse. Ahora se configura con `APIFOOTBALL_TIMEOUT_MS` (15 s).
2. **Vigilante del ciclo completo**, como segundo cinturón: `conVigilante()`
   deja de esperar un ciclo que no termina en `SYNC_TIMEOUT_CICLO_MS` (4 min,
   menor que los 5 del cerrojo a propósito) y libera el planificador. Cubre
   cualquier promesa que no resuelva, no solo una petición HTTP.
3. **El cerrojo se suelta por el testigo del ciclo, no por el del proceso.** Sin
   esto, un ciclo abandonado que terminara tarde soltaría el cerrojo del ciclo
   siguiente del mismo proceso y habría dos sincronizando a la vez. El testigo
   es `${ID_INSTANCIA}#${contador}`; `tomarCerrojo`/`soltarCerrojo` lo aceptan
   como parámetro opcional, así que las llamadas existentes no cambian.
4. **Métrica `ciclosAbandonadosPorTiempo`** y los dos plazos expuestos en
   `/api/admin/sync-metricas`. El fallo dejó de ser invisible, que era la parte
   peor del hallazgo.
5. **`/api/clasificacion-jornada` ya no lee la temporada entera.** Traía todas
   las jornadas con todos sus partidos para llenar el desplegable y localizar
   una; ahora pide `.select('nombre')` y un `findOne` de la elegida, dentro del
   mismo `Promise.all`. Con 40 jornadas de 10 partidos eran ~400 subdocumentos
   por carga de pantalla.
6. **Congelar dentro de ese GET ya no puede tumbar la consulta.** Dos peticiones
   simultáneas sobre una jornada recién confirmada hacen el mismo upsert y
   chocan contra el índice único `{quinielaId, jornada}`; MongoDB devuelve
   11000 y la pantalla respondía 500 por una carrera que además ya había dejado
   el trabajo hecho. Ahora se registra, se relee y, si aun así no hay
   materializado, los puntos al vuelo dan el mismo número.
7. **La portada pide solo el podio.** `index-ranking.js` pedía la tabla completa
   y descartaba todo menos tres filas; ahora usa `?pagina=1&limite=3`, la
   paginación que la Fase 5 ya había construido y que la pantalla más visitada
   era la única en no aprovechar.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Timeout del proveedor, `conVigilante()`, testigo por ciclo, métrica y plazos; clasificación por jornada con proyección y congelado tolerante a fallos |
| `private/js/index-ranking.js` | La portada consume el ranking paginado |
| `.env.example` | `APIFOOTBALL_TIMEOUT_MS` y `SYNC_TIMEOUT_CICLO_MS` |
| `test/architecture.test.js` | Cuatro invariantes: timeout, vigilante y testigo, proyección de la clasificación, portada paginada |
| `test/integracion.test.js` | Tres casos: el vigilante abandona lo que no resuelve, un ciclo abandonado no suelta el cerrojo ajeno, la clasificación responde 200 con el congelado fallando |
| `avance_proyecto.md` | Punto de partida, tabla de fases, vigilancia de métricas y esta entrada |

**Verificación:**

```
npm run check                            → sintaxis válida
node --check private/js/index-ranking.js → sintaxis válida
npm test                                 → 82/82 (29 arquitectura + 53 integración)
duración                                 → ~55 s, sin red y sin tocar la base real
```

**Hallazgos nuevos:**

- La caché del ranking **se invalida sola justo cuando más falta hace**.
  `actualizarPuntosDeJornada()` llama a `invalidarCacheRanking()`
  incondicionalmente en su primera línea, y el sincronizador la llama al final de
  cada `sincronizarJornadaDesdeApi()`. Con partidos en vivo la ventana es de
  60 s, exactamente el TTL de la caché: durante la jornada en vivo —el pico de
  tráfico— la caché se vacía en cada ciclo y casi nunca llega a servir. La
  corrección natural es invalidar solo si los resultados escritos difieren de los
  previos. **No se tocó aquí** porque cambia el comportamiento del sincronizador
  y merece su propia prueba de regresión.
- El censo del ciclo recorre **todas** las jornadas de todas las quinielas
  activas cada minuto, incluidas temporadas cerradas hace un año. Las llamadas al
  proveedor sí están acotadas por las ventanas; la lectura de Mongo no.
- Se comprobó contra `mongodb-memory-server` que `POST /api/jornadas` sin
  `nombre` **no** sobrescribe una jornada existente: Mongoose castea a
  `nombre: null` y crea una jornada basura, que luego aparece como columna en la
  tabla general y como opción en el desplegable. Es la ruta por la que debe
  empezar el bloque de validación.
- Sobre **S-04**: el username está restringido a `^[a-zA-Z0-9_.-]{3,30}$` en el
  registro y `POST /api/jugadores` está retirado con 410, así que el ranking
  —lo que más se interpola— no es un vector. Los vectores reales son los campos
  libres de administración: nombre de jornada, nombres de equipo y textos de
  trivia. Es "el dueño de una quiniela contra sus propios miembros", que en un
  modelo donde cualquiera crea quinielas sigue importando, pero no es "cualquier
  usuario contra todos". Se mantiene abierto, con esa severidad corregida.
  `index-ranking.js` sigue usando `innerHTML` con plantilla: es de lo primero
  que hay que convertir cuando se aborde.

**Pendiente / siguiente paso:** prueba de humo visual de Inicio (el podio ahora
viene paginado) y de la tabla por jornada. Después, el bloque de validación de
dominio: marcador entero no negativo, jornada con nombre obligatorio y
`fechaCierre` obligatoria —eso cierra de una vez la validación y la privacidad de
pronósticos, que son el mismo agujero visto por dos lados—.

---

### 📌 Entrada 017 — 18 de agosto de 2026 — Validación de dominio y privacidad de pronósticos

**Objetivo:** cerrar las dos prioridades altas restantes de la Entrada 015 que
resultaron ser **el mismo agujero visto por dos lados**: nadie validaba los datos
de entrada, y la ausencia de `fechaCierre` —que era una consecuencia de esa falta
de validación— hacía públicos los pronósticos de todos.

**Qué se hizo:**

1. **Validadores de dominio**, reunidos en una sección propia y exportados para
   poder probarlos sueltos: `normalizarMarcador`, `normalizarNombreDeJornada`,
   `normalizarFechaDeCierre`, `normalizarPartido`, `normalizarPartidos` y
   `normalizarIndicesDePartido`.
2. **Marcadores.** `Number()` a secas era el agujero: acepta `'-3'`, acepta
   `'2.5'` y acepta `'1e999'`, que **no da NaN, da Infinity**. Los tres pasaban
   la comprobación anterior y llegaban a la base como puntuación válida. Ahora un
   marcador es un entero de 0 a 99, o `null` si se dejó en blanco. Se aplica en
   las tres rutas que escriben marcadores: pronósticos del jugador, pronósticos
   cargados por un administrador y resultados oficiales manuales.
3. **Jornadas.** Nombre obligatorio y acotado a 80 caracteres, al menos un
   partido y como máximo 50, y los dos equipos obligatorios en cada partido.
4. **`fechaCierre` obligatoria al CREAR una jornada, opcional al editarla.** La
   asimetría es deliberada: exigirla también al editar dejaría inservibles las
   pantallas de administración con las jornadas heredadas que nunca la tuvieron.
   Para esas, el riesgo lo cubre el punto 6.
5. **Índices de partido a eliminar**: enteros, dentro de rango y sin repetir. El
   duplicado no era cosmético: la ruta hace `splice` por cada índice, así que un
   número repetido borraba dos partidos, el señalado y su vecino.
6. **Privacidad por defecto de los pronósticos.** `jornadaEstaCerradaParaPronosticos()`
   sustituye la regla `sin fecha = cerrada` en las tres vías que la usaban:
   `GET /api/resultados`, `GET /api/resultados/:jugador/:jornada` y
   `POST /api/resultados-seguros/:jugador/:jornada`. Una jornada sin fecha ahora
   sigue **privada** hasta que **todos** sus partidos han empezado de verdad,
   reutilizando `partidoYaInicio()`, que es la señal que el sistema ya usaba para
   bloquear la edición. No aparece una regla nueva: se reutiliza la que ya había.
7. **El 400 vuelve a decir qué pasó.** El manejador global convertía todo 4xx en
   un "La petición no es válida." mudo; ahora los errores de validación
   conservan su mensaje, que es lo que el administrador necesita para corregir el
   dato. Las dos rutas de pronósticos con `try/catch` propio dejaron de
   devolver 500 ante un dato inválido.

**El caso más grave que cerró el punto 6**, porque no era solo visibilidad de una
lista: en `/api/resultados-seguros` la rama `jornadaSinFecha` saltaba **la
comprobación de identidad y la de contraseña a la vez**. Con una jornada a la que
se le olvidó la fecha, cualquier miembro podía leer los pronósticos de cualquier
otro antes de que se jugara el partido.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Sección de validación de dominio; validación en las cinco rutas de jornada y las tres de marcadores; `jornadaEstaCerradaParaPronosticos()` en las tres vías de privacidad; mensaje de validación en el manejador global |
| `test/architecture.test.js` | Dos invariantes: las escrituras pasan por los validadores y `Number(nuevo.marcador)` ya no existe; ninguna vía de privacidad usa `sin fecha = cerrada` |
| `test/integracion.test.js` | Seis casos: marcadores inválidos, jornada sin nombre, fecha obligatoria al crear y no al editar, marcador negativo/fraccionario rechazado por HTTP, privacidad de una jornada sin fecha (403 en las tres vías, y 200 cuando el partido ya empezó) e índices repetidos |
| `avance_proyecto.md` | Punto de partida, tabla de fases y esta entrada |

**Verificación:**

```
npm run check             → sintaxis válida
npm test                  → 90/90 (31 arquitectura + 59 integración)
duración                  → ~60 s, sin red y sin tocar la base real
npm audit --omit=dev      → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- **`GET /api/resultados` se encareció a propósito.** Para decidir la privacidad
  sin `fechaCierre` hacen falta los partidos y los resultados oficiales, así que
  ahora lee `Jornada` con `partidos` y `ResultadoOficial` completo. El endpoint ya
  era el ejemplo de manual de M-26 —devuelve todos los pronósticos de todas las
  jornadas—, y la corrección de privacidad pesa menos que el problema que ya
  tenía. Cuando se pagine, esto se resuelve solo.
- **Las rutas `/api/jornadas/agregar-partido`, `/eliminar-partidos` y `/comodin`
  no las llama ninguna pantalla**: `jornadas.js` hace todas esas operaciones con
  `POST /api/jornadas`. Se validaron igualmente porque siguen expuestas, pero son
  candidatas a retirarse en la Fase 6.
- Normalizar los partidos descarta el `_id` de los subdocumentos, así que al
  editar una jornada Mongo les asigna otros nuevos. Se comprobó que **nada** en el
  código referencia `partido._id`: todo trabaja por índice.
- La pantalla de importación ya mostraba `data.error` del servidor, así que el
  administrador que olvide la fecha de cierre ve el motivo exacto. Las pantallas
  de edición de `jornadas.js` siguen con `alert` genéricos; no se tocaron porque
  las ediciones no exigen fecha y no llegan a ese 400.

**Pendiente / siguiente paso:** prueba de humo visual de crear jornada (a mano y
por importación), editar una existente y consultar pronósticos ajenos con una
jornada abierta. Después queda **S-04** —convertir los renderizados con
`innerHTML` a nodos DOM, empezando por `index-ranking.js`— y la invalidación
excesiva de la caché del ranking anotada en la Entrada 016.

---

### 📌 Entrada 018 — 18 de agosto de 2026 — Ojo para ver la contraseña

**Objetivo:** poder comprobar lo que se está escribiendo en cualquier campo de
contraseña, y asegurar que un fallo de contraseña siempre se explique.

**Qué se hizo:**

1. `private/js/password-visible.js` recorre los `input[type="password"]` de la
   página y les monta el botón encima. Se hizo así, y no repitiendo el marcado
   en las nueve pantallas que los tienen, para que **una pantalla nueva lo
   herede sin que nadie se acuerde de añadirlo**. Una prueba de arquitectura
   falla si alguna se queda sin él.
2. El icono muestra la **acción**, no el estado: con la contraseña oculta se ve
   un ojo abierto —"pulsa para verla"—, y tachado cuando ya está a la vista. Es
   la convención de los navegadores y de los gestores de contraseñas.
3. El botón es `type="button"`. Sin eso, dentro de un `<form>` habría enviado
   el formulario al pulsarlo: pulsar el ojo en el login habría intentado
   iniciar sesión.
4. Se conserva la posición del cursor al alternar, porque lo normal es pulsar el
   ojo a mitad de escribir.
5. Dibujado con `createElementNS`, sin `innerHTML`, para no añadir deuda de S-04
   justo antes de ir a limpiarla. Hay una prueba que lo fija.
6. Se revisaron **las siete rutas de contraseña** y todas mostraban ya un
   mensaje al fallar: no había ninguna muda. Lo que había era inconsistencia de
   redacción, y se unificó a `Contraseña incorrecta.`

**El login es la excepción, y a propósito:** sigue diciendo *"Usuario, correo o
contraseña incorrectos."* Decir solo "contraseña incorrecta" confirmaría que esa
cuenta **existe**, que es la vía normal para armar una lista de usuarios reales
antes de atacarlos.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `private/js/password-visible.js` | Nuevo: monta el ojo sobre cada campo de contraseña |
| `private/css/styles.css` | Estilos del botón, que neutralizan la regla general de `button` |
| `public/*.html` (9) | Cargan el script |
| `server.js` y 4 scripts | Redacción unificada del mensaje de contraseña incorrecta |
| `test/architecture.test.js` | Dos invariantes: ninguna pantalla sin ojo; el ojo sin `innerHTML` |

**Verificación:** `npm test` → 92/92.

---

### 📌 Entrada 019 — 18 de agosto de 2026 — El cierre es por partido, no por jornada

**Objetivo:** retirar la `fechaCierre` de la jornada, que era información
duplicada —cada partido ya se cierra a su hora de inicio— y pasar la privacidad
de los pronósticos a decidirse partido a partido.

**Por qué esto revierte parte de la Entrada 017.** Allí se hizo `fechaCierre`
obligatoria al crear una jornada. La observación posterior fue mejor: si el
cierre real lo marca el pitido inicial de cada partido, la fecha de jornada es un
dato que hay que recordar poner, que puede contradecir a los partidos y cuyo
olvido tenía consecuencias. Se quita el campo, no el criterio: la validación de
la 017 se queda entera.

**Qué se hizo:**

1. `fechaCierre` fuera del `JornadaSchema`, de las cuatro rutas que la escribían
   y de las dos que la devolvían. `normalizarFechaDeCierre` se retira por
   quedarse sin quien lo llame. **Las trivias conservan la suya**, que es un
   campo distinto y una regla que no cambia.
2. `partidosDestapados()` sustituye a `jornadaEstaCerradaParaPronosticos()`:
   devuelve un booleano por partido, y un partido se destapa en cuanto empieza.
   Reutiliza `partidoYaInicio()`, que ya decidía cuándo dejaba de poder
   editarse un pronóstico, así que **lo que no se puede editar es exactamente
   lo que se puede ver**: una sola regla, imposible que discrepen.
3. `taparPronosticosNoDestapados()` deja los marcadores pendientes en `null` y
   conserva equipos y posición, con `oculto: true`. La fila sigue estando; solo
   no dice qué pronosticó el jugador. Las pantallas ya pintaban `null` como
   "-", así que no hubo que tocarlas.
4. `/api/resultados` deja de omitir la jornada entera y pasa a tapar partido a
   partido. Antes, en una jornada a medias no se veía **nada**, ni siquiera los
   partidos ya jugados.
5. En `/api/resultados-seguros`, la contraseña pasa a proteger solo lo **propio**,
   que es para lo que estaba: la pantalla se usa en el móvil de uno delante de
   los demás. Para lo ajeno ya no hace falta pedir nada, porque solo se entrega
   lo que se puede ver.
6. Frontend: fuera los dos campos de fecha y hora al crear jornada, el bloque
   entero de "Modificar fecha de cierre", el campo de la pantalla de importación,
   la línea "Cierre:" del listado y la cabecera de `llenar_jornada`. Con ellos se
   fueron tres funciones que quedaban sin uso.

**El hallazgo serio: había una CUARTA vía de privacidad que la Entrada 017 no
tocó.** `GET /api/resultados-con-equipos/:jugador/:jornada` conservaba intacto
el patrón `!fechaCierre || …`, así que seguía publicando los pronósticos de una
jornada sin fecha. **La prueba de la 017 no lo detectó porque esa ruta llamaba
`jornadaAcceso` a lo que las otras tres llaman `jornadaDoc`**, y la comprobación
buscaba el patrón con el nombre de variable concreto. Dos lecciones, y las dos
están aplicadas:

- La regla vive ahora en **una función compartida**, no en una expresión copiada
  cuatro veces. Una regla en un solo sitio no se puede quedar a medio cambiar.
- La prueba busca la **forma** del patrón, no un nombre de variable, y además
  cuenta los usos de `partidosDestapados()`: si alguien añade una quinta ruta
  que entregue pronósticos ajenos y se le olvida, el número no cuadra.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | Modelo, 4 rutas de escritura, 2 de lectura y las **4** vías de privacidad |
| `private/js/jornadas.js` | −161 líneas: controles, ayudantes y los siete envíos con fecha |
| `private/js/importar_partidos.js`, `llenar_jornada.js` | Sin fecha de cierre |
| `public/jornadas.html`, `importar_partidos.html` | Fuera los campos y el bloque de modificar |
| `test/*` | Reescritas las 4 pruebas que fijaban la regla vieja |

**Verificación:**

```
npm run check                      → sintaxis válida
node --check en los 34 scripts     → todos válidos
npm test                           → 92/92 (33 arquitectura + 59 integración)
npm audit --omit=dev               → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- Las jornadas ya guardadas conservan su `fechaCierre` en Mongo. El código ya no
  la lee, así que es un campo inerte. Borrarlo requiere una orden explícita.
- `GET /api/resultados` devuelve ahora **más** filas que antes, aunque tapadas.
  Es un endpoint sin paginar (M-26) y esto lo empeora ligeramente; se resuelve
  solo cuando se pagine.
- La pantalla de importación seguía teniendo un campo de fecha de cierre que ya
  no servía para nada: se retiró junto con su conversor de zona horaria.

**Pendiente / siguiente paso:** prueba de humo visual de crear jornada (ya sin
pedir fecha), editar una existente y ver los pronósticos de otro con una jornada
a medias —debe verse el partido jugado y no el pendiente—. Después, la
invalidación excesiva de la caché del ranking (Entrada 016) y S-04.

---

### 📌 Entrada 020 — 18 de agosto de 2026 — La caché del ranking sobrevive al minuto en vivo

**Objetivo:** que la caché de `/api/resultados-totales` sirva de algo durante el
partido, que es cuando más gente mira la tabla.

**El diagnóstico, con una corrección respecto a como lo conté en la Entrada 016.**
Allí lo resumí como "la caché se vacía justo cuando más falta hace". Eso era
cierto pero incompleto, y la parte que faltaba cambia la solución: cuando el
marcador cambia de verdad, vaciar la caché es **correcto y necesario** —la tabla
ya no vale—. El desperdicio estaba en otro sitio:

- `sincronizarJornadaDesdeApi()` reescribe el resultado oficial en **cada** ciclo
  que toque la jornada, y termina llamando a `actualizarPuntosDeJornada()`, que
  invalida la caché en su primera línea, sin mirar si algo cambió.
- `refrescarFixture()` da por "hay datos nuevos" cualquier respuesta del
  proveedor, no solo las que traen algo distinto.
- Y el campo que cambia siempre es `minuto`.

Resultado: un 0-0 que sigue 0-0 llamaba a recalcular una tabla idéntica una vez
por minuto durante noventa minutos.

**Qué se hizo:**

1. `puntosPuedenHaberCambiado(anteriores, nuevos)` compara únicamente los campos
   de los que dependen los puntos: `marcador1`, `marcador2`, `comodin`, `estado`
   y `bloqueadoFinal`. **`minuto` queda fuera a propósito**, y es la clave de
   todo el arreglo.
2. El documento se **sigue reescribiendo siempre**: el minuto en vivo tiene que
   llegar a las pantallas. Lo que pasa a ser condicional es la invalidación y el
   recálculo de puntos.
3. La comparación empareja por equipos con `buscarOficialCorrespondiente()`, no
   por posición: el proveedor a veces devuelve local y visitante al revés, y ahí
   los marcadores sí cambian de significado.
4. Métrica `syncsSinCambioDePuntos`, para poder ver en producción cuánto se está
   ahorrando de verdad en vez de suponerlo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | `CAMPOS_QUE_MUEVEN_PUNTOS`, `puntosPuedenHaberCambiado()`, invalidación condicional y métrica |
| `test/architecture.test.js` | El invariante de que `minuto` no entra en la lista |
| `test/integracion.test.js` | Caso unitario de la comparación y uno de extremo a extremo: gol → invalida, minuto → no |
| `avance_proyecto.md` | Punto de partida, tabla de fases y esta entrada |

**Verificación:**

```
npm run check             → sintaxis válida
npm test                  → 95/95 (34 arquitectura + 61 integración)
npm audit --omit=dev      → 0 vulnerabilidades
```

La prueba de extremo a extremo es la que vale: sincroniza el minuto 20 con 1-0,
calienta la caché, sincroniza el minuto 21 con el **mismo** marcador y comprueba
que la segunda lectura de la tabla no vuelve a tocar `Jornada`; después mete un
gol y comprueba que entonces sí recalcula. Y verifica que el minuto 21 llegó a
la base, que es lo que no debía romperse.

**Hallazgos nuevos:**

- `refrescarFixture()` sigue marcando como "refrescado" todo partido del que el
  proveedor conteste algo. Eso ya no cuesta caché, pero sí una reescritura de
  `ResultadoOficial` por ciclo y por quiniela. Comparar también ahí ahorraría
  escrituras en Mongo; se deja anotado porque toca el corazón de la Fase 4 y
  merece su propia prueba.
- La caché sigue siendo **por instancia**. Con varias instancias, cada una
  mantiene la suya y el TTL de 60 s acota la discrepancia. Redis sería el
  siguiente paso solo si hiciera falta coherencia inmediata entre procesos.

**Pendiente / siguiente paso:** vigilar `syncsSinCambioDePuntos` en el primer
domingo con partidos en vivo: debe crecer mucho más deprisa que
`jornadasReescritas`. Después, **S-04** —los `innerHTML`, empezando por
`index-ranking.js` y `ver-resultados.js`— y las transacciones.

---

### 📌 Entrada 021 — 18 de agosto de 2026 — S-04: HTML sin agujeros de inyección

**Objetivo:** cerrar el hallazgo S-04. El frontend construía HTML con plantillas
e `innerHTML`, metiendo dentro nombres de jornada, de equipo y textos de trivia
sin escapar. Y la CSP permite `unsafe-inline` tanto en `script-src` como en
`script-src-attr` —el frontend depende de 63 manejadores en atributo—, así que
un `<img onerror=…>` que llegue al DOM **sí se ejecuta**.

**La decisión de enfoque, que es lo importante.** El audit ofrecía dos vías:
convertir los renderizados a nodos DOM con `textContent`, o aplicar una función
de escape estricta. Se eligió la segunda, y no por comodidad:

> Convertir 62 plantillas a `createElement` **cambia el HTML generado**, y este
> frontend no tiene pruebas de navegador. No habría forma de comprobar que las
> dieciocho pantallas siguen viéndose igual; el riesgo de romper la interfaz
> superaba al del agujero que se venía a cerrar.

Etiquetar la plantilla deja el marcado **byte a byte idéntico** y solo cambia lo
que se interpola, que es exactamente el agujero.

**Qué se hizo:**

1. `private/js/html-seguro.js` define `escapar()`, la plantilla etiquetada
   `html` y `crudo()`. Se escapan también las comillas, no solo los ángulos:
   un valor dentro de un atributo —`title="${nombre}"`— puede cerrar el atributo
   y añadir otro, que es la mitad de los casos reales.
2. La conversión de una plantilla es **anteponerle `html`**. Eso convierte ~150
   interpolaciones en 62 ediciones de un token, cada una verificable a ojo.
3. `html` devuelve un `HtmlCrudo`, de modo que una plantilla anidada dentro de
   otra no se escapa dos veces. La marca es una **clase**, no una bandera en un
   objeto plano: así una respuesta del servidor no puede hacerse pasar por HTML
   seguro trayendo el campo puesto. Hay una prueba para eso.
4. Se retiraron las dos copias locales de `escapar` (`miembros.js` y
   `quinielas.js`), que eran la convención ya existente pero duplicada y sin
   aplicar en los otros dieciséis archivos.
5. **62 plantillas convertidas en 18 archivos**, y el ayudante cargado en las 17
   pantallas que lo necesitan.

**El guardián, que es lo que impide que esto se deshaga.** Una prueba recorre
todos los scripts con un **escáner con estado** (`test/plantillas.js`) y falla si
alguna plantilla que produce HTML e interpola datos se queda sin etiquetar. Hizo
falta un escáner de verdad y no una expresión regular: las plantillas se anidan,
y una expresión regular empareja la comilla de cierre de la interna con la de
apertura de la siguiente, inventando plantillas que no existen —dio quince falsos
positivos y, peor, **tapó tres casos reales**—.

Se comprobó que la prueba funciona quitando a mano una etiqueta: falla.

**Y una segunda prueba comprueba el orden de carga**, que no es cosmético: un
script con `defer` se ejecuta DESPUÉS de todos los que no lo llevan. En
`index.html`, que carga sus scripts al final del cuerpo y sin `defer`, el
ayudante diferido habría llegado tarde y `html` habría sido `undefined`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `private/js/html-seguro.js` | Nuevo: `escapar`, `html`, `crudo` |
| `private/js/*.js` (18) | 62 plantillas etiquetadas; dos `escapar` locales retirados |
| `public/*.html` (17) | Cargan el ayudante antes que su propio script |
| `test/plantillas.js` | Nuevo: escáner de plantillas con estado |
| `test/architecture.test.js` | Cuatro pruebas: escapado, la etiqueta, el guardián y el orden de carga |

**Verificación:**

```
node --check en los 35 scripts   → todos válidos
npm test                         → 99/99 (38 arquitectura + 61 integración)
npm audit --omit=dev             → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- **Dos restos muertos de la Entrada 019**, que el escáner sacó a la luz: el
  bloque "Fecha de cierre" de `ver_jornadas.js` y el bloque "Cierre de jornada"
  de `llenar_jornada_user.js` —este último con un `setInterval` de un segundo—.
  Como la API ya no devuelve el campo, no se ejecutaban nunca. Retirados.
- **La CSP todavía no se puede endurecer.** Con el escapado puesto, el siguiente
  paso natural sería quitar `unsafe-inline`, pero el frontend sigue teniendo 63
  manejadores en atributo (`onclick=…`) y `script-src-attr: 'none'` dejaría la
  interfaz inerte. Convertirlos a `addEventListener` es una fase propia, y
  entonces sí se podrá cerrar la CSP —que es lo que convertiría el escapado en
  defensa en profundidad y no en la única línea—.
- `ver-resultados.js` y varios más siguen usando `insertAdjacentHTML`. Ya va
  escapado, así que no es un agujero; queda como estilo.

**Pendiente / siguiente paso:** prueba de humo visual **amplia**, porque este
cambio toca dieciocho pantallas. Lo que hay que mirar en cada una es que el
contenido se vea como antes y no aparezcan etiquetas HTML en texto. Después,
transacciones y las pruebas E2E, que son las que harían automática esta
comprobación.

---

### 📌 Entrada 022 — 18 de agosto de 2026 — Transacciones

**Objetivo:** cerrar la última prioridad alta de la Entrada 015. Cuatro
operaciones eran secuencias de varias escrituras sin transacción: si fallaba la
de en medio, lo que quedaba no era "menos datos" sino un estado que el resto del
código no sabe interpretar.

| Operación | Qué quedaba a medias |
|---|---|
| Crear quiniela | Una quiniela cuyo propietario **no es miembro de ella**: no aparece en su lista y no puede entrar. Invisible e inaccesible, pero ocupando nombre y código |
| Transferir propiedad | La quiniela con **dos propietarios o con ninguno**, y el documento discrepando de las membresías |
| Borrar jornada | Pronósticos y puntos congelados de una jornada que ya no existe. **La tabla general los seguía sumando al total** sin columna a la que pertenecer: los puntos de todos salían mal y nada decía por qué |
| Reconciliar trivias | Respuestas huérfanas de trivias borradas, **que seguían contando puntos** |

**Qué se hizo:**

1. `enTransaccion(operacion)` envuelve una secuencia en `session.withTransaction`.
   La función recibe la sesión y **debe pasarla a cada escritura**: una consulta
   que se olvide de `{ session }` queda fuera de la transacción y no se
   revierte, que es el fallo silencioso típico de esto.
2. Las cuatro operaciones pasan por ahí.
3. Si el servidor no admite transacciones se ejecuta igualmente, sin
   atomicidad, avisando **una vez** por proceso. MongoDB solo las admite sobre
   un conjunto de réplicas; Atlas lo es —también el plan gratuito—, así que en
   producción no se da, pero un `mongod` suelto de desarrollo sí. Se prefirió
   eso a dejar la aplicación inservible en local.

**Dos trampas que costaron ir despacio:**

- **`Model.create` con sesión EXIGE un arreglo.** Con un documento suelto,
  Mongoose interpreta el segundo argumento como otro documento y **la sesión se
  pierde sin decir nada**: esa escritura habría quedado fuera de la transacción
  y el arreglo no habría servido de nada. Hay una prueba de arquitectura que lo
  fija.
- **Una sesión no admite operaciones en paralelo.** La transferencia de
  propiedad hacía `Promise.all` de tres `save`; dentro de una transacción tienen
  que ir en secuencia. También está fijado por prueba.

**El arnés de pruebas cambió, y era imprescindible.** Las pruebas arrancaban un
`mongod` suelto (`MongoMemoryServer`), donde las transacciones **no existen**:
las pruebas de atomicidad se habrían ejercitado contra la rama de respaldo de
`enTransaccion()` y habrían pasado sin comprobar nada. Ahora arrancan un
conjunto de réplicas de un nodo (`MongoMemoryReplSet`), que tarda medio segundo
en levantar. Hay una prueba que impide volver atrás.

**La verificación que de verdad importa:** se desactivó la atomicidad a mano
—dejando `enTransaccion` ejecutando sin sesión— y **las cuatro pruebas nuevas
fallaron**. Una prueba de reversión que no se ha visto fallar no demuestra nada.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | `enTransaccion()`, `esFaltaDeSoporteDeTransacciones()` y las cuatro secuencias |
| `test/integracion.test.js` | Conjunto de réplicas y cuatro casos que fuerzan el fallo a mitad |
| `test/architecture.test.js` | Invariantes del ayudante, del arreglo en `create`, del `Promise.all` y del arnés |
| `avance_proyecto.md` | Punto de partida, tabla de fases y esta entrada |

**Verificación:**

```
npm run check             → sintaxis válida
npm test                  → 105/105 (40 arquitectura + 65 integración)
npm audit --omit=dev      → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- **Dos alarmas antiguas saltaron al cambiar el borrado de jornada**, y estaban
  bien puestas: fijaban la forma literal de `PuntosJornada.deleteMany` y su
  adyacencia con `invalidarCacheRanking`. Se actualizó la expectativa
  conservando la intención —que la ruta haga ambas cosas—, no la adyacencia: el
  borrado ocurre ahora dentro de la transacción y la invalidación **después de
  confirmarla**, porque invalidar antes sería mentir si se revierte.
- `PUT /api/admin/trivias/:jornadaNombre` **no invalidaba la caché del ranking**
  pese a borrar respuestas y poner puntos a cero. Se añadió al cerrar la
  transacción.
- Las pruebas de integración pasaron de ~55 s a ~6 s. No es mérito de esta
  entrada; el conjunto de réplicas resultó ser más rápido que el mongod suelto
  en este equipo.

**Pendiente / siguiente paso:** **pruebas E2E con Playwright**, que es lo
acordado y lo que haría automática la prueba de humo manual que se viene
repitiendo. Después, la CSP —convertir los 63 `onclick=` a `addEventListener`
para poder quitar `unsafe-inline`— y los medios de la Entrada 015.

---

### 📌 Entrada 023 — 18 de agosto de 2026 — Pruebas de navegador con Playwright

**Objetivo:** automatizar la prueba de humo manual. Las 105 pruebas de `npm test`
cubren bien el servidor, pero el frontend no tenía ninguna: cada entrega de las
últimas seis terminó con una lista de pantallas que había que abrir y mirar a
mano, y esa lista crecía.

**Qué se hizo:**

1. `playwright.config.js` con dos proyectos: **escritorio y móvil**. El móvil no
   es un extra: la interfaz entera está construida sobre `mobile-shell` y es
   como se usa la aplicación.
2. `test/e2e/arrancar.js` levanta la aplicación completa —base en memoria y
   servidor HTTP— sin tocar nada real. Lo lanza Playwright a través de
   `webServer`, que espera a que `/healthz` responda: así ninguna prueba puede
   correr contra un servidor a medio levantar.
3. La base es un **conjunto de réplicas**, igual que en las pruebas de
   integración. Con un mongod suelto, las rutas que crean quinielas caerían a la
   rama sin transacción y las pruebas verían la aplicación comportándose de otra
   manera que en producción.
4. Se ejecutan **en serie y con un solo trabajador**: comparten base de datos y
   el ranking es global a la quiniela. En paralelo se pisarían y los fallos
   serían intermitentes, que es la peor clase de prueba.
5. Corren **aparte de `npm test`** (`npm run test:e2e`), para que la suite
   rápida siga siendo rápida.

**Las 9 pruebas (×2 proyectos = 18):**

| Archivo | Qué fija |
|---|---|
| `cuenta.spec.js` | Alta, creación de quiniela y entrada; contraseña corta rechazada por el SERVIDOR —se le quita el `minlength` al campo a propósito—; el login que no revela si la cuenta existe; el ojo de la contraseña |
| `inyeccion.spec.js` | Regresión de S-04 con un navegador de verdad |
| `jornadas.spec.js` | Que crear jornada ya no pide fecha; la validación con su motivo; y la privacidad partido a partido con dos usuarios reales |

**La prueba que más valor tiene** es la de inyección. Las de arquitectura
comprueban que las plantillas van etiquetadas; esta comprueba lo que de verdad
importa: que un nombre de jornada con `<img src=x onerror=…>` dentro llega a la
pantalla **como texto**, que no aparece ninguna `<img>` en el DOM y que la
bandera que el manejador habría puesto en `window` sigue sin existir.

**Y las dos se verificaron al revés, que es lo único que las hace valer:**

- Se quitó la etiqueta `html` de `ver_jornadas.js` → la prueba de inyección
  **falla**.
- (En la Entrada 022 se hizo lo mismo con la atomicidad y fallaron las cuatro.)

Una prueba de seguridad que pasa también contra el código vulnerable no es una
prueba, es un adorno.

**Dos cosas que las pruebas destaparon del propio montaje:**

- Crear una quiniela **lleva directo a la portada**; el servidor ya la deja
  seleccionada. El ayudante esperaba volver a la lista y pulsar «Entrar».
- Activar Admin Mode **no navega a ningún sitio**, solo cambia qué sección se
  muestra. Sin esperar a que aparezca la de administración, la prueba seguía
  antes de que la sesión quedara marcada y el servidor respondía 401.
- Y una de dominio: **el servidor bloquea el pronóstico de un partido que ya
  empezó**, que es la otra cara de la regla de privacidad. La prueba tuvo que
  pronosticar primero y adelantar el reloj después.

**Archivos añadidos:**

| Archivo | Cambio |
|---|---|
| `playwright.config.js` | Dos proyectos, servidor propio, en serie |
| `test/e2e/arrancar.js` | Levanta base en memoria y aplicación |
| `test/e2e/ayudas.js` | Alta, creación de quiniela y Admin Mode |
| `test/e2e/*.spec.js` | Las nueve pruebas |
| `package.json`, `.gitignore` | `test:e2e`, `test:e2e:ui`; informes fuera del control de versiones |

**Verificación:**

```
npm test              → 105/105 (la suite rápida no cambia)
npm run test:e2e      → 18/18 (9 × escritorio y móvil), ~25 s
npm audit --omit=dev  → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- Cada prueba se crea **su propia cuenta y su propia quiniela**, con marca de
  tiempo en el nombre. Reutilizar datos entre pruebas las hace depender del
  orden, y esos fallos se persiguen durante horas.
- Playwright deja `test-results/` y `playwright-report/`, ya excluidos del
  control de versiones. Las capturas y los rastros solo se guardan **al fallar**.
- Los navegadores no van en el repositorio: en una máquina nueva hace falta
  `npx playwright install chromium` una vez.

**Pendiente / siguiente paso:** ampliar la cobertura a las pantallas de
resultados y trivias, que son las que más plantillas tienen. Después, **la
CSP**: convertir los 63 `onclick=` a `addEventListener` para poder quitar
`unsafe-inline`, que es lo que convertiría el escapado de S-04 en defensa en
profundidad y no en la única línea. Y montar CI, que ahora ya tiene algo que
ejecutar.

---

### 📌 Entrada 024 — 18 de agosto de 2026 — Los cinco frentes pendientes

**Objetivo:** cerrar de una tanda los cinco puntos que quedaban en la lista:
ampliar E2E, endurecer la CSP, montar CI, M-26 y empezar la modularización.
Cada uno va en su propio commit, para poder revertir uno sin arrastrar los demás.

---

#### 1 · Pruebas de navegador de resultados y trivias — y un bug real

Cuatro pruebas nuevas sobre las pantallas con más plantillas. **Destaparon una
regresión mía de la Entrada 021:**

```js
html`<div>${lista.map(x => html`<p>${x}</p>`).join('')}</div>`
```

`.join('')` convierte el arreglo de `HtmlCrudo` en una **cadena**, y con ello se
pierde la marca de "esto ya es HTML": la plantilla de fuera lo trata como dato y
lo escapa. El marcado salía **como texto en pantalla**, y el bloque interior
además doblemente escapado. Se veía en los resultados de trivias al desplegar
una pregunta.

Afectaba a cuatro sitios en dos archivos. **La prueba de S-04 no lo veía**:
comprueba que las plantillas van etiquetadas, no que la composición conserve la
marca. Se añadió el guardián que faltaba, verificado reintroduciendo el fallo.

Y tres cosas de dominio que el montaje sacó a la luz, ninguna un fallo: cargar
resultados oficiales marca los partidos como terminados y eso **bloquea sus
trivias**; las preguntas no se pintan hasta que el jugador se identifica; y
validar la contraseña **repinta** las trivias, así que seleccionar antes de que
asiente hace que el repintado borre la elección.

---

#### 2 · CSP cerrada

Hasta ahora el escapado de S-04 era la **única** línea de defensa: la política
permitía inline en `script-src` y en `script-src-attr`, así que cualquier marcado
que se colara en el DOM podía ejecutarse. Ahora es defensa en profundidad.

Para poder cerrarla había que sacar el código del marcado:

- **22 `onclick="window.location.href='…'"`** pasan a `data-ir-a`, conectados por
  `navegacion.js`. Eran bastantes menos de los 63 que decía el comentario del
  propio código.
- **2 `oninput` de autocompletado estaban muertos**: apuntaban a contenedores
  `equipo1Suggestions`/`equipo2Suggestions` que no existen —los reales son
  `suggestions1`/`2`— y `jornadas.js` ya hacía el trabajo con `addEventListener`.
  Se retiran sin sustituto.
- Los **4 bloques `<script>`** del HTML pasan a archivos propios.

**Hallazgo:** al sacar el script inline de `resultados-totales.html` apareció
código que el guardián de S-04 **nunca había mirado**, construyendo la vista
móvil con nombres de jugador y de jornada **sin escapar**. Estaba fuera del
alcance de la prueba por vivir dentro del HTML.

Dos guardianes nuevos: uno de arquitectura (ninguna pantalla con manejadores en
atributo ni `<script>` inline) y uno de navegador que **recorre las 32 pantallas
registrando violaciones de CSP**. Este segundo es necesario porque una violación
**no da error visible**: el botón carga, se pulsa y no hace nada. Verificado
reintroduciendo un `onload` inline.

---

#### 3 · Integración continua

`.github/workflows/pruebas.yml`, en cada empujón y cada pull request contra
`main`. Dos trabajos separados a propósito: la suite rápida tarda medio minuto y
la de navegador un par, así que ver fallar la primera no obliga a esperar a la
segunda.

`npm ci` y no `npm install`: instala exactamente lo del lockfile y falla si se
desincronizó, que es parte de lo que se quiere detectar. Verificado con
`npm ci --dry-run`. Las evidencias de Playwright solo se suben **si algo falla**.

Con una prueba que fija **qué** tiene que ejecutar el pipeline: un flujo que
existe pero no corre las pruebas da una falsa sensación de red.

---

#### 4 · M-26

Tres endpoints devolvían colecciones enteras y el navegador filtraba después de
habérselas traído por la red. Los tres aceptan ahora acotarse, y **sin parámetros
responden igual que antes**:

| Endpoint | Cómo se acota |
|---|---|
| `GET /api/jornadas?resumen=1` | Solo los nombres. La mayoría de pantallas solo llenan un desplegable |
| `GET /api/resultados-oficiales?jornada=X` | Una jornada |
| `GET /api/resultados?jornada=X` | Acota las **tres** lecturas. Era el caso de manual |

Con una prueba de que el filtro **no debilita la privacidad**: acotar por jornada
sigue tapando los partidos que no han empezado. Un filtro que además se saltara
el tapado sería peor que no tenerlo.

---

#### 5 · Fase 6: primera tajada

`server.js` pasaba de 5.300 líneas. Se extrae lo que **no toca Express ni los
modelos** —funciones puras, ya cubiertas por pruebas, riesgo casi nulo— y con
ello queda establecido el patrón: `src/`, `require`, y reexportación desde
`server.js` para no cambiar la superficie pública.

- `src/transacciones.js` (89 líneas)
- `src/validacion.js` (143 líneas)

Y se retira el código muerto ya identificado: el marcador
`////////////borrar borrar`, el bloque comentado de `footballApi`, y **dos
scripts huérfanos** —`llenar_jornada.js`, duplicado de `llenar_jornada_user.js`,
y `main.js`, cuatro líneas sin lógica—. El segundo lo encontró la prueba nueva,
no yo.

Dos invariantes para las tajadas siguientes: lo extraído **se reexporta** desde
`server.js`, y los módulos de `src/` **no pueden depender de `server.js`** —sería
un ciclo y el troceado dejaría de servir—.

**Esto NO termina la Fase 6.** Quedan las rutas, los modelos y el sincronizador,
que sí tocan Express y merecen su propia sesión con su prueba de humo.

---

**Verificación:**

```
npm run check         → sintaxis válida
npm test              → 112/112 (45 arquitectura + 67 integración)
npm run test:e2e      → 30/30 (15 × escritorio y móvil)
npm audit --omit=dev  → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- El análisis automático de qué pantallas necesitan los partidos **se equivocó**
  con `ver-resultados-oficiales.js`: usa `.partidos`, pero de la respuesta de
  oficiales, no de la de jornadas. Las heurísticas por texto orientan; no
  deciden.
- Un heredoc del shell se comió las barras de `\\b` en una prueba nueva, y `\b`
  dentro de una plantilla es un **retroceso**, no un límite de palabra. La prueba
  fallaba por su propia expresión regular, no por el código.

**Pendiente / siguiente paso:** prueba de humo visual, con atención a los
**botones de navegación** —los 22 que cambiaron de `onclick` a `data-ir-a`— y a
los **resultados de trivias**, que es donde estaba el marcado saliendo como
texto. Después, seguir troceando `server.js`: rutas, modelos y sincronizador.

---

### 📌 Entrada 025 — 18 de agosto de 2026 — El CI en rojo a la primera, y por qué

**Objetivo:** dejar la integración continua realmente en verde. La Entrada 024 la
montó, pero **nunca se había visto correr**: se validó la estructura del archivo y
`npm ci --dry-run` en la máquina de desarrollo, que no es lo mismo.

**Lo que pasó.** El primer empujón la puso en rojo:

```
> node --test "test/**/*.test.js"
Could not find '/home/runner/work/.../test/**/*.test.js'
Error: Process completed with exit code 1.
```

**`node --test` solo expande comodines desde Node 22.** La máquina de desarrollo
tiene Node 24 y el flujo pedía Node 20, así que el comodín funcionaba en local y
en el servidor se tomaba como un nombre de archivo literal.

Y falló de la peor manera posible: **en rojo sin haber ejecutado una sola
prueba**. No había nada mal en el código; simplemente las pruebas no llegaron a
arrancar. Un rojo así se confunde fácilmente con un fallo real y se pierde el
tiempo buscando donde no hay nada.

**Qué se hizo:**

1. El script `test` pasa a **listar los archivos explícitamente**. Funciona en
   cualquier versión que `engines` admite (`>=20`), que es lo que se prometía.
2. El flujo pide **Node 22** en vez de 20, que además está al final de su vida.
3. `actions/checkout` y `actions/setup-node` suben a **v5**, con lo que
   desaparecen los dos avisos de deprecación que salían junto al error. Eran
   solo avisos y no la causa, pero estorbaban al leer.

**El riesgo que aparece al quitar el comodín**, y que es la parte interesante:
con rutas explícitas, añadir un archivo de pruebas y olvidar listarlo haría que
**el CI pasara en verde sin ejecutarlo**. Eso es peor que fallar, porque da
confianza falsa. Hay una prueba nueva que lo impide, verificada creando un
archivo de pruebas suelto: falla y dice cuál falta.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `package.json` | `test` lista los archivos en vez de usar comodín |
| `.github/workflows/pruebas.yml` | Node 22; `checkout`/`setup-node` a v5 |
| `test/architecture.test.js` | Que `npm test` ejecute TODOS los archivos de prueba, y sin comodines |

**Verificación:**

```
npm test              → 113/113
npm run test:e2e      → 30/30
npm audit --omit=dev  → 0 vulnerabilidades
integración continua  → verde, confirmado en GitHub Actions
```

**Hallazgos nuevos:**

- **Una diferencia de versión entre desarrollo y CI puede ser invisible durante
  meses.** Aquí la delató el primer día porque el CI se estrenó; sin él, el
  comodín habría seguido funcionando en la máquina de siempre y roto en cualquier
  otra.
- Antes de sospechar del comodín se descartó lo primero que suele fallar al
  pasar de Windows a Linux: **las diferencias de mayúsculas en los nombres de
  archivo**, que Windows oculta y Linux no perdona. No había ninguna.

**Pendiente / siguiente paso:** seguir troceando `server.js` —rutas, modelos y
sincronizador—, y las decisiones que dependen del usuario: C-06 (el clúster M0
que se auto-pausa), M-30 (la base llamada `test`) y la configuración de Render.

---

### 📌 Entrada 026 — 18 de agosto de 2026 — Fase A: los dos retoques de interfaz

**Objetivo:** la primera fase del plan de producto (§20.2), la única sin
decisiones pendientes: la petición 4 —el escritorio se ve mal, el botón de
llenar jornada es desproporcionado— y la 6 —la tabla por jornada solo se alcanza
desde la barra inferior—.

---

#### Lo primero fue medir, no mirar

La petición decía «desproporcionado» sin más. Antes de tocar CSS se levantó la
aplicación de pruebas y se midió la tarjeta en los dos tamaños:

| | Ancho | Alto |
|---|---|---|
| Escritorio (1280) | 411 px | **261 px** |
| Móvil (393) | 329 px | 88 px |

**El problema no era el ancho: era el alto.** En escritorio la tarjeta ocupaba
la mitad de la rejilla, que es lo correcto, pero medía **tres veces** lo que sus
compañeras. De haberla enunciado como «ocupa toda la anchura» —que es como la
recogía el plan— se habría arreglado algo que no estaba roto.

**La causa:** el rotador de la portada (`.home-rotator`, ranking y partidos en
vivo) vive **dentro** de la rejilla `.quick-actions`. A partir de 720 px la
rejilla pasa a dos columnas, así que a ese panel alto le tocaba media fila y su
vecina se estiraba hasta igualarlo. La vecina era «Llenar Quiniela», y encima es
la tarjeta `primary`: un bloque verde de 411×261 al lado de tarjetas de 88.

**El arreglo son dos líneas:** que el rotador ocupe la fila entera. Así nadie la
comparte con él y las tarjetas vuelven a emparejarse entre iguales. La regla vive
dentro del `@media (min-width: 720px)` que ya existía, de modo que en móvil
—donde la rejilla es de una sola columna y el caso principal— no cambia nada.
Medido después: **411×104** en escritorio, y el móvil intacto en 329×88.

No se tocó `align-items`. Que dos tarjetas de la misma fila igualen su altura es
el comportamiento deseado —«Admin mode» lo hace y se ve bien—; lo patológico era
igualarse con un panel que no es una tarjeta.

---

#### La tarjeta que faltaba

`clasificacion-jornada.html` solo se alcanzaba desde la barra inferior. Se añade
su tarjeta **junto a «Tabla General»**, no al final: son la misma pregunta con
distinto alcance, y quien busca una suele querer comparar con la otra.

De paso se quitaron los espacios sobrantes al final de tres líneas `</a>` que ya
venían así.

---

#### Las pruebas: una por petición, y ninguna con números fijos

`test/e2e/portada.spec.js`, cuatro pruebas contando escritorio y móvil.

La de la tarjeta la busca **dentro de `.quick-actions`**, y esto no es un detalle
de estilo: la barra inferior ya enlazaba a esa pantalla, así que un selector por
`href` a secas habría pasado en verde sin que la tarjeta existiera. La prueba
habría certificado justo lo que se quería arreglar.

La de la maquetación no compara contra un número fijo sino contra **la mediana de
las demás tarjetas**, con un margen de 1,8×. Un umbral en píxeles se rompe en
cuanto cambie el tipo de letra o el relleno, y lo que se quiere fijar no es una
altura: es la proporción. Una tarjeta puede ser algo más alta por llevar dos
líneas de texto; no tres veces más alta. El mensaje de fallo nombra la culpable y
da los dos números.

**Verificado reintroduciendo ambos fallos** —comentando el `grid-column` y
devolviendo el `href` al valor anterior—: las dos pruebas caen, y la de altura
falla diciendo *«la tarjeta llenar_jornada_user.html mide 261px de alto y la
mediana es 88px»*.

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `private/css/styles.css` | `.home-rotator` ocupa la fila entera a partir de 720 px |
| `public/index.html` | Tarjeta hacia `clasificacion-jornada.html` junto a la Tabla General |
| `test/e2e/portada.spec.js` | Nuevo: las dos pruebas de la portada |
| `avance_proyecto.md` | Fase A marcada como completada y esta entrada |

**Verificación:**

```
npm run check     → sintaxis válida
npm test          → 113/113
npm run test:e2e  → 34/34 (17 × escritorio y móvil; eran 30)
```

**Hallazgos nuevos:**

- **La captura de página completa miente sobre la barra inferior.** Sale flotando
  a media página, encima de una tarjeta, porque es `position: fixed` y la captura
  la fija en su posición del viewport. No es un fallo de maquetación: en el
  navegador está donde debe. Se anota para que nadie lo «arregle» al ver la
  imagen.
- **El plan describía el síntoma equivocado**, y no por descuido: lo describió
  quien no lo había medido. Medir antes de tocar costó dos minutos y cambió el
  arreglo entero.

**Pendiente / siguiente paso:** **Fase B — qué es «la jornada actual»**
(peticiones 1, 2 y 5), que es la siguiente del plan pero **arranca bloqueada por
una decisión de producto**: si la jornada actual se deriva de las fechas de los
partidos o de `createdAt`. La recomendación de §20.3 es lo primero. Sin esa
respuesta no se puede empezar.

---

### 📌 Entrada 027 — 18 de agosto de 2026 — Fase B: qué es «la jornada actual»

**Objetivo:** las peticiones 1, 2 y 5, que son la misma pregunta. Antes de tocar
código había que decidirla, y la decisión tomada fue la recomendada en §20.3:
**la jornada actual es la que contiene el partido más próximo —hacia adelante o
hacia atrás— sin resultado definitivo**, derivada de las fechas de los partidos
y no de `createdAt` ni de un número puesto a mano.

---

#### El problema no era que una pantalla se equivocara

Era que había **tres reglas** y ninguna sabía de las otras:

| Dónde | Cómo se elegía |
|---|---|
| Tabla por jornada | `sort({ createdAt: -1 })` — la creada más recientemente |
| Llenar jornada | `data[data.length - 1]` — el último del arreglo, sin orden garantizado |
| Resultados oficiales | `jornadas[jornadas.length - 1]` — lo mismo, por otro camino |

`createdAt` es cuándo se creó el registro, no cuándo se juega: una jornada
importada tarde se volvía «la última» con partidos de la semana pasada. Y la
petición 1 lo agravaba, porque dice que **puede haber dos jornadas jugándose a la
vez**, con lo que «la última» deja de tener una sola respuesta.

Igual que con el cierre por partido en la Entrada 019, la regla acaba en **un
solo sitio** y las tres pantallas la consumen. Tres copias de una regla acaban
discrepando; estas ya lo habían hecho.

---

#### La regla, y por qué tiene tres grupos y no una fórmula

`src/jornada-actual.js`, función pura: recibe las jornadas y el reloj, no
consulta la base y no conoce Express.

La distancia se mide en **valor absoluto**. Recién terminada una jornada, sus
partidos quedan unas horas atrás y durante ese rato sigue siendo la que la gente
quiere ver; deja de serlo sola, en cuanto los partidos de la siguiente se acercan
más de lo que la anterior se aleja. No hace falta ninguna regla extra para eso.

Pero una distancia sola no basta, y por eso hay **tres grupos**, donde el grupo
manda siempre sobre la distancia:

| Grupo | Qué es | Por qué va ahí |
|---|---|---|
| 1.º | Tiene partidos sin resultado definitivo, y con fecha | El caso normal: se ordenan por cercanía |
| 2.º | Tiene partidos pendientes pero **ninguna fecha** | Los partidos cargados a mano no tienen `apiDate`; no se pueden ordenar, pero siguen siendo más actuales que una jornada cerrada |
| 3.º | Todo definitivo | Una temporada cerrada nunca es «la actual», por muy cerca que quede su último partido |

Sin los grupos, una jornada cerrada hace una hora le ganaría a la que se juega el
mes que viene, que es exactamente al revés de lo que hay que enseñar.

Los empates se rompen por **el orden en que llegan**, y el servidor manda la más
nueva primero. Es decir: `createdAt` deja de ser la regla y pasa a ser el
desempate, que es el único sitio donde nunca hizo daño.

---

#### Lo que se movió, y lo que se tuvo que mover antes

`src/fechas.js`: `parseFechaPartidoCostaRica` y `extraerFechaApi` salen de
`server.js`. No es un extra de la Fase 6 metido de contrabando: la regla nueva
necesita interpretar `apiDate`, y si lo importara de `server.js` habría un ciclo,
que es justo el invariante que la Entrada 024 dejó escrito para las tajadas
siguientes.

**Servidor.** `calcularJornadaActual()` lee lo justo y se lo da a la regla:

```js
Jornada.find({}).select('nombre partidos.apiDate')
ResultadoOficial.find({}).select('jornada resultados.estado resultados.bloqueadoFinal')
```

La proyección importa. La regla necesita mirar dentro de los partidos —va por
fechas—, y traérselos enteros sería volver a los cuatrocientos subdocumentos por
pantalla que quitó la Fase 5. Se proyectan la fecha y el estado, y nada más.

`GET /api/jornada-actual` devuelve la sugerida **y la lista de nombres**, para
que una pantalla llene su desplegable y elija el valor por defecto con una sola
petición.

**Pantallas.** Llenar quiniela abre en la sugerida y **estrena selector**
(petición 1); resultados oficiales abre en la sugerida en vez de en el último
elemento del arreglo (petición 2); la tabla por jornada deja de ordenar por
`createdAt`. Y la portada estrena un tercer panel con el top 3 de la jornada
(petición 5).

Para ese tercero hubo que **generalizar el carrusel**. La rotación vivía dentro
de `index-live.js` y era un booleano —ranking o en vivo—, que no da para tres.
Sale a `index-rotador.js` y pasa a recorrer una lista, con un único acuerdo entre
las partes: **un panel oculto es un panel que no tiene nada que enseñar, y se
salta**. Así el rotador no sabe de rankings ni de jornadas, y cada panel decide
si merece turno. Los paneles arrancan ocultos y se destapan al tener contenido;
al revés, la portada enseñaría tarjetas vacías durante un segundo en cada carga.

---

#### Tres fallos que destaparon las pruebas, y ninguno era del código

1. **La prueba de integración con años 2099 y 2020.** Se escribió «2099» para
   decir futuro y «2020» para decir pasado, y falló: a 2026, el 2099 queda
   setenta años por delante y el 2020 seis por detrás, así que la vieja era la
   más cercana y la regla la elegía **bien**. El dato de prueba estaba mal. Las
   fechas pasaron a ser relativas al reloj.

2. **El pronóstico rechazado con «Partidos bloqueados: 1».** La prueba del podio
   ponía el partido ayer, para que pareciera jugado, y mandaba un pronóstico. El
   servidor lo rechazó con razón: desde la Entrada 019 los pronósticos se cierran
   partido a partido en cuanto empieza. La prueba pedía algo imposible.

3. **`llenar_jornada.html` se quedó en blanco.** Esa pantalla huérfana comparte
   script con `llenar_jornada_user.html` —son gemelas de antes de la Fase 6— y no
   tiene el selector nuevo, así que el script moría en la primera línea. Lo cazó
   la prueba de CSP que recorre las 32 pantallas, no una prueba de la Fase B: la
   violación no da error visible, la pantalla simplemente no hace nada. El
   selector pasa a ser opcional; sin él la pantalla abre en la sugerida y no se
   puede cambiar, que es lo que hacía antes.

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/jornada-actual.js` | Nuevo: la regla, pura y con los tres grupos |
| `src/fechas.js` | Nuevo: las dos funciones de fecha, sacadas de `server.js` |
| `server.js` | `calcularJornadaActual()`, `GET /api/jornada-actual`, y la tabla por jornada deja de usar `createdAt` |
| `private/js/llenar_jornada_user.js` | Abre en la sugerida, selector de jornadas, y pide solo la suya en vez de todas |
| `private/js/ver-resultados-oficiales.js` | Abre en la sugerida sin pisar lo que el usuario elija |
| `private/js/index-rotador.js` | Nuevo: la rotación, ahora sobre una lista |
| `private/js/index-jornada.js` | Nuevo: el podio de la jornada |
| `private/js/index-live.js` | Se queda solo con su panel; ya no rota |
| `public/index.html`, `public/llenar_jornada_user.html` | El panel nuevo y el selector |
| `test/integracion.test.js` | 9 pruebas de la Fase B |
| `test/e2e/jornada-actual.spec.js` | Nuevo: 6 pruebas de navegador |
| `test/architecture.test.js` | Los dos guardianes que la mudanza dejó obsoletos |
| `avance_proyecto.md` | Fase B marcada como completada y esta entrada |

**Verificación:**

```
npm run check         → sintaxis válida
npm test              → 122/122 (eran 113)
npm run test:e2e      → 46/46 (eran 34)
npm audit --omit=dev  → 0 vulnerabilidades
```

**Hallazgos nuevos:**

- ⚠️ **Una jornada abandonada se queda de «actual» para siempre.** Si a una
  jornada nunca se le cargan resultados, sus partidos siguen contando como
  pendientes y puede ganarle a una posterior ya cerrada por muy vieja que sea.
  Salió por accidente montando una captura: una jornada de hace 30 días sin
  resultados desplazaba a la del día siguiente. **La regla hace lo que se
  acordó**, así que no se ha cambiado por cuenta propia; queda anotado como
  decisión pendiente. El arreglo sería un plazo —una jornada cuyo último partido
  quedó hace más de una semana y sigue sin un solo resultado está abandonada, no
  en curso—. Mientras tanto no bloquea a nadie: las tres pantallas llevan
  selector.
- **Dos guardianes de arquitectura fallaron por la mudanza, no por un fallo.**
  Buscaban `function parseFechaPartidoCostaRica` en `server.js`, y ahora vive en
  `src/`. Se corrigieron mirando el conjunto —server.js más `src/`—, que es lo
  que ya hacían las comprobaciones de validadores desde la Fase 6, y de paso se
  añadió que ninguna de las dos pueda **reaparecer** en `server.js`: reexportarla
  está bien, redefinirla es volver a tener dos verdades.
- **El heredoc del shell se come las barras invertidas**, otra vez. Lo anotó la
  Entrada 024 y volvió a morder tres veces seguidas al editar expresiones
  regulares. La salida es no meter barras en el heredoc: anclar por posición y
  traer el texto nuevo desde un archivo.

**Pendiente / siguiente paso:** decidir si «una jornada abandonada» merece un
plazo, que es la única cuestión abierta que deja esta fase. Después, la **Fase C
— buscador de ligas dinámico** (petición 9), que solo necesita confirmar cuántos
días hacia adelante se buscan y habilita la Fase D.

---

### 📌 Entrada 028 — 18 de agosto de 2026 — La jornada actual pasa a ser la última creada

**Objetivo:** cambiar la regla de la Fase B. El usuario descartó derivarla de las
fechas de los partidos: **la jornada actual es la última que se creó**.

Es una decisión de producto y está tomada. Lo que sigue es qué implica y qué se
encontró al aplicarla.

---

#### El hallazgo que cambió el arreglo

`sort({ createdAt: -1 })` era la regla original de la tabla por jornada. Al ir a
restaurarla apareció esto:

```js
const JornadaSchema = new mongoose.Schema({
  nombre: String,
  partidos: [ ... ]
});          // ← sin { timestamps: true }
```

**`createdAt` no existe en las jornadas.** Cinco de los siete esquemas del
archivo llevan `timestamps: true`; `Jornada` no. Así que aquel `sort` ordenaba
por un campo ausente: Mongo no falla, simplemente no ordena, y devuelve lo que le
apetezca. Eso explica de dónde salía la discrepancia entre pantallas que motivó
la Fase B —no era que hubiera dos criterios, es que uno de ellos no era ningún
criterio—.

**Se ordena por `_id`.** El ObjectId de Mongo lleva dentro la marca de tiempo de
creación y ordena cronológicamente, así que sirve para las jornadas que **ya
existen**: cero migración, cero campo nuevo que alguien tenga que acordarse de
rellenar. Añadir `timestamps: true` habría funcionado solo para las jornadas
futuras y habría dejado a las viejas sin fecha, que es la mitad peor del
problema.

Comprobado antes de escribirlo: dos ObjectIds creados con un segundo de
diferencia ordenan correctamente entre sí.

**Editar una jornada no la rejuvenece.** La ruta que las guarda hace `upsert` por
nombre y conserva el `_id`, así que corregir una falta de ortografía en una
jornada vieja no la asciende a jornada actual. Hay una prueba que lo fija, porque
si esa ruta pasara algún día a borrar y recrear, el síntoma —«la jornada actual
cambió sola»— no se relacionaría jamás con la causa.

---

#### Qué se conserva y qué se va

Lo que la Fase B tenía de valioso **no era la regla**: era que hubiera **una
sola**, en un solo sitio, y que las pantallas la consumieran. Eso se queda entero.

| Se queda | Se va |
|---|---|
| `GET /api/jornada-actual` y `calcularJornadaActual()` | `src/jornada-actual.js` — los tres grupos y la distancia |
| El selector de jornadas en llenar quiniela (petición 1) | Las 9 pruebas de la regla por fechas |
| Resultados oficiales abriendo en la sugerida (petición 2) | |
| El podio de la jornada en la portada (petición 5) | |
| `src/fechas.js` — lo sigue usando `partidoYaInicio` | |

La regla dejó de merecer un módulo propio: ahora es una consulta ordenada, y
envolverla en una función pura de cien líneas para devolver el primer elemento
sería fingir una complejidad que ya no existe.

**A cambio se acepta un caso conocido:** una jornada importada tarde se presenta
como la actual aunque sus partidos ya se hayan jugado. Es exactamente lo que la
regla por fechas evitaba. Se acepta a sabiendas, y no duele porque las tres
pantallas llevan selector: se corrige en un clic. A cambio, la regla se explica
en una frase, que es lo que se pidió.

Y se va con ella el problema que dejó abierto la Entrada 027: una jornada
abandonada ya no puede quedarse de «actual» para siempre, porque las fechas de
los partidos dejaron de decidir nada.

---

#### Las pruebas cruzan las fechas a propósito

Tanto las de integración como las de navegador crean la jornada **más nueva** con
los partidos **más viejos**. No es un descuido: es lo que distingue qué regla está
aplicando el servidor. Con las fechas alineadas al orden de creación, las dos
reglas dan el mismo resultado y la prueba pasaría con cualquiera de las dos.

Se añadieron además dos que fijan el hallazgo de arriba: una comprueba que
`createdAt` **sigue sin existir** —y avisa si algún día aparece, porque entonces
la regla se puede simplificar— y otra que editar no asciende.

El guardián de arquitectura ahora prohíbe explícitamente `sort({ createdAt: -1 })`
en `server.js`. No es celo: es el error que estuvo ahí sin que nadie lo viera, y
lo natural es volver a escribirlo.

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | `calcularJornadaActual()` ordena por `_id`; fuera el require y la exportación de la regla anterior |
| `src/jornada-actual.js` | **Eliminado** |
| `test/integracion.test.js` | Las 9 pruebas de la regla por fechas → 6 de la regla nueva |
| `test/e2e/jornada-actual.spec.js` | Fixtures invertidas: la más nueva lleva los partidos más viejos |
| `test/architecture.test.js` | Fuera `jornadaSugerida`; el guardián prohíbe ordenar por `createdAt` |
| `avance_proyecto.md` | §20.3 con la decisión nueva y esta entrada |

**Verificación:**

```
npm run check     → sintaxis válida
npm test          → 119/119
npm run test:e2e  → 46/46
```

**Hallazgos nuevos:**

- **`Jornada` es el único esquema de dominio sin `timestamps`.** Cinco de siete
  lo llevan. No se ha añadido —el `_id` resuelve lo que hacía falta y un campo
  nuevo que nadie lee es peso muerto—, pero queda anotado por si alguna vez hace
  falta saber cuándo se tocó una jornada, no cuándo se creó.
- **Una regla que no ordena nada es peor que una regla equivocada.** Una regla
  equivocada se nota; `sort` sobre un campo inexistente devuelve resultados
  plausibles y distintos cada vez, y se atribuye a cualquier otra cosa. Esta
  llevaba ahí desde que se escribió la pantalla.

**Pendiente / siguiente paso:** **Fase C — buscador de ligas dinámico**
(petición 9), que solo necesita confirmar cuántos días hacia adelante se buscan y
habilita la Fase D.

---

### 📌 Entrada 029 — 19 de agosto de 2026 — La prueba de humo que faltaba, y la barra amarilla

**Objetivo:** cerrar los cabos sueltos que arrastraban dos sesiones —subir `main`
y hacer la prueba de humo visual que dejó pendiente la Entrada 024— antes de
empezar la Fase C.

---

#### Lo primero: la documentación no estaba subida

`git status` tenía **249 líneas sin confirmar** en `avance_proyecto.md`: la
reescritura del punto de partida, la sección de pendientes y el inventario del
§2, hecha la tarde anterior y nunca commiteada. Es justo el texto que sirve para
retomar el trabajo, y vivía solo en un disco. Se confirma y se sube: `main` pasa
de 6 commits sin subir a 0.

---

#### La prueba de humo, automatizada en vez de mirada

La Entrada 024 dejó pendiente «mirar los 22 botones que pasaron de `onclick` a
`data-ir-a`». Mirarlos una vez no sirve de mucho: lo que hace falta es que nadie
pueda romperlos sin enterarse. Así que en vez de una revisión manual se escribió
`test/e2e/navegacion.spec.js`, que **pulsa los 23 botones, uno por uno, en
escritorio y en móvil**, y comprueba que la pantalla cambia a la que el atributo
declara.

Las pantallas se descubren leyendo el marcado de `public/`, no de una lista
escrita a mano: una pantalla nueva con un botón nuevo entra sola en el barrido.
Es la única forma de que la prueba siga sirviendo dentro de seis meses.

**Comprobado que detecta de verdad:** se retiró `navegacion.js` de
`jugadores.html` y la prueba falló nombrando la pantalla exacta. Restaurado
después.

---

#### El modal que colgaba el barrido, y por qué costó encontrarlo

El primer intento se quedó colgado sin decir dónde. El síntoma era «timeout de la
prueba» a secas, y el plazo se lo comía entero una sola pantalla.

La causa: **tres pantallas abren un modal de «Validar jugador» nada más cargar**
—las dos de llenar jornada y la de trivias—. El script preselecciona al usuario
en el combo de jugadores y dispara un `change` sobre él, y ese manejador pide la
contraseña. El modal es `position: fixed` a pantalla completa con `z-index: 999`,
así que mientras esté arriba **ningún botón de debajo se puede pulsar**. Playwright
lo decía en su registro —«`modal-card` intercepts pointer events»— pero solo al
mirar el detalle del fallo.

Dos cosas se aprendieron y quedaron en el código:

- **El modal no está arriba cuando termina de cargar el documento**: lo abre una
  petición, así que aparece un instante después. La primera versión miraba si
  estorbaba justo al cargar, y unas veces lo cerraba y otras no: el fallo salía
  en una pantalla distinta en cada corrida. Ahora se espera a que se decida.
- **Todo clic lleva plazo propio y corto.** Sin él, un botón tapado se come el
  plazo entero de la prueba y el informe dice «timeout» sin decir cuál de los
  veintitrés fue.

De paso se comprobó una sospecha y resultó infundada: `/api/jugador/:nombre`
devuelve `password: true`, un booleano, no el hash. No hay fuga.

---

#### El hallazgo: una barra amarilla vacía en Llenar Jornada

Al mirar las capturas apareció, en las dos pantallas de llenar jornada, **una
barra amarilla vacía** entre el texto de los comodines y el selector de jornada.

Era `<div id="infoCierreContainer" class="info-card"></div>`, y **ningún script
del repositorio escribe nunca en él**. Es lo que quedó cuando el cierre pasó a
ser por partido en vez de por jornada (Entrada 019): el aviso desapareció, el
contenedor no. Y como `.info-card` tiene fondo amarillo y `padding: 14px`, un
contenedor sin nada dentro se pinta igual que uno con aviso.

Se arregla por los dos lados, a propósito:

| Dónde | Qué |
|---|---|
| `public/llenar_jornada.html` y `llenar_jornada_user.html` | Fuera el contenedor muerto |
| `private/css/styles.css` | `.info-card:empty { display: none; }` |

La regla de CSS no sobra: `llenar_trivia.html` tiene un aviso hermano que **su
script vacía** cuando no hay nada que decir, y sin la regla ese caso pintaría la
misma barra. El marcado muerto se quita; la clase, además, deja de poder
pintarse vacía venga de donde venga.

El barrido recoge ahora también las tarjetas de aviso vacías de cada pantalla, y
se comprobó inyectando una con solo un salto de línea dentro —que **no** es
`:empty` para el CSS, así que la regla sola no la taparía— y la prueba la cazó.

---

#### Lo que se miró y estaba bien

Con dos jornadas sembradas y sus resultados oficiales:

| Qué | Estado |
|---|---|
| El carrusel de la portada rota al **Top 3 de la jornada** y nombra la jornada correcta | ✅ |
| El **selector de jornada** de llenar quiniela abre en la última creada | ✅ |
| **Resultados oficiales** abre en la sugerida y pinta los marcadores sin pulsar nada | ✅ |
| La **tabla por jornada** abre en la misma y trae puntos, exactos y diferencia | ✅ |
| La tarjeta del rotador ocupa la fila entera y ninguna se estira (Fase A) | ✅ |

Un susto que no lo era: un partido con fecha de **2099** salía «Partido cerrado».
No es la fecha: el servidor guarda `estado: r.estado || 'TC'` al cargar un
resultado oficial, y `partidoBloqueado()` cierra cualquier partido con resultado
oficial en `LIVE`, `MT` o `TC`. Es correcto —lo raro era el dato de prueba, que
juntaba fecha futura con resultado ya cargado, cosa que no pasa en la realidad—.

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `test/e2e/navegacion.spec.js` | **Nuevo.** Barrido de los 23 botones y de las tarjetas de aviso vacías |
| `public/llenar_jornada.html` | Fuera `#infoCierreContainer`, contenedor sin escritor |
| `public/llenar_jornada_user.html` | Lo mismo |
| `private/css/styles.css` | `.info-card:empty { display: none; }` |
| `avance_proyecto.md` | Esta entrada y el punto de partida al día |

**Verificación:**

```
npm test          → 119/119
npm run test:e2e  → 48/48  (46 anteriores + 2 nuevas, escritorio y móvil)
```

**Hallazgos nuevos:**

- **Un contenedor sin escritor es marcado muerto que se ve.** `#infoCierreContainer`
  llevaba ahí desde la Entrada 019 y nadie lo notó porque las pruebas miran
  contenido, no ausencia de él. Lo cazó una captura, no una aserción.
- **Una prueba de navegador sin plazo por acción no dice dónde falló.** Playwright
  hereda el plazo de la prueba entera para cada clic, así que la primera pantalla
  que se cuelgue se lo lleva todo y el informe queda mudo.
- **`jornadas.spec.js` falló una vez y no se reprodujo.** Fue en móvil, en la
  prueba que acepta un `prompt` del navegador, y pasó sola en las dos corridas
  siguientes y aislada. Queda anotado: si vuelve, el sospechoso es el `dialog`.

**Pendiente / siguiente paso:** **Fase C — buscador de ligas dinámico**
(petición 9). Decisión tomada: se buscan **7 días hacia adelante**.

---

### 📌 Entrada 030 — 19 de agosto de 2026 — Fase C: el buscador de ligas deja de ser una lista escrita a mano

**Objetivo:** la petición 9 — que sea fácil buscar ligas, y que el desplegable se
llene con **las que de verdad tienen partidos**, no con una lista fija.

**Decisión de producto tomada antes de empezar: se buscan 7 días hacia
adelante**, contando el de hoy. Una semana cubre la jornada completa de casi
cualquier liga sin disparar el consumo del proveedor, y es el rango con el que
se arma una jornada normal.

---

#### Lo que había, y por qué no se arreglaba escribiendo más opciones

El desplegable eran unas veinte `<option>` en el HTML, con el país y el nombre
del torneo incrustados como texto:

```html
<option value="country=Mexico;league_exact=Liga MX">México - Liga MX</option>
```

y en el navegador tres funciones que, con eso, buscaban el partido
**comparando nombres**: `parseFiltroTorneo` troceaba la cadena,
`partidoCoincideConFiltro` miraba si el nombre de la liga del partido contenía
el esperado, y `esLigaNoPermitida` descartaba sub-20, reservas y femenil.

Tenía dos defectos, y ninguno se arregla añadiendo opciones:

1. **Si el proveedor renombra una competición, la opción deja de encontrar nada
   y nadie se entera.** La búsqueda devuelve cero partidos y parece que ese día
   no se juega. Es el peor tipo de fallo: silencioso y plausible.
2. **Los torneos que no estaban en la lista no existían.** Los centroamericanos
   que pedía la petición, entre otros.

---

#### El cambio de fondo: identidad en vez de nombres

Lo que se arregla no es el contenido de la lista, es **con qué se identifica una
liga**. Ahora el desplegable trae el `league_id` que usa el propio proveedor, y
comparar identidades no se rompe cuando cambia el rótulo.

| Pieza | Qué hace |
|---|---|
| `src/ligas.js` | **Nuevo.** La parte pura: el rango de fechas, el tope de días, la lista de competiciones bloqueadas y el agrupado por país |
| `GET /api/football/ligas-disponibles` | **Nuevo.** Los países con sus ligas, el id de cada una y cuántos partidos trae |
| `proveedorDeEventos.porRango` | **Nueva costura.** La única puerta hacia `get_events`, y por donde las pruebas meten un proveedor falso |
| `mapearEventoDelProveedor` | Extraído de la ruta de partidos: ahora hay dos cosas que leen la misma respuesta y una sola traducción |

El desplegable se rehace **cada vez que cambia la fecha**: las ligas de la semana
que viene no son las de esta, y ofrecer torneos sin partidos es exactamente lo
que esta fase vino a quitar.

---

#### Tres decisiones que conviene tener presentes

**El filtro de exclusiones subió al servidor, y ahora se aplica siempre.** La
lista de palabras bloqueadas —sub-20, reservas, femenil, juvenil— vivía en el
navegador y solo se aplicaba **si había un torneo elegido**: con «Todos los
torneos» se colaban igual. Ahora es una sola lista, en `src/ligas.js`, y la usan
las dos rutas que leen del proveedor. **Es un cambio de comportamiento
deliberado**, no un efecto secundario: la lista existe precisamente para que una
quiniela de Primera División no acabe con el partido de la sub-20, que se llama
casi igual.

**La caché de ligas vive en memoria del proceso, no en Mongo.** La de partidos de
la Fase 4 sí está en Mongo porque el ahorro **crece con el número de quinielas**:
cien quinielas siguiendo el mismo partido lo consultan una vez. Ésta la usan solo
los administradores mientras arman una jornada, así que el ahorro no escala igual
y no compensa una colección más. Con dos instancias cada una tendrá la suya, y el
coste es una consulta más cada diez minutos. Se limpia lo caducado al escribir,
porque si no el mapa crece con cada rango distinto y no lo vacía nadie: una fuga
lenta pero segura en un proceso que vive semanas.

**Hay un tope de 300 partidos en pantalla.** Sin torneo elegido, una semana entera
son miles, y pintarlos todos deja el navegador inservible. Se corta y se dice
cuántos había, que es mejor que colgarse en silencio.

Y una puerta que no estaba en el plan: la ruta nueva lleva **`requireAdmin`**.
Crear jornadas es cosa de administradores, y sin eso cualquier miembro podría
gastar la cuota del proveedor recargando la pantalla.

---

#### Qué pasa si el proveedor no responde

El desplegable **no se queda vacío**. Quedan «Todos los torneos» y «Buscar por
texto» —las dos opciones que no dependen de nadie— y el texto de abajo dice qué
pasó. Un desplegable vacío y mudo es lo peor que puede encontrarse quien viene a
armar una jornada: parece que la aplicación está rota y no hay nada que hacer.
Hay una prueba que lo fija, con la ruta interceptada devolviendo un 500.

---

#### Las pruebas, y un proveedor falso en el arnés de navegador

Diez de integración y cinco de navegador. Las de integración usan la costura
`porRango`, igual que las de la Fase 4 usan `porId`.

Para las de navegador hizo falta algo nuevo: la aplicación de pruebas arranca con
una **clave de API de mentira**, así que esta pantalla no podía cargar nada y no
había nada que probar. `test/e2e/arrancar.js` sustituye ahora `porRango` por una
lista fija —dos ligas de dos países más una femenil que el servidor debe
descartar—. Va en el arnés y no en cada prueba porque es propiedad **del
entorno**: esta aplicación de pruebas no habla con nadie de fuera.

**Comprobado que distinguen:** con `partidoCoincideConSeleccion` devolviendo
siempre `true`, la prueba de «buscar por una liga trae solo sus partidos» falla.

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/ligas.js` | **Nuevo**, 160 líneas. Rango, tope de días, exclusiones y agrupado por país |
| `server.js` | `mapearEventoDelProveedor`, `buscarEventosPorRango`, `porRango`, la ruta nueva y su caché; la ruta de partidos filtra lo bloqueado |
| `public/importar_partidos.html` | Fuera los ~20 torneos escritos a mano; «Desde» y el texto del rango |
| `private/js/importar_partidos.js` | Carga las ligas, filtra por id en vez de por nombre, busca el rango entero, tope de 300 |
| `test/integracion.test.js` | 10 pruebas nuevas |
| `test/e2e/importar-partidos.spec.js` | **Nuevo.** 5 pruebas de la pantalla |
| `test/e2e/arrancar.js` | Proveedor de rango falso y determinista |
| `avance_proyecto.md` | §20.4 y esta entrada |

**Verificación:**

```
npm test          → 129/129
npm run test:e2e  → 58/58
```

**Hallazgos nuevos:**

- **La caché por rango es global a la aplicación, no por quiniela**, y está bien
  que lo sea: una liga tiene partidos o no los tiene, y eso no depende de quién
  pregunte. Mordió al escribir las pruebas —una reutilizó el rango de otra y
  recibió lo que aquélla había dejado guardado—, así que cada prueba usa su
  propia fecha. Vale la pena recordarlo antes de perseguir un fantasma.
- **Un `optgroup` nunca es «visible» para Playwright.** Está en el DOM, pero
  dentro de un desplegable cerrado no se puede ver, así que `waitFor()` espera
  para siempre. Se comprueba con `toHaveCount`, no con visibilidad.
- **Unirse a una quiniela deja la membresía pendiente** y devuelve 202, no 200:
  hace falta que un administrador la apruebe antes de poder seleccionarla. Una
  prueba que lo ignore recibe 409 «Debes seleccionar una quiniela activa» y
  parece un fallo de permisos.

**Pendiente / siguiente paso:** **Fase D — administración de jornadas unificada**
(petición 3). ⚠️ Antes de empezar hay que **confirmar que se acepta perder el
alta manual de partidos**: es irreversible en la práctica, porque significa que
no se podrá crear una jornada con un partido que el API no tenga —un amistoso, un
torneo local—. Con el buscador de esta fase el riesgo baja mucho, pero es
decisión de producto y conviene decirlo en voz alta antes y no descubrirlo un
domingo.

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

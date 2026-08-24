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

## 🔖 PUNTO DE PARTIDA — última actualización: 22 de agosto de 2026

> **Lee esto primero al retomar.** Resume dónde quedó todo y qué hacer a
> continuación. El detalle de cada paso está en la bitácora (§19).

### ⚠️ Lo primero, en un minuto

```bash
git branch --show-current   # debe decir: main
git status                  # debe estar limpio
npm test                    # 400/400
npm run test:e2e            # 94/94, ~3,4 min
```

✅ **La migración a PostgreSQL está TERMINADA.** Las 7 tajadas y los 7 pasos de
la séptima. `server.js` ya no existe: la aplicación es `arrancar.js`,
`src/servidor.js`, `src/rutas/` y 22 módulos de `src/`.

✅ **Fundida en `main` el 22 de agosto**, y el esquema de Neon está al día:
`npm start` conecta, arranca y responde. Se comprobó de punta a punta contra la
base de verdad —registro, sesión que sobrevive y creación de quiniela— y se
borraron los datos de prueba.

✅ **Desplegado**: `https://quinieladeportivaglobal.onrender.com` responde,
habla con Neon y mantiene la sesión. El viaje Render → Neon son **3 ms**.

**La migración no deja nada pendiente**, y la **Fase E** (verificación de correo)
y la **recuperación de contraseña** ya funcionan. ⚠️ Lo último está escrito pero
sin desplegar: ver «Lo siguiente».

> El `gh` CLI **no está instalado** en esta máquina, así que el resultado del CI
> hay que mirarlo en GitHub a mano.

### Dónde estamos

**La migración de MongoDB a PostgreSQL está hecha**, decidida el 20 de agosto
después de un sondeo que la midió en vez de opinarla, y cerrada el 22 en trece
entradas de bitácora (040 a 052).

| Qué | Estado |
|---|---|
| Pruebas rápidas | **400**, ~65 s |
| Pruebas de navegador | **94**, ~3,4 min, contra el servidor de verdad |
| Rutas sobre PostgreSQL | **81 de 81** |
| `server.js` | **Borrado.** Empezó con 5.270 líneas el 14 de agosto |
| `arrancar.js` | 90 líneas: abre el puerto, comprueba el rol, arranca los relojes |
| `src/` | 22 módulos + `src/rutas/` (4) |
| Mongo en el proyecto | **Nada.** Ni `mongoose`, ni `connect-mongo`, ni `mongodb-memory-server` |
| Base en Neon | Montada, **pero con el esquema del 20 de agosto**. Ver «Lo siguiente» |

**Lo que ya está probado y funciona**, y no hay que volver a discutirlo:

- El aislamiento entre quinielas lo aplica **la base** con *Row-Level Security*,
  no el ORM. Aguanta 240 peticiones concurrentes sobre un *pool* sin un cruce, y
  cierra **M-33**, que en Mongo era un agujero real.
- **Ninguna prueba sale a la red ni necesita base real.** Las 295 rápidas usan
  PGlite; el proveedor se sustituye con `proveedor.usarFuente()`.
- Las pruebas son **más rápidas** que con Mongo: PGlite arranca en 2,9 s contra
  los 13,4 de `MongoMemoryReplSet`.
- **Ocho hallazgos viejos quedan cerrados** por el modelo nuevo, más tres que
  aparecieron al portar (M-34, M-35 y el hueco de los dos relojes). Ver §A.2.

**Lo que NO está hecho**: redesplegar lo último, la **Fase F** entera, y probar
la aplicación con varias quinielas y gente de verdad. Los tres, en «Lo siguiente».

### Lo que se hizo antes (fases 0 a 6, del 14 al 18 de agosto)

| Fase | Qué se hizo | Bitácora |
|---|---|---|
| **0** | Higiene: `NODE_ENV`, CORS, parser único, −63 paquetes, `legacy-data/` | 003 |
| **1** | Seguridad: helmet, rate limiting, índices, sondas de salud, reintentos de conexión | 006 |
| **2** | **Cerrada la fuga C-02** entre quinielas + 4 bugs de dominio | 007 |
| **3** | Red de pruebas: de **6 a 53 pruebas**, con MongoDB en memoria | 008, 009 |
| **4** | **Cerrados C-01 y C-05**: caché de partidos compartida, ventanas por estado, cerrojo distribuido | 010 |
| **5** | Ranking materializado (`PuntosJornada`), caché por quiniela y paginación de la tabla general | 012 |
| **6.1–6.9** | Endurecimiento, validación, cierre por partido, S-04, transacciones, Playwright, CI | 016–025 |

También se resolvieron dos incidentes de infraestructura (bitácoras 004 y 005) y
se absorbió `HANDOFF.md` en el Anexo A (bitácora 002).

### Lo que se hizo el 18 y el 19 de agosto — el plan de producto

Las **fases A, B, C y D** de §20, más la corrección de la regla de la jornada
actual. Cuatro cosas de esos dos días que hay que tener presentes:

- **El cierre es POR PARTIDO, no por jornada.** Un partido se cierra a su hora de
  inicio, y ahí su pronóstico deja de poder editarse y pasa a ser visible
  (Entrada 019).
- **La jornada actual es LA ÚLTIMA QUE SE CREÓ** (Entradas 027 y 028).
- **Los partidos salen SOLO del API** (Entrada 031). `jornadas.html` es la única
  pantalla y hace agregar, modificar, eliminar y ver.
- **Una liga se identifica por su `league_id`, no por su nombre** (Entrada 030).

### Lo que se hizo el 20 de agosto — el día largo

Once entradas de bitácora, de la **032** a la **042**. Se puede contar en tres
actos.

**Acto 1 — el sondeo (032).** El usuario preguntó si convenía pasarse a SQL
aprovechando que los datos de hoy son de prueba. Se midió en vez de opinar: 13
esquemas, 81 rutas, **~220 llamadas a la base**, 5 arreglos incrustados. Se
modeló el sistema entero en PostgreSQL y se montó un banco de pruebas con 10
comprobaciones. **Y se desmontó el argumento más fuerte en contra**: las pruebas
se harían más rápidas, no más lentas. De rebote apareció **M-33**, un agujero
real del código actual de Mongo.

**Acto 2 — la puerta (033 a 039).** Se escribió el **Anexo C**, el procedimiento
para montar la base en Neon, y se ejecutó. Costó **cuatro vueltas de depuración**,
las cuatro con la misma raíz: *el ensayo local no reproducía el sitio real*
—privilegios, transacciones del editor, presentación de resultados y permisos de
rol del proveedor—. Ninguna era un fallo del SQL. **Lo que rompió la racha no fue
un ensayo mejor: fue hacer que el guion informara.** Al final: **8/8** en la
prueba de aceptación y **4/4** en la del *pool*, con 240 peticiones concurrentes
y ni un cruce.

**Acto 3 — la migración empieza (040 a 043).** Rama `postgres` y tres tajadas:
los cimientos de la capa de datos, la plataforma y el dominio básico. **55
pruebas nuevas**, todas verdes, sin tocar `server.js`.

Cinco cosas de ese día que **no se deducen leyendo el código**:

- ⚠️ **Ordenar por `id` deja de significar «por antigüedad»** al pasar de
  ObjectId a uuid. `sort({_id: -1})` era «la última creada» porque un ObjectId
  lleva la fecha dentro; un uuid es aleatorio. Traducirlo mal habría roto la
  Fase B **sin fallar nunca**. Por eso `jornadas` tiene una columna `secuencia`.
- ⚠️ **Un superusuario se salta RLS siempre**, aunque la tabla lleve `FORCE ROW
  LEVEL SECURITY`, y el rol dueño puede **apagarlo**. La aplicación se conecta
  con `app_quiniela`, y tanto `src/db.js` como el arnés de pruebas **se plantan**
  si detectan privilegios de más.
- ⚠️ **La transacción va por PETICIÓN, no por consulta.** Cada `await` es un
  viaje a la base; una transacción por consulta multiplica el coste por cuatro
  **y parece culpa de PostgreSQL**. Por eso `enQuiniela` es reentrante.
- **M-02 deja de poder ocurrir.** Guardar una jornada **reconcilia por posición**
  en vez de borrar y reinsertar, así que los partidos conservan su `id` y los
  pronósticos siguen colgando de quien colgaban.
- **Se encontró un bug que no estaba en ninguna lista**: degradar a dos
  administradores a la vez podía dejar la quiniela **sin ninguno**, porque la
  cuenta y el guardado iban en dos pasos.

### Lo que se hizo el 21 de agosto — el día de las rutas

**Seis entradas de bitácora, de la 044 a la 049.** Se puede contar en dos actos.

**Acto 1 — se terminan de portar las reglas (044 a 046).** Las tajadas 4, 5 y 6:
la puntuación, las trivias y el sincronizador. **83 pruebas nuevas**, todas
verdes, sin tocar `server.js`. Al acabar el acto, **todas las reglas de negocio
del sistema viven en `src/` y están probadas**, y ninguna ruta habla todavía con
PostgreSQL.

**Acto 2 — las rutas empiezan a hablar PostgreSQL (047 a 049).** Arranca la
tajada 7, la única que no puede ser aditiva, y se parte en siete pasos. Van
cinco: cimientos, plataforma, dominio, puntuación y trivias. **66 de las 81
rutas** ya corren sobre PostgreSQL, en un servidor nuevo que crece **al lado**
de `server.js`, no encima.

| Tajada / paso | Qué entró | Entrada |
|---|---|---|
| **4** | Motor de puntos, pronósticos, resultados oficiales, ranking congelado | 044 |
| **5** | Trivias: ocho tipos, reconciliación y autorresolución | 045 |
| **6** | Caché de partidos, cerrojo distribuido, ciclo y métricas; `src/eventos.js` | 046 |
| **7.1–7.3** | Servidor nuevo: cimientos, plataforma y dominio (42 rutas) | 047 |
| **7.4** | Puntuación (10 rutas) | 048 |
| **7.5** | Trivias (14 rutas) y el `_id → id` del frontend | 049 |

#### Las tres decisiones de fondo del día

1. ⚠️ **Un servidor NUEVO, al lado, no cirugía sobre `server.js`.** Portar 81
   rutas en sitio habría tumbado sus 83 pruebas de integración con el primer
   grupo, y no habrían vuelto a pasar hasta el final: varios días trabajando a
   ciegas sobre lo único que demuestra que la aplicación funciona. El apagado de
   verdad queda reducido a **una línea de `package.json`** en el paso 7.7.
2. ⚠️ **La transacción se abre DENTRO de la ruta, no en el middleware.**
   Traducir `tenantContext.run({quinielaId}, next)` a `db.enQuiniela(id, next)`
   habría sido un error grave y silencioso: `next()` de Express retorna antes de
   que el manejador async termine, así que se haría COMMIT y se soltaría la
   conexión **con la ruta todavía corriendo**. La otra salida —mantenerla abierta
   hasta que la respuesta termine— agota el *pool* de Neon con clientes lentos.
3. **El comodín NO se congela, y la puntuación SÍ.** Parece incoherente y no lo
   es: la puntuación es **global** y tocarla barrería todas las jornadas jugadas
   de golpe (eso es M-03); el comodín es **local** a una jornada y quien lo marca
   la tiene delante. La respuesta estaba en el código viejo: la ruta del comodín
   llamaba a recalcular, la de la puntuación no.

#### Los cinco errores que se encontraron, todos silenciosos

Ninguno falla. Los cinco dan un número creíble y equivocado, o dejan ver lo que
no debería verse.

⚠️ **Los cuatro primeros están vivos hoy en `main`.** El quinto no: se coló al
escribir el servidor nuevo y lo cazó una prueba el mismo día.

| Hallazgo | Qué hace | Dónde |
|---|---|---|
| **M-02** | El `splice` al borrar un partido desalinea los pronósticos de **todos** los jugadores | `server.js:1592` |
| **M-34** | Marcar un comodín después de que el partido terminó **no mueve los puntos**: el comodín se copiaba en el resultado oficial y un partido terminado ya no se consulta | Entrada 044 |
| **M-35** | El gemelo de M-02 en las trivias: guardaban `partidoIndex`, y el mismo `splice` dejaba las preguntas apuntando al partido de al lado | Entrada 045 |
| Dos relojes | Las trivias bloqueaban responder por el inicio del partido pero decidían la privacidad por la fecha de cierre: había un hueco donde **nadie podía responder y nada era visible** | Entrada 045 |
| `req.path` | Dentro de `app.use('/api', …)` viene relativo al punto de montaje, así que la excepción que deja **desarchivar** una quiniela nunca casaba. **No estaba en `main`**: el código viejo usaba `originalUrl` y tenía razón | Entrada 047 |

#### Seis cosas más que no se deducen leyendo el código

- **El cerrojo distribuido deja de necesitar un `catch`.** En Mongo había que
  atrapar el código 11000 porque el choque contra el índice único ERA la
  respuesta «lo tiene otro». En PostgreSQL es una sentencia: si no devuelve fila,
  no es tuyo.
- ⚠️ **`jsonb ||` es superficial.** Fundir `{puntuacion:{marcadorExacto:9}}`
  sobre el bloque **sustituye el objeto `puntuacion` entero** y se lleva los otros
  cinco campos. En Mongo lo hacía `$set` por campos y no se notaba.
- ⚠️ **Un `JOIN` sin su columna en el `SELECT` da un `undefined` silencioso**, y
  eso dejaba abiertas trivias de partidos ya jugados.
- ⚠️ **El N+1 vuelve solo al portar una ruta sin pensarla.** `/api/resultados`
  escrita de la forma natural pedía los pronósticos de cada jugador en cada
  jornada: **ochocientos viajes a la base** con veinte jugadores y cuarenta
  jornadas. Es el mismo N+1 que la Fase 5 ya había quitado.
- **Dos guardianes de la Fase 6 pagaron solos durante la migración**: el de
  funciones duplicadas cazó `partidoYaInicio` (tajada 4) y el del VAR cazó que
  `esGolApiFootball` se había mudado a `src/` (tajada 6).
- **Y dos veces la prueba estaba mal, no el código.** Una esperaba poder
  pronosticar después de cargar el resultado oficial —que cierra el partido—, y
  otra escribía respuestas con un `INSERT … SELECT FROM jugadores` sobre un
  propietario recién creado: insertaba **cero filas** y pasaba sin probar nada.
  **Un `INSERT` que no inserta no falla.**


### Lo que se hizo el 22 de agosto — el cambio

Una entrada, la **052**, y es la que cierra la migración: **`server.js` ya no
existe**. Empezó el 14 de agosto con 5.270 líneas y catorce esquemas de Mongoose
dentro; hoy son `arrancar.js` (90 líneas), `src/servidor.js`, cuatro módulos de
rutas y 22 de dominio, cada uno con sus pruebas. Era **C-04**.

**El orden importó más que ninguna otra cosa.** Se hizo todo lo verificable
ANTES de borrar nada:

1. `arrancar.js` y `npm start` apuntando al servidor nuevo.
2. **Las 62 pruebas de navegador pasadas a PGlite y corridas contra él.** Ésa fue
   la prueba de fondo: la aplicación real, en escritorio y en móvil.
3. Los 46 centinelas de arquitectura, portados uno a uno.
4. **Y sólo entonces** se borró `server.js`.

Si algo hubiera estado mal, se habría sabido en el paso 2, con el viejo en pie.

Cuatro cosas de ese día que **no se deducen leyendo el código**:

- ⚠️ **La base de Neon está en el esquema del 20 de agosto, no en el de hoy.** Le
  falta la tabla `sesiones`, y **sin ella la aplicación arranca, deja entrar a la
  gente y nadie sigue dentro en la petición siguiente** — sin ningún error que lo
  explique. Es el paso manual que queda pendiente.
- ⚠️ **Veintidós de los 46 centinelas se rompieron al borrar `server.js`**, y
  casi ninguno por el motivo que vigilaba: buscaban patrones de Mongoose que
  dejaron de existir. Portarlos no fue mecánico, pero **la lección de cada uno
  sobrevivió**: «la URI multi-quiniela» pasó a ser «el rol no puede apagar RLS»,
  y «las pruebas usan un conjunto de réplicas» pasó a ser «el arnés corre con los
  mismos permisos que producción».
- **Un centinela contaba mal y decía la verdad.** El de privacidad esperaba
  cuatro sitios donde se decide la visibilidad y hay tres: `taparAjenos` sirve a
  dos rutas. Se ajustó a 3 **con igualdad, no con «al menos»**, para que también
  avise si aparece un cuarto.
- **El único cambio de API visible de toda la migración lo cazaron las pruebas de
  navegador**: crear trivias devolvía la lista de las creadas y ahora devuelve
  una cuenta. Nada del frontend usaba la lista.
- ⚠️ **Y al desplegar, la base estaba en la otra costa.** Neon en Ohio, Render en
  Oregón: **47 ms por consulta** en vez de 3, así que una ruta con cinco pagaba
  ~235 ms sólo en viajes —y habría parecido culpa de PostgreSQL—. Se midió desde
  fuera con las dos sondas y se arregló recreando la base en Oregón, que salió
  gratis porque estaba vacía. Entrada 053.


### 🌅 Lo siguiente

**Lo primero, siempre:** `git branch --show-current` (debe decir `main`),
`git log --oneline -3`, `git status` y `npm test`.

#### ⚠️ 1. Redesplegar en Render

Es lo único que separa lo escrito de lo que ve la gente. Arrastra los **cobros**
(Entrada 061), las **ligas favoritas** (Entrada 059), la **recuperación de
contraseña** (Entrada 056) y el **arreglo del enlace azul** (Entrada 057).

✅ **La migración de los cobros ya se corrió en Neon el 23 de agosto**, y se
comprobó: `pagos` con RLS activada y forzada, su política puesta y las cuatro
concesiones a `app_quiniela`. **No hay que volver a correrla.**

Se deja escrito el procedimiento por si hace falta montar la base otra vez:

1. En el **editor SQL de Neon**, **con el rol dueño** (no `app_quiniela`), pegar
   y ejecutar `db/migraciones/001-cobros.sql` entero.
2. Comprobar con las tres consultas que trae al final —sobre todo la del RLS de
   `pagos`: si `relrowsecurity` o `relforcerowsecurity` salen en falso, **los
   pagos de una quiniela se verían desde otra**.
3. Y entonces sí: *Manual Deploy* → *Deploy latest commit*.

La migración es aditiva y se puede correr dos veces sin romper nada. **No hace
falta ninguna variable de entorno nueva**, y las quinielas que ya existen no
cambian: los dos cobros nacen apagados.

#### 2. 📥 Fase F — sugerencias de partidos destacados *(en el backlog)*

**Aparcada el 23 de agosto por decisión tuya**, y en su lugar se hicieron las
ligas favoritas. Cuando se retome, sigue necesitando dos decisiones:

- **Qué cuenta como «igualados».** ¿Diferencia de puntos en la tabla? ¿De
  posición? ¿Cuánta?
- **Qué es un «clásico».** ¿Una lista escrita a mano por quiniela? ¿Por país?
  ¿Los dos primeros de la tabla?

⚠️ Y una dependencia técnica: necesita **la tabla de posiciones de cada liga**,
que hoy no se consulta al proveedor. Es una llamada nueva a APIFootball, con su
cuota y su caché.

#### 3. Probar con gente de verdad

Nada de esto es programar, y es lo que más va a enseñar:

- ⚠️ **La aplicación nunca ha corrido con varias quinielas a la vez.** El
  aislamiento está probado por todos lados —RLS, 240 peticiones concurrentes,
  pruebas en cada módulo— pero **eso es distinto de haberlo visto funcionando
  con gente dentro**.
- **Los resultados de trivias no se han mirado con datos reales** desde la
  Entrada 024. Las pruebas cubren que los datos llegan a la pantalla, no que se
  vean bien. Diez minutos con la aplicación levantada.

#### 4. Y lo que hay que mirar cuando haya tráfico

En `/api/admin/sync-metricas`:

- ⚠️ **`consultasAhorradasPorDeduplicacion`** debe crecer en cuanto haya **dos
  quinielas siguiendo los mismos partidos**. Si se queda en cero, la
  deduplicación no funciona y la cuota del proveedor se gasta de más **sin que
  nada falle**. Es la promesa de C-01 y **la única que todavía no se ha visto
  cumplirse con datos de verdad**.
- **`syncsSinCambioDePuntos`** debe crecer mucho más deprisa que
  `jornadasReescritas` el primer domingo con partidos en vivo.
- **`ciclosAbandonadosPorTiempo`**: si sube, el proveedor está tardando.

#### Dos cabos de limpieza, sin prisa

1. **Borrar el proyecto de Neon en Ohio**, si sigue ahí. Ya no lo usa nadie, y
   un proyecto al que alguien podría apuntar por error es peor que no tenerlo.
2. **Las ramas viejas**: `postgres` y las ocho de trabajo están contenidas en
   `main` y se pueden borrar.

#### Las cuatro reglas del código, que siguen valiendo

Las tres primeras son de §21.2 y sostienen el aislamiento. La cuarta se aprendió
el 21 de agosto y ya mordió una vez.

1. La transacción es **por petición**; `enQuiniela` es reentrante.
2. El contexto se fija con `SET LOCAL`, dentro de la transacción.
3. La aplicación **no** se conecta con el rol dueño.
4. ⚠️ **El middleware NO abre transacción**: cada ruta envuelve su cuerpo en
   `enQuiniela(req, …)`. `next()` de Express retorna antes de que el manejador
   async termine, así que abrirla en el middleware haría COMMIT con la ruta
   todavía corriendo.


### Estado de Git

✅ **`postgres` se fundió en `main` el 22 de agosto.** Ya no hay dos mundos: las
dos ramas apuntan al mismo sitio y `main` es PostgreSQL.

```
main  ← AQUI SE TRABAJA
  7613974 Migracion a PostgreSQL: MongoDB queda fuera del proyecto   ← la fusion
  796e0ff Anotar el commit del cambio en el estado de Git
  9d75210 Tajada 7, paso 7: el cambio. La migracion esta terminada
  ...
  9a52f01 Migracion, tajada 1: los cimientos de la capa de datos
  8c07e07 La puerta esta pasada, y un numero que hay que saber leer   ← aqui estaba main
```

> ⚠️ Esta lista es una foto y envejece. **Comprueba con `git log --oneline` y
> `git status -sb` dónde estás de verdad** antes de fiarte de ella.

La rama `postgres` se puede borrar cuando se quiera: su contenido está entero en
`main`.

```bash
git branch -d postgres
git push origin --delete postgres
```

Las ocho ramas de trabajo antiguas también están contenidas en `main`:

```bash
git branch -d arreglo-ci cache-ranking cinco-puntos e2e-playwright               fase-4-sincronizador fase-6-endurecimiento s04-xss transacciones
```


### ⚠️ Antes de arrancar la aplicación, lee esto

**Las dos trampas de MongoDB ya no aplican.** El clúster de Atlas que se
auto-pausaba (**C-06**) y el DNS de esta máquina que no resuelve SRV eran las dos
peculiaridades que costaron una tarde el 16 de agosto (bitácoras 004 y 005). Con
PostgreSQL no hay ninguna de las dos: **Neon se suspende por inactividad pero se
despierta solo** al llegar una conexión, y la cadena no usa SRV.

Lo que sí conviene saber:

1. **La primera petición después de un rato tarda unos segundos.** Neon suspende
   el cómputo en el plan gratuito. No es un fallo, es el plan. Por eso el
   servidor abre el puerto sin esperar a la base y `/readyz` devuelve 503 hasta
   que responde.
2. ⛔ **`DATABASE_URL` tiene que llevar el rol `app_quiniela` y la cadena con
   `-pooler`.** El rol dueño puede **apagar RLS** con un `ALTER TABLE`, y
   entonces el aislamiento entre quinielas dejaría de existir sin que nada
   fallara. `comprobarRol()` se planta al arrancar si detecta que puede.

### Comandos habituales

```bash
npm start                  # arranca la aplicación. Exige DATABASE_URL
npm test                   # las 295 pruebas rápidas, ~45 s
npm run test:postgres      # las 249 de los módulos, sin los centinelas
npm run test:rutas         # solo las 111 del servidor
npm run test:arquitectura  # solo los 46 centinelas
npm run test:e2e           # las 62 de navegador (~2,5 min, escritorio y móvil)
npm run test:e2e:ui        # las mismas, con el inspector de Playwright
npm run check              # comprobación de sintaxis
npm audit --omit=dev       # 0 vulnerabilidades, verificado el 18-ago
```

**Ninguna prueba necesita red ni base real.** Levantan **PGlite**, que es
PostgreSQL 18 compilado a WebAssembly y va como paquete de npm; el proveedor
externo se sustituye con `proveedor.usarFuente()`. Las de navegador necesitan
`npx playwright install chromium` una vez por máquina.

**Para tocar la base de Neon:**

```bash
# Poner el esquema al día: db/poner-al-dia.sql, en el editor SQL de Neon,
# CON EL ROL DUEÑO. Ver "Lo siguiente".

cd sondeo-sql && npm install
npm run pool               # LA PUERTA: aislamiento con pool real, 240 peticiones
```

⚠️ `npm run pool` necesita `DATABASE_URL` en el `.env` de la raíz, con **el rol
`app_quiniela`** (no el dueño) y **la cadena con `-pooler`**. Se planta si
detecta cualquiera de las dos cosas mal, en vez de dar un verde sin valor.


---

## 🎯 LO QUE QUEDA PENDIENTE

**Puesto al día el 22 de agosto de 2026**, al cerrar la migración. Sigue
dividido en dos mundos que conviene no mezclar: **la migración** (§A), que ya
está hecha y sólo deja un paso manual, y **lo que ya estaba pendiente antes**
(§B), que no ha cambiado en toda la semana.

---

## A. ✅ La migración a PostgreSQL — TERMINADA Y FUNDIDA

Siete tajadas, la séptima en siete pasos, trece entradas de bitácora (040 a 052)
y tres días. El esquema de Neon está al día, la aplicación arranca contra ella y
`main` es PostgreSQL. **No queda nada de la migración por hacer.**

El plan completo, con sus decisiones de alcance y sus reglas, está en **§21**.
Esto es sólo el estado.

| # | Tajada | Qué entra | Estado |
|---|---|---|---|
| **1** | Cimientos | `src/db.js`, `db/esquema.sql`, arnés PGlite | ✅ `9a52f01` — Entrada 040 |
| **2** | Plataforma | `usuarios`, `quinielas`, `membresias` | ✅ `04ec8af` — Entrada 041 |
| **3** | Dominio básico | `jugadores`, `jornadas`, `partidos`, `equipos` | ✅ `99bac51` — Entrada 042 |
| **4** | Puntuación | `resultados`/`pronosticos`, `resultados_oficiales`, motor de puntos, ranking materializado | ✅ Entrada 044 |
| **5** | Trivias | `trivias`, `respuestas_trivia`, autorresolución y reconciliación | ✅ Entrada 045 |
| **6** | Sincronizador | `fixtures`, `job_locks`, APIFootball, métricas | ✅ Entrada 046 |
| **7** | El cambio y la limpieza | Ver el desglose de abajo | ✅ **7 de 7** — Entrada 052 |

### A.0 La tajada 7, paso a paso

Se partió en siete porque es la única que no puede ser aditiva. ⚠️ **El único
punto sin retorno es el 7.7**; hasta entonces `server.js` sigue vivo y verde.

| # | Qué entra | Rutas | Estado |
|---|---|---|---|
| **7.1** | Cimientos: helmet, CORS, sesiones sobre `connect-pg-simple`, sondas, guardias, errores, registro y login | 7 | ✅ Entrada 047 |
| **7.2** | Plataforma: `quinielas`, `quiniela-actual`, `admin-mode`, miembros, configuración | 19 | ✅ Entrada 047 |
| **7.3** | Dominio: `jornadas`, `jugadores`, `equipos`, `jornada-actual` | 16 | ✅ Entrada 047 |
| **7.4** | Puntuación: `resultados`, `resultados-oficiales`, `-totales`, `-seguros`, `-con-equipos`, `clasificacion-jornada` | 10 | ✅ Entrada 048 |
| **7.5** | Trivias, más el `_id → id` de los 3 archivos del frontend | 14 | ✅ Entrada 049 |
| **7.6** | Sincronizador y admin: `admin`, `football`, `debug`, el planificador y `src/proveedor.js` | 15 | ✅ Entrada 051 |
| **7.7** | El cambio, y lo único sin retorno. `npm start` apunta al nuevo, se borra `server.js`, fuera `mongoose`/`connect-mongo`/`mongodb-memory-server`/`src/transacciones.js`, se portan las 62 de navegador, `render.yaml` y la documentación | — | ✅ Entrada 052 |

✅ **Las tres cosas que no eran programar quedaron resueltas el 22 de agosto**:
`DATABASE_URL` está puesta con el rol `app_quiniela` y la cadena con `-pooler`
—comprobado desde aquí—, y el usuario confirmó lo de la región y lo de la
aplicación anterior. `render.yaml` las deja escritas para que no se vuelvan a
perder de vista.

### A.1 Lo que hay que saber de cada tajada que falta

**Tajada 7.** Su desglose está arriba, en §A.0.

### A.2 Lo que la migración cierra de la lista vieja de hallazgos

No hay que arreglarlos aparte: salen por obligación del modelo nuevo.

| Hallazgo | Cómo lo cierra |
|---|---|
| **C-06** — el clúster M0 que se pausa y hay que despertar a mano | Neon se suspende pero **se despierta solo** al llegar una conexión |
| **C-04** — `server.js` monolítico | Todo salió a `src/`: 21 módulos y `src/rutas/`. `server.js` **desaparece** en el paso 7.7 |
| **M-01** — el vínculo con el jugador es por cadena | `jugador_id` con clave ajena |
| **M-02** — el vínculo partido↔pronóstico es por índice de array. ⚠️ **No es deuda de modelo: es un fallo activo**, el `splice` de `server.js:1592` desalinea los pronósticos de todos | `partido_id`, y `guardar` reconcilia por posición para no romperlo (Entrada 044) |
| **M-34** — ⚠️ **el comodín marcado tarde no mueve los puntos.** Se copiaba dentro del resultado oficial, y un partido terminado ya no se vuelve a consultar | El comodín vive sólo en `partidos` y el motor lo lee de ahí (Entrada 044) |
| **M-25** — falta índice en `Trivia` | Está en `db/esquema.sql` (Entrada 045) |
| **M-30** — la base se llama `test` | La base nueva se llama `quiniela` |
| **M-33** — el `tenantPlugin` no engancha `aggregate` | Lo aplica la base con RLS: no hay hueco por donde escaparse |
| **S-10** — sin índice único en `RespuestaTrivia` | `UNIQUE (quiniela_id, jugador_id, trivia_id)`, con prueba que lo fija (Entrada 045) |
| **M-35** — ⚠️ **el gemelo de M-02 en las trivias**: guardaban `partidoIndex`, y el mismo `splice` dejaba las preguntas apuntando al partido de al lado | `partido_id` con borrado en cascada (Entrada 045) |

⚠️ **Hasta que la migración termine, todos esos siguen abiertos en `main`.** Si la
migración se abandonara, **M-33 hay que arreglarlo aparte**: es un agujero real
del código que hoy corre.

### A.3 Lo que la migración NO toca

- **El frontend.** Es la decisión de alcance de §21.1: claves ajenas dentro,
  nombres en el API. De los 39 scripts de `private/js/` sólo cambiaron **3**, y
  sólo en las 4 apariciones de `_id` (Entrada 049).
- **`src/validacion.js`, `src/fechas.js` y `src/ligas.js`.** No sabían nada de
  Mongoose, así que se reutilizan tal cual.
- **Las reglas de producto.** El cierre por partido, la jornada actual, los
  partidos sólo del API: todo eso sigue igual.

### A.4 ✅ La deuda temporal del método, ya pagada

Trabajar con un servidor nuevo al lado del viejo tuvo un precio, y se pago entero
el 22 de agosto. Queda escrito porque el metodo funciono y merece repetirse: **lo
verificable se hizo antes de borrar nada**.

| Lo que hubo, del 21 al 22 | Por que | Como quedo |
|---|---|---|
| **Dos servidores**: `server.js` y `src/servidor.js` | Portar 81 rutas en sitio habria dejado 83 pruebas en rojo durante dias | `server.js` **borrado** |
| **Dos suites de rutas**: 83 contra Mongo y 91 contra PostgreSQL | La vieja era la red de seguridad mientras la nueva crecia | `test/integracion.test.js` **borrado**; quedan 111 en `test/rutas.test.js` |
| **`trivia.id ?? trivia._id`** en 3 archivos | Las mismas pantallas se servian desde los dos servidores | Solo `trivia.id` |
| **Las 62 de navegador arrancaban Mongo** | Corrian contra el servidor viejo, que era el que se desplegaba | PGlite, y **62/62 contra el nuevo** |
| **`src/transacciones.js`** | Lo usaba `server.js` | **Borrado**: en PostgreSQL las transacciones son de serie |

Y del `package.json` salieron **`mongoose`**, **`connect-mongo`** y
**`mongodb-memory-server`**. Hay dos centinelas que vigilan que no vuelvan:
borrar un archivo es facil, y resucitarlo "temporalmente" tambien.


## B. Lo que ya estaba pendiente antes de la migración

### B.1 Plan de producto (§20) — quedan dos fases

| Orden | Fase | Peticiones | Qué hace falta antes de empezar |
|---|---|---|---|
| ✅ | **A — Retoques de interfaz** | 4, 6 | Hecha (Entrada 026) |
| ✅ | **B — Qué es "la jornada actual"** | 1, 2, 5 | Hecha (Entradas 027 y 028) |
| ✅ | **C — Buscador de ligas dinámico** | 9 | Hecha (Entrada 030) |
| ✅ | **D — Administración de jornadas unificada** | 3 | Hecha (Entrada 031) |
| ✅ | **E — Verificación de correo** | 8 | Hecha (Entrada 054). **Brevo**, y **sin confirmar no se entra** |
| ✅ | **Recuperar la contraseña** | — | Hecha (Entrada 056). **No estaba en §20**: salió al ver funcionar el correo, y el terreno ya estaba puesto |
| **1.º** | **F — Sugerencias de partidos destacados** | 10 | ⚠️ **Definir las heurísticas**: qué cuenta como "igualados", qué es un "clásico". Necesita la tabla de posiciones de cada liga, que hoy no se consulta |
| ✅ | **Aparte** | 7 (SQL) | **Respondida y en marcha**: se migra. Ver §21 |

✅ **El dominio definitivo ya está decidido**: `quinieladeportivaglobal.onrender.com`,
que además ya es el valor por defecto de CORS en `server.js`. Era el cabo que
bloqueaba la Fase E; **ya no bloquea**.

**Cuándo hacer la Fase E:** después de la migración, y sobre PostgreSQL. Hacerla
ahora significaría escribirla dos veces.

### B.2 Deuda técnica que sigue abierta

✅ **Cuatro puntos de esta lista murieron con la migración** y ya no están aquí:
M-33 (el `tenantPlugin` que no enganchaba `aggregate`), M-02, M-34 y M-35. Los
cuatro daban números equivocados o abrían huecos **sin fallar nunca**, que es lo
que hay que saber reconocer la próxima vez. Están contados en §A.2 y en las
Entradas 044, 045 y 052.

Lo que sigue abierto:

1. **`style-src` conserva `unsafe-inline`.** Se cerraron `script-src` y
   `script-src-attr` (Entrada 024); los estilos no. Quedan 19 `style=` en línea
   en el frontend.
2. **Paginación del resto de listados (M-26).** La tabla general sí está
   paginada, y tres endpoints aceptan acotarse; el resto es deuda transversal.
3. **Medios de la Entrada 015 sin resolver:** una jornada aplazada o cancelada
   queda provisional para siempre, y no hay política escrita sobre los miembros
   que entran a mitad de temporada.
4. **Los resultados de trivias no se han mirado con datos de verdad** desde la
   Entrada 024. Las pruebas cubren que los datos llegan a la pantalla, no que se
   vean bien. Es una revisión de diez minutos con la aplicación levantada.
5. **La aplicación nunca ha corrido con varias quinielas y datos reales a la
   vez.** El aislamiento está probado —RLS, 240 peticiones concurrentes, y
   pruebas en cada módulo— pero eso es distinto de haberlo visto funcionando con
   gente dentro. Es lo primero que dirá si algo se pasó por alto.
6. **Sin limitador en `verificar-password` ni `cambiar-password`.** Sólo sirve
   contra la cuenta propia y exige la contraseña actual, así que es poco
   explotable; queda anotado por si algún día se endurece (Entrada 064).
7. **`script-src` permite `cdnjs.cloudflare.com`**, que es de donde sale jsPDF.
   Si ese CDN se viera comprometido, ejecutaría código en las pantallas. Es el
   compromiso habitual de usar un CDN, pero conviene tenerlo escrito.
8. ⚠️ **`public/miembros.html` abre TRES documentos**: tres `<!DOCTYPE>`, tres
   `<html>` y tres `<head>`. El navegador lo remienda y la pantalla funciona,
   por eso lleva ahí desde siempre sin que nadie lo note. El mismo fallo estaba
   en `configuracion-quiniela.html` y se corrigió en la Entrada 059; éste se
   dejó por no ser el asunto de aquel día. **Es un arreglo de un minuto**, pero
   conviene mirar la pantalla después: el marcado remendado puede estar
   apoyándose en el remiendo.


### B.3 Decisiones del usuario — cómo quedaron

| # | Decisión | Estado |
|---|---|---|
| **SQL** | ¿Migrar a PostgreSQL? | ✅ **Hecha.** Decidida el 20-ago, cerrada y fundida en `main` el 22 |
| **Dominio** | ¿Cuál es el definitivo? | ✅ **`quinieladeportivaglobal.onrender.com`** |
| **C-06** | ¿Se paga un clúster que no se pause? | ✅ **No hace falta pagarlo**: Neon se despierta solo. Quedó resuelto de paso |
| **M-30** | ¿La base sigue llamándose `test`? | ✅ **Resuelto**: la nueva se llama `quiniela` |
| **Render** | Variables y health check | ✅ **Puesto y desplegado** (22-ago). ⚠️ Render **no** aplica `render.yaml` solo: hubo que poner a mano las variables, el *health check* **y el Start Command**, que fue el que tumbó el primer intento |
| **Región** | ¿Dónde va la base? | ✅ **Oregón, la misma que Render** (22-ago). Estuvo en Ohio y costaba 47 ms por consulta |
| **Correo** | Proveedor de envío para la Fase E | ✅ **Brevo** (22-ago): permite verificar una sola dirección de remitente **sin poseer un dominio**, que es la situación de este proyecto. Resend queda escrito para el día que haya dominio |
| **Bloqueo** | Qué se le impide a una cuenta sin verificar | ✅ **Sin confirmar no se entra** (22-ago), igual que en GymTrack |

✅ **Los dos cabos que no se podían mirar desde esta máquina los cerró el usuario**
el 22 de agosto: lo que hay puesto en Render, y si seguía viva la aplicación
anterior apuntando a la misma base.

⚠️ **Pero conviene volver a mirarlos justo después de desplegar**, porque el
despliegue nuevo cambia el primero: las variables que hoy haya puestas son las de
la versión de Mongo. La lista de las que hacen falta está en `render.yaml` y en
«Lo siguiente».

### B.4 Cosas que vigilar cuando haya tráfico real

- **`/api/admin/sync-metricas` tras el primer despliegue.**
  `consultasAhorradasPorDeduplicacion` debe crecer en cuanto haya dos quinielas
  siguiendo los mismos partidos. Mirar también `ciclosAbandonadosPorTiempo`.
- **`syncsSinCambioDePuntos`** en el primer domingo con partidos en vivo: debe
  crecer mucho más deprisa que `jornadasReescritas` (Entrada 020).
- **La cuota del proveedor.** El buscador de la Fase C consulta siete días de una
  vez y su caché vive **en memoria del proceso**: con dos instancias en Render son
  dos consultas por cada diez minutos, no una (Entrada 030).
- ⚠️ **La latencia entre Render y Neon.** Desde esta máquina un viaje a Neon son
  ~116 ms; entre Render y Neon **en la misma región** deben ser 1–5 ms. Si no lo
  son, están en regiones distintas y hay que moverlo (Entrada 039).
- **Anexo B, procedimiento C**: auditar si la fuga C-02 dañó datos. Hoy no hay
  nada que auditar. Repetir cuando haya varias quinielas.


---

## C. Trampas conocidas del entorno de trabajo

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
- **Los acentos graves dentro de comillas dobles del shell ejecutan lo que
  envuelven.** Escribir `node -e "… /* una `.info-card` vacía */ …"` no deja un
  comentario: deja el hueco, porque el shell sustituyó el texto por la salida del
  comando `.info-card`, que no existe. El archivo se escribe igual y sin avisar.
  Mordió en la Entrada 029. Es la misma familia que lo del heredoc: **el texto
  largo va en un archivo, no en la línea de comandos.**
- **`/tmp` no es el mismo sitio para el shell y para Node.** En Git Bash apunta al
  temporal del usuario; Node en Windows lo lee como `C:\tmp`, que no existe. Un
  archivo escrito con `cat > /tmp/x` no lo encuentra un `readFileSync("/tmp/x")`.
  Usar rutas absolutas de Windows para todo lo que cruce entre los dos.
- **Un `optgroup` nunca es «visible» para Playwright.** Está en el DOM, pero
  dentro de un desplegable cerrado no se puede ver, así que `waitFor()` espera
  hasta agotar el plazo. Se comprueba con `toHaveCount`, no con visibilidad
  (Entrada 030).
- **La caché de ligas disponibles es global, no por quiniela.** Va por rango de
  fechas, y está bien que así sea: una liga tiene partidos o no los tiene, y eso
  no depende de quién pregunte. Dos pruebas que compartan rango comparten
  respuesta, y la segunda recibe lo que dejó la primera. Cada prueba, su fecha
  (Entrada 030).
- **Unirse a una quiniela no da acceso: deja la membresía pendiente** y devuelve
  202. Hace falta que un administrador la apruebe antes de poder seleccionarla.
  Una prueba que lo ignore recibe un 409 «Debes seleccionar una quiniela activa»
  y parece un fallo de permisos (Entrada 030).
- ⚠️ **Un banco de pruebas con más privilegios que producción da falsos verdes.**
  El ensayo del sondeo SQL corría como superusuario y por eso pasaba 7/7 aquí y
  fallaba en Neon: los superusuarios **se saltan RLS**, y el rol dueño de Neon no
  es superusuario. Vale para cualquier arnés, no sólo para éste — si las pruebas
  corren con más permisos que la aplicación, todo lo que dependa de permisos está
  sin probar. Ahora `probar-neon-sql.js` **se niega a arrancar** si detecta que
  tiene privilegios de más (Entrada 034).
- ⚠️ **`FORCE ROW LEVEL SECURITY` también alcanza al dueño de la tabla.**
  Cualquier carga inicial, migración o respaldo **tiene que fijar
  `app.quiniela_id`** antes de escribir en las 12 tablas de dominio, o la política
  rechaza la inserción. Es bueno —el aislamiento no tiene puerta trasera— pero hay
  que saberlo antes de escribir el script, no descubrirlo con un error a mitad de
  una transacción (Entrada 034).
- ⚠️ **Un hueco que pide un secreto dentro de un archivo versionado se rellena.**
  `neon-preparar.sql` tenía un `CAMBIAME-por-algo-largo-y-aleatorio` con un aviso
  al lado de no guardarlo en el repositorio, y aun así acabó conteniendo una
  contraseña real. Se pilló antes del commit, pero un secreto que llega al
  historial **no se arregla borrándolo después**. La solución no es un aviso más
  grande: es **quitar el hueco** (Entrada 034).
- ⚠️ **«Failed transaction: ROLLBACK required» no es un error: es el eco de otro.**
  Es lo que PostgreSQL responde a **todas** las sentencias posteriores a la que
  falló de verdad, porque la transacción queda abortada. En un editor web, donde
  se ve la respuesta de la última sentencia, **el error real desaparece de la
  pantalla**. Lo que hay que buscar es **la primera** que falló, no la última.
  Costó dos vueltas enteras (Entrada 035).
- ⚠️ **En un editor SQL web, la última sentencia del guion es la única que se ve.**
  Un guion pensado para pegarse en uno **tiene que terminar en el `SELECT` que
  interesa**. La prueba de aceptación de Neon acababa en un `DROP TABLE` de
  limpieza, así que corría entera, calculaba las ocho comprobaciones y las
  borraba antes de que nadie las viera: desde fuera parecía que no hacía nada
  (Entrada 036).
- ⚠️ **En Neon, crear un rol no da derecho a asumirlo.** Hace falta
  `GRANT <rol> TO CURRENT_USER;`. El sintoma es `permission denied to set role`
  y llega **despues** de que el `CREATE ROLE` haya ido bien, que es lo que
  despista: parece que el rol quedo mal creado, y esta perfectamente creado
  (Entrada 037).
- ⚠️ **Los acentos graves dentro de comillas dobles de `node -e "…"` ejecutan lo
  que envuelven.** Es la misma familia que lo del heredoc, y volvió a morder dos
  veces el 20 de agosto editando `avance_proyecto.md`: el texto entre acentos
  desaparece del archivo, sustituido por la salida de un comando que no existe, y
  **se escribe igual y sin avisar**. La salida es la de siempre: **el texto largo
  va en un archivo, no en la línea de comandos**.
- ⚠️ **La sustitución de procesos de bash (`<(…)`) no funciona al pasársela a
  Node en Windows.** Node recibe una ruta tipo `/proc/694/fd/63` y la interpreta
  como `C:\proc\…`, que no existe. Es la misma familia que lo de `/tmp`. Usar
  archivos de verdad con rutas absolutas de Windows (Entrada 043).
- ⚠️ **Ordenar por `id` deja de significar «por antigüedad» al pasar de ObjectId
  a uuid.** Un ObjectId lleva la fecha de creación dentro; un uuid es aleatorio.
  Cualquier `sort({_id: …})` que quede por portar hay que mirarlo dos veces: si
  lo que quería era orden de creación, necesita su propia columna. Traducirlo mal
  **no falla**, sólo devuelve lo que no es (Entrada 042).
- ⚠️ **En PostgreSQL, renumerar posiciones exige unicidad diferible.** Al borrar
  el elemento de la posición 2, los siguientes bajan una; comprobada fila a fila,
  la renumeración choca consigo misma a mitad. `DEFERRABLE` la comprueba al
  cerrar la transacción (Entrada 042).
- ⚠️ **`rolsuper` y `rolbypassrls` no bastan para saber si un rol es seguro.** El
  dueño de las tablas no es ninguna de las dos cosas y aun así puede **apagar
  RLS** con un `ALTER TABLE`. La pregunta correcta es si es dueño de alguna
  tabla: `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND
  tableowner = current_user`, que debe dar **0** para el rol con el que se
  conecta la aplicación (Entrada 038).
- ⚠️ **Un aviso en mitad de una salida en verde no lo lee nadie.** Cuando una
  condición invalida el resultado —el rol equivocado, la cadena equivocada— hay
  que **abortar, no advertir**: ocho `OK` seguidos tapan cualquier aviso que haya
  quedado arriba (Entrada 038).
- ⚠️ **`sslmode=require` ya no significa lo que parece en `pg`.** Hoy se comporta
  como `verify-full`; en la próxima versión mayor pasará a la semántica de libpq,
  que es **más débil**. Las cadenas de conexión deben decir **`verify-full`**
  explícito para no cambiar de garantías con una actualización (Entrada 038).

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

> **Puesto al día el 22 de agosto de 2026**, después de la migración a
> PostgreSQL. **De §3 en adelante este documento es el análisis original del 14
> de agosto** y describe el sistema tal como estaba entonces —con MongoDB,
> `server.js` y otra suite de pruebas—; se conserva como registro de lo que se
> encontró, no como descripción de lo que hay. Lo vigente es esta sección, el
> 🔖 PUNTO DE PARTIDA del principio y la bitácora (§19).

### 2.1 Raíz

| Archivo | Líneas | Rol |
|---|---:|---|
| `arrancar.js` | 88 | **El punto de entrada.** Abre el puerto, comprueba el rol de la base y arranca los relojes |
| `avance_proyecto.md` | — | Este documento |
| `package.json` | 42 | Dependencias y scripts |
| `package-lock.json` | — | Necesario para `npm ci`, que es lo que usa el CI |
| `playwright.config.js` | 63 | Pruebas de navegador: dos proyectos —escritorio y móvil—, en serie y con un solo trabajador |
| `render.yaml` | 100 | Descriptor del despliegue. ⚠️ **Render NO lo aplica a un servicio que ya existe**: sirve de documentación, y cada variable hay que ponerla a mano (Entrada 055) |
| `README.md` | 55 | Instalación, modelo de acceso y migración |
| `HANDOFF.md` | 65 | Acta del 9 de julio de 2026. **Superada**: su contenido íntegro vive en el Anexo A |
| `.env` | — | Secretos locales (ignorado por Git) |
| `.env.example` | — | Plantilla con todas las variables |
| `.gitignore` | 9 | Ignora `.env`, `node_modules/`, `test-results/`, informes de Playwright |

⛔ **`server.js` ya no existe.** Empezó con 5.270 líneas el 14 de agosto y se
borró el 22 al cerrar la tajada 7.7 (Entrada 052).

**Directorios:** `src/` (la aplicación), `db/` (el esquema SQL **y las
migraciones**), `public/` (35 pantallas), `private/` (CSS y JS servidos),
`test/`, `scripts/`, `legacy-data/`, `.github/workflows/`.

### 2.2 `src/` — la aplicación

**24 módulos y 5 archivos de rutas.** La regla que los ordena: `src/db.js` es el
**único** sitio que abre transacciones y fija el contexto de quiniela; todo lo
demás recibe la conexión ya preparada.

| Archivo | Líneas | Rol |
|---|---:|---|
| `servidor.js` | 764 | Monta Express: sesión, guardias, limitadores y autenticación. Exporta `crearApp({pool, secretoSesion})` |
| `db.js` | 267 | **El único que abre transacciones** y fija `app.quiniela_id`. Expone el pool crudo con `fuenteActual()` |
| `trivias.js` | 459 | Trivias: apertura, cierre y respuestas |
| `eventos.js` | 445 | Bitácora de eventos del dominio |
| `sincronizador.js` | 440 | Ciclo de sincronización con el proveedor, con ventana por estado del partido |
| `ranking.js` | 349 | Clasificación y **las reglas de congelado** de una jornada cerrada |
| `jornadas.js` | 480 | Jornadas, partidos, **el orden por hora** y lo que costó cada una |
| `pronosticos.js` | 287 | Pronósticos, y la tabla comparativa en **una sola consulta** |
| `membresias.js` | 248 | Quién pertenece a qué quiniela y con qué papel |
| `fixtures.js` | 241 | Caché de partidos del proveedor, compartida entre quinielas |
| `oficiales.js` | 238 | Resultados oficiales |
| `respuestas-trivia.js` | 223 | Respuestas de los participantes |
| `proveedor.js` | 221 | Cliente de APIFootball, con tiempo de espera propio |
| `correo.js` | 215 | Tres transportes —`consola`, `brevo`, `resend`—, plantillas y bandeja en memoria |
| `puntuacion.js` | 203 | **Motor de puntos, sin efectos.** Aritmética idéntica a la de Mongo |
| `usuarios.js` | 194 | Cuentas, contraseñas y cierre de sesiones |
| `ligas.js` | 281 | Rango de búsqueda, competiciones bloqueadas, agrupado por país y **ligas favoritas** |
| `pagos.js` | 238 | Los abonos y las cuentas. ⚠️ **Ni edita ni borra**: se corrige con asiento inverso |
| `cobros.js` | 234 | **La aritmética del dinero, sin efectos.** Las dos cuentas, el saldo y la estimación |
| `quinielas.js` | 161 | Alta, archivado y configuración (puntuación y **ligas favoritas**) |
| `validacion.js` | 161 | Validadores de dominio: marcadores, nombres, partidos, índices |
| `jugadores.js` | 128 | Participantes |
| `planificador.js` | 116 | Los relojes: cada cuánto corre el sincronizador |
| `tokens.js` | 101 | Tokens de un solo uso, **guardados sólo en SHA-256** |
| `fechas.js` | 87 | `parseFechaPartidoCostaRica`. Costa Rica es UTC−6 todo el año |
| `cerrojos.js` | 87 | Cerrojos de consejo para que dos instancias no hagan el mismo trabajo |

**`src/rutas/` — las 81 rutas, repartidas por tema:**

| Archivo | Líneas | Rutas |
|---|---:|---|
| `puntuacion.js` | 377 | 10 — resultados, totales, clasificación por jornada |
| `plataforma.js` | 387 | 20 — lo de fuera de una quiniela. ⚠️ Partido en `sinQuiniela`/`conQuiniela` **porque el orden importa** |
| `admin.js` | 470 | 20 — administración, sincronizador y **cobros** |
| `dominio.js` | 268 | 16 — jornadas, partidos, pronósticos |
| `trivias.js` | 235 | 14 — trivias y sus respuestas |

### 2.3 `db/` — el esquema

| Archivo | Líneas | Rol |
|---|---:|---|
| `esquema.sql` | 351 | **19 tablas** con seguridad por fila (RLS) activada y forzada. Es lo que se pega en el editor de Neon |
| `poner-al-dia.sql` | 158 | Recrea el esquema con el rol dueño. ⚠️ **Se niega a correr si hay datos**, y ese seguro ya destapó un fallo real (Entrada 055). **Desde que hay datos en Neon ya no sirve**: los cambios van por `migraciones/` |

**`db/migraciones/` — los cambios de esquema, uno por archivo numerado.** Nació
con los cobros (Entrada 061), que fue el primer cambio con datos de verdad
delante. Sus tres reglas están escritas en la cabecera de la primera:

1. **Aditiva.** Crea; no borra ni reescribe.
2. **Idempotente.** Correrla dos veces no puede fallar. Nadie se acuerda de si
   ya la corrió.
3. **La misma verdad que `esquema.sql`.** Si los dos se separan, una
   instalación nueva y una al día dejan de ser la misma cosa.

| Archivo | Líneas | Qué trae |
|---|---:|---|
| `001-cobros.sql` | 220 | `jornadas.precio`, `jugadores.cobrar_desde` y `juega_torneo`, la tabla `pagos` con su RLS |

### 2.4 `scripts/`

| Archivo | Líneas | Rol |
|---|---:|---|
| `migrate-legacy.js` | 101 | Migrador de la base anterior. Simulación por defecto. **Lo único que aún habla con MongoDB** |

### 2.5 `test/` — 400 pruebas rápidas y 94 de navegador

`npm test` las corre todas en ~50 s, **sin red y sin tocar ninguna base real**:
por debajo hay un PostgreSQL 18 compilado a WebAssembly (PGlite), así que es
PostgreSQL de verdad y no una imitación.

| Archivo | Líneas | Pruebas | Qué comprueba |
|---|---:|---:|---|
| `rutas.test.js` | 2.780 | **171** | El servidor en marcha: HTTP real con `supertest` |
| `architecture.test.js` | 1.300 | **51** | El TEXTO del código. Guardan lecciones ya pagadas: que una ruta retirada no vuelva, que el rol no pueda desactivar la RLS |
| `puntuacion.test.js` | 700 | 31 | El motor de puntos, comodines y **la identidad del partido** |
| `trivias.test.js` | 529 | 27 | Apertura, cierre y respuestas |
| `sincronizador.test.js` | 448 | 29 | Ventanas por estado y proveedor caído |
| `plataforma.test.js` | 335 | 24 | Quinielas, membresías y aislamiento |
| `dominio.test.js` | 505 | 34 | Jornadas, partidos y pronósticos, más ligas favoritas y **el orden por hora** (puras) |
| `cobros.test.js` | 252 | 19 | **La aritmética del dinero.** Pura: no toca base ni red |
| `db.test.js` | 235 | 14 | Transacciones, contexto de quiniela y que ninguna tabla se quede sin RLS |
| `postgres-en-memoria.js` | 167 | — | El arnés de PGlite |
| `plantillas.js` | 87 | — | Utilidades compartidas |

> Las suites van **nombradas una a una** en `package.json`, no con un comodín:
> `test/*.test.js` funciona en Windows y falla en el CI de Linux, porque quien
> expande el comodín es el shell (Entrada 025).

**`test/e2e/` — 94 de navegador, con Playwright.** Aparte, porque tardan ~2,5
minutos y la suite rápida tiene que seguir siendo rápida.

| Archivo | Líneas | Qué cubre |
|---|---:|---|
| `resultados.spec.js` | 243 | Resultados oficiales, tabla general paginada y trivias |
| `jornadas.spec.js` | 238 | Administración de jornadas y privacidad partido a partido |
| `jornada-actual.spec.js` | 202 | Las tres pantallas abren en la misma jornada |
| `navegacion.spec.js` | 154 | Pulsa **todos los botones `data-ir-a`** y comprueba que ninguna pantalla pinta tarjetas de aviso vacías |
| `arrancar.js` | 116 | Levanta la aplicación sobre PGlite. ⚠️ Aquí vive `/e2e/ultimo-correo`, **que nunca se declara en `crearApp`** |
| `ayudas.js` | 111 | Registro, quiniela y Admin Mode. Cada prueba crea su cuenta |
| `cobros.spec.js` | 138 | Encender los cobros, anotar un abono y que el jugador lo vea |
| `adminmode.spec.js` | 125 | ⚠️ Qué se enseña cuando la comprobación de permisos falla, y adónde se sale |
| `ligas-favoritas.spec.js` | 114 | Marcar favoritas y verlas de primeras al armar la jornada |
| `jornadas-buscador.spec.js` | 109 | El desplegable dinámico, las exclusiones y el proveedor caído |
| `inyeccion.spec.js` | 95 | El marcado en los nombres se muestra como texto (S-04) |
| `cuenta.spec.js` | 94 | Registro, sesión, quiniela, ojo de la contraseña |
| `password.spec.js` | 90 | Recuperar la contraseña de punta a punta |
| `portada.spec.js` | 83 | La tarjeta nueva y que ninguna se estire |
| `csp.spec.js` | 76 | Recorre las pantallas buscando violaciones de CSP. Hace falta porque una violación **no da error visible**: el botón carga, se pulsa y no pasa nada |

### 2.6 `public/` — 35 pantallas HTML

Servidas con `express.static`.

**Públicas / de cuenta:** `login.html`, `registro.html`, `quinielas.html`,
`index.html`, `reglamento_quiniela.html`, `verificar-correo.html`,
`olvide-password.html`, `restablecer-password.html`

**De participante:** `llenar_jornada.html`, `llenar_jornada_user.html`,
`llenar_trivia.html`, `ver_jornadas.html`, `ver_jugadores.html`,
`verResultados.html`, `verResultados_puntos.html`, `resultados-totales.html`,
`clasificacion-jornada.html`, `ver-resultados-oficiales.html`,
`ver_resultados_trivias.html`, `ver_resultados_totales_de_jugadores.html`

**De administración (las 14 de `PAGINAS_ADMIN`, en `src/servidor.js`):**
`jugadores.html`, `jornadas.html`, `resultados.html`,
`agregar-resultados-oficiales.html`, `generar_reporte.html`,
`enviarresultados.html`, `copiarresultadojugador.html`, `admin_trivias.html`,
`enviarresultadostrivias.html`, `enviarresultadospartido.html`,
`enviarresultadostriviaspartido.html`, `miembros.html`,
`configuracion-quiniela.html`, `cobros.html`

⚠️ **La guardia compara `req.path` contra esa lista.** Una pantalla nueva de
administración que no se añada ahí **se sirve a cualquiera con sesión**. No es
fuga de datos —las APIs sí exigen `requireAdmin`— pero sí de superficie.

⛔ **`importar_partidos.html` ya no existe:** su buscador se integró en
`jornadas.html` en la Fase D, y los partidos salen sólo del API.

### 2.7 `private/js/` — 44 scripts

Servidos por `GET /js/:filename`. Es un pseudo-ocultamiento: el navegador los
descarga igual. **No hay ningún secreto ahí, pero tampoco protección real** — la
ruta no comprueba sesión.

Los más grandes:

| Script | Líneas | Función |
|---|---:|---|
| `jornadas.js` | 696 | Administración de jornadas, partidos y el buscador |
| `llenar_jornada_user.js` | 619 | Formulario de pronósticos |
| `llenar_trivia.js` | 450 | Formulario de trivias |
| `ver-resultados_puntos.js` | 446 | Puntos por jornada |
| `ver_resultados_totales_de_jugadores.js` | 386 | Tabla comparativa completa |
| `ver-resultados.js` | 374 | Vista de pronósticos |
| `admin_trivias.js` | 301 | Configuración de trivias por jornada |

### 2.8 `private/css/`

Un único `styles.css` con el sistema visual "mobile shell".

⚠️ **Dos reglas que existen por un fallo ya pagado**, y que conviene no "limpiar":

- La **regla general para `a`** (Entrada 057): antes no había ninguna, y cualquier
  enlace fuera de `.bottom-nav` o `.action-card` salía con el azul del navegador.
- **`.checkbox-fila` y `.checkbox-card`** (Entrada 060): deshacen el
  `width: 100%` que la regla global de `input` aplica también a las casillas de
  verificación. Sin ellas la casilla mide el ancho de la fila y **el texto deja
  de estar junto a su casilla**.

### 2.9 Dependencias

```
axios ^1.11.0            → cliente HTTP hacia APIFootball
bcrypt ^6.0.0            → hash de contraseñas (SALT_ROUNDS = 10)
connect-pg-simple ^10    → almacén de sesiones, en la tabla `sesiones`
cors ^2.8.5              → CORS con lista blanca configurable
dotenv ^17.0.1           → variables de entorno
express ^4.21.2          → framework HTTP
express-async-errors     → captura de errores en manejadores async
express-rate-limit ^8.6  → limitación de intentos
express-session ^1.18.0  → sesiones
helmet ^8.3.0            → cabeceras de seguridad
pg ^8.23.0               → cliente de PostgreSQL

--- solo para desarrollo ---
@electric-sql/pglite     → PostgreSQL 18 en WebAssembly, para las pruebas
@playwright/test ^1.62   → pruebas de navegador
supertest ^7.2.2         → HTTP contra la app sin abrir puerto
```

⛔ **Fuera en la tajada 7.7:** `mongoose`, `connect-mongo` y
`mongodb-memory-server`.

### 2.10 Scripts de npm

```
"start"             → node arrancar.js
"check"             → node --check arrancar.js
"test"              → las 8 suites nombradas una a una   (325)
"test:arquitectura" → node --test test/architecture.test.js
"test:postgres"     → las 7 que necesitan base           (279)
"test:rutas"        → node --test test/rutas.test.js
"test:e2e"          → playwright test
"test:e2e:ui"       → playwright test --ui
"migrate:legacy:dry" / "migrate:legacy"
```

### 2.11 Variables de entorno

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | **Sí** | Sin ella el proceso termina con `exit(1)`. ⚠️ Rol `app_quiniela`, **nunca el dueño** —el dueño se salta la RLS y el aislamiento entre quinielas desaparece—, cadena del `-pooler` y `sslmode=verify-full` explícito |
| `SESSION_SECRET` | Sí en producción | En desarrollo usa `'solo-desarrollo-cambiar'` |
| `APIFOOTBALL_COM_KEY` | Sí para sincronizar | Sin ella las rutas de fútbol devuelven 500 |
| `MAIL_TRANSPORT` | Sí en producción | `consola`, `brevo` o `resend`. ⚠️ Si se queda en `consola`, **nadie confirma su correo y nadie entra**. `/readyz` lo avisa (Entrada 055) |
| `MAIL_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` | Con `brevo` o `resend` | `MAIL_FROM` tiene que ser la dirección verificada en el proveedor |
| `APP_ORIGIN` | Sí en producción | De dónde cuelga el enlace del correo. Sin esto apunta a `localhost` y no le sirve a nadie |
| `VERIFY_TOKEN_HOURS` | No | Vida del enlace de confirmación. Por defecto 24 |
| `RESET_TOKEN_HOURS` | No | Vida del de restablecer. Por defecto **1**, corto a propósito: ese enlace abre la cuenta a quien lo tenga |
| `DB_MAX_CONEXIONES` | No | Tamaño del pool. Por defecto 10 |
| `PORT` | No | Por defecto 3000 |
| `NODE_ENV` | — | `development` o `production`. En producción activa `trust proxy`, cookie `secure` y `SESSION_SECRET` obligatorio |
| `ALLOWED_ORIGINS` | No | Orígenes CORS separados por comas |
| `DEBUG_ENDPOINTS` | No | Con cualquier valor distinto de `true`, los `/debug/*` responden 404 |
| `SYNC_INTERVALO_MS`, `SYNC_CONCURRENCIA`, `SYNC_TIMEOUT_CICLO_MS`, `JOBS_HABILITADOS` | No | El sincronizador |
| `APIFOOTBALL_TIMEOUT_MS` | No | Tiempo de espera del proveedor |
| `RANKING_CACHE_TTL_MS` | No | Vida de la caché de ranking; por defecto 60.000. Las escrituras la invalidan antes |

Sólo para `scripts/migrate-legacy.js`: `MONGO_URI_MULTIQUINIELA`,
`MONGO_URI_LEGACY_READONLY`, `LEGACY_DB_NAME`, `TARGET_DB_NAME`,
`MIGRATION_OWNER_EMAIL`, `MIGRATION_POOL_NAME`.

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

### 13.1 La suite del 17 de agosto — 75 pruebas *(histórico)*

> ⚠️ **Esto es la foto del 17 de agosto, no lo de hoy.** Aquella suite corría
> contra MongoDB en memoria y ya no existe. **Hoy son 325 rápidas y 68 de
> navegador, sobre PostgreSQL**; el inventario al día está en §2.5.

Estado tras añadir la clasificación por jornada (17 de agosto de 2026). Corrían en **~14 segundos, sin red y
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
| **M-33** | El `tenantPlugin` **no engancha `aggregate`, `insertMany` ni `bulkWrite`**. Hoy no hay fuga porque no se usa ninguno (cero llamadas), pero la primera agregacion que alguien escriba saldra sin filtro de quiniela y en silencio. Es la forma que tenia C-02 | `server.js:545-568` |

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

> **Estado al 23 de agosto de 2026: completadas las fases A, B, C, D, E y G.**
> La **F** —sugerencias de partidos destacados— está **en el backlog**, aparcada
> a petición del usuario: sigue sin definir qué cuenta como «igualados» y qué es
> un «clásico», y necesita la tabla de posiciones, que hoy no se consulta.
>
> Fuera de las diez peticiones originales y ya hechas: la **recuperación de
> contraseña** (Entrada 056), las **ligas favoritas** (Entrada 059) y los
> **cobros** (Entrada 061). Las tres salieron de ver la aplicación en uso, no de
> la lista.

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
| ✅ **4.º** | **D — Administración de jornadas unificada** | 3 | El cambio estructural grande, y necesita que buscar partidos ya funcione bien. **Completada el 19-ago-2026: los partidos salen solo del API** |
| ✅ **5.º** | **E — Verificación de correo** | 8 | Independiente de todo lo demás. **Completada el 22-ago-2026** (Entradas 053 a 055), con Brevo y la política «sin confirmar no se entra» |
| ✅ **6.º** | **G — Ligas favoritas de la quiniela** | — | No estaba en las diez: salió al ver el desplegable en uso. **Completada el 23-ago-2026** (Entrada 059) |
| ✅ **7.º** | **H — Cobros: cuota de torneo y por jornada** | — | Tampoco estaba en las diez. **Completada el 23-ago-2026** (Entrada 061). Lo primero del sistema que cuenta dinero |
| 📥 **backlog** | **F — Sugerencias de partidos** | 10 | Lo más especulativo y lo más caro. **Aparcada el 23-ago-2026 por decisión del usuario**: sigue necesitando definir qué es «igualados» y qué es un «clásico», y además la tabla de posiciones, que hoy no se consulta |
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

### ✅ 20.5 Fase D — Administración de jornadas unificada *(petición 3)* — COMPLETADA el 19 de agosto de 2026

> Que *agregar jornada* pase a ser **agregar / modificar / eliminar / ver**, y que
> los partidos salgan **solo del API**: desaparece *importar desde API* como
> pantalla aparte.

Es el cambio estructural más grande de la lista. Hoy hay **dos pantallas** que
hacen lo mismo por caminos distintos: `jornadas.html` (a mano, con autocompletado
de equipos) e `importar_partidos.html` (desde el API). Unificarlas simplifica de
verdad.

**Lo que había que confirmar antes de empezar**, porque es irreversible en la
práctica: quitar la entrada manual significa que **no se podrá crear una jornada
con un partido que el API no tenga**. Si alguna vez hace falta un amistoso, un
torneo local o un partido que el proveedor no cubre, deja de ser posible.

**Decisión tomada el 19-ago-2026: se acepta.** Los partidos salen **solo del
API**. El usuario lo confirmó habiéndosele expuesto la pérdida: «no importa,
dejemos que solo se puedan agregar partidos que estén en el API».

**Lo que se acepta a cambio, escrito para que nadie se sorprenda luego:** si el
proveedor no cubre un partido, ese partido no puede entrar en una quiniela. No
hay puerta de atrás por interfaz. La salida, si algún día hace falta, sería
reponer el alta manual detrás de Admin Mode —el código que se retira queda en el
historial de git, no se pierde—.

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

**Decisión pendiente:** ninguna. Se confirmó el 19-ago-2026 que se acepta perder
el alta manual.

**Cómo quedó (Entrada 031).** La duplicación era peor de lo que decía este plan:
las dos pantallas no compartían un camino, compartían **tres copias enteras** —la
lista de torneos, la tabla de traducción de equipos y el filtro de exclusiones—,
y ya habían divergido: **la Fase C arregló el desplegable de una y dejó intacto
el de la otra** sin que nadie lo notara. Las dos tablas de traducción resultaron
idénticas —147 entradas, cero discrepancias— y viven ahora en
`private/js/equipos-es.js`.

Se fueron también `POST /api/jornadas/importar-api` —que era `POST /api/jornadas`
con una traducción de nombres delante, y esa traducción bajó a
`normalizarPartido`— y las dos referencias a la pantalla retirada. Balance: **902
líneas añadidas contra 2.126 borradas**, y una pantalla menos.

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

## 21. Plan de migración a PostgreSQL

> ✅ **EJECUTADO Y TERMINADO el 22 de agosto de 2026.** Lo que sigue es el plan
> tal como se escribió, en futuro; se conserva porque explica **por qué** se hizo
> así. Cómo quedó de verdad está en §A y en las Entradas 040 a 052.
>
> **Decidido el 20 de agosto de 2026**, después de que el sondeo (Entradas 032 a
> 039) pasara la puerta: 8 de 8 en la prueba de aceptación y 4 de 4 en la del
> *pool*, con 240 peticiones concurrentes y ni un cruce.

### 21.1 Las cuatro decisiones de alcance

Se tomaron antes de escribir una línea, porque cada una cambia el tamaño de la
obra. Están aquí para no volver a discutirlas a mitad de camino.

| Decisión | Qué se eligió | Qué se acepta a cambio |
|---|---|---|
| **Identidad** | **Claves ajenas dentro, nombres en el API.** La base usa `jornada_id` y `partido_id` de verdad; las rutas siguen recibiendo y devolviendo nombres, y los resuelven una vez al entrar | Cierra **M-01** y **M-02** en el modelo de datos, y **el frontend no se toca**. A cambio, los nombres siguen siendo la identidad de cara afuera: dos jornadas no pueden llamarse igual dentro de una quiniela, que ya era el caso |
| **Capa de datos** | **`pg` a secas**, con ayudantes en `src/db.js` | SQL a la vista y control total de la transacción y del contexto RLS, que es la pieza delicada. Sin generación de código ni paso de compilación. A cambio, no hay tipos: el proyecto es JavaScript llano |
| **Rama** | **`postgres`**, se funde cuando las 142 rápidas y las 62 de navegador pasen | `main` sigue desplegable y con el CI en verde. A cambio, una fusión grande al final y `main` sin novedades varias sesiones |
| **`_id` → `id`** | Se cambia | Sale gratis: `_id` aparece **4 veces en 3 archivos** del frontend |

### 21.2 Las tres reglas que sostienen el aislamiento

Están escritas en la cabecera de `src/db.js` y **no son estilo, son la
seguridad**. Equivocar cualquiera de las tres rompe el aislamiento en silencio.

1. ⚠️ **La transacción es por PETICIÓN, no por consulta.** Todas las consultas de
   una petición caben en la misma transacción con el mismo contexto, así que el
   sobrecoste se paga una vez. Por eso `enQuiniela` es **reentrante**. Si alguien
   escribe una transacción por consulta, el coste se multiplica por cuatro y
   **parecerá culpa de PostgreSQL** (Entrada 039).
2. ⚠️ **El contexto se fija con `SET LOCAL`, dentro de la transacción.** Es toda
   la defensa: el *pooler* de Neon trabaja en modo transacción, y un `SET` de
   sesión se colaría en la petición siguiente que reutilice la conexión.
3. ⚠️ **La aplicación no se conecta con el rol dueño.** El dueño puede **apagar
   RLS**. `comprobarRol()` se planta al arrancar si detecta que puede.

### 21.3 Las tajadas

Cada una termina con su suite en verde y su commit. Ninguna se empieza sin la
anterior cerrada.

| # | Tajada | Qué entra | Estado |
|---|---|---|---|
| **1** | **Cimientos** | `src/db.js`, `db/esquema.sql`, arnés PGlite, 13 pruebas | ✅ Entrada 040 |
| **2** | **Plataforma** | `usuarios`, `quinielas`, `membresias` y sus reglas | ✅ Entrada 041 |
| **3** | **Dominio básico** | `jugadores`, `jornadas`, `partidos`, `equipos` | ✅ Entrada 042 |
| **4** | **Puntuación** | `resultados`/`pronosticos`, `resultados_oficiales`, motor de puntos, ranking materializado | ✅ Entrada 044 |
| **5** | **Trivias** | `trivias`, `respuestas_trivia`, autorresolución y reconciliación | ✅ Entrada 045 |
| **6** | **Sincronizador** | `fixtures`, `job_locks`, APIFootball, métricas | ✅ Entrada 046 |
| **7** | **Limpieza** | Fuera `mongoose`, `connect-mongo` y `mongodb-memory-server`; `render.yaml`; documentación | ✅ Entrada 052 |

### 21.4 Lo que hay que acordarse de mirar

- ⚠️ **Las sesiones viven en Mongo** (`connect-mongo`). Pasan a `connect-pg-simple`,
  que necesita su propia tabla. No estaba en el plan original y apareció al
  revisar `package.json` (Entrada 040).
- **`src/transacciones.js` se queda sin trabajo.** Todo su baile de «MongoDB sólo
  hace transacciones sobre un conjunto de réplicas» desaparece: en PostgreSQL son
  de serie y sin condiciones. Se retira en la tajada 7.
- **Los contadores centinela de `architecture.test.js` se van a mover mucho.** No
  es una regresión: `server.js` va a menguar de verdad por primera vez.
- **En desarrollo local, PGlite; Neon para el CI y producción.** Cada viaje a
  Neon desde esta máquina son ~116 ms, así que desarrollar contra Neon sería
  lento sin motivo (Entrada 039).

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

## Anexo C — Procedimiento: crear la base en Neon

> Escrito el 20 de agosto de 2026, al decidirse abrir la puerta del sondeo SQL
> (Entrada 033). **Los tres archivos que se pegan están probados**: se ensayaron
> contra un PostgreSQL de verdad con `sondeo-sql/probar-neon-sql.js` antes de
> escribir este anexo, y las ocho comprobaciones pasan.
>
> **Se ejecutó entero contra Neon el 20 de agosto**: el paso 5 dio **8 de 8**
> (Entrada 038) y el paso 9 dio **4 de 4** (Entrada 039). Este anexo ya no es un
> plan: es el registro de algo que se hizo y funcionó.

**Qué deja montado:** una base PostgreSQL en Neon, con las 16 tablas, el
aislamiento por quiniela aplicado por la base y un rol de aplicación que **no
puede apagarlo**. Al terminar, la prueba de aceptación tiene que dar **8 de 8**.

⚠️ **Esto no migra nada ni toca la aplicación.** Al final de este anexo la
aplicación sigue hablando con MongoDB exactamente igual que antes. Es la puerta
que se acordó abrir antes de comprometerse: si las ocho comprobaciones no pasan
con un *pool* de conexiones de verdad, no se sigue.

---

### Antes de empezar

Ten a mano **la región de tu servicio de Render** (Oregon, Ohio, Frankfurt,
Singapur…). No es un detalle: si la base queda lejos de la aplicación, cada
consulta paga el viaje de ida y vuelta, y la aplicación hace muchas por petición.

> ⚠️ **Esto no es teórico: pasó.** La base se montó en Ohio y el servicio estaba
> en Oregón. Cada consulta costaba **47 ms** en vez de 3, así que una ruta con
> cinco consultas pagaba ~235 ms sólo en viajes — y habría parecido culpa de
> PostgreSQL. Se descubrió midiendo desde fuera el mismo día del despliegue, y se
> arregló creando el proyecto de nuevo en Oregón (Entrada 053).

> **Cómo se mide sin entrar a ningún panel:** `/healthz` no toca la base y
> `/readyz` hace un `SELECT 1`. La diferencia entre las dos, tomando el **mínimo**
> de varias llamadas, es el viaje de ida y vuelta a la base: la latencia propia
> hasta el servidor se cancela porque está en las dos.

---

### Paso 1 — Crear la cuenta y el proyecto

1. Entra en **[console.neon.tech](https://console.neon.tech)** y crea la cuenta
   (se puede con GitHub o Google).
2. **Create project**, y rellena:
   - **Name:** `quinieladeportivaglobal`
   - **Postgres version:** la más alta que ofrezca (17 o 18). El esquema no usa
     nada exótico; `gen_random_uuid()` es de serie desde la 13.
   - **Region:** ⚠️ **la misma que tu servicio de Render**.
3. Al crearlo, Neon te enseña una cadena de conexión. **Todavía no la uses.**

### Paso 2 — Crear la base con nombre propio

Neon crea por defecto una base llamada `neondb` y un rol dueño llamado
`neondb_owner` (los nombres exactos los ves en el panel). **No la uses así**: es
exactamente la trampa de **M-30**, la misma por la que hoy la base de Mongo se
llama `test`.

En la pestaña **Databases** → **New Database**, crea una llamada **`quiniela`**,
con el rol dueño que Neon ya te dio.

> Si prefieres otro nombre, cámbialo también en la línea `GRANT CONNECT ON
> DATABASE quiniela` de `sondeo-sql/neon-preparar.sql`, o el paso 4 fallará.

### Paso 3 — Aplicar el esquema

En la pestaña **SQL Editor**, arriba a la derecha, **elige la base `quiniela`**
(si te deja en `neondb` crearás las tablas en el sitio equivocado).

Pega el contenido entero de **`db/esquema.sql`** y ejecútalo. Crea **18 tablas** y
activa RLS en las 12 de dominio.

> ⛔ **`db/esquema.sql`, NO `sondeo-sql/esquema.sql`.** Este anexo decía el segundo
> hasta el 22 de agosto, y para entonces ya era el viejo: le faltan la tabla
> `sesiones` y la columna `jornadas.secuencia`. Seguirlo al pie de la letra monta
> una base en la que **nadie sigue dentro en la petición siguiente**, sin ningún
> error que lo explique. `sondeo-sql/esquema.sql` se queda como estaba porque es
> el registro de lo que se sondeó; **el que vale es el de `db/`.**

### Paso 4 — Crear el rol de la aplicación

Son **dos** cosas, y están separadas a propósito.

1. **Pega entero `sondeo-sql/neon-preparar.sql`** y ejecútalo. Crea el rol
   `app_quiniela` con sus permisos mínimos, **sin contraseña**.
2. **Escribe a mano esta única línea** en el SQL Editor, con una contraseña larga
   y aleatoria, y ejecútala:

   ```sql
   ALTER ROLE app_quiniela PASSWORD 'la-que-acabes-de-generar';
   ```

⚠️ **La contraseña no va en ningún archivo del repositorio, y el archivo ya no
tiene dónde ponerla.** Guárdala sólo en tu gestor de contraseñas y en las
variables de entorno de Render. Que **no** sea una que uses en otro sitio: acaba
en una variable de entorno, que está menos protegida que un gestor.

> **Por qué está separado así.** La primera versión de este anexo tenía un hueco
> que decía «CAMBIAME por algo largo y aleatorio» dentro del archivo, y pasó lo
> que pasa con esos huecos: se rellenó con la contraseña de verdad, en un archivo
> versionado. Se pilló antes de confirmarlo, pero un secreto que llega a un
> commit **no se arregla borrándolo después**: se queda en el historial para
> siempre. Ver la Entrada 034.

> **Por qué este paso existe y no es opcional.** RLS no protege contra un
> superusuario ni contra un rol con `BYPASSRLS`, y el rol dueño puede **apagar
> RLS** con un `ALTER TABLE`. Si la aplicación se conecta con el rol que Neon da
> por defecto, el aislamiento deja de ser una garantía y pasa a ser una
> costumbre. Con `app_quiniela` la aplicación puede leer y escribir filas, y nada
> más: ni `CREATE`, ni `ALTER`, ni `DROP`.

### Paso 5 — La prueba de aceptación

Pega **`sondeo-sql/neon-verificar.sql`** entero y ejecútalo.

Tiene que devolver **ocho líneas, todas diciendo `PASA`**:

```
PASA  El rol app_quiniela existe y no puede saltarse RLS
PASA  Las 12 tablas de dominio tienen RLS activo y forzado
PASA  El dueño puede asumir el rol app_quiniela
PASA  Sin contexto de quiniela no se ve nada
PASA  Un SELECT sin filtro solo ve la quiniela del contexto
PASA  Pedir a proposito la quiniela ajena devuelve vacio
PASA  Un JOIN no cruza quinielas con jornadas del mismo nombre
PASA  Escribir en una quiniela ajena lo rechaza la base
```

⚠️ **Si alguna dice `FALLA`, para aquí.** Significa que el aislamiento no está
puesto, y una aplicación sobre esa base filtraría datos entre quinielas sin
avisar de nada. Es C-02 otra vez.

**La columna `detalle` trae el error exacto de PostgreSQL.** Eso es lo que hay
que mirar, y lo que hay que pegar si se pide ayuda — no el mensaje que muestre el
editor.

La primera vez sale el aviso `Table "verif_resultados" does not exist, skipping`.
**Es normal y no es un error:** lo da el `DROP TABLE IF EXISTS` del principio,
que limpia los resultados de la ejecución anterior y la primera vez no tiene nada
que limpiar.

> ⚠️ **El guion termina en el `SELECT` a propósito.** Antes tenía detrás un
> `DROP TABLE` de limpieza, y eso lo hacía inservible: el editor de Neon muestra
> sólo la salida de la **última** sentencia, así que el guion corría entero, las
> ocho comprobaciones pasaban, y la tabla se borraba antes de que nadie la viera.
> Desde fuera parecía que no había hecho nada. Ver la Entrada 036.
>
> La tabla `verif_resultados` se queda en la base, entonces. No estorba y se
> borra sola en la siguiente ejecución.

> **Por qué el archivo está escrito como un solo bloque `DO` y no como un guion
> normal.** La primera versión era una tanda de sentencias dentro de un
> `BEGIN…ROLLBACK`, y en el editor web tenía dos problemas. Uno: en cuanto una
> sentencia falla, PostgreSQL aborta la transacción y **todo lo demás responde
> «Failed transaction: ROLLBACK required»**, que no dice qué falló — es el síntoma
> de lo que vino después, y el error de verdad se pierde de vista. Dos: no todos
> los editores web mantienen una transacción abierta entre sentencias, así que ni
> el `ROLLBACK` del final era de fiar. Ahora todo es **una sola sentencia**, cada
> comprobación atrapa su propio error, y los datos de prueba se borran al final.
> Ver la Entrada 035.

### Paso 6 — Armar la cadena de conexión de la aplicación

En **Connection Details**, Neon te da la cadena del **rol dueño**. La de
`app_quiniela` **no aparece en el panel**, porque ese rol lo creaste tú por SQL y
Neon no lo gestiona: hay que armarla a mano, cambiando usuario y contraseña.

Neon ofrece **dos** cadenas y la diferencia importa:

| | Cuál es | Para qué |
|---|---|---|
| **Con *pooler*** | el host lleva `-pooler` | **La aplicación.** Muchas conexiones cortas |
| **Directa** | el host no lo lleva | Migraciones y cambios de esquema |

Quedan así (cambiando `app_quiniela` y su contraseña):

```
# Para la aplicación
postgresql://app_quiniela:TU-CLAVE@ep-loquesea-pooler.REGION.aws.neon.tech/quiniela?sslmode=require

# Para migraciones y DDL, con el rol dueño
postgresql://neondb_owner:CLAVE-DEL-DUENO@ep-loquesea.REGION.aws.neon.tech/quiniela?sslmode=require
```

⚠️ **`sslmode=require` no es adorno**: Neon rechaza las conexiones sin TLS.

⚠️ **Y lo que hay que saber del *pooler*, que es la razón de que el diseño sea
como es:** trabaja en modo transacción, así que **un `SET` de sesión no
sobrevive** de una petición a la siguiente. Por eso el contexto de quiniela se
pone con **`SET LOCAL` dentro de un `BEGIN`**, y por eso cada operación de la
aplicación tiene que ir dentro de una transacción. No es una preferencia de
estilo: hecho de otro modo, el contexto de una quiniela se filtraría a la
petición siguiente que reutilice la conexión.

### Paso 7 — Una rama para las pruebas

En **Branches** → **New Branch**, crea una llamada `pruebas` a partir de `main`.
Neon las hace por copia sobre escritura: son instantáneas y no duplican los
datos. Es lo que usará el CI para tener una base limpia sin tocar la de verdad.

### Paso 8 — Dónde van las variables

Todavía **no** en Render: la aplicación aún habla con Mongo. De momento van a tu
`.env` local, con nombres nuevos que no chocan con los de Mongo:

```
DATABASE_URL=postgresql://app_quiniela:...-pooler...?sslmode=require
DATABASE_URL_DIRECT=postgresql://neondb_owner:...?sslmode=require
```

Cuando se escriba el `render.yaml` acordado, estas dos son las que irán allí.

---

### Paso 9 — La puerta de verdad: el aislamiento con un *pool*

Los ocho `PASA` del paso 5 se consiguen con **una sola conexión**. La aplicación
no funciona así: usa un *pool*, y **la conexión que atendió a la quiniela A la
reutiliza después otra petición cualquiera**.

Ahí está el riesgo que ninguna comprobación anterior ha tocado. El aislamiento se
apoya en una variable de sesión, `app.quiniela_id`; si sobreviviera al final de
la petición, la siguiente leería con el contexto de la anterior. Y sería una fuga
**peor que C-02**: intermitente, dependiente de la carga y silenciosa — con poco
tráfico no aparece nunca, y con mucho aparece a ratos.

La defensa es que el contexto se fija con `SET LOCAL` **dentro de una
transacción**, para que PostgreSQL lo deshaga al cerrarla. Esto lo comprueba:

```bash
cd sondeo-sql
npm install
npm run pool
```

Necesita `DATABASE_URL` en el `.env` de la raíz —la cadena **con *pooler*** y con
el rol **`app_quiniela`**—. Si detecta que falta el *pooler* o que el usuario es
el rol dueño, avisa: en cualquiera de los dos casos la prueba valdría menos de lo
que parece.

Lo que hace: levanta seis quinielas, lanza **240 peticiones concurrentes** sobre
un *pool* de diez conexiones y comprueba que ninguna ve datos de otra; después
lanza veinte consultas **sin contexto** sobre esas mismas conexiones ya usadas,
que deben ver **cero filas**; y por último alterna quinielas distintas sobre el
mismo *pool* para forzar que una conexión pase de una a otra entre peticiones.
Crea sus propios datos con nombres que empiezan por `pool_` y los borra al
terminar, pase lo que pase.

⚠️ **Si esto falla, no se sigue.** No hay arreglo «de código» que valga: querría
decir que el modelo de aislamiento no aguanta el modo en que la aplicación va a
usar la base.

---

### Lo que NO hay que hacer

- ⚠️ **No pongas la cadena del rol dueño en la aplicación.** Es el paso 4 entero
  tirado a la basura.
- ⚠️ **No uses la cadena directa para la aplicación.** Sin el *pooler*, cada
  petición abre conexión contra el proceso de Postgres y el plan gratuito de Neon
  tiene un límite bajo de conexiones.
- **No borres `sondeo-sql/`** hasta que la decisión esté tomada del todo.

### Lo que este anexo deja sin resolver

**Nada, si el paso 9 pasa.** Con los ocho `PASA` del paso 5 y el `pool` del paso
9 en verde, la puerta está pasada y la decisión de migrar las 81 rutas se toma
con datos y no con impresiones.

Lo que sigue fuera del alcance de este anexo es la **migración en sí**: ninguna
ruta de la aplicación habla todavía con PostgreSQL, y eso es deliberado.

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

### 📌 Entrada 031 — 19 de agosto de 2026 — Fase D: una sola pantalla de jornadas, y los partidos solo del API

**Objetivo:** la petición 3 — que *agregar jornada* pase a ser **agregar,
modificar, eliminar y ver**, y que los partidos salgan **solo del API**, con lo
que desaparece *importar desde API* como pantalla aparte.

**Decisión de producto, tomada tras exponer la pérdida:** se acepta. Si el
proveedor no cubre un partido —un amistoso, un torneo local—, ese partido no
puede entrar en una quiniela, y no hay puerta de atrás por interfaz. El usuario
lo confirmó: «no importa, dejemos que solo se puedan agregar partidos que estén
en el API».

---

#### Lo que se encontró al abrir: la duplicación era peor de lo que decía el plan

El plan hablaba de dos pantallas que hacían lo mismo por caminos distintos. Al
abrirlas resultó que compartían **tres copias enteras** de código, no una:

| Qué estaba duplicado | Dónde |
|---|---|
| La lista de ~20 torneos escrita a mano | `importar_partidos.html` **y** `jornadas.html` |
| La tabla de traducción de equipos | `importar_partidos.js` **y** `jornadas.js`, ~230 líneas cada una |
| `esLigaNoPermitida` y el filtro por nombres | Las dos, otra vez |

**Y las copias ya habían divergido.** La Fase C, el día anterior, arregló el
desplegable de `importar_partidos.html` y **no tocó el de `jornadas.html`**,
porque nadie sabía que había un segundo. Es exactamente el fallo que esta fase
venía a hacer imposible, ocurriendo mientras tanto.

Las dos tablas de traducción se compararon antes de unirlas: **147 entradas
útiles cada una, cero discrepancias**, y con claves repetidas dentro de cada
literal. Pura duplicación, sin una sola diferencia que rescatar. Están ahora en
`private/js/equipos-es.js`, una vez y ordenadas.

---

#### La pantalla nueva

Tres partes, en el orden en que se usan:

1. **Jornada** — una existente (se cargan sus partidos) o «➕ Nueva jornada».
2. **Buscar partidos** — el buscador de la Fase C, ahora aquí dentro.
3. **Partidos de la jornada** — lo que va a quedar guardado: comodín editable,
   quitar, guardar, y eliminar la jornada entera.

Un partido ya agregado aparece en los resultados de la búsqueda como **«Ya está
en la jornada»** y con la casilla apagada. La identidad es el `apiFixtureId`
cuando lo hay y los dos equipos si no, de modo que una jornada traída de la base
—cuyos partidos no vienen del buscador— también se compara bien.

---

#### Dos rutas de escritura se convirtieron en una

`POST /api/jornadas/importar-api` era `POST /api/jornadas` **con una traducción
de nombres delante**: el buscador manda `fecha` y `estado`, y la jornada guarda
`apiDate` y `apiStatus`. Nada más. Dos rutas para una escritura, y la copia se
había quedado sin validaciones que la otra sí ganó.

El alias bajó a `normalizarPartido`, en `src/validacion.js`: **quien normaliza es
quien debe saber los nombres que acepta**. `apiDate` gana sobre `fecha` si vienen
los dos. Con eso la ruta sobró y se retiró.

---

#### El fallo que destapó la prueba, y que era mío

Al guardar, el mensaje «Jornada guardada» aparecía y **se borraba solo un
instante después**. La causa: al guardar se recarga la lista de jornadas, y esa
recarga llamaba a la función que limpia el aviso.

Limpiar el aviso es respuesta a que **el usuario** cambie de jornada, no a que la
pantalla recargue datos. Se movió al manejador del `change`, y en la función que
carga quedó anotado por qué no debe volver ahí.

Lo cazó la prueba de extremo a extremo, no la revisión del código: leyendo, la
secuencia «avisar, recargar» parece inofensiva.

---

#### Dos guardianes de arquitectura bajaron de número, a propósito

Los dos son **contadores centinela**, y bajaron porque se borró una pantalla:

| Guardián | Antes | Ahora | Por qué |
|---|---|---|---|
| Escrituras directas de `Jornada` | 3 | 2 | Se retiró `importar-api` |
| Plantillas de riesgo halladas | ≥ 60 | ≥ 50 | Se borró `importar_partidos.js` con las suyas |

El segundo es un **suelo, no un objetivo**: está para que el rastreador no pase
en verde por no encontrar nada. Lo que de verdad comprueba —que ninguna plantilla
meta datos en HTML sin escaparlos— siguió pasando en todo momento.

---

#### El balance

```
11 archivos, 902 líneas añadidas, 2.126 borradas
```

| Pieza | Antes | Ahora |
|---|---:|---:|
| `private/js/jornadas.js` | 1.097 | 659 |
| `private/js/importar_partidos.js` | 811 | **borrado** |
| `private/js/equipos-es.js` | — | 172 |
| `public/jornadas.html` | 233 | 135 |
| `public/importar_partidos.html` | 121 | **borrado** |
| Pantallas HTML | 32 | 31 |

---

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `public/jornadas.html` | Reescrita: la única pantalla de jornadas |
| `private/js/jornadas.js` | Reescrito: absorbe el buscador; fuera el alta manual y el autocompletado |
| `private/js/equipos-es.js` | **Nuevo.** La tabla de traducción, una sola vez |
| `public/importar_partidos.html` | **Borrado** |
| `private/js/importar_partidos.js` | **Borrado** |
| `public/adminmode.html` | Fuera la tarjeta de importar; la de jornadas dice lo que hace ahora |
| `server.js` | Retirada `/api/jornadas/importar-api` y las dos referencias a la pantalla |
| `src/validacion.js` | `normalizarPartido` acepta `fecha`/`estado` como alias |
| `test/architecture.test.js` | Los dos contadores centinela, con su porqué |
| `test/e2e/jornadas.spec.js` | Crear desde el API, modificar, eliminar, y que la pantalla retirada dé 404 |
| `test/e2e/jornadas-buscador.spec.js` | Renombrada desde `importar-partidos.spec.js`; apunta a la pantalla nueva |

**Verificación:**

```
npm test          → 129/129
npm run test:e2e  → 62/62  (58 anteriores + 4 nuevas, escritorio y móvil)
```

**Hallazgos nuevos:**

- **Una duplicación que nadie ha catalogado se arregla a medias.** La Fase C
  corrigió el desplegable de una pantalla y dejó intacto el de la otra, sin que
  nadie lo notara, porque la copia no estaba en ningún sitio anotada. El
  antídoto no es tener más cuidado: es que no haya dos.
- **Borrar código mueve los contadores centinela**, y eso no es una regresión.
  Conviene que digan en el propio código que son un suelo y por qué, o el
  siguiente que los vea en rojo pensará que rompió algo.
- **Un aviso de éxito puede borrarlo su propia recarga.** «Avisar y recargar» se
  lee inofensivo; lo que lo delata es la prueba que mira la pantalla.

**Pendiente / siguiente paso:** **Fase E — verificación de correo electrónico**
(petición 8). ⚠️ Tiene dos decisiones abiertas y una de ellas cuesta dinero:
**qué proveedor de envío** (Resend, SendGrid, SMTP propio — con configuración en
Render) y **qué se bloquea a una cuenta sin verificar**. Media parte ya está
hecha sin saberlo: el modelo `Usuario` ya tiene `emailVerificado`,
`tokenVerificacion` y `expiracionTokenVerificacion`.

---

### 📌 Entrada 032 — 20 de agosto de 2026 — Sondeo SQL: medir en vez de opinar

**Objetivo:** contestar con números, y no con impresiones, si conviene pasar de
MongoDB a PostgreSQL, después de que el usuario aportara un dato que cambia la
pregunta: **los datos de hoy son de prueba y se pueden tirar enteros**.

Conviene decir de entrada por qué esto no contradice la §20.8. Aquella respuesta
—«no migrar»— contestaba a otra pregunta: daba por hecho que había datos que
conservar y un histórico que mover. Sin datos que salvar, el balance hay que
rehacerlo. Lo que **no** cambia es el tamaño de la obra, y era importante decirlo
antes de empezar: renombrar la base son treinta minutos; pasar a SQL es reescribir
la capa de datos entera. Que haya que hacer lo primero no abarata lo segundo.

Se acordó una **sesión de sondeo con límite y sin compromiso**: modelar, probar y
medir; decidir después.

**Qué se hizo:**

1. **Se midió la obra**, para dejar de estimarla a ojo: **13 esquemas** de
   Mongoose, **81 rutas**, **~220 puntos de llamada** a la base (56 `find`, 55
   `findOne`, 22 `save`, 36 `lean`, 15 `findById`…), **5 arreglos incrustados** y
   **2.617 líneas** de pruebas de integración atadas al arnés de Mongo.
2. **Se modeló el sistema entero en PostgreSQL** (`sondeo-sql/esquema.sql`): las
   13 colecciones se vuelven **16 tablas**, con claves ajenas de verdad y con el
   aislamiento por quiniela puesto en *Row-Level Security* en lugar de en el ORM.
3. **Se montó un banco de pruebas** (`sondeo-sql/sondeo-pglite.js`) que arranca un
   PostgreSQL de verdad, aplica el esquema y corre **10 comprobaciones** de
   aislamiento, cerrojo y ranking.
4. **Se cronometró el arnés de pruebas**, que era la mayor duda de todas.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/esquema.sql` | **Nuevo.** Las 13 colecciones en 16 tablas, con RLS |
| `sondeo-sql/sondeo-pglite.js` | **Nuevo.** El banco de pruebas y sus mediciones |
| `sondeo-sql/LEEME.md` | **Nuevo.** Qué es esto, cómo se corre y qué no prueba |
| `avance_proyecto.md` | Esta entrada, §15 (M-32) y las secciones de cabecera |

⚠️ **Nada de `sondeo-sql/` lo usa la aplicación**, no está enganchado a `npm test`
y no toca `package.json`. Es material de una exploración: si la decisión es
quedarse en Mongo, se borra la carpeta y no queda deuda.

**Verificación:**

```
node sondeo-sql/sondeo-pglite.js  → 10/10 comprobaciones pasan

  OK  Un SELECT sin filtro sólo ve la quiniela del contexto
  OK  Pedir a propósito la quiniela ajena devuelve vacío
  OK  Una agregación tampoco escapa (es el hueco de aggregate en Mongoose)
  OK  Un JOIN de tres tablas no cruza quinielas
  OK  Escribir en una quiniela ajena lo rechaza la base
  OK  Sin contexto de quiniela no se ve nada (la puerta de §5.2)
  OK  AVISO comprobado: el superusuario ve TODAS las quinielas
  OK  El cerrojo: el primero entra, el segundo rebota
  OK  El cerrojo caducado lo puede tomar otro
  OK  El ranking sale en UNA consulta y sin los puntos de la otra quiniela

npm test                          → 129/129, 17,3 s de reloj
```

Y los tiempos, que son el corazón del sondeo:

| Medida | Mongo (hoy) | PostgreSQL (sondeo) |
|---|---|---|
| Arranque del arnés de pruebas | **13.438 ms** (`MongoMemoryReplSet`) | **2.896 ms** (PGlite + esquema) |
| Aplicar el esquema | — | 96 ms |
| Consulta con transacción y RLS | — | 1,67 ms |
| Consulta suelta, sin aislamiento | — | 0,32 ms |
| Ranking completo | 6 lecturas + armado en JavaScript | **1 consulta**, 4 ms |

**Hallazgos nuevos:**

1. ⚠️ **La trampa más cara de todas: un superusuario se salta RLS siempre**,
   aunque la tabla lleve `FORCE ROW LEVEL SECURITY`. Si la aplicación se conecta
   con el rol dueño de la base —que es **justo lo que dan por defecto Neon y casi
   cualquier proveedor**— el aislamiento no existe y **nada avisa**: las consultas
   funcionan, devuelven filas, y devuelven también las de las demás quinielas. Es
   C-02 otra vez, con otro disfraz. El banco lo comprueba en las dos direcciones a
   propósito: con el rol `app` no se ve lo ajeno, y con el dueño se ve todo. Si
   algún día se migra, **crear el rol sin privilegios es el primer paso, no el
   último**.

2. **Se encontró un agujero latente en el código actual de Mongo**, y no tiene
   nada que ver con SQL: el `tenantPlugin` engancha `find*`, `countDocuments`,
   `update*` y `delete*`, pero **no `aggregate`, ni `insertMany`, ni `bulkWrite`**.
   Hoy no hay fuga porque el código no usa ninguno de los tres —se contaron: cero—
   pero el día que alguien escriba la primera agregación para un informe, **la
   consulta saldrá sin filtro de quiniela y en silencio**. Queda anotado como
   **M-33**. No urge, pero es exactamente la forma que tenía C-02.

3. **El arnés de pruebas se haría MÁS RÁPIDO, no más lento.** Era el argumento
   más fuerte en contra de migrar, y la medición lo desmonta: `MongoMemoryReplSet`
   tarda **13,4 s** en levantarse —la mayor parte de los 17,3 s que dura `npm
   test`— y PGlite tarda **2,9 s** con el esquema ya aplicado. PGlite es
   PostgreSQL 18 compilado a WebAssembly: es un paquete de npm, no necesita
   binarios, ni Docker, ni red.

4. ⚠️ **PGlite atiende una sola conexión**, y eso deja dos cosas sin probar: la
   disciplina de `SET LOCAL` dentro de transacción con un *pool* de verdad —que es
   lo que impide que el contexto de una quiniela se filtre a la petición siguiente
   que reutilice la conexión— y cualquier carrera real. Hoy **no cuesta nada**:
   las pruebas de integración no tienen ni un `Promise.all`, así que no hay una
   sola prueba de concurrencia que se pierda. Pero tampoco se podrían escribir sin
   un PostgreSQL de verdad. En CI es fácil: GitHub Actions levanta uno como
   servicio en tres líneas.

5. **`embedded-postgres` no arranca en esta máquina.** Fue el primer camino que se
   intentó, y falla con `STATUS_IN_PAGE_ERROR` (`0xC0000006`) al ejecutar
   `initdb.exe`, tanto en la serie 17 como en la 18. Además **todas sus versiones
   publicadas son *beta***. No hay Docker ni `psql` instalados. Si alguien retoma
   esto, que no gaste la hora otra vez: **el camino que funciona es PGlite**.

6. **Tres cosas salieron mejor de lo esperado.** El cerrojo distribuido cabe en un
   `INSERT … ON CONFLICT DO UPDATE … WHERE expira_en <= now()`, que es más simple y
   más correcto que la versión de Mongo. El ranking, que hoy son seis lecturas
   completas armadas en JavaScript, sale en **una consulta**. Y `pgcrypto` no hace
   falta: `gen_random_uuid()` es de serie desde PostgreSQL 13.

7. **Lo que sí obliga a repensar, no solo a reescribir**, son los cinco arreglos
   incrustados. Al volverse tablas hijas, cada partido y cada pronóstico gana
   identidad propia —eso cierra **M-02** por obligación— pero los vínculos de hoy
   son por **nombre**: `Resultado.jornada` es el nombre de la jornada,
   `Resultado.jugador` es el `username`, `RespuestaTrivia.triviaId` es una cadena.
   Convertirlos en claves ajenas es la parte cara, y es también **M-01**.

**Pendiente / siguiente paso:**

La decisión, que es del usuario y sigue abierta. El sondeo no la toma: la deja
informada. Lo que queda sobre la mesa:

- **A favor:** Neon se suspende pero **se despierta solo** al llegar la primera
  conexión, así que cerraría **C-06** —que hoy está aceptado como riesgo— sin
  pagar nada; el aislamiento pasa a aplicarlo la base; se cierran **M-01**, **M-02**
  y **M-33** por obligación del modelo; y las pruebas se aceleran.
- **En contra:** son **81 rutas y ~220 llamadas** que hay que reescribir, varias
  sesiones sin nada visible para el usuario, y un tramo largo con la aplicación a
  medio migrar. Ni la Fase E ni la Fase F avanzan mientras tanto.

Si se decide seguir, **el primer paso no es migrar rutas**: es levantar un
PostgreSQL de verdad —en CI o en una rama de Neon— y volver a correr estas diez
comprobaciones con un *pool* de conexiones, para cerrar lo que PGlite no puede
probar. Si se decide no seguir, se borra `sondeo-sql/` y sólo queda M-32 anotado,
que es un hallazgo que valía la sesión por sí solo.

---

### 📌 Entrada 033 — 20 de agosto de 2026 — Se abre la puerta: el procedimiento de Neon, probado

**Objetivo:** dejar escrito, paso a paso y **sin nada que improvisar**, cómo se
crea la base de PostgreSQL en Neon, para poder correr las comprobaciones del
sondeo contra una base de verdad y decidir con eso si se migra.

Conviene ser preciso sobre qué se decidió y qué no. **No se ha decidido migrar
las 81 rutas.** Lo que se decidió es **abrir la puerta** que proponía la Entrada
032: montar la base, comprobar el aislamiento con un *pool* de conexiones real
—lo único que el sondeo no pudo verificar, porque PGlite atiende una sola
conexión— y decidir después. La aplicación sigue hablando con MongoDB y no se le
ha tocado una línea.

**Qué se hizo:**

1. **Se subió el sondeo** (`b23f4f1`). `main` y `origin/main` vuelven a estar a
   la par.
2. **Se escribieron los dos archivos que se pegan en Neon**: uno crea el rol de
   la aplicación con sus permisos, y otro es una prueba de aceptación de siete
   comprobaciones.
3. ⚠️ **Se ensayaron los tres archivos antes de escribir el procedimiento**, con
   `sondeo-sql/probar-neon-sql.js`, que aplica `esquema.sql`, `neon-preparar.sql`
   y `neon-verificar.sql` contra un PostgreSQL de verdad, en ese orden. No se
   entregan pasos sin haberlos ejecutado.
4. **Se escribió el Anexo C** con los ocho pasos, lo que no hay que hacer y lo
   que queda sin resolver.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/neon-preparar.sql` | **Nuevo.** El rol `app_quiniela` y sus permisos mínimos |
| `sondeo-sql/neon-verificar.sql` | **Nuevo.** Siete comprobaciones dentro de una transacción que termina en `ROLLBACK` |
| `sondeo-sql/probar-neon-sql.js` | **Nuevo.** Ensaya los tres archivos antes de tocar Neon |
| `sondeo-sql/LEEME.md` | Se añaden los archivos nuevos y cómo ensayarlos |
| `avance_proyecto.md` | **Anexo C**, esta entrada y las secciones de cabecera |

**Verificación:**

```
cd sondeo-sql && node probar-neon-sql.js  → 7/7 pasan
cd sondeo-sql && npm run sondeo           → 10/10 comprobaciones pasan
npm test                                  → 129/129
git push origin main                      → e583e37..b23f4f1
```

**Hallazgos nuevos:**

1. **El rol de la aplicación no lo puede dar el panel de Neon.** `app_quiniela`
   se crea por SQL, así que Neon no lo gestiona y **su cadena de conexión no
   aparece en Connection Details**: hay que armarla a mano cambiando usuario y
   contraseña sobre la del rol dueño. Es el punto donde es fácil rendirse y
   acabar poniendo la cadena del dueño en la aplicación, que es tirar a la basura
   todo el aislamiento.

2. ⚠️ **El *pooler* de Neon obliga al diseño, no lo sugiere.** Trabaja en modo
   transacción, así que **un `SET` de sesión no sobrevive** de una petición a la
   siguiente. Por eso el contexto de quiniela va con **`SET LOCAL` dentro de un
   `BEGIN`** y cada operación tiene que ir en una transacción. Hecho de otro modo,
   el contexto de una quiniela **se filtraría a la petición siguiente que
   reutilice la conexión**, que es una fuga peor que C-02 porque sería
   intermitente y dependería de la carga.

3. **La prueba de aceptación no ensucia la base.** Todo va dentro de una
   transacción que acaba en `ROLLBACK`, así que se puede repetir cuantas veces se
   quiera, también sobre una base con datos.

4. **M-30 se resuelve de paso, si esto sigue adelante.** El Anexo C hace crear una
   base llamada `quiniela` en vez de quedarse con la `neondb` que Neon da por
   defecto — que es exactamente la misma trampa por la que hoy la base de Mongo se
   llama `test`.

**Pendiente / siguiente paso:**

El usuario ejecuta el Anexo C. Cuando las siete comprobaciones den `PASA`, **la
puerta de verdad todavía no está pasada**: falta correr esas mismas
comprobaciones **desde Node, con un `Pool` de `pg` y varias peticiones a la vez**,
para confirmar que el contexto de una quiniela no se cuela en la petición de
otra. Eso es lo primero de la sesión siguiente, y hasta que pase **no se toca
ninguna ruta**.

Sigue sin contestar, y la Fase E la necesita en cualquiera de los dos escenarios:
⚠️ **cuál va a ser el dominio definitivo.**

---

### 📌 Entrada 034 — 20 de agosto de 2026 — El ensayo que no ensayaba, y una contraseña a punto de subirse

**Objetivo:** arreglar el paso 5 del Anexo C, que le falló al usuario en Neon con
«Failed transaction: ROLLBACK required», y cerrar de raíz una fuga de secreto que
apareció por el camino.

**Qué pasó:**

El paso 5 —la prueba de aceptación— **falló en Neon aunque pasaba 7/7 aquí**. La
causa es exactamente la que este mismo material lleva advirtiendo desde la
Entrada 032, aplicada en la dirección contraria:

> **El ensayo corría como superusuario, y los superusuarios se saltan RLS.**

PGlite conecta como `postgres`, que es superusuario. En Neon, el rol dueño
(`neondb_owner`) **no lo es**, y como las tablas llevan `FORCE ROW LEVEL
SECURITY`, **el dueño también está sujeto a las políticas**. Las inserciones de
datos de prueba del archivo corrían antes de fijar el contexto de quiniela, así
que en Neon las rechazó la política —`new row violates row-level security policy
for table "jugadores"`— y todo lo que venía detrás se saltó, que es lo que el
editor de Neon resume como «ROLLBACK required».

⚠️ **La ironía es la lección:** el archivo advertía por escrito de que un
superusuario se salta RLS, y el ensayo que lo verificaba corría como
superusuario. **Un banco de pruebas con más privilegios que el entorno real no
prueba lo que dice probar.** El fallo no fue del SQL: fue del ensayo.

**Y por el camino apareció otra cosa.** `neon-preparar.sql` tenía un hueco que
decía `CAMBIAME-por-algo-largo-y-aleatorio`, y pasó lo que pasa con esos huecos:
el usuario lo rellenó con una contraseña personal de verdad, **en un archivo
versionado en git**. Se detectó antes de confirmarlo —se comprobó buscando la
cadena en todo el historial con `git log -S`, y nunca llegó a ningún commit— pero el margen fue de un `git add`.

**Qué se hizo:**

1. **El ensayo ahora crea un rol `duenio` `NOSUPERUSER NOBYPASSRLS CREATEROLE`** y
   corre todo bajo él, que es lo que Neon da de verdad. Además **comprueba al
   arrancar** que no tiene privilegios de más y se niega a seguir si los tiene:
   si algún día alguien lo devuelve a superusuario, el ensayo lo dice en vez de
   dar un falso verde.
2. **La prueba de aceptación fija el contexto de quiniela antes de cada bloque de
   inserciones**, como hará la aplicación. No es un rodeo: es la demostración de
   que `FORCE ROW LEVEL SECURITY` hace su trabajo incluso con el dueño.
3. **`neon-preparar.sql` ya no tiene dónde poner un secreto.** El rol se crea
   **sin contraseña**, y la contraseña se pone con un `ALTER ROLE` suelto que se
   escribe a mano en el editor de Neon y no se guarda en ningún archivo. Un hueco
   que pide un secreto en un archivo versionado es una trampa, no una comodidad.
4. **Se corrigió el paso 4 del Anexo C** para reflejarlo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/probar-neon-sql.js` | Corre como dueño sin privilegios y se niega a correr con ellos |
| `sondeo-sql/neon-verificar.sql` | Fija el contexto de quiniela antes de sembrar los datos |
| `sondeo-sql/neon-preparar.sql` | Rol sin contraseña; la contraseña va en una línea aparte |
| `avance_proyecto.md` | Esta entrada, el paso 4 del Anexo C y las trampas conocidas |

**Verificación:**

```
node sondeo-sql/probar-neon-sql.js  → 7/7 pasan, ahora como dueño NO superusuario
git log -S <la contraseña> --all      → vacío: nunca llegó a ningún commit
npm test                            → 129/129
```

**Hallazgos nuevos:**

1. ⚠️ **Un banco de pruebas con más privilegios que producción da falsos verdes.**
   Vale para cualquier arnés, no sólo para éste: si las pruebas corren como
   superusuario y la aplicación no, **todo lo que dependa de permisos está sin
   probar**. Por eso el ensayo ahora se niega a arrancar con privilegios de más.
2. ⚠️ **`FORCE ROW LEVEL SECURITY` también alcanza al dueño de la tabla**, y eso
   cambia cómo se siembran datos: cualquier script de carga inicial, migración o
   respaldo **tiene que fijar `app.quiniela_id`** antes de escribir en las 12
   tablas de dominio. Es bueno —significa que el aislamiento no tiene puerta
   trasera— pero hay que saberlo antes, no descubrirlo con un error.
3. **Un hueco que pide un secreto dentro de un archivo versionado se rellena.**
   No sirve de nada escribir «no lo guardes en el repositorio» al lado del hueco:
   el sitio para escribirlo está ahí, y el archivo está en git. La solución no es
   un aviso más grande, es **quitar el hueco**.

**Pendiente / siguiente paso:**

El usuario repite los pasos 4 y 5 del Anexo C con los archivos corregidos. Cuando
den 7/7, sigue faltando lo mismo que antes: correr las comprobaciones **desde
Node, con un `Pool` de `pg` y varias peticiones a la vez**, que es lo único que
PGlite no puede probar. Hasta que eso pase, no se toca ninguna ruta.

---

### 📌 Entrada 035 — 20 de agosto de 2026 — Dejar de adivinar: que el guion diga qué falló

**Objetivo:** el paso 5 del Anexo C volvió a fallar en Neon con el mismo mensaje
—«Failed transaction: ROLLBACK required»— después de arreglar la causa de la
Entrada 034. Segunda vez con el mismo síntoma y sin saber la causa.

**Qué se hizo, y por qué se cambió de método:**

La Entrada 034 arregló **una** causa real. Que el síntoma se repitiera sólo
demostraba que había **otra**, y a esas alturas se estaba adivinando: proponer un
arreglo, esperar a que el usuario lo probara en Neon, y volver a empezar. Cada
vuelta cuesta una ida y vuelta con una persona delante.

⚠️ **El problema de fondo no era el SQL: era que el guion no sabía informar.**

`«Failed transaction: ROLLBACK required»` **no dice qué falló.** Es lo que
PostgreSQL responde a *todas* las sentencias que vienen **después** de la que
falló de verdad, porque la transacción queda abortada. En un editor web, donde lo
que se ve es la respuesta de la última sentencia, **el error real desaparece de la
pantalla**. Se estaba depurando a ciegas por culpa del formato del guion, no por
culpa de la base.

Así que en vez de adivinar una tercera causa, se rehízo el guion para que
informe:

1. **Todo va dentro de un único bloque `DO`**, que para el editor es **una sola
   sentencia**. Ya no hay «sentencias posteriores» que puedan enmascarar nada.
2. **Cada comprobación tiene su propio `BEGIN … EXCEPTION`**, así que una que
   falle **se anota con el error exacto de PostgreSQL en la columna `detalle`** y
   las demás siguen corriendo. Se pasa de «algo falló» a «esto falló, y esto
   dijo».
3. **Se añadió una comprobación que antes no existía** y que era sospechosa
   principal: **¿puede el rol dueño asumir `app_quiniela`?** Si no puede, todo lo
   demás mediría al dueño en vez de a la aplicación, que es un falso verde peor
   que un fallo. Si falla, el detalle trae escrito el arreglo:
   `GRANT app_quiniela TO CURRENT_USER;`. Son **ocho** comprobaciones, no siete.
4. **Se dejó de depender de que el editor mantenga una transacción abierta.** La
   versión anterior usaba `BEGIN … ROLLBACK` para no ensuciar la base, y eso sólo
   funciona si el editor conserva la sesión entre sentencias, cosa que no todos
   hacen. Ahora la limpieza la hace el propio bloque: borra la semilla al
   terminar, y si algo revienta antes, el bloque entero se deshace solo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/neon-verificar.sql` | Reescrito como un único bloque `DO`, con 8 comprobaciones que atrapan su propio error |
| `sondeo-sql/LEEME.md` | 8/8 en vez de 7/7 |
| `avance_proyecto.md` | Esta entrada, el paso 5 del Anexo C y las referencias del procedimiento |

**Verificación:**

```
node sondeo-sql/probar-neon-sql.js  → 8/8 pasan, como dueño NO superusuario
npm test                            → 129/129
```

**Hallazgos nuevos:**

1. ⚠️ **«Failed transaction: ROLLBACK required» no es un error: es el eco de
   otro.** Cuando aparezca —en Neon o en cualquier editor SQL— lo que hay que
   buscar es **la primera** sentencia que falló, no la última. Es la trampa que
   costó dos vueltas enteras en esta sesión.
2. **Un guion que se ejecuta a mano, en un editor ajeno y por otra persona, tiene
   que informar tan bien como una prueba automática.** Aquí el guion era correcto
   en su intención y aun así inservible para depurar, porque el formato escondía
   la causa. Un `DO` con `EXCEPTION` por comprobación cuesta unas líneas más y
   convierte «no sé qué pasó» en «falló la número 3, y dijo esto».
3. **La comprobación que faltaba era la del propio andamio.** Las siete originales
   verificaban el aislamiento, pero **ninguna verificaba que se estuviera midiendo
   con el rol correcto**. Es la misma familia de error que la Entrada 034: no
   comprobar las condiciones en las que se mide.

**Pendiente / siguiente paso:**

El usuario vuelve a ejecutar el paso 5 con el guion nuevo. Pase o falle, **ahora
habrá un mensaje concreto** que diga qué ocurre. Después sigue faltando lo mismo
de siempre: las comprobaciones **desde Node, con un `Pool` de `pg` y varias
peticiones a la vez**, que es lo único que PGlite no puede probar. Hasta que eso
pase, no se toca ninguna ruta.

⚠️ Aparte: `sondeo-sql/neon-preparar.sql` apareció en el árbol de trabajo
**revertido a la versión vieja** —la del hueco `CAMBIAME`—, probablemente porque
un editor guardó un búfer viejo encima. La versión buena está confirmada; se
recupera con `git checkout -- sondeo-sql/neon-preparar.sql`.

---

### 📌 Entrada 036 — 20 de agosto de 2026 — La limpieza que se comió el resultado

**Objetivo:** el guion reescrito en la Entrada 035 **corrió sin errores** —el
usuario lo confirmó— pero en pantalla no apareció la tabla de resultados. Sólo
salía el aviso `Table "verif_resultados" does not exist, skipping`.

**Qué pasaba:**

El aviso era inocente: lo da el `DROP TABLE IF EXISTS` de la primera línea, que
la primera vez no tiene nada que limpiar. No era el problema.

El problema estaba en la **última** línea. El archivo terminaba así:

```sql
SELECT ... FROM verif_resultados ORDER BY n;   -- las ocho comprobaciones
DROP TABLE verif_resultados;                   -- "limpieza"
```

⚠️ **Muchos editores web —el de Neon entre ellos— muestran sólo la salida de la
última sentencia**, y un `DROP TABLE` no devuelve filas. Así que el guion corría
entero, las ocho comprobaciones pasaban, se calculaba la tabla… y la sentencia
siguiente la borraba antes de que nadie la viera. Desde fuera parecía que no
había hecho nada.

**El arreglo es quitar el `DROP TABLE`**: el `SELECT` pasa a ser la última
sentencia del archivo. La tabla `verif_resultados` se queda en la base, que no
estorba a nadie, y se borra sola al principio de la siguiente ejecución con el
`DROP TABLE IF EXISTS` que ya estaba.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/neon-verificar.sql` | Se quita el `DROP TABLE` final; el `SELECT` queda el último. Se documenta que el aviso de la primera vez es normal |
| `avance_proyecto.md` | Esta entrada, el paso 5 del Anexo C y las trampas conocidas |

**Verificación:**

```
node sondeo-sql/probar-neon-sql.js  → 8/8 pasan
npm test                            → 129/129
```

**Hallazgos nuevos:**

1. ⚠️ **En un editor SQL web, la última sentencia del guion es la única que se
   ve.** Cualquier guion pensado para pegarse en uno **tiene que terminar en el
   `SELECT` que interesa**. Poner la limpieza detrás del resultado es tan natural
   escribiéndolo como fatal ejecutándolo: el resultado existe, es correcto, y no
   llega a la pantalla.

2. **Tres vueltas seguidas con la misma raíz.** Las Entradas 034, 035 y ésta son
   el mismo error con tres disfraces: **el ensayo local no reproducía las
   condiciones reales**. Primero por privilegios —se corría como superusuario—,
   luego por el manejo de transacciones del editor, y ahora por cómo el editor
   muestra los resultados. `probar-neon-sql.js` ejecuta el SQL y lee la respuesta
   mediante la librería, así que **nunca vio ninguno de los tres problemas**: los
   tres estaban en el borde entre el guion y la herramienta que lo ejecuta, que es
   justo lo que un ensayo programático no toca.
   La lección para lo que venga: **cuando un procedimiento lo ejecuta una persona
   en una herramienta ajena, la herramienta es parte de lo que hay que probar**, y
   eso no se puede automatizar del todo desde aquí.

3. **La limpieza automática tiene un coste que hay que decidir a conciencia.**
   Aquí se prefirió **dejar rastro** —una tabla de resultados que sobrevive— antes
   que un guion que no deja ver lo que hizo. Para un procedimiento manual, poder
   ver el resultado vale más que dejar la base impoluta.

**Pendiente / siguiente paso:**

El usuario vuelve a ejecutar el paso 5. Esta vez la tabla de las ocho
comprobaciones tiene que aparecer en pantalla.

Después sigue faltando lo mismo de siempre, y conviene no perderlo de vista entre
tantas vueltas: las comprobaciones **desde Node, con un `Pool` de `pg` y varias
peticiones a la vez**, que es lo único que PGlite no puede probar por atender una
sola conexión. Hasta que eso pase, **no se toca ninguna ruta**.

---

### 📌 Entrada 037 — 20 de agosto de 2026 — En Neon, crear un rol no da derecho a asumirlo

**Objetivo:** con el guion reescrito en las Entradas 035 y 036, la prueba de
aceptación por fin **enseñó el error de verdad** en vez de esconderlo. Arreglarlo.

**Lo que devolvió Neon:**

```
1  El rol app_quiniela existe y no puede saltarse RLS    PASA   superusuario=f bypassrls=f
2  Las 12 tablas de dominio tienen RLS activo y forzado  PASA   12 de 12
3  El dueño puede asumir el rol app_quiniela             FALLA  permission denied to set role
                                                                "app_quiniela"
```

Y ahí se paró, con **tres filas de ocho**. La parada es deliberada: la
comprobación 3 hace `RETURN` si falla, porque **seguir habría medido al rol dueño
creyendo que se medía a la aplicación**. Cinco `PASA` falsos habrían sido mucho
peor que un `FALLA` honesto.

**La causa:**

⚠️ **En un PostgreSQL normal, quien crea un rol queda como administrador suyo y
puede asumirlo con `SET ROLE`. En Neon no.** `neondb_owner` crea `app_quiniela`
sin problema —el paso 4 nunca dio error— pero al intentar ponerse en su piel, lo
rechaza.

Y asumirlo hace falta, porque desde el editor SQL es la **única** forma de
comprobar el aislamiento: hay que consultar como consultaría la aplicación.

**Qué se hizo:**

1. **`neon-preparar.sql` lleva ahora `GRANT app_quiniela TO CURRENT_USER;`**, con
   la explicación al lado. Deja de ser un paso manual que alguien tendría que
   descubrir por su cuenta.
2. **Se documentó en `probar-neon-sql.js` que este ensayo no puede detectar esa
   diferencia**, porque en PGlite el permiso ya viene dado: allí `duenio` crea el
   rol y por eso puede asumirlo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/neon-preparar.sql` | `GRANT app_quiniela TO CURRENT_USER;` y el porqué |
| `sondeo-sql/probar-neon-sql.js` | Se deja escrito qué diferencia con Neon sigue sin poder reproducir |
| `sondeo-sql/probar-pool.js` | **Nuevo.** La puerta de verdad: el aislamiento con un `Pool` de conexiones |
| `sondeo-sql/package.json` | Se añade `pg` y el guion `npm run pool` |
| `avance_proyecto.md` | Esta entrada, el Anexo C y las trampas conocidas |

**Verificación:**

```
node sondeo-sql/probar-neon-sql.js  → 8/8 pasan (el GRANT no rompe nada)
node --check sondeo-sql/probar-pool.js → sintaxis correcta
npm test                            → 129/129
```

⚠️ **`probar-pool.js` todavía no se ha ejecutado de verdad**, porque necesita un
PostgreSQL con *pool* —o sea, Neon— y en esta máquina no hay ninguno. Está
escrito y listo, no verificado.

**Hallazgos nuevos:**

1. ⚠️ **En Neon, crear un rol no da derecho a asumirlo.** Hace falta
   `GRANT <rol> TO CURRENT_USER;`. El síntoma es `permission denied to set role`,
   y llega **después** de que el `CREATE ROLE` haya ido bien, que es lo que
   despista: parece que el rol quedó mal creado, y está perfectamente creado.

2. **Cuarta vez en la misma sesión con la misma raíz, y ya no es casualidad: es
   un patrón que conviene nombrar.** Las Entradas 034, 035, 036 y ésta son todas
   *el ensayo local no reproduce el sitio real* — privilegios, transacciones del
   editor, presentación de resultados, y ahora permisos de rol del proveedor.
   Ninguna era un fallo del SQL.
   **Lo que rompió la racha no fue un ensayo mejor: fue hacer que el guion
   informara.** Los tres primeros se arreglaron adivinando, uno por vuelta. El
   cuarto se arregló en una sola vuelta porque la comprobación 3 dijo qué pasaba y
   dejó escrito el arreglo en el mismo mensaje. **Cuando algo lo ejecuta otra
   persona en una herramienta ajena, invertir en que el guion explique el fallo
   rinde más que invertir en un ensayo más fiel.**

3. **Detenerse a la primera comprobación que invalida el resto es una decisión de
   diseño, no una limitación.** Tres filas y un `FALLA` claro valen más que ocho
   filas de las que cinco mienten.

**Pendiente / siguiente paso:**

El usuario ejecuta `GRANT app_quiniela TO CURRENT_USER;` —una línea, el rol ya
existe y no hay que recrearlo— y repite la prueba de aceptación. Debe dar **8 de
8**.

Después, **la puerta de verdad**: poner `DATABASE_URL` en el `.env` con la cadena
del *pooler* y el rol `app_quiniela`, y correr `npm run pool` desde `sondeo-sql/`.
Comprueba con conexiones reutilizadas lo único que PGlite no puede: que el
contexto de una quiniela **no se cuele en la petición siguiente**. Hasta que eso
pase en verde, **no se toca ninguna ruta**.

---

### 📌 Entrada 038 — 20 de agosto de 2026 — Ocho de ocho en Neon, y el guardián que faltaba en la puerta

**Objetivo:** cerrar el paso 5 del Anexo C —conseguido— y arreglar un fallo de la
prueba del *pool* que habría dado un verde sin valor.

**Lo bueno primero: la prueba de aceptación pasa entera en Neon.**

```
1  El rol app_quiniela existe y no puede saltarse RLS       PASA  superusuario=f bypassrls=f
2  Las 12 tablas de dominio tienen RLS activo y forzado     PASA  12 de 12
3  El dueño puede asumir el rol app_quiniela                PASA
4  Sin contexto de quiniela no se ve nada                   PASA  vio 0 filas
5  Un SELECT sin filtro solo ve la quiniela del contexto    PASA  vio 1: ana_v
6  Pedir a proposito la quiniela ajena devuelve vacio       PASA  devolvio 0 filas
7  Un JOIN no cruza quinielas con jornadas del mismo nombre PASA  devolvio 1 filas
8  Escribir en una quiniela ajena lo rechaza la base        PASA  new row violates row-level
                                                                  security policy
```

La octava es la que más dice: **la inserción en una quiniela ajena la rechaza la
base, no el código**. Con el `tenantPlugin` de Mongo eso depende de que el plugin
esté puesto en el esquema y de que la consulta pase por sus enganches — y
**M-33** documenta tres por los que no pasa.

**El fallo que se encontró:**

Al correr `probar-pool.js`, el usuario conectaba como **`neondb_owner`**. El guion
lo avisaba… y seguía. ⚠️ **Eso era un fallo grave de diseño, y de la misma familia
que lleva mordiendo toda la sesión:**

> Con el rol dueño, **las ocho comprobaciones del *pool* habrían salido en
> verde igual**, porque `FORCE ROW LEVEL SECURITY` también alcanza al dueño. Verde
> y sin ningún valor: el dueño puede **apagar RLS** con un `ALTER TABLE`, y la
> aplicación no debe poder.

Y peor: **mirar `rolsuper` y `rolbypassrls` no distingue el caso**, porque el rol
dueño de Neon no es ninguna de las dos cosas. Mi comprobación del rol daba
`PASA` para `neondb_owner`. Lo que sí lo distingue es **si es dueño de las
tablas**.

**Qué se hizo:**

1. **`probar-pool.js` ahora se planta en vez de avisar**, y con tres motivos:
   si el rol es superusuario, si tiene `BYPASSRLS`, o —el que faltaba— **si es
   dueño de alguna tabla de `public`**. El mensaje explica por qué se para y trae
   escrito cómo armar la cadena correcta.
2. **También se planta si la cadena no lleva `-pooler`**, porque lo que hay que
   verificar es justo el modo transacción del *pooler*.
3. **Se cambió la recomendación a `sslmode=verify-full`.** Las versiones nuevas de
   `pg` tratan `require` como `verify-full` pero avisan de que en la próxima mayor
   pasarán a la semántica de libpq, que es **más débil**. Escribirlo explícito
   quita el aviso y fija el comportamiento seguro. Los certificados de Neon son de
   una autoridad pública y verifican sin configuración extra.
4. **Se añadieron avisos de progreso** a cada fase, para que un cuelgue se vea.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/probar-pool.js` | Aborta si el rol puede desactivar RLS o si falta el *pooler*; `verify-full`; progreso por fases |
| `avance_proyecto.md` | Esta entrada y el estado del Anexo C |

**Verificación:**

```
node sondeo-sql/probar-neon-sql.js         → 8/8 pasan
node --check sondeo-sql/probar-pool.js     → sintaxis correcta
DATABASE_URL=<sin pooler> node probar-pool.js → se planta, como debe
npm test                                   → 129/129
```

**Hallazgos nuevos:**

1. ⚠️ **`rolsuper` y `rolbypassrls` no bastan para saber si un rol es seguro para
   la aplicación.** El dueño de las tablas no es ninguna de las dos cosas y aun
   así puede **apagar RLS**. La pregunta correcta es *¿es dueño de alguna tabla?*:

   ```sql
   SELECT count(*) FROM pg_tables
    WHERE schemaname = 'public' AND tableowner = current_user;
   ```

   Tiene que dar **0** para el rol con el que se conecta la aplicación.

2. ⚠️ **Un aviso en mitad de una salida en verde no lo lee nadie.** El guion
   avisaba de que el rol estaba mal y seguía corriendo; si hubiera terminado,
   ocho `OK` habrían tapado el aviso. **Cuando una condición invalida el
   resultado, hay que abortar, no advertir.** Es la misma decisión que la
   comprobación 3 del `neon-verificar.sql`, y ahí ya había demostrado servir.

3. **`sslmode=require` ya no significa lo que parece en `pg`.** Hoy se comporta
   como `verify-full`; en la próxima versión mayor pasará a la semántica de libpq,
   más débil. Cualquier cadena de conexión del proyecto debería decir
   **`verify-full`** explícito para no cambiar de garantías con una actualización.

**Pendiente / siguiente paso:**

El usuario arma `DATABASE_URL` con el rol **`app_quiniela`** —no el dueño— y
corre `npm run pool` desde `sondeo-sql/`. Si no recuerda la contraseña de ese
rol, se le pone una nueva con `ALTER ROLE app_quiniela PASSWORD '...';`.

Es **el último paso de la puerta**. Si sale en verde, la decisión de migrar las
81 rutas se toma con datos. Hasta entonces, **no se toca ninguna ruta**.

---

### 📌 Entrada 039 — 20 de agosto de 2026 — La puerta está pasada, y un número que hay que saber leer

**Objetivo:** cerrar el sondeo SQL. La prueba del *pool* —lo único que PGlite no
podía comprobar— corrió por fin contra Neon.

**El resultado: 4 de 4.**

```
OK  El rol conectado no puede saltarse ni desactivar RLS
      usuario=app_quiniela, dueño de 0 tablas de public
OK  240 peticiones concurrentes, ninguna vio otra quiniela
      6 quinielas × 40 rondas
OK  Sin contexto no se ve nada, ni reutilizando conexiones usadas
      20 de 20 vieron 0 filas
OK  Alternando quinielas sobre el mismo pool, el contexto siempre es el suyo
      120 de 120
```

**Qué significa exactamente**, porque es la pregunta que abrió todo esto: con un
*pool* de diez conexiones, 240 peticiones concurrentes repartidas en seis
quinielas y el *pooler* de Neon en modo transacción, **el contexto de una quiniela
no se coló ni una vez en la petición de otra**. La disciplina de `SET LOCAL`
dentro de la transacción aguanta el modo real en que la aplicación usaría la
base.

**Con esto la puerta está pasada.** La decisión de migrar las 81 rutas ya se puede
tomar con datos y no con impresiones.

---

**Y ahora el número que hay que saber leer.**

La primera medición del coste salió así:

```
coste por consulta : 429.80 ms con transacción y contexto
                     116.57 ms suelta
```

⚠️ **Leído a la ligera, ese 429 mata la migración.** Leído bien, no dice nada de
PostgreSQL.

**116 ms para un `SELECT 1` no es la base: es la distancia.** Es el viaje de ida
y vuelta entre esta máquina y la región de Neon. Y el 429 es, casi exactamente,
**cuatro veces** ese viaje — porque la versión ingenua del ayudante de contexto
hacía cuatro llamadas separadas: `BEGIN`, `set_config`, la consulta y `COMMIT`.
No había 313 ms de «precio del aislamiento»: había tres viajes más.

Dos consecuencias, y ninguna es «PostgreSQL es lento»:

1. **En producción lo que cuenta es la distancia entre Render y Neon**, no entre
   esta máquina y Neon. En la misma región son entre 1 y 5 ms, no 116. Esta
   medida **no sirve** para decidir si PostgreSQL aguanta; sirve para saber que
   **desarrollar en local contra Neon va a ser lento**, y eso hay que tenerlo
   presente antes de que alguien crea que la aplicación se ha estropeado.

2. ⚠️ **La transacción va por PETICIÓN, no por consulta.** Es la consecuencia de
   diseño importante y no es obvia: todas las consultas de una petición caben en
   la misma transacción con el mismo contexto, así que el sobrecoste del
   aislamiento **se paga una vez por petición**. Con seis consultas —lo que hace
   hoy `/api/resultados-totales`— el sobrecoste se reparte entre seis en vez de
   multiplicarse por seis. Si se implementa «una transacción por consulta», el
   coste se multiplica por cuatro y **parecerá culpa de PostgreSQL**.

**Qué se hizo:**

1. **`enQuiniela` manda `BEGIN` y el contexto en UNA sola llamada**, con el
   protocolo simple. De cuatro viajes a tres. ⚠️ Ese protocolo no admite
   parámetros, así que el identificador **se valida como UUID antes de
   interpolarlo**: sin esa validación esto sería una inyección de SQL de manual.
   Queda comprobado que la validación rechaza `x'; DROP TABLE jugadores; --`.
2. **La medición se rehízo para separar la distancia del sobrecoste.** Ahora lo
   primero que imprime es el viaje pelado, y expresa lo demás en «viajes», que es
   la unidad que de verdad importa. Añade el caso real —seis consultas en una
   transacción— junto al peor caso.
3. **Avisa cuando el viaje pasa de 20 ms**, explicando que eso mide la distancia
   de la máquina y no la velocidad de la base.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `sondeo-sql/probar-pool.js` | `BEGIN` y contexto en una llamada, con validación de UUID; medición separada en viajes; aviso de latencia |
| `avance_proyecto.md` | Esta entrada, el estado del Anexo C y la cabecera |

**Verificación:**

```
npm run pool (contra Neon)         → 4/4 pasan, 240 peticiones sin un cruce
node --check probar-pool.js        → sintaxis correcta
BEGIN+contexto en una llamada      → funciona (comprobado contra PGlite)
la validación rechaza la inyección → sí
npm test                           → 129/129
```

**Hallazgos nuevos:**

1. ⚠️ **Cada `await` contra la base es un viaje.** Con la base al lado no se nota;
   con la base en otra región, un ayudante de cuatro llamadas cuesta cuatro
   viajes. **Antes de culpar a la base, hay que contar los viajes.** Aquí el
   «precio del aislamiento» de 313 ms eran tres viajes mal contados.
2. ⚠️ **La transacción se abre por petición, no por consulta.** Es la decisión de
   diseño que hay que respetar cuando se escriba la capa de datos, y la que hace
   que el aislamiento sea barato en vez de caro.
3. **Una medición sin su unidad de referencia engaña.** «429 ms» no significa
   nada sin saber que un viaje son 116. La versión nueva imprime el viaje
   **primero** y lo demás en múltiplos suyos, para que el número no se pueda leer
   mal.
4. **Desarrollar en local contra Neon será lento**, y conviene decidir qué hacer:
   o se asume, o se usa PGlite en local —que arranca en 2,9 s y no tiene red— y
   se deja Neon para el CI y producción. La segunda opción es la que conserva el
   ritmo de trabajo de estas dos semanas.

**Pendiente / siguiente paso:**

**El sondeo terminó.** Lo que queda es la decisión, que es del usuario:

- **A favor:** el aislamiento lo aplica la base y aguanta la concurrencia (esta
  entrada); cierra **C-06** gratis porque Neon se despierta solo; cierra
  **M-01**, **M-02**, **M-30** y **M-33** por obligación del modelo; las pruebas
  arrancan en 2,9 s en vez de 13,4 s.
- **En contra:** **81 rutas y ~220 llamadas** que reescribir, varias sesiones sin
  nada visible, y la Fase E parada mientras tanto.

Si se decide seguir, el primer paso ya **no** es una comprobación más: es diseñar
la capa de datos con la transacción por petición y empezar a portar rutas, con
`sondeo-sql/` como referencia del esquema.

Si se decide no seguir, se borra `sondeo-sql/`, se arregla **M-33** —que es un
agujero real del código de hoy y no depende de nada de esto— y la siguiente es la
**Fase E**.

⚠️ Y sigue sin contestar, en cualquiera de los dos escenarios: **cuál va a ser el
dominio definitivo**, que la Fase E necesita.

---

### 📌 Entrada 040 — 20 de agosto de 2026 — Migración, tajada 1: los cimientos

**Objetivo:** el usuario decidió migrar y dio el dominio definitivo
(`quinieladeportivaglobal.onrender.com`). Empezar por los cimientos de la capa de
datos, que es lo que todo lo demás va a usar.

**Las cuatro decisiones de alcance** se tomaron antes de escribir código y están
en **§21.1**. En corto: claves ajenas dentro y nombres en el API —así el frontend
no se toca—, `pg` a secas sin ORM, rama `postgres`, y `_id` pasa a `id` porque
sale gratis (aparece **4 veces en 3 archivos**).

Lo que decidió el alcance fue una medición: `jornadaNombre` aparece **80 veces**
en `server.js`, `jornada:` 42, `partidoIndex` 23 y `triviaId` 19. Unos **164
sitios** atados a la identidad por nombre. Llevar los ids hasta el API habría
tocado además los 39 scripts del frontend y las 62 pruebas de navegador;
resolverlos al entrar en la ruta consigue el grueso del beneficio por bastante
menos.

**Qué se hizo:**

1. **Rama `postgres`** a partir de `main`.
2. **`db/esquema.sql`**: el esquema del sondeo pasa a ser parte del proyecto.
3. **`src/db.js`**: el único sitio que sabe abrir una transacción y fijar el
   contexto de quiniela. Trae `iniciar`, `cerrar`, `consulta`, `enTransaccion`,
   `enQuiniela`, `quinielaActual`, `aplicarEsquema` y `comprobarRol`.
4. **`test/postgres-en-memoria.js`**: el arnés con PGlite, que releva a
   `MongoMemoryReplSet`.
5. **`test/db.test.js`**: 13 pruebas de las reglas, no de las rutas.
6. Dependencias: `pg` y `connect-pg-simple`; `@electric-sql/pglite` de desarrollo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/db.js` | **Nuevo.** La capa de datos y las tres reglas del aislamiento |
| `db/esquema.sql` | **Nuevo.** Las 16 tablas con RLS, venidas del sondeo |
| `test/postgres-en-memoria.js` | **Nuevo.** Arnés PGlite con turnos y rol sin privilegios |
| `test/db.test.js` | **Nuevo.** 13 pruebas de los cimientos |
| `package.json` | `pg`, `connect-pg-simple`, `@electric-sql/pglite`; `npm run test:db` |

**Verificación:**

```
npm run test:db → 13/13 en 2,6 s
npm test        → 142/142 (129 de Mongo + 13 nuevas), 12,5 s
```

Las 129 de Mongo siguen en verde porque **`server.js` no se ha tocado todavía**.
Eso es deliberado: la tajada 1 no migra ninguna ruta, sólo pone el suelo.

**Hallazgos nuevos:**

1. ⚠️ **El arnés de pruebas se saltaba RLS, y las pruebas lo cazaron a la
   primera.** PGlite conecta como `postgres`, que es superusuario. Las cuatro
   primeras pruebas de aislamiento fallaron enseñando `2 !== 1` y `2 !== 0`: se
   veían las dos quinielas. Es **el mismo error que costó cuatro vueltas montando
   el Anexo C** (Entradas 034 a 037) — pero esta vez costó dos minutos, porque
   había una prueba mirando. El arnés crea ahora el rol `app_quiniela` igual que
   en Neon, se pone en su piel, y **se niega a arrancar** si detecta que corre con
   privilegios de más.
2. ⚠️ **Las sesiones viven en Mongo** (`connect-mongo`), y eso no estaba en el
   plan. Apareció al mirar `package.json`. Pasan a `connect-pg-simple`, que
   necesita su propia tabla. Anotado en §21.4.
3. **`TRUNCATE` exige ser dueño de las tablas**, y `app_quiniela` no lo es a
   propósito. El vaciado entre pruebas vuelve al rol dueño el rato justo y
   regresa, **todo en una sola llamada**: si se pudiera salir a mitad, la sesión
   se quedaría con permisos de dueño y las pruebas siguientes serían falsos
   verdes.
4. **`enQuiniela` es reentrante, y hay una prueba que lo exige.** Es la regla 1
   convertida en código: anidar la misma quiniela reutiliza la transacción.
   Anidar **otra** quiniela lanza un error con nombre y apellidos, en vez de
   cruzar datos en silencio.
5. **La suite de cimientos tarda 2,6 s en total** — menos de lo que
   `MongoMemoryReplSet` tardaba sólo en levantarse (13,4 s). La promesa de la
   Entrada 032 se cumple ya en la primera tajada.

**Pendiente / siguiente paso:**

**Tajada 2 — plataforma**: `usuarios`, `quinielas`, `membresias`; registro,
login, sesiones, roles y Admin Mode. Es la primera que toca `server.js` de
verdad, y la que se lleva por delante `connect-mongo`.

---

### 📌 Entrada 041 — 20 de agosto de 2026 — Migración, tajada 2: la plataforma

**Objetivo:** portar a PostgreSQL las tres piezas de plataforma —cuentas,
quinielas y membresías— con sus reglas de negocio intactas.

**Cómo se hizo, y por qué así:**

La tajada es **aditiva**: los módulos nuevos viven al lado de lo de Mongo, y
`server.js` **no se ha tocado**. Por eso las 129 pruebas viejas siguen en verde y
`main` sigue desplegable.

⚠️ **Esto no se puede mantener hasta el final, y conviene decirlo ahora.** El
límite entre Mongo y PostgreSQL no se puede partir por la mitad: en cuanto
`quinielas` viva en PostgreSQL con identificadores UUID, las colecciones de
dominio que siguen en Mongo —con su `quinielaId` de tipo ObjectId— dejan de poder
apuntar a ellas. **Hay un momento en el que la aplicación se apaga y no vuelve
hasta que todas las tajadas estén hechas.** Ese momento es cuando `server.js`
cambie de base, y **no es esta tajada**: se retrasa todo lo posible construyendo
primero, a un lado, todo lo que se pueda probar sin Express.

**Qué se hizo:**

1. **`src/usuarios.js`** — validación del registro, normalización de identidad,
   alta, autenticación y la forma pública de un usuario.
2. **`src/quinielas.js`** — alta con su membresía de propietario en la misma
   transacción, búsqueda por código, listado por usuario y configuración.
3. **`src/membresias.js`** — solicitar ingreso, aprobar, rechazar, cambiar rol,
   solicitar retiro, aprobar retiro, expulsar y transferir la propiedad.
4. **`test/plataforma.test.js`** — 24 pruebas de esas reglas.
5. Un índice único parcial en `jugadores` que el alta al aprobar necesitaba.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/usuarios.js` | **Nuevo.** Cuentas |
| `src/quinielas.js` | **Nuevo.** Quinielas y su configuración |
| `src/membresias.js` | **Nuevo.** Pertenencia, roles y estados |
| `test/plataforma.test.js` | **Nuevo.** 24 pruebas |
| `db/esquema.sql` | Índice único parcial `jugadores (quiniela_id, usuario_id)` |
| `src/db.js` | `enQuiniela` limpia el contexto al salir de una transacción prestada |
| `package.json` | `npm run test:postgres` |

**Verificación:**

```
node --test test/plataforma.test.js → 24/24 a la primera
npm run test:postgres              → 37 pruebas en 6,5 s
npm test                           → 166/166 (129 de Mongo + 37 nuevas)
```

**Hallazgos nuevos:**

1. **Cuatro reglas del código viejo eran comprobaciones sin red debajo, y ahora
   la tienen.** El original miraba si el nombre estaba cogido y luego insertaba;
   entre las dos cosas cabe otro registro. Ahora quien decide es el índice único,
   y el error `23505` se traduce en un mensaje en vez de subir como un 500. Lo
   mismo con el código de ingreso: en vez de mirar si existe, se inserta y **se
   reintenta si choca**, que es más simple y más correcto.
2. ⚠️ **Degradar a dos administradores a la vez podía dejar la quiniela sin
   ninguno.** El código viejo contaba administradores y luego guardaba, en dos
   pasos: dos degradaciones simultáneas veían cada una «quedan dos» y pasaban.
   Ahora la cuenta y el cambio van en la misma transacción y con `FOR UPDATE`.
   No estaba en la lista de hallazgos: apareció al portar la regla.
3. **La configuración de la quiniela se funde en vez de sustituirse**
   (`configuracion || $2::jsonb`). Escribir el bloque entero desde el navegador
   borraría cualquier ajuste que el cliente no conociera. En Mongo esto lo hacía
   `$set` por campos; en `jsonb` hay que pedirlo explícitamente, y es fácil no
   darse cuenta.
4. ⚠️ **Una transacción prestada hay que devolverla como estaba.** Aprobar un
   miembro escribe en `membresias` (plataforma) y en `jugadores` (con RLS), así
   que `enQuiniela` entra prestado en la transacción de `enTransaccion`. Si al
   salir no limpiara `app.quiniela_id`, todo lo que viniera después en esa misma
   transacción seguiría filtrado por esa quiniela **sin haberlo pedido**.
5. **Las funciones devuelven un motivo, no un código HTTP.** `{ ok: false,
   motivo: 'sin_admin', mensaje: … }`. Así la regla se prueba sin Express y la
   ruta se limita a traducir. Es lo que permitió escribir 24 pruebas sin levantar
   un servidor.

**Pendiente / siguiente paso:**

**Tajada 3 — dominio básico**: `jugadores`, `jornadas`, `partidos` y `equipos`.
Sigue siendo aditiva y sigue sin tocar `server.js`.

El cambio de base de `server.js` —con las sesiones a `connect-pg-simple`— se hará
cuando las tajadas 3 a 6 hayan dejado listos los módulos de dominio, para que el
tiempo con la aplicación apagada sea el más corto posible.

---

### 📌 Entrada 042 — 20 de agosto de 2026 — Migración, tajada 3: jornadas, partidos, jugadores y equipos

**Objetivo:** portar el dominio básico. Sigue siendo aditiva: `server.js` no se
toca y las 129 pruebas de Mongo siguen verdes.

**El hallazgo que podía haber roto la Fase B sin que nadie lo notara:**

⚠️ **«La jornada actual es la última que se creó» se resolvía en Mongo con
`sort({_id: -1})`.** Un ObjectId lleva la fecha de creación dentro, así que
ordenar por él era ordenar por creación. **Un uuid es aleatorio.** Traducir esa
consulta a `ORDER BY id DESC` habría dado un orden arbitrario **sin fallar
nunca**: la ruta seguiría devolviendo una jornada, sólo que la que no es.

Y `creada_en` tampoco bastaba: `now()` es la hora de la **transacción**, así que
dos jornadas creadas en la misma quedan empatadas. La tabla lleva ahora una
columna `secuencia` (`GENERATED ALWAYS AS IDENTITY`), estrictamente creciente, y
es la que manda al ordenar.

Es el tipo de cosa que sólo se ve mirando *por qué* funcionaba lo viejo, no
traduciendo lo que decía.

**El otro cambio de fondo: M-02 deja de poder ocurrir.**

En Mongo, guardar una jornada reemplazaba el arreglo de partidos entero, y los
pronósticos —que apuntaban **por posición**— pasaban a otro partido en silencio.
Aquí cada partido tiene identidad, y `guardar` **reconcilia por posición en vez
de borrar y reinsertar**: el partido de la posición 0 conserva su `id`, así que
lo que colgaba de él sigue colgando de él. Borrar y reinsertar habría sido más
corto de escribir y se habría llevado los pronósticos por delante en cascada.

Lo mismo al eliminar partidos: los que sobreviven conservan su `id` aunque
cambien de posición. En Mongo aquello era un `splice` y los pronósticos
posteriores pasaban a apuntar al partido de al lado.

**Qué se hizo:**

1. **`src/jornadas.js`** — la jornada actual, listar, buscar por nombre, guardar
   con reconciliación, agregar partido, eliminar partidos con renumeración y
   fijar comodines.
2. **`src/jugadores.js`** — nombres que juegan (miembros de dentro + históricos
   sin cuenta), y los equipos.
3. **`test/dominio.test.js`** — 18 pruebas.
4. `db/esquema.sql`: columna `secuencia` en `jornadas` y unicidad **diferible**
   de `(jornada_id, orden)`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/jornadas.js` | **Nuevo.** Jornadas y partidos |
| `src/jugadores.js` | **Nuevo.** Jugadores y equipos |
| `test/dominio.test.js` | **Nuevo.** 18 pruebas |
| `db/esquema.sql` | `jornadas.secuencia`; `UNIQUE (jornada_id, orden) DEFERRABLE` |
| `package.json` | La suite nueva entra en `npm test` y en `test:postgres` |

**Verificación:**

```
node --test test/dominio.test.js → 18/18
npm run test:postgres           → 55 pruebas en 7,4 s
npm test                        → 184/184
```

**Hallazgos nuevos:**

1. ⚠️ **Ordenar por `id` deja de significar «por antigüedad» al pasar de ObjectId
   a uuid.** Cualquier `sort({_id: …})` que quede por portar hay que mirarlo dos
   veces: si lo que quería era orden de creación, necesita su propia columna.
2. **Renumerar posiciones exige unicidad diferible.** Al borrar el partido de la
   posición 2, los siguientes bajan una; comprobada fila a fila, la renumeración
   choca consigo misma a mitad. `DEFERRABLE` la comprueba al cerrar la
   transacción, cuando el orden ya vuelve a ser coherente.
3. **Los nombres de jugadores salen de dos sitios que no se pueden unir en un
   `JOIN`**: `membresias` es de plataforma y `jugadores` lleva RLS. Son dos
   consultas, la primera sin contexto y la segunda dentro de él. Un `JOIN`
   dejaría fuera a unos o a otros según por dónde se mirara.
4. **El propietario es jugador desde que crea la quiniela.** Una prueba nueva
   falló por esperar lo contrario, y **la equivocada era la prueba**: crear una
   quiniela deja una membresía activa, y `estado IN ('activo','pendiente_retiro')`
   la incluye. Quedó anotado en la propia prueba, porque leyendo el código parece
   que sólo entran quienes fueron aprobados.
5. **`listar` trae las jornadas con sus partidos en UNA consulta** (`json_agg`).
   En Mongo eran una por jornada. No estaba en la lista de N+1 conocidos porque
   el arreglo venía incrustado; al separarse en tablas, evitarlo era gratis.
6. **`src/validacion.js` se reutiliza tal cual.** No sabía nada de Mongoose, así
   que la migración no lo toca: es la recompensa de haberlo extraído en la Fase 6.

**Pendiente / siguiente paso:**

**Tajada 4 — puntuación**: `resultados`/`pronosticos`, `resultados_oficiales`, el
motor de puntos y el ranking materializado (`puntos_jornada`). Es la más
enredada de las que quedan, porque es donde vive la regla de congelar los puntos
de una jornada terminada.

---

### 📌 Entrada 043 — 20 de agosto de 2026 — Punto de control: dónde queda todo

**Objetivo:** dejar el documento en un estado del que se pueda retomar mañana sin
tener que reconstruir nada de cabeza. El día ha sido largo —**doce entradas, de
la 032 a ésta**— y la cabecera había envejecido a mitad de camino.

**Qué se hizo:**

Se reescribió la cabecera entera del documento, que es lo que se lee al retomar:

1. **«Lo primero, en un minuto»** ahora avisa de lo que más puede despistar:
   ⚠️ **el trabajo está en la rama `postgres`, no en `main`.** Quien abra el
   proyecto y corra `npm test` en `main` verá 129 pruebas y una aplicación sobre
   MongoDB, y pensará que no se ha hecho nada.
2. **«Dónde estamos»** separa lo que está probado y cerrado de lo que no: el
   aislamiento aguanta, las reglas están portadas, **y ninguna ruta habla todavía
   con PostgreSQL**.
3. **«Lo que se hizo el 20 de agosto»** cuenta el día en tres actos —el sondeo,
   la puerta y las tres primeras tajadas— con las cinco cosas que no se deducen
   leyendo el código.
4. **«Estado de Git»** describe **dos ramas vivas** y deja claro cuál es cuál.
5. **«Comandos habituales»** distingue lo que da cada rama, y añade cómo se
   toca la base de Neon.
6. **«Lo que queda pendiente»** se partió en dos mundos que no conviene mezclar:
   **§A la migración** y **§B lo que ya estaba pendiente antes**.

**Lo que se aclaró al escribirlo, y no estaba escrito en ningún sitio:**

- **Ocho hallazgos viejos los cierra la migración sin trabajo aparte** —C-04,
  C-06, M-01, M-02, M-25, M-30, M-33 y S-10—, y ahora hay una tabla que dice
  cuál cierra cada pieza del modelo nuevo. ⚠️ Con una advertencia: **hasta que la
  migración termine siguen todos abiertos en `main`**, y si se abandonara,
  **M-33 hay que arreglarlo aparte** porque es un agujero del código que hoy
  corre.
- **La Fase E ya no está bloqueada.** El dominio definitivo se decidió hoy
  —`quinieladeportivaglobal.onrender.com`, que además ya era el valor por defecto
  de CORS—. Le quedan dos decisiones, las dos de producto: **proveedor de correo**
  y **qué se bloquea sin verificar**.
- **La Fase E se hace DESPUÉS de la migración**, y sobre PostgreSQL. Hacerla
  ahora sería escribirla dos veces.
- **Se retiró un pendiente que dejó de aplicar**: «`Jornada` es el único esquema
  sin `timestamps`». En el modelo nuevo la tabla lleva `creada_en` y `secuencia`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `avance_proyecto.md` | Cabecera, estado de Git, comandos y la sección de pendientes, reescritos enteros. Esta entrada |

**Verificación:**

```
npm test              → 184/184
npm run test:postgres → 55, ~7 s
git status            → limpio
```

**Hallazgos nuevos:**

1. ⚠️ **Un documento de continuidad con dos ramas vivas necesita decir en cuál se
   trabaja, y decirlo lo primero.** Toda la cabecera daba por supuesto que sólo
   había una. Quien retome en `main` y corra las pruebas verá un proyecto que no
   ha avanzado.
2. **Separar «lo de la migración» de «lo de antes» hizo aparecer solapamientos
   que nadie había cruzado.** Ocho hallazgos de la lista vieja los cierra el
   modelo nuevo sin trabajo aparte; verlo puestos en una tabla cambia cómo se lee
   la lista de deuda, y evita que alguien se ponga a arreglar a mano algo que va a
   desaparecer solo.
3. **La rama se subió.** La lección de la Entrada 029 —«la documentación de
   continuidad estuvo una tarde entera existiendo sólo en un disco»— se aplica
   igual al código de una rama larga: tres tajadas de trabajo viviendo en un solo
   disco es un riesgo que no hace falta correr.

**Pendiente / siguiente paso:**

**Tajada 4 — puntuación.** Todo lo que hace falta saber para empezarla está en
§21 y en §A.1: qué entra, qué reglas hay que respetar y por qué el motor de
puntos se puede mover tal cual.

---

### 📌 Entrada 044 — 21 de agosto de 2026 — Migración, tajada 4: la puntuación

**Objetivo:** portar el motor de puntos, los pronósticos, los resultados
oficiales y el ranking materializado. Es la tajada más enredada de las que
quedaban, porque es donde vive la regla de congelar los puntos de una jornada
terminada.

**Lo que se hizo antes de escribir nada: leer POR QUÉ funcionaba lo viejo.**

Las tres preguntas de alcance se revisaron contra el código antes de decidir, y
las tres cambiaron de respuesta al mirarlas de cerca. Salieron **dos errores del
código que corre hoy en `main`** y un cabo que nadie había atado.

⚠️ **Error 1 — marcar un comodín tarde no movía los puntos.** El comodín es una
propiedad del partido, pero en Mongo se **copiaba** dentro del resultado oficial
en cada ciclo del sincronizador, y el motor lo leía de esa copia. Un partido
terminado ya no se vuelve a consultar, así que la copia se quedaba con el valor
viejo para siempre. La ruta llamaba a recalcular acto seguido y no servía de
nada: no fallaba, no avisaba, y daba un número creíble y equivocado.

⚠️ **Error 2 — M-02 no era deuda de modelo, era un fallo activo.** La ruta de
borrar partidos hace `splice` sobre el arreglo de la jornada y **nunca toca los
pronósticos de los jugadores**. Desde esa posición en adelante, cada pronóstico
pasa a puntuarse contra el partido de al lado. En silencio.

**Cabo suelto** — al reconciliar por posición, cambiar el partido de una posición
por otro distinto dejaba el pronóstico viejo pegado al partido nuevo.

**Las tres decisiones, y por qué cada una:**

| Decisión | Qué se eligió | Qué se acepta a cambio |
|---|---|---|
| **El comodín** | Vive **sólo en `partidos`**. El motor lo recibe como argumento explícito. `resultados_oficiales_partidos` no tiene dónde copiarlo | Una sola fuente de verdad, y corregir una casilla mal puesta pasa a tener efecto de verdad. A cambio, la carga manual **ignora** el comodín que venga en el cuerpo: manda la jornada, no el formulario |
| **El emparejamiento** | Por **`partido_id`**, no por posición | Cierra M-02 de raíz. La aritmética de `puntosDePartido` se mueve **intacta**, así que ningún puntaje ya emitido cambia de valor |
| **La foto congelada** | **Sustitución completa**, y sólo las cuatro reglas de puntuación | Es una fotografía, no un ajuste. Fundirla como se funde `quinielas.configuracion` dejaría sobrevivir una clave del congelado anterior dentro del siguiente |

**Y una decisión que se tomó dos veces, porque la primera estaba mal.**

Se decidió al principio que la foto congelada guardara **también los comodines**,
para que tocar una casilla en enero no reescribiera su clasificación en marzo.
Al escribir las pruebas, dos de ellas se contradijeron: una exigía que corregir
un comodín moviera los puntos, la otra que no los moviera. No podían tener razón
las dos.

Lo que zanjó la duda no fue una opinión sino el código: **cambiar
`configuracion.puntuacion` NO llama a recalcular nada** (`server.js:1330`),
mientras que **la ruta del comodín SÍ llama, sobre esa jornada concreta**
(`server.js:1617`). La intención del código original era inequívoca.

Y la diferencia de fondo es de **alcance**:

- `configuracion.puntuacion` es **global**: subir el marcador exacto de 5 a 10
  tocaría todas las jornadas jugadas de golpe, sin que nadie mirara ninguna. Eso
  es M-03 y por eso se congela.
- `partidos.comodin` es **local a una jornada**: quien lo marca está editando esa
  jornada y la tiene delante. Es una corrección, no un barrido.

Congelarlo además dejaba a un administrador que se equivocó de casilla **sin
ninguna forma de arreglarlo**, que es exactamente el error de Mongo que esta
tajada venía a cerrar. Se quitó de la foto.

**Qué se hizo:**

1. **`src/puntuacion.js`** — el motor puro: puntos por partido y por jornada,
   estadísticas de desempate, si una jornada está terminada, y el orden y los
   puestos de una clasificación.
2. **`src/pronosticos.js`** — leer y guardar pronósticos con el cierre por
   partido, y la traducción de posición a `partido_id`, que ocurre una sola vez.
3. **`src/oficiales.js`** — resultados oficiales, carga manual y el detector de
   «esto puede haber movido la tabla».
4. **`src/ranking.js`** — congelar, recalcular, descongelar, la clasificación por
   jornada y la tabla general.
5. **`test/puntuacion.test.js`** — 27 pruebas.
6. Dos retoques a la tajada 3: el filtro de expulsados en `jugadores.nombres`, y
   el cabo del `api_fixture_id` en `jornadas.guardar`.
7. **`partidoYaInicio` se mudó a `src/fechas.js`**, y `server.js` la importa en
   vez de definirla.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/puntuacion.js` | **Nuevo.** El motor, sin base de datos |
| `src/pronosticos.js` | **Nuevo.** Pronósticos y el cierre por partido |
| `src/oficiales.js` | **Nuevo.** Resultados oficiales |
| `src/ranking.js` | **Nuevo.** Congelado y las dos tablas |
| `test/puntuacion.test.js` | **Nuevo.** 27 pruebas |
| `src/fechas.js` | Recibe `partidoYaInicio`: la usan los dos mundos |
| `server.js` | Importa `partidoYaInicio` en vez de definirla. **Único cambio; ninguna ruta habla todavía con PostgreSQL** |
| `src/jornadas.js` | `guardar` borra los pronósticos de un partido que cambió de `api_fixture_id` |
| `src/jugadores.js` | `nombres` acepta `incluirExpulsados` |
| `package.json` | La suite nueva entra en `npm test` y en `test:postgres` |
| `avance_proyecto.md` | Cabecera al día (decía `99bac51`, ya iba por `f947039`). Esta entrada |

**Verificación:**

```
node --test test/puntuacion.test.js → 27/27
npm run test:postgres              → 82 pruebas en 7,7 s
npm test                           → 211/211
```

**Hallazgos nuevos:**

1. ⚠️ **El comodín tardío no movía los puntos** (error activo en `main`). La
   migración lo cierra.
2. ⚠️ **M-02 es un fallo activo, no deuda de modelo**: el `splice` de
   `server.js:1592` desalinea los pronósticos de todos los jugadores. La
   migración lo cierra.
3. **Dos pruebas que se contradicen son una decisión mal tomada, no una prueba
   mal escrita.** El primer diseño congelaba los comodines; escribir las pruebas
   lo destapó antes de que llegara a ninguna ruta. La lección no es «escribe
   pruebas» sino **dónde estaba la respuesta**: en qué rutas llamaban a
   recalcular y cuáles no, que es información que sólo existe en el código viejo.
4. **El centinela de funciones duplicadas de `architecture.test.js` cazó
   `partidoYaInicio` a la primera.** Dos copias de esa regla son dos respuestas
   distintas a «¿puedo cambiar mi pronóstico?». Se mudó a `src/fechas.js`, que ya
   era el sitio compartido por los dos mundos. **Es la primera vez que un
   guardián escrito en la Fase 6 paga solo durante la migración.**
5. **La carga manual tomaba el comodín del cuerpo de la petición**
   (`server.js:3221`): lo que el navegador devolviera. Funcionaba porque el
   cliente lee y reescribe, pero es una copia que puede desviarse. Ahora se
   ignora.
6. **`puntosPuedenHaberCambiado` pasó de heurística a comparación.** En Mongo
   tenía que emparejar por equipos, con normalización de nombres y el caso de
   local y visitante invertidos. Por `partido_id` son seis líneas y no hay nada
   que pueda equivocarse. La heurística de equipos sigue haciendo falta, pero
   sólo en la frontera con el proveedor: eso es la tajada 6.
7. **Una jornada sin partidos no se da por terminada.** Sin esa línea, una
   jornada recién creada y vacía se congelaría con todo el mundo a cero y no
   volvería a calcularse nunca.

**Pendiente / siguiente paso:**

**Tajada 5 — trivias**: `trivias`, `respuestas_trivia`, autorresolución y
reconciliación. El esquema ya trae el índice único que cierra **S-10** y el
índice de **M-25**. La tabla general ya lee la suma de `respuestas_trivia`, así
que la columna de trivias funciona desde ya.

---

### 📌 Entrada 045 — 21 de agosto de 2026 — Migración, tajada 5: las trivias

**Objetivo:** portar las ocho preguntas por partido, sus respuestas, la
reconciliación y la autorresolución. Sigue siendo aditiva: `server.js` no se
toca y ninguna ruta habla todavía con PostgreSQL.

**Lo que se decidió, y lo que se dejó para la tajada 6.**

Interpretar el JSON del proveedor —quién anotó primero, cuántas amarillas, si
hubo penales— **no entra aquí**. Es la frontera con APIFootball y es la tajada 6.
`resolverPendientes` recibe `obtenerEvento` e `interpretar` **como argumentos**,
igual que la carga manual de resultados recibe el normalizador. No es un adorno
de diseño: es lo que permite probar la resolución entera —los ocho tipos, el
reparto de puntos, los fallos parciales— **sin red y sin proveedor falso**.

**Tres cambios de comportamiento, y por qué cada uno.**

⚠️ **1. La privacidad pasa a decidirse trivia a trivia.** En Mongo era todo o
nada: hasta que la **última** trivia de la jornada cerraba, ninguna respuesta
ajena se veía. Ahora cada pregunta se abre cuando le toca, que es exactamente lo
que ya hacían los pronósticos desde la Entrada 019. Dos reglas distintas para la
misma pantalla no se sostenían.

⚠️ **2. Una trivia cerrada ya no tumba el envío entero.** Mongo devolvía 403 y
**no guardaba ninguna**: quien llegaba tarde a una sola pregunta perdía las diez.
Ahora la cerrada se salta y se cuenta, como los pronósticos.

⚠️ **3. Los dos relojes del cierre se unen, y arreglan un hueco.** Guardar una
respuesta se bloqueaba con `partidoYaInicio`, pero la privacidad se decidía con
`fechaCierre`. Con el partido ya empezado y la fecha por llegar había un hueco:
**nadie podía responder y aun así las respuestas seguían ocultas**. `estaCerrada`
los une —cerrada cuando pasó su fecha **o** empezó su partido, lo que ocurra
antes—. Nunca deja responder más tiempo que antes.

**Qué se hizo:**

1. **`src/trivias.js`** — los ocho tipos, las opciones, el cierre, crear,
   reconciliar, eliminar y resolver.
2. **`src/respuestas-trivia.js`** — guardar y leer respuestas con la privacidad
   por pregunta, y la suma que alimenta la columna «Trivias» del ranking.
3. **`test/trivias.test.js`** — 27 pruebas.
4. `db/esquema.sql`: índice único parcial `trivias (quiniela_id, partido_id, tipo)
   WHERE activa`.
5. `src/ranking.js` deja de tener su propia consulta de puntos de trivias y usa
   la del módulo.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/trivias.js` | **Nuevo.** Preguntas, reconciliación y resolución |
| `src/respuestas-trivia.js` | **Nuevo.** Respuestas y privacidad |
| `test/trivias.test.js` | **Nuevo.** 27 pruebas |
| `db/esquema.sql` | Índice único parcial que cierra la carrera de la reconciliación |
| `src/ranking.js` | La columna «Trivias» sale del módulo, no de una consulta repetida |
| `package.json` | La suite nueva entra en `npm test` y en `test:postgres` |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/trivias.test.js → 27/27
npm run test:postgres           → 109 pruebas
npm test                        → 238/238
```

**Hallazgos nuevos:**

1. ⚠️ **M-02 tenía un gemelo en las trivias, y nadie lo había anotado.** La
   trivia guardaba `partidoIndex` —un número— más una copia de los dos equipos.
   El `splice` de `server.js:1592` tampoco toca las trivias, así que borrar un
   partido dejaba las preguntas de los siguientes apuntando al partido de al
   lado. Es la misma forma y el mismo silencio. Aquí es `partido_id` con borrado
   en cascada, y hay una prueba que lo fija.
2. ⚠️ **La reconciliación tenía una carrera de libro.** Miraba si la trivia
   existía y, si no, la creaba. Entre mirar y escribir cabe otra petición, y ahí
   salían dos preguntas idénticas sobre el mismo partido, cada una con sus
   respuestas y sus puntos. El índice único parcial lo cierra: **quien decide es
   la base**, y el segundo intento actualiza en vez de duplicar. Es el mismo
   patrón que el código de ingreso de la tajada 2.
3. **Repartir los puntos de una trivia es UN `UPDATE`, no un bucle.** Mongo leía
   cada respuesta y la volvía a escribir: con cuarenta jugadores eran ochenta
   viajes a la base **por pregunta**. Un `CASE WHEN respuesta = … END` lo hace de
   una vez.
4. **Buscar el partido de una trivia deja de ser una heurística.** Mongo
   comparaba los nombres de los dos equipos en los dos órdenes posibles, porque
   la trivia llevaba una copia. Con `partido_id` no hay nada que emparejar y por
   tanto nada que se pueda emparejar mal. Es el mismo alivio que tuvo
   `puntosPuedenHaberCambiado` en la tajada 4.
5. **Los equipos ya no se copian dentro de la trivia**, se leen del partido. Es
   la misma decisión que el comodín en la Entrada 044, y por la misma razón: un
   dato copiado es un dato que se puede quedar viejo.
6. **`activa` es una columna que nadie apaga.** El código viejo la crea siempre
   en `true` y borra de verdad cuando quiere quitar una trivia. Se conserva
   porque el índice único parcial la usa, pero conviene saber que hoy no
   distingue nada.
7. **Una respuesta vacía del intérprete NO marca la trivia como resuelta.** Si lo
   hiciera, una pregunta que el proveedor todavía no puede contestar quedaría
   cerrada en cero para siempre. Se reintenta en el pase siguiente.

**Pendiente / siguiente paso:**

**Tajada 6 — sincronizador**: `fixtures`, `job_locks`, APIFootball y las
métricas. Ahí entra lo que esta tajada dejó fuera a propósito: `obtenerEvento` y
el intérprete de los ocho tipos —`resolverRespuestaTrivia` y sus ayudantes—, que
hoy siguen en `server.js`.

⚠️ Recordar que `fixtures` y `job_locks` **no llevan `quiniela_id` y es a
propósito**: son justo la parte que todas las quinielas comparten, y es lo que
cerró C-01 y C-05.

---

### 📌 Entrada 046 — 21 de agosto de 2026 — Migración, tajada 6: el sincronizador

**Objetivo:** portar la caché compartida de partidos, el cerrojo distribuido, el
ciclo de sincronización y las métricas. Es la última tajada antes del apagado.

**Lo primero que se hizo no fue portar, sino separar.**

`server.js` tenía quince funciones que **no hacen otra cosa que leer el JSON del
proveedor**: quién anotó primero, cuántas amarillas, si el minuto es un número o
`"45+"`, si un gol lo anuló el VAR. Son puras —no tocan la base, no conocen
Express, no dependen del reloj— y estaban repartidas por cuatro sitios del
archivo, a mil líneas unas de otras.

Se sacaron todas a **`src/eventos.js`**, y `server.js` las importa. Tres razones,
por orden de peso:

1. **La tajada 5 dejó un cabo colgando a propósito:** `trivias.resolverPendientes`
   recibe el intérprete como argumento, y ese intérprete tenía que vivir en algún
   sitio que no fuera `server.js`.
2. **Son la frontera con APIFootball**, y las fronteras conviene tenerlas juntas.
   El JSON del proveedor tiene rarezas que no se adivinan, y cada una está
   resuelta ahí con su comentario. Quien vaya a cambiar una debería poder verlas
   todas a la vez.
3. `server.js` pierde **388 líneas** y no gana ninguna.

⚠️ Y una separación más, dentro de la frontera: **leer la respuesta del proveedor
e ir a pedírsela son dos cosas distintas.** `src/eventos.js` sólo interpreta. Ir a
buscarla —con su plazo, su clave y su cuota— se queda en `server.js` hasta la
tajada 7. Es lo que permite que las 29 pruebas nuevas **no salgan a la red ni una
vez**.

**Qué se hizo:**

1. **`src/eventos.js`** — las quince funciones puras que leen el JSON.
2. **`src/cerrojos.js`** — el cerrojo distribuido.
3. **`src/fixtures.js`** — la caché compartida: identidad de un partido, ventanas
   de consulta, y guardar sin perder lo bueno.
4. **`src/sincronizador.js`** — el censo, el refresco, el ciclo, el vigilante, el
   limitador de concurrencia, las métricas y el volcado de la caché a una
   quiniela.
5. **`test/sincronizador.test.js`** — 29 pruebas.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/eventos.js` | **Nuevo.** La lectura del JSON del proveedor, en un solo sitio |
| `src/cerrojos.js` | **Nuevo.** El cerrojo distribuido |
| `src/fixtures.js` | **Nuevo.** La caché compartida y sus ventanas |
| `src/sincronizador.js` | **Nuevo.** El ciclo entero |
| `test/sincronizador.test.js` | **Nuevo.** 29 pruebas |
| `server.js` | **−388 líneas**: importa de `src/eventos.js` lo que antes definía. Ninguna ruta habla todavía con PostgreSQL |
| `test/architecture.test.js` | El centinela del VAR mira el conjunto, no sólo `server.js` |
| `package.json` | La suite nueva entra en `npm test` y en `test:postgres` |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/sincronizador.test.js → 29/29 a la primera
npm run test:postgres                  → 138 pruebas
npm test                               → 267/267
```

**Hallazgos nuevos:**

1. **El cerrojo pasa de «un error que no es un error» a una sentencia.** En Mongo
   había que hacer un `upsert` con filtro por caducado y **atrapar el código
   11000**, porque el choque contra el índice único *era* la respuesta «lo tiene
   otro». Funcionaba, pero para leerlo había que saber que un error concreto no
   era un error. Aquí es un `INSERT … ON CONFLICT DO UPDATE … WHERE expira_en <=
   $ahora`: si no devuelve fila, no es tuyo. Sin excepciones que interpretar.
2. ⚠️ **El centinela del VAR se rompió al mover el código, y tenía razón en
   romperse.** Buscaba `/\bvar\b/.test(info)` en `server.js`, y la función se
   había ido a `src/`. La cabecera del propio arnés ya decía la regla —las
   DEFINICIONES se buscan en todo el conjunto, los USOS en `server.js`— y este
   centinela no la seguía. **Es el segundo guardián de la Fase 6 que paga solo
   durante la migración**, después de `partidoYaInicio` en la tajada 4.
3. **`consultasAhorradasPorDeduplicacion` no existía como métrica, sólo como
   idea.** El ciclo viejo deduplicaba de verdad, pero no contaba cuánto ahorraba,
   así que la promesa de C-01 no se podía comprobar con un número. Ahora es la
   diferencia entre partidos seguidos y claves únicas, y hay una prueba que la
   fija: dos quinielas con los mismos dos partidos hacen **dos** consultas, no
   cuatro.
4. **La ventana tenía un tope que parece un detalle y no lo es**, y ahora tiene su
   propia prueba: un partido que empieza en tres horas cae en la ventana «lejano»
   de seis, así que sin el tope **se consultaría por primera vez tres horas
   después de haber empezado**. La prueba comprueba la hora exacta.
5. **Que `reescribirJornada` sea un argumento del ciclo no es abstracción por
   gusto:** el ciclo es lo único del sincronizador que entra en el contexto de una
   quiniela, y aislarlo es lo que permite probar el censo, la deduplicación y el
   cerrojo **sin escribir en ninguna quiniela**.
6. **El comodín ya no se copia al reescribir los resultados oficiales.** Era la
   fuga de la Entrada 044, y aquí es donde se copiaba. Ya no hay dónde.

**Pendiente / siguiente paso:**

**Tajada 7 — el cambio y la limpieza.** ⚠️ Es donde la aplicación se apaga y
vuelve. Entra: las 81 rutas de `server.js` pasando a los módulos de `src/`, las
sesiones (`connect-mongo` → `connect-pg-simple`, con su tabla), quitar
`mongoose`, `connect-mongo` y `mongodb-memory-server`, retirar
`src/transacciones.js` —se queda sin trabajo—, portar las 83 pruebas de
integración y las 62 de navegador, y escribir el `render.yaml`.

Lo que queda de `server.js` por mover a `src/` antes o durante: **ir a pedirle
datos al proveedor** (`buscarEventoPorId`, `buscarEventoPorFallback`,
`buscarEventosPorRango`, `obtenerEventoTrivia`) y el planificador que llama al
`tick`.

---

### 📌 Entrada 047 — 21 de agosto de 2026 — Tajada 7, pasos 1 a 3: las rutas empiezan a hablar PostgreSQL

**Objetivo:** los cimientos del servidor nuevo, las rutas de plataforma y las de
dominio. **42 de las 81 rutas** ya corren sobre PostgreSQL.

**La decisión que cambia el carácter de la tajada: un servidor NUEVO, al lado.**

Portar 81 rutas modificando `server.js` en sitio habría tumbado sus 83 pruebas de
integración con el primer grupo, y **no habrían vuelto a pasar hasta el final**:
varios días trabajando a ciegas sobre lo único que demuestra que la aplicación
funciona.

Así que las rutas nuevas viven en `src/servidor.js` y `src/rutas/`, con su propia
suite. `server.js` sigue **intacto y verde**. El apagado de verdad se reduce a una
línea de `package.json` en el paso 7.7, cuando todo esto ya esté probado.

A cambio: unos días con dos servidores en el repositorio. Es temporal y el precio
es pequeño comparado con perder la red de seguridad en la tajada más grande.

⚠️ **DÓNDE SE ABRE LA TRANSACCIÓN, que era la trampa de esta tajada.**

En `server.js` el contexto se fijaba con `tenantContext.run({ quinielaId }, next)`.
Traducirlo a `db.enQuiniela(id, next)` habría sido un error grave **y silencioso**:

> `enQuiniela` toma una conexión del pool y abre una transacción, pero `next()`
> de Express **retorna antes de que el manejador async termine**. Se haría COMMIT
> y se soltaría la conexión con la ruta todavía corriendo.

La alternativa —mantener la transacción abierta hasta que la respuesta termine—
es correcta pero retiene una conexión durante la serialización y mientras un
cliente lento lee: con el plan gratuito de Neon eso agota el pool.

**La solución: el middleware sólo resuelve `req.quiniela`, y cada ruta envuelve su
propio cuerpo en un `db.enQuiniela`.** Una transacción por petición —la regla 1 de
§21.2— y la conexión suelta antes de escribir la respuesta. Como `enQuiniela` es
reentrante, una ruta que llame a tres módulos sigue usando una sola.

**Qué se hizo:**

1. **`src/servidor.js`** — helmet, CORS, parser, sondas, sesiones sobre
   `connect-pg-simple`, limitadores, registro y login, la guardia de las páginas
   de administración, el middleware de quiniela activa, los estáticos y el
   manejador de errores.
2. **`src/rutas/plataforma.js`** — 19 rutas: elegir quiniela, unirse, Admin Mode,
   miembros, configuración, archivar y eliminar.
3. **`src/rutas/dominio.js`** — 16 rutas: jornadas, partidos, jugadores, equipos y
   la cuenta.
4. **`test/rutas.test.js`** — 46 pruebas.
5. `db/esquema.sql`: la tabla `sesiones`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/servidor.js` | **Nuevo.** La aplicación Express sobre PostgreSQL |
| `src/rutas/plataforma.js` | **Nuevo.** 19 rutas |
| `src/rutas/dominio.js` | **Nuevo.** 16 rutas |
| `test/rutas.test.js` | **Nuevo.** 46 pruebas |
| `db/esquema.sql` | Tabla `sesiones` para `connect-pg-simple` |
| `src/db.js` | `fuenteActual()`: el almacén de sesiones necesita el pool crudo |
| `test/postgres-en-memoria.js` | `sesiones` entra en el vaciado entre pruebas |
| `package.json` | `test:rutas`; la suite nueva entra en `npm test` y `test:postgres` |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/rutas.test.js → 46/46
npm run test:postgres          → 184 pruebas
npm test                       → 313/313
```

**Hallazgos nuevos:**

1. ⚠️ **`req.path` dentro de un `app.use('/api', …)` viene relativo al punto de
   montaje.** La excepción que deja desarchivar una quiniela comparaba
   `/api/quiniela-actual/archivar` contra lo que Express da ahí, que es
   `/quiniela-actual/archivar`. Nunca casaba, y **una quiniela archivada se
   quedaba archivada para siempre**. El código viejo usaba `originalUrl` y tenía
   razón. Lo cazó una prueba a la primera.
2. ⚠️ **`jsonb ||` es superficial, y eso muerde en la configuración.** Fundir
   `{puntuacion:{marcadorExacto:9}}` sobre el bloque **sustituye el objeto
   `puntuacion` entero** y se lleva los otros cinco campos. La ruta funde la
   puntuación en JavaScript antes de mandarla, y hay una prueba que lo fija. En
   Mongo esto lo hacía `$set` por campos y no se notaba.
3. **La suite nueva prueba la TRADUCCIÓN, no las reglas.** Las reglas ya tienen
   138 pruebas en los módulos; aquí se comprueba que la ruta correcta llama a la
   regla correcta con el código HTTP correcto. Es lo que mantiene la suite en 46
   pruebas en vez de en 200 repetidas.
4. **Las rutas de plataforma se parten en dos por el orden.** Las que sirven para
   elegir quiniela van ANTES del middleware que resuelve la quiniela activa:
   exigir una quiniela seleccionada para poder seleccionar quiniela dejaría a una
   cuenta nueva sin forma de entrar a ninguna parte.
5. **Una prueba fallaba sólo en sus nueve primeras cuentas.** El generador de
   credenciales daba `u1`…`u9`, de dos caracteres, y el registro exige tres. A
   partir de `u10` pasaban. Fallar sólo al principio de una suite es la peor
   forma de fallar: parece un problema de orden y no lo es.
6. **`path.basename` en las rutas de archivos.** Servir `private/js/:filename`
   sin él es un salto de directorio de manual. El código viejo tampoco lo tenía;
   la ruta nueva sí.
7. **Borrar una jornada ya no necesita transacción.** En Mongo eran cuatro
   borrados que tenían que ir juntos; aquí las claves ajenas en cascada se llevan
   pronósticos, resultados oficiales y puntos congelados. Menos código y sin
   estado intermedio posible.

**Pendiente / siguiente paso:**

**Paso 7.4 — puntuación**: `/api/resultados`, `/api/resultados-oficiales`,
`-totales`, `-seguros`, `-con-equipos` y `/api/clasificacion-jornada`. Son 10
rutas y todas apoyan en `src/ranking.js` y `src/pronosticos.js`, que ya están
probados.

Luego **7.5 trivias** (12 rutas, incluye el `_id → id` del frontend), **7.6
sincronizador y admin** (17 rutas y `src/proveedor.js`), y **7.7 el cambio**.

---

### 📌 Entrada 048 — 21 de agosto de 2026 — Tajada 7, paso 4: las rutas de puntuación

**Objetivo:** las diez rutas de pronósticos, resultados oficiales y las dos
tablas. Con éstas van **52 de las 81 rutas** sobre PostgreSQL.

**Lo que este paso puso a prueba de verdad: la regla de privacidad.**

Cuatro de estas diez rutas entregan pronósticos ajenos, y las cuatro tienen que
aplicar la misma regla —**de otro participante sólo se ve lo de los partidos que
ya empezaron**—. Esa regla ya se rompió una vez: `/api/resultados-con-equipos` se
quedó fuera del repaso de privacidad porque llamaba `jornadaAcceso` a lo que las
otras llamaban `jornadaDoc`, y la prueba que buscaba el patrón viejo no la vio.

Aquí las cuatro pasan por **una sola función** (`taparAjenos`) que se apoya en el
`bloqueado` que ya devuelve `pronosticos.deJugador`. Una regla en un solo lugar no
se puede quedar a medio cambiar.

⚠️ Y lo que no se puede ver **no es un 403**: llega con los marcadores en `null` o
en `''`, con la fila puesta. Así la pantalla muestra la jornada a medias en vez de
quedarse en blanco, que es justo lo que se quería arreglar.

**Qué se hizo:**

1. **`src/rutas/puntuacion.js`** — las diez rutas, más la caché del ranking y la
   paginación de la tabla general.
2. **`src/pronosticos.js`** — nueva función `tabla()`: todos los pronósticos de la
   quiniela en UNA consulta.
3. **`test/rutas.test.js`** — 20 pruebas nuevas (66 en total).

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/rutas/puntuacion.js` | **Nuevo.** 10 rutas, caché y paginación |
| `src/pronosticos.js` | `tabla()`: la tabla de todos contra todos, en una consulta |
| `src/servidor.js` | Engancha el grupo nuevo |
| `test/rutas.test.js` | 20 pruebas más |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/rutas.test.js → 66/66
npm run test:postgres          → 204 pruebas
npm test                       → 333/333
```

**Hallazgos nuevos:**

1. ⚠️ **`/api/resultados` escrita de la forma natural era un N+1 de libro.** La
   primera versión pedía los pronósticos de cada jugador en cada jornada: con
   veinte jugadores y cuarenta jornadas son **ochocientos viajes a la base para
   pintar una pantalla**. Se reescribió como una sola consulta con cinco `JOIN`.
   Es el mismo N+1 que la Fase 5 quitó de la tabla general, y volvió a aparecer
   en cuanto se portó la ruta sin pensarlo.
2. ⚠️ **Cargar un resultado oficial CIERRA el partido, aunque se juegue en 2099.**
   Una prueba mal planteada lo destapó: cargaba el resultado y luego intentaba
   pronosticar, esperando que se guardara. No se guarda, y es correcto —acertar
   después de saber el resultado no es acertar—. La prueba estaba mal, no el
   código, y quedó reescrita al derecho **y con una segunda que fija el
   comportamiento** para que nadie lo «arregle».
3. **La caché del ranking va por quiniela, y hay una prueba que lo fija.** Una
   caché global sería C-02 otra vez, y esta vez **en memoria, donde RLS no
   llega**: la base no puede salvarnos de un `Map` mal indexado.
4. **La paginación sólo aparece si se pide.** Sin `?pagina` ni `?limite` la
   respuesta es el objeto de siempre: hay pantallas que lo esperan entero y
   romperlas por paginar no compensa.
5. **`/api/resultados-seguros` conserva su reparto de responsabilidades.** La
   contraseña protege lo PROPIO —la pantalla se usa en el móvil de uno delante
   de los demás—; para lo ajeno no se pide nada, porque sólo se entrega lo
   visible. Ahí vivía una puerta abierta: una rama «jornada sin fecha» saltaba a
   la vez la comprobación de identidad y la de contraseña.

**Pendiente / siguiente paso:**

**Paso 7.5 — trivias**: 12 rutas, más el `_id → id` de los 3 archivos del
frontend. Los módulos `src/trivias.js` y `src/respuestas-trivia.js` ya están
probados con 27 pruebas.

Luego **7.6 sincronizador y admin** (17 rutas y `src/proveedor.js`) y **7.7 el
cambio**.

---

### 📌 Entrada 049 — 21 de agosto de 2026 — Tajada 7, paso 5: las rutas de trivias

**Objetivo:** las catorce rutas de trivias, y el `_id → id` del frontend. Con
éstas van **66 de las 81 rutas** sobre PostgreSQL.

**La decisión de este paso: de dónde sale el evento para resolver.**

⚠️ **De la caché compartida de partidos, no del proveedor.** Resolver diez
trivias del mismo partido no puede costar diez llamadas al API: el ciclo de
sincronización ya guardó el evento crudo en `fixtures.evento`, y de ahí se lee.
Es exactamente para lo que existe esa caché (C-01).

Y tiene un efecto de rebote bueno: `/api/admin/trivias/resolver` **no sale a la
red**, así que se prueba entera con un evento escrito a mano. Si el partido nunca
se sincronizó no hay evento y la trivia se queda pendiente para el pase
siguiente, en vez de resolverse en falso.

**El `_id → id`, y por qué con respaldo.**

El frontend leía `trivia._id` en 4 sitios de 3 archivos. Ahora lee
`trivia.id ?? trivia._id`, y el respaldo **no es indecisión**: mientras
`server.js` siga vivo, las MISMAS pantallas se sirven desde los dos servidores
—el viejo devuelve documentos de Mongoose con `_id`, el nuevo devuelve `id`— y
las 62 pruebas de navegador corren contra el viejo hasta el paso 7.7. Cambiarlo
del todo ahora las rompería. El respaldo se retira en el 7.7.

**Qué se hizo:**

1. **`src/rutas/trivias.js`** — las catorce rutas.
2. **`src/trivias.js`** — `abiertas()` y `ultima()`.
3. **`src/respuestas-trivia.js`** — `deJornada()`: los resultados de todos.
4. **`private/js/`** — el `_id → id` con respaldo, en 3 archivos.
5. **`test/rutas.test.js`** — 25 pruebas nuevas (91 en total).

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/rutas/trivias.js` | **Nuevo.** 14 rutas |
| `src/trivias.js` | `abiertas()`, `ultima()` |
| `src/respuestas-trivia.js` | `deJornada()` |
| `src/servidor.js` | Engancha el grupo nuevo |
| `private/js/llenar_trivia.js` | `trivia.id ?? trivia._id`, 2 sitios |
| `private/js/enviarresultadostrivias.js` | Ídem |
| `private/js/enviarresultadostriviaspartidos.js` | Ídem |
| `test/rutas.test.js` | 25 pruebas más |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/rutas.test.js → 91/91
npm run test:postgres          → 229 pruebas
npm test                       → 358/358
```

**Hallazgos nuevos:**

1. ⚠️ **`/api/trivias/activas` tenía que declararse ANTES que
   `/api/trivias/:jornadaNombre`.** Si no, Express toma «activas» por el nombre
   de una jornada y la ruta nunca se ejecuta. Igual con `/latest`. Hay una prueba
   que lo fija, porque el síntoma sería una lista vacía —no un error— y nadie lo
   miraría dos veces.
2. ⚠️ **Un `JOIN` sin su columna en el `SELECT` da un `undefined` silencioso.**
   `abiertas()` unía con `resultados_oficiales_partidos` para saber si el partido
   había empezado, pero la consulta base no seleccionaba `rop.estado`: la
   comprobación leía `undefined` y **dejaba abiertas trivias de partidos ya
   jugados**. Se detectó al releer la consulta, no al probarla, y por eso la
   consulta se escribe ahora entera en vez de apilarse sobre la base.
3. ⚠️ **`jugadores` sólo tiene fila de quien ya ha actuado.** Una prueba escribía
   respuestas con un `INSERT … SELECT … FROM jugadores WHERE nombre = …` para un
   propietario recién creado: insertaba **cero filas** y la prueba pasaba sin
   probar nada. Quedó reescrita usando sólo el API, que es como pasa de verdad.
   La lección es de las pruebas, no del código: **un `INSERT` que no inserta no
   falla**.
4. **Las trivias se comprueban en los dos extremos.**
   `triviasHabilitadas` se mira al crearlas **y** al responderlas. Apagarlas con
   preguntas ya publicadas dejaría a la gente respondiendo a algo que nadie va a
   puntuar.
5. **`/api/trivias-jornadas` y `/api/resultados-trivias` bajaron de N consultas a
   dos.** En Mongo, los resultados de una jornada pedían las respuestas de cada
   trivia por separado: con ocho preguntas eran ocho viajes. Ahora son las
   trivias con su partido, y todas las respuestas, en dos.

**Pendiente / siguiente paso:**

**Paso 7.6 — sincronizador y admin**: 15 rutas —`/api/admin/*`,
`/api/football/*`, `/api/debug/*` y `/api/sync-resultados-oficiales`— más
`src/proveedor.js`, que es lo único que queda por sacar de `server.js`: ir a
pedirle datos a APIFootball, con su plazo de espera, su clave y su cuota. Y el
planificador que llama al `tick`.

Después sólo queda **7.7, el cambio**.

---

### 📌 Entrada 050 — 21 de agosto de 2026 — Punto de control: el día entero, y qué queda

**Objetivo:** dejar el documento en un estado del que se pueda retomar sin
reconstruir nada de cabeza. El día ha sido largo —**seis entradas, de la 044 a la
049**— y la cabecera se había quedado contando sólo la mitad.

**Qué se hizo:**

Se reescribieron las cuatro secciones que se leen al retomar:

1. **«Lo primero, en un minuto»** — corregía el commit de cabeza y, sobre todo,
   una frase que había dejado de ser cierta: decía que la capa nueva «todavía no
   la usa ninguna ruta». La usan **66 de 81**. Ahora avisa de lo que más puede
   despistar: ⚠️ **en la rama hay DOS servidores a la vez, y es a propósito.**
2. **«Dónde estamos»** — «lo que NO está hecho» ya no dice «ninguna ruta»: dice
   las 15 que faltan y el paso 7.7, que es lo único irreversible.
3. **«Lo que se hizo el 21 de agosto»** — reescrita entera. Contaba tres entradas
   de las seis. Ahora cuenta el día en **dos actos** —terminar de portar las
   reglas, y las rutas—, con una tabla de qué entró en cada paso, **las tres
   decisiones de fondo**, **los cinco errores silenciosos** y seis cosas que no
   se deducen del código.
4. **«Lo siguiente»** — arrastraba texto de hace dos días que repetía §21.2 y
   hablaba de la tajada 7 como si no hubiera empezado. Ahora dice el paso 7.6,
   sus dos piezas que no son rutas, y **las cuatro reglas** que hay que respetar
   al escribir una ruta.

**Y se añadió una sección que faltaba: §A.4.**

Trabajar con un servidor nuevo al lado del viejo crea **deuda temporal a
propósito**, y no estaba escrita en ninguna parte. Son cinco cosas —dos
servidores, dos suites de rutas, el respaldo `trivia.id ?? trivia._id`, las
pruebas de navegador arrancando Mongo, y `src/transacciones.js`— y **las cinco
mueren en el paso 7.7**. Sin esa tabla, cualquiera de ellas parece un descuido.

**Lo que se aclaró al escribirlo, y no estaba escrito:**

- ⚠️ **Cuatro de los cinco errores del día están vivos en `main`; el quinto no.**
  El del `req.path` se coló al escribir el servidor nuevo y lo cazó una prueba el
  mismo día — el código viejo usaba `originalUrl` y tenía razón. La diferencia
  importa: es «hay un fallo en producción» contra «me equivoqué y lo arreglé», y
  mezclarlos hace la lista de deuda menos creíble.
- **C-04 pasó de promesa a hecho.** Decía que `server.js` «menguará de verdad por
  primera vez»; ya menguó, y en el 7.7 desaparece.
- **El `_id → id` del frontend dejó de ser pendiente.** Estaba en §A.3 como algo
  por hacer; se hizo en la Entrada 049, en 3 archivos de los 39.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `avance_proyecto.md` | Cabecera, «dónde estamos», el día 21, «lo siguiente» y el estado de Git, reescritos. **§A.4 nueva.** Precisiones en §A.2, §A.3 y §B.2. Esta entrada |

**Verificación:**

```
npm test              → 358/358
npm run test:postgres → 229
git status            → limpio
```

**Hallazgos nuevos:**

1. ⚠️ **Una frase de la cabecera llevaba dos entradas siendo falsa.** «La capa de
   datos sobre PostgreSQL todavía no la usa ninguna ruta» era cierta el 20 de
   agosto y dejó de serlo con la Entrada 047. Nadie la volvió a leer porque las
   entradas nuevas se añaden abajo y la cabecera se actualiza por campos sueltos
   —números de pruebas, commits— y no por sentido. **Al cerrar el día conviene
   leer la cabecera entera, no parchearla.**
2. **Un método de trabajo que crea deuda a propósito tiene que decirlo por
   escrito.** Dos servidores en el repositorio es una decisión razonada, pero
   quien la vea sin explicación la leerá como un trabajo a medias. §A.4 existe
   para eso, y va con la lista exacta de lo que hay que deshacer.
3. **Separar «lo de hoy» de «lo de siempre» sigue pagando.** §A es la migración y
   §B lo que ya estaba pendiente. Hoy §B **no cambió en nada**: las dos fases de
   producto y sus dos decisiones abiertas —proveedor de correo y qué se bloquea
   sin verificar— siguen exactamente donde estaban.

**Pendiente / siguiente paso:**

**Paso 7.6 — sincronizador y admin.** 15 rutas más `src/proveedor.js` y el
planificador. Después, **7.7: el cambio**, que es el único punto sin retorno.

⚠️ **Y tres cosas que no son programar y hacen falta antes de desplegar** (§B.3):
`DATABASE_URL` en Render con el rol `app_quiniela` y la cadena con `-pooler`;
comprobar que Render y Neon están en la misma región; y saber si sigue viva la
aplicación anterior apuntando a la misma base.

---

### 📌 Entrada 051 — 21 de agosto de 2026 — Tajada 7, paso 6: el sincronizador, el proveedor y las últimas rutas

**Objetivo:** las 15 rutas que faltaban, más las dos piezas que no son rutas: ir
a pedirle datos a APIFootball, y el reloj que dispara los trabajos periódicos.

## ✅ Las 81 rutas están portadas

Es el hito del paso: **`src/servidor.js` responde a todo lo que responde
`server.js`**. Se comprueba comparando las dos listas de rutas, y la diferencia
es vacía. Lo que queda es el **cambio** —paso 7.7—, que no añade
funcionalidad: apaga el viejo y enciende el nuevo.

**La separación que faltaba: pedir y leer no son lo mismo.**

`src/eventos.js` sabía **leer** la respuesta del proveedor desde la tajada 6.
Faltaba quien **va a buscarla**, y eso es `src/proveedor.js`: la URL, la clave,
el plazo de espera y las cuatro consultas.

No es una separación estética. Es lo que permite que **las 249 pruebas de
PostgreSQL no salgan a la red ni una vez**: quien interpreta se prueba con un
JSON escrito a mano, y quien pide se sustituye entero con `usarFuente()`. Las
pruebas del paso ejercitan el buscador de partidos, el de ligas con su caché, la
sincronización a mano y un ciclo completo del planificador **sin tocar
internet**.

**Qué se hizo:**

1. **`src/proveedor.js`** — el cliente, el plazo, las cuatro consultas
   (`porRango`, `porId`, `porFecha`, `ligas`), la caché de ligas disponibles y
   `usarFuente()`.
2. **`src/planificador.js`** — los dos relojes: el ciclo de sincronización y el
   barrido de trivias, con su interruptor `JOBS_HABILITADOS`.
3. **`src/rutas/admin.js`** — las 15 rutas: proveedor, sincronización a mano,
   modo admin, métricas y depuración.
4. **`server.js`** — importa el proveedor en vez de definirlo. **−140 líneas**, y
   `axios` deja de aparecer en él.
5. **`test/rutas.test.js`** — 20 pruebas nuevas (111 en total).

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/proveedor.js` | **Nuevo.** La única puerta al exterior del proyecto |
| `src/planificador.js` | **Nuevo.** Los trabajos periódicos |
| `src/rutas/admin.js` | **Nuevo.** 15 rutas |
| `src/servidor.js` | Engancha el grupo nuevo |
| `server.js` | **4.733 líneas** (eran 4.873). Importa el proveedor; ya no requiere `axios` |
| `test/architecture.test.js` | El centinela del plazo de espera mira el conjunto |
| `test/rutas.test.js` | 20 pruebas más |
| `avance_proyecto.md` | Esta entrada y el estado |

**Verificación:**

```
node --test test/rutas.test.js → 111/111
npm run test:postgres          → 249 pruebas
npm test                       → 378/378
rutas sin portar               → 0 de 81
```

**Hallazgos nuevos:**

1. ⚠️ **`obtenerEventoTrivia` y `buscarEventoPorId` eran la MISMA consulta**, con
   dos nombres y dos cuerpos: mismo `action`, mismo `match_id`, misma zona
   horaria. La única diferencia era que una escribía en el registro cuando venía
   vacía. Nadie lo había notado porque vivían a mil setecientas líneas de
   distancia. Ahora es `proveedor.porId`, una sola vez.
2. ⚠️ **Es el TERCER centinela que buscaba una definición en `server.js` cuando
   ya vivía en `src/`**, después de `partidoYaInicio` (tajada 4) y del VAR
   (tajada 6). La cabecera del arnés dice la regla —**las definiciones se buscan
   en el conjunto, los usos en `server.js`**— y tres centinelas no la seguían. No
   es que fallen: es que se escribieron cuando todo estaba en un archivo. Se
   aprovechó para añadir uno nuevo que vigila que **haya un solo `axios.create`**:
   dos clientes serían dos plazos de espera distintos.
3. **El modo admin NO aplica el cierre por partido, y eso es correcto.** Un
   administrador transcribe lo que ya recibió por otro medio, y suele hacerlo con
   la jornada empezada. Es la diferencia con `POST /api/resultados`, y por eso
   exige `requireAdmin`. Hay una prueba que lo fija para que nadie lo «arregle».
4. **`/api/debug/*` responde 404 y no 403 con la bandera apagada**, para no
   revelar siquiera que la ruta existe. Hay prueba.
5. **La sincronización a mano se salta las ventanas a propósito.** Es una
   petición explícita de quien está mirando la pantalla, no el reloj: dos
   llamadas seguidas consultan dos veces. También con prueba, porque «ahorra
   cuota» es justo el argumento con el que alguien lo cambiaría.
6. **El barrido de trivias no entra en las quinielas archivadas.** Nadie va a
   puntuar ahí y recorrerlas sólo gasta llamadas al proveedor.

**Pendiente / siguiente paso:**

**Paso 7.7 — el cambio.** ⚠️ **Es el único punto sin retorno de toda la
migración.** No añade funcionalidad: cambia cuál de los dos servidores arranca.

La lista exacta de lo que hay que deshacer está en **§A.4**, y son cinco cosas:
los dos servidores, las dos suites de rutas, el respaldo `trivia.id ?? trivia._id`,
las pruebas de navegador arrancando Mongo, y `src/transacciones.js`. Más el
`render.yaml` y sacar `mongoose`, `connect-mongo` y `mongodb-memory-server`.

⚠️ **Y las tres cosas que no son programar** (§B.3): `DATABASE_URL` en Render con
el rol `app_quiniela` y la cadena con `-pooler`; comprobar que Render y Neon
están en la misma región; y saber si sigue viva la aplicación anterior apuntando
a la misma base.

---

### 📌 Entrada 052 — 22 de agosto de 2026 — Tajada 7, paso 7: el cambio. La migración está terminada

**Objetivo:** apagar el servidor viejo y encender el nuevo. Es el único paso sin
retorno de toda la migración, y el único que **no añade funcionalidad**.

## ✅ `server.js` ya no existe

Empezó el 14 de agosto con **5.270 líneas** y catorce esquemas de Mongoose
dentro. Hoy son `arrancar.js` (90 líneas), `src/servidor.js`, cuatro módulos de
rutas y 22 módulos de dominio, cada uno con sus pruebas. Era **C-04**, y se cierra.

**Cómo se hizo sin trabajar a ciegas.**

El orden importó más que ninguna otra cosa. Se hizo lo verificable ANTES de
borrar nada:

1. **`arrancar.js`** y `npm start` apuntando al servidor nuevo.
2. **Las 62 pruebas de navegador** pasadas a PGlite y **corridas contra el
   servidor nuevo**. Ésa fue la prueba de fondo: 62/62 con la aplicación real,
   en escritorio y en móvil.
3. **Los 46 centinelas de arquitectura**, portados uno a uno.
4. **Y sólo entonces** se borró `server.js`.

Si algo hubiera estado mal, se habría sabido en el paso 2, con el viejo todavía
en pie.

**Qué se hizo:**

1. **`arrancar.js`** — abre el puerto, comprueba el rol, arranca los trabajos
   periódicos y cierra ordenadamente con `SIGTERM`.
2. **`test/e2e/arrancar.js`** — PGlite en vez de Mongo, y el proveedor falso
   pasa por `proveedor.usarFuente()`.
3. **`test/architecture.test.js`** — los 46 centinelas apuntando al código nuevo.
4. **`render.yaml`** — la configuración del servicio, versionada.
5. **`db/poner-al-dia.sql`** — el guion para dejar Neon al día.
6. **Borrados**: `server.js`, `test/integracion.test.js`, `src/transacciones.js`,
   el respaldo `?? trivia._id` del frontend, y `mongoose`, `connect-mongo` y
   `mongodb-memory-server` del `package.json`.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `server.js` | **BORRADO.** 4.733 líneas que ya no hacían falta |
| `test/integracion.test.js` | **BORRADO.** Sus 83 pruebas las releva `test/rutas.test.js` |
| `src/transacciones.js` | **BORRADO.** En PostgreSQL las transacciones son de serie |
| `arrancar.js` | **Nuevo.** El punto de entrada |
| `render.yaml` | **Nuevo.** La configuración del servicio |
| `db/poner-al-dia.sql` | **Nuevo.** Recrear el esquema en Neon, con seguro |
| `test/architecture.test.js` | Los 46 centinelas, portados |
| `test/e2e/arrancar.js` | PGlite en vez de Mongo |
| `test/e2e/resultados.spec.js` | `creadas` es un número, no una lista |
| `private/js/` (3) | Fuera el respaldo `?? trivia._id` |
| `package.json` | `main`, `start`, `check`, suites; fuera las tres dependencias de Mongo |

**Verificación:**

```
npm test              → 295/295
npm run test:e2e      →  62/62  (escritorio y móvil, contra el servidor nuevo)
node_modules/mongoose → no existe
server.js             → no existe
```

**Hallazgos nuevos:**

1. ⚠️ **La base de Neon estaba en el esquema del 20 de agosto**, no en el de hoy.
   Le faltan la tabla `sesiones`, la columna `jornadas.secuencia` y dos índices
   únicos, y le sobra una tabla del banco de pruebas. **Sin `sesiones`, la
   aplicación arranca, deja entrar a la gente y nadie sigue dentro en la petición
   siguiente** — y no hay ningún error que lo explique. Es el tipo de fallo que
   se descubre en producción a los treinta segundos.
2. **`db/poner-al-dia.sql` se planta si encuentra datos.** Recrea el esquema
   entero porque la base está vacía —comprobado: 0 usuarios, 0 quinielas— y eso
   es más simple y más fiable que ir aplicando diferencias. Pero el día que haya
   datos ese guion sería una catástrofe, así que **comprueba antes de borrar** y
   aborta con el recuento en el mensaje.
3. ⚠️ **Veintidós de los 46 centinelas se rompieron al borrar `server.js`**, y
   casi ninguno por el motivo que vigilaba: buscaban patrones de Mongoose que
   habían dejado de existir. Portarlos no fue mecánico —cada uno hubo que
   traducirlo a su equivalente en PostgreSQL— pero **la lección de cada uno
   sobrevivió**. Los que vigilaban cosas que murieron con Mongo se sustituyeron
   por el riesgo equivalente de hoy: «la URI multi-quiniela» pasó a ser «el rol
   no puede apagar RLS», y «las pruebas usan un conjunto de réplicas» pasó a ser
   «el arnés corre con los mismos permisos que producción».
4. **Un centinela contaba mal y decía la verdad.** El de privacidad esperaba
   cuatro sitios que decidieran la visibilidad y hay **tres**: `taparAjenos`
   sirve a dos rutas, y las otras dos deciden en línea porque devuelven `''` en
   vez de `null`. Se ajustó a 3 **con igualdad, no con «al menos»**: así también
   avisa si alguien añade un cuarto.
5. **La respuesta de crear trivias cambió de forma, y lo cazaron las pruebas de
   navegador.** Devolvía la lista de trivias creadas y ahora devuelve una cuenta.
   Nada del frontend usaba la lista, y la cuenta la deja igual que su ruta
   hermana. Es el único cambio de API de toda la migración que no era invisible.
6. **`npm prune` no basta para saber que Mongo se fue.** Hay un centinela que
   comprueba el `package.json` y otro que comprueba que `server.js` no vuelva:
   borrar un archivo es fácil, y resucitarlo «temporalmente» también.

**Pendiente / siguiente paso:**

⚠️ **Un paso manual antes de desplegar, y es el único que queda de la
migración**: ejecutar **`db/poner-al-dia.sql`** en el editor SQL de Neon **con
el rol dueño** —no con `app_quiniela`—, pegando dentro el contenido de
`db/esquema.sql`. El guion se planta solo si encuentra datos, y comprueba al
final que todo quedó puesto.

Después: fundir `postgres` en `main` y desplegar.

Y con la migración cerrada, lo que queda es **§B**: la Fase E (verificación de
correo, con sus dos decisiones de producto abiertas) y la Fase F (sugerencias de
partidos destacados).

---

### 📌 Entrada 053 — 22 de agosto de 2026 — Desplegado, y la base cruzó el país

**Objetivo:** desplegar en Render y comprobar que lo desplegado funciona de
verdad, no que el proceso arranca.

## ✅ La aplicación está en producción sobre PostgreSQL

`https://quinieladeportivaglobal.onrender.com` responde, habla con Neon, registra
cuentas y **mantiene la sesión entre peticiones**, que es lo que probaba la tabla
`sesiones`.

**Dos cosas fallaron, y las dos eran configuración de Render que `render.yaml` no
aplica solo.**

⚠️ **La primera tumbó el despliegue: el Start Command.** El servicio tenía
guardado `node server.js` de la versión anterior, y ese archivo se borró ayer. El
*build* pasó —`Build successful 🎉`— y el arranque murió con
`Cannot find module '/opt/render/project/src/server.js'`.

Es la misma trampa que ya estaba anotada —«Render no aplica `render.yaml` solo a
un servicio que ya existe»— pero **el aviso listaba las variables de entorno y el
*health check*, y se dejaba fuera el comando de arranque**, que es justo el que
rompe primero. El aviso era correcto y estaba incompleto, que para el caso es lo
mismo.

## ⚠️ La segunda no tumbó nada, y era peor: 47 ms por consulta

Con la aplicación ya en pie, se midió la latencia entre Render y Neon desde
fuera. Salieron **47 ms**. Debían ser 1–5.

La causa, mirando el nombre del servidor de Neon y la configuración de Render:

| | Región |
|---|---|
| Neon | `us-east-2` — Ohio |
| Render | Oregón |

**Costas opuestas.** Una ruta con cinco consultas pagaba ~235 ms sólo en viajes,
y la aplicación se habría sentido lenta **pareciendo culpa de PostgreSQL**.

**Cómo se midió, que es lo que conviene recordar.** Sin entrar a ningún panel y
sin instrumentar nada: `/healthz` no toca la base y `/readyz` hace un `SELECT 1`.
La diferencia entre las dos, **tomando el mínimo de treinta llamadas**, es el
viaje de ida y vuelta: la latencia propia hasta el servidor se cancela porque
está en las dos sondas. El mínimo y no la mediana, porque el mínimo es la medida
limpia — la mediana arrastra el ruido de la red y de los vecinos del plan
gratuito.

**El arreglo.** Ni Render ni Neon dejan cambiar la región de algo que ya existe.
Se recreó **la base**, no el servicio, por dos razones: estaba **vacía**, y
recrear el servicio habría costado el subdominio ya decidido. El usuario montó un
proyecto nuevo en Oregón siguiendo el Anexo C, con 8/8 en la prueba de
aceptación.

**Resultado: de 47 ms a 3 ms.**

Hay un detalle que lo confirma mejor que el número: la mediana de `/readyz`
(187 ms) quedó **por debajo** de la de `/healthz` (198 ms). Eso sólo puede pasar
si el viaje a la base se volvió insignificante frente al ruido; antes había 35 ms
de separación constante.

**Qué se hizo:**

1. Diagnóstico del arranque fallido y corrección del **Start Command**.
2. Medición de la latencia desde fuera, y diagnóstico de las regiones.
3. Proyecto nuevo de Neon en Oregón, esquema, rol y 8/8 (lo ejecutó el usuario).
4. `DATABASE_URL` nueva en Render y en el `.env` local.
5. Prueba de humo contra producción, y borrado de los datos de prueba.
6. **Corrección del Anexo C**, que tenía una trampa.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `avance_proyecto.md` | Anexo C corregido: el esquema y la lección de la región. Esta entrada |
| `.env` | `DATABASE_URL` apuntando a Oregón (no versionado) |

**Verificación:**

```
/readyz en producción → {"estado":"listo","base":"conectada"}
viaje Render → Neon   → ~3 ms  (eran ~47)
registro + sesión     → funciona contra la base nueva
esquema en Oregón     → 18 tablas, 12 con RLS, sesiones y secuencia puestas
```

**Hallazgos nuevos:**

1. ⛔ **El Anexo C tenía una trampa que habría recreado el problema de ayer.**
   Mandaba pegar `sondeo-sql/esquema.sql`, que el 20 de agosto era el bueno y
   para el 22 ya era el viejo: le faltan `sesiones` y `jornadas.secuencia`.
   Seguirlo al pie de la letra monta una base en la que **nadie sigue dentro en
   la petición siguiente**. Ahora dice `db/esquema.sql`, con el aviso en negrita.
   **Un procedimiento probado envejece igual que un comentario**, y éste llevaba
   dos días caducado sin que nada lo delatara.
2. ⚠️ **Un aviso incompleto engaña igual que uno equivocado.** «Render no aplica
   `render.yaml` solo» estaba escrito, y aun así el despliegue murió: la lista
   que lo acompañaba tenía las variables y el *health check*, y no el comando de
   arranque. Quien lee un aviso con lista se fía de la lista.
3. **La región se puede medir desde fuera, con dos sondas y sin permisos.** No
   hacía falta entrar al panel de Neon ni instrumentar la aplicación. Que
   `/healthz` NO toque la base —que parecía sólo una regla de higiene para que la
   sonda no se cuelgue— resultó ser lo que hace posible la medición.
4. **`app_quiniela` no pudo borrar `verif_resultados`**, la tabla que deja la
   prueba de aceptación. `must be owner of table` — y está bien que así sea: es
   la regla 3 de §21.2 funcionando. Se queda hasta que alguien la borre con el
   rol dueño; no estorba.
5. **Recrear la base salió gratis porque estaba vacía, y eso no dura.** La
   decisión de recrear la base en vez del servicio se tomó por eso y por el
   subdominio. Con datos dentro habría hecho falta un volcado y una restauración,
   y la ventana de indisponibilidad deja de ser cero.

**Pendiente / siguiente paso:**

Queda un cabo menor: **borrar el proyecto de Neon en Ohio** —ya no lo usa nadie—
y, si se quiere, la tabla `verif_resultados` de Oregón, con el rol dueño:

```sql
DROP TABLE IF EXISTS verif_resultados;
```

Y con eso, **la migración y el despliegue están cerrados**. Lo que queda del
proyecto es §B: la **Fase E** (verificación de correo), que espera dos decisiones
de producto, y la **Fase F** (sugerencias de partidos destacados).

⚠️ Lo primero que conviene vigilar con tráfico real está en §B.4, y ahora se
puede mirar de verdad: `consultasAhorradasPorDeduplicacion` en
`/api/admin/sync-metricas` debe crecer en cuanto haya dos quinielas siguiendo los
mismos partidos.

---

### 📌 Entrada 054 — 22 de agosto de 2026 — Fase E: verificación de correo

**Objetivo:** que una cuenta nueva confirme su dirección antes de poder entrar.
Es la primera de las dos fases de producto que quedaban de §20.

**De dónde salió el diseño: de GymTrack.**

El usuario preguntó si me acordaba de cómo se hizo allí. **No me acordaba** —la
memoria de este proyecto sólo guarda sus convenciones de documentación— pero el
proyecto está en esta misma máquina (`gimnasio/13_Agosto_2026/gymtrack`) y se
leyó entero antes de escribir una línea. Seis decisiones se traen tal cual, y
están explicadas abajo porque **ninguna es obvia mirando el resultado**.

**Las dos decisiones del usuario:**

| Decisión | Elegido | Por qué |
|---|---|---|
| **Proveedor** | **Brevo** | Permite verificar **una sola dirección de remitente sin poseer un dominio**. `onrender.com` no es un dominio propio donde poner registros DNS, así que Resend —que los exige— no servía |
| **Qué se bloquea** | **Sin confirmar no se entra** | Lo mismo que GymTrack: lo más simple de explicar y lo más fácil de probar |

`resend` queda **escrito por adelantado** en el mismo archivo para el día que
haya dominio propio. Migrar será cambiar tres variables.

**Lo que hace que esto sea seguro, y no se ve en el resultado:**

1. ⚠️ **Del token sólo se guarda el hash.** El valor en claro existe dentro de
   `emitir()` y del enlace del correo, y en ningún sitio más. Una filtración de
   la base **no entrega la capacidad de entrar en cuentas ajenas**. Por eso las
   columnas `token_verificacion` y `expiracion_token_verificacion` **salieron de
   `usuarios`**: guardaban el token en claro.
2. ⚠️ **La comprobación de «está confirmado» va DESPUÉS de validar la
   contraseña.** El orden es la mitad de la protección: avisar de que una cuenta
   existe pero no está confirmada **antes** de comprobar la clave revelaría qué
   correos están registrados a cualquiera que pruebe direcciones.
3. **El reenvío responde lo mismo exista o no la cuenta**, y no reenvía a una ya
   confirmada: ni da pistas ni gasta cuota.
4. **Emitir un token anula los pendientes del mismo propósito.** Si alguien pide
   el enlace tres veces, sólo el último sirve — de lo contrario un correo viejo
   reenviado seguiría abriendo la cuenta.
5. **Que el correo no salga NO tumba el registro.** La cuenta se crea igual y
   `correoEnviado` deja que la pantalla ofrezca reenviarlo: un proveedor caído no
   puede impedir que alguien se dé de alta.
6. **El nombre se escapa dentro del HTML del correo**, igual que en el DOM.

**Qué se hizo:**

1. **`db/esquema.sql`** — tabla `auth_tokens` con el hash, y fuera las dos
   columnas de token en claro de `usuarios`.
2. **`src/correo.js`** — los tres transportes, la plantilla y `intentar()`.
3. **`src/tokens.js`** — emitir, buscar utilizable y marcar usado.
4. **`src/servidor.js`** — el registro ya no abre sesión; el login bloquea; dos
   rutas nuevas.
5. **`public/verificar-correo.html`** y su script.
6. **`private/js/registro.js` y `login.js`** — la nueva secuencia.
7. **15 pruebas** de la fase, y los dos arneses adaptados.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/correo.js` | **Nuevo.** Consola, Brevo y Resend |
| `src/tokens.js` | **Nuevo.** Tokens de un solo uso, hasheados |
| `db/esquema.sql` | Tabla `auth_tokens`; fuera el token en claro de `usuarios` |
| `src/servidor.js` | Registro sin sesión, login bloqueado, `/verificar-correo` y `/reenviar-verificacion` |
| `src/usuarios.js` | `porEmail` y `marcarVerificado` |
| `public/verificar-correo.html` | **Nueva.** La pantalla del enlace |
| `private/js/verificar-correo.js` | **Nuevo** |
| `private/js/registro.js`, `login.js` | La secuencia nueva |
| `test/rutas.test.js` | `cuentaNueva` pasa por el flujo real; 15 pruebas de la fase |
| `test/e2e/ayudas.js`, `arrancar.js` | El flujo por la interfaz, y la puerta del arnés |
| `test/postgres-en-memoria.js` | `auth_tokens` y la bandeja, en el vaciado |
| `render.yaml`, `.env.example` | Las cinco variables de correo |

**Verificación:**

```
npm test         → 310/310
npm run test:e2e →  62/62
```

**Hallazgos nuevos:**

1. ⚠️ **Bloquear el login rompía las 111 pruebas de rutas y las 62 de
   navegador**, porque todas registran una cuenta y entran acto seguido. Se
   resolvió haciendo que los dos ayudantes **recorran el flujo de verdad** —alta,
   token del correo, confirmación y login— en vez de marcar la cuenta como
   verificada en la base. Cuesta dos peticiones más por cuenta y a cambio, **si
   la verificación se rompe, se cae la suite entera** en vez de un puñado de
   pruebas dedicadas.
2. ⚠️ **Las pruebas de navegador corren en OTRO proceso**, así que no pueden leer
   la bandeja del transporte de consola, y el token no está en la base. Se les
   dio una puerta —`/e2e/ultimo-correo`— **declarada en `test/e2e/arrancar.js` y
   no en `crearApp`**: en producción esa ruta no existe, no es que responda 404
   por una bandera. Era eso o dejar el token asomar en alguna respuesta.
3. **Esperar por el TEXTO de un mensaje es frágil cuando ese elemento también
   pinta los errores.** La primera versión del ayudante esperaba a que
   `#registroMensaje` dijera «correo», y la suite se colgó: cada prueba agotaba
   su plazo. La señal inequívoca es que **el formulario se retira**.
4. **La bandeja del transporte de consola vive en memoria, no en la base**, así
   que `TRUNCATE` no la vacía. Sin limpiarla entre pruebas, una prueba leería el
   último correo de la anterior **y pasaría por casualidad**.
5. **Una sola tabla para dos flujos.** `auth_tokens` tiene ya
   `restablecer_password` en su `CHECK` aunque hoy no se use: la mecánica es
   idéntica —valor aleatorio, vence, un solo uso, pertenece a alguien— y
   separarlas obligaría a escribir dos veces lo mismo.
6. ⚠️ **En producción con el transporte de consola nadie podría usar la
   aplicación**, porque nadie recibiría su enlace y sin confirmar no se entra. El
   módulo avisa fuerte al arrancar en vez de que se descubra por los usuarios.

**Pendiente / siguiente paso:**

⛔ **Antes de desplegar esto hacen falta dos cosas en Brevo y cinco variables en
Render**, y están en «Lo siguiente». Sin ellas, **la aplicación desplegada dejaría
de admitir cuentas nuevas**: se crearían, pero sin correo nadie podría entrar.

⚠️ **Y el esquema de Neon cambió**: hay que aplicar `auth_tokens` y quitar las dos
columnas viejas. La base está vacía, así que vale otra vez `db/poner-al-dia.sql`.

Después queda la **Fase F** — sugerencias de partidos destacados—, que necesita
definir las heurísticas.

---

### 📌 Entrada 055 — 22 de agosto de 2026 — Lo que salió al poner la Fase E en producción

**Objetivo:** desplegar la verificación de correo. Salieron **tres cosas**, y las
tres son del mismo tipo: **fallos que no rompen nada visible**.

## 1. ⚠️ El registro no era atómico, y dejaba a la gente atrapada

Lo destapó **el seguro de `db/poner-al-dia.sql`**. Al ir a aplicar el esquema, el
guion se negó: *«la base tiene datos (1 usuarios)»*. Ese usuario lo había dejado
una prueba de registro contra producción que falló a mitad, porque la base
todavía no tenía `auth_tokens`.

El fallo de fondo: `crear` confirmaba la cuenta y **sólo después** se emitía el
token. Si eso fallaba, la persona quedaba **atrapada**:

- no puede entrar, porque no está confirmada;
- no puede volver a registrarse, porque su nombre y su correo ya están cogidos;
- y ningún mensaje lo explica.

Ahora las dos escrituras van en una transacción. ⚠️ **El envío del correo se
queda FUERA a propósito**: es una llamada de red que puede tardar segundos, y
retener una conexión de la base mientras tanto agotaría el *pool*. Que el correo
no salga sigue sin tumbar el registro.

La prueba que lo fija rompe la emisión del token, comprueba que la cuenta no
queda creada, **y que se puede volver a registrar con los mismos datos** — ésa
es la parte que demuestra que ya no hay trampa.

## 2. El reenvío compartía contador con el registro, y la pantalla mentía

Un **429** al pedir el enlace destapó dos cosas.

La primera: el reenvío usaba **el limitador del registro**. Registrarte dos veces
y pedir el enlace tres te dejaba bloqueado sin relación aparente, y el mensaje
hablaba de *«cuentas creadas»* cuando lo que habías pedido era un correo. Ahora
tiene el suyo, con ventana de 15 minutos en vez de una hora: quien no recibe el
correo lo pide dos o tres veces seguidas y luego se va, y una hora de castigo por
eso es desproporcionado. Sigue siendo estricto porque **cada llamada manda un
correo de verdad**.

⚠️ **La segunda es peor: la pantalla no miraba el código de estado.** Pintaba el
mensaje del cuerpo o, si no venía, *«le enviamos el enlace»* — y en un 429 el
cuerpo trae `error`, no `mensaje`. Así que **decía que el correo había salido
cuando no era verdad**. Un mensaje de éxito falso es peor que un error: quien lo
lee se queda esperando algo que no va a llegar.

## 3. ⛔ Y el correo no se estaba enviando, con `correoEnviado: true`

Los registros de Render mostraban `transporte de consola, NO se envió`:
`MAIL_TRANSPORT` no estaba llegando como `brevo`. Nadie confirmaba su dirección
y —como sin confirmar no se entra— **nadie podía usar la aplicación**.

⚠️ **Lo que hizo el diagnóstico lento fue un error mío.** Al probar el registro
contra producción vi `correoEnviado: true` y **di el envío por bueno**. No lo
era: `intentar()` devuelve `true` si el envío no lanzó, y **el transporte de
consola nunca lanza** — escribe en el registro y termina bien.

El arreglo es que `/readyz` informe del transporte: `correo: { transporte,
envia }`, con un aviso explícito en producción si está en `consola`. Se ve desde
fuera, sin entrar a los registros del servidor.

No devuelve 503, y es deliberado: la aplicación **sí** puede atender tráfico
—quien ya confirmó sigue entrando— y tumbarla por esto sería peor que el
problema.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/servidor.js` | Registro atómico; `limiteReenvio` propio; `/readyz` informa del correo |
| `private/js/verificar-correo.js` | Mira el estado antes de dar el envío por bueno |
| `db/poner-al-dia.sql` | Comprueba `auth_tokens` y que el token en claro no vuelva |
| `test/rutas.test.js` | 5 pruebas |

**Verificación:**

```
npm test → 315/315
```

**Hallazgos nuevos:**

1. ⚠️ **`correoEnviado: true` NO prueba que el correo saliera.** Sólo prueba que
   la función no lanzó. Es la trampa que costó el diagnóstico, y por eso hay
   ahora una prueba que la deja escrita: lo que hay que mirar para saber si los
   correos salen es `/readyz`, no la respuesta del registro.
2. **Un seguro puesto para otra cosa encontró el fallo.** El `ABORTADO: la base
   tiene datos` de `poner-al-dia.sql` existía para no borrar datos de verdad, y
   acabó delatando un registro a medias. Los seguros que cuentan lo que ven
   valen más que los que sólo dicen «no».
3. **Una prueba se dejó engañar por su propio comentario.** La que comprueba el
   orden del `if (!respuesta.ok)` citaba el mensaje viejo dentro del comentario
   que explicaba el arreglo, y el texto aparecía antes. Es **la misma lección
   que `architecture.test.js` ya tenía aprendida** —quitar comentarios antes de
   buscar— y volvió a morder por escribir la prueba sin acordarse.
4. ⚠️ **`render.yaml` no basta, y ya van tres veces.** Primero el Start Command,
   luego el health check, ahora `MAIL_TRANSPORT`. **Render no aplica ese archivo
   a un servicio que ya existe**, y cada vez que se añade una variable hay que
   ponerla a mano.

**Pendiente / siguiente paso:**

Con esto la Fase E queda funcionando en producción. Lo siguiente fue la
recuperación de contraseña (Entrada 056).

---

### 📌 Entrada 056 — 22 de agosto de 2026 — Recuperar la contraseña

**Objetivo:** que quien olvide su contraseña pueda elegir una nueva. No estaba
en §20 —es una petición del usuario al ver funcionar el correo— pero el terreno
ya estaba preparado.

**Casi no hubo que decidir nada, y eso es la señal de que la Fase E se hizo
bien.** `auth_tokens` ya tenía `restablecer_password` en su `CHECK`,
`src/tokens.js` ya exportaba la constante, y `src/correo.js` ya tenía la
plantilla y los tres transportes. La mecánica es idéntica —un valor aleatorio,
que vence, que se usa una vez y que pertenece a alguien— y por eso se escribió
una sola tabla para los dos flujos.

**Las cuatro decisiones que sí hubo:**

1. ⚠️ **Restablecer CIERRA todas las sesiones abiertas.** Si el motivo del
   cambio fue que otra persona entró a la cuenta, **su sesión no puede
   sobrevivir**: cambiar la clave sin esto la dejaría dentro, que es justo lo
   contrario de lo que se pretendía. El identificador vive dentro del JSON de
   `express-session`, así que se busca por `sess->>'usuarioId'`.
2. ⚠️ **Restablecer confirma la dirección de paso.** Quien abrió el enlace
   demostró que controla el buzón. Sin esto, alguien que recuperara la
   contraseña sin haber confirmado nunca **seguiría sin poder entrar**, y el
   mensaje de error no le diría por qué.
3. ⚠️ **El enlace vive 1 hora, no 24.** Este enlace **abre la cuenta a quien lo
   tenga**: un correo viejo olvidado en una bandeja es una llave. Confirmar una
   dirección no tiene ese riesgo, y por eso aquél sigue durando un día.
4. **Una contraseña corta no gasta el token.** Escribir mal una vez no puede
   costar volver a pedir el enlace.

Y lo de siempre contra la enumeración: **pedir el enlace responde igual exista o
no la cuenta**, y a una dirección sin cuenta no se le manda nada — ni da pistas
ni gasta cuota.

**Qué se hizo:**

1. **`src/correo.js`** — `enviarRestablecer`, con un pie que importa: *«si no
   pediste este cambio, tu contraseña seguirá siendo la misma»*. Quien lo recibe
   sin haberlo pedido tiene que saber que no tiene que hacer nada.
2. **`src/usuarios.js`** — `cambiarPassword` y `cerrarSesiones`.
3. **`src/tokens.js`** — `HORAS_RESTABLECER`, con su propia variable de entorno.
4. **`src/servidor.js`** — `POST /api/auth/olvide-password` y
   `POST /api/auth/restablecer-password`.
5. **Dos pantallas** y el enlace desde el login, que es donde uno se acuerda de
   que la olvidó.
6. **10 pruebas de rutas y 3 de navegador.**

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/servidor.js` | Las dos rutas |
| `src/correo.js` | `enviarRestablecer` |
| `src/usuarios.js` | `cambiarPassword`, `cerrarSesiones` |
| `src/tokens.js` | `HORAS_RESTABLECER` |
| `public/olvide-password.html` | **Nueva** |
| `public/restablecer-password.html` | **Nueva** |
| `private/js/olvide-password.js` | **Nuevo** |
| `private/js/restablecer-password.js` | **Nuevo** |
| `public/login.html` | El enlace «¿Olvidaste tu contraseña?» |
| `test/rutas.test.js` | 10 pruebas |
| `test/e2e/password.spec.js` | **Nueva.** 3 pruebas por la interfaz |
| `.env.example`, `render.yaml` | `RESET_TOKEN_HOURS` |

**Verificación:**

```
npm test         → 325/325
npm run test:e2e →  68/68
```

**Hallazgos nuevos:**

1. **Los dos flujos comparten tabla, y por eso hay que filtrar por propósito.**
   Si `usable()` no lo hiciera, **el enlace de confirmar el correo —que dura 24
   horas— serviría para cambiar la contraseña de cualquiera**. Hay una prueba que
   lo intenta a propósito.
2. **La sesión se guarda como JSON en la tabla `sesiones`**, con la forma que
   impone `connect-pg-simple`. Cerrar las de alguien es un `DELETE ... WHERE
   sess->>'usuarioId' = $1`. Con `connect-mongo` esto habría sido más incómodo:
   el identificador estaba igual de enterrado, pero sin un operador de camino
   que lo sacara en la propia consulta.
3. **El token se borra de la barra de direcciones nada más leerlo.** Aquí importa
   más que en la confirmación: éste **abre la cuenta**, así que dejarlo a la
   vista invita a copiarlo o a que lo vea quien pase por detrás.
4. **Cerrar sesiones va FUERA de la transacción.** Es un borrado en otra tabla
   que no tiene que deshacerse si algo posterior fallara, y **cerrar sesiones de
   más nunca hace daño**: lo peor que pasa es que alguien vuelva a entrar.

**Pendiente / siguiente paso:**

⚠️ **Hay que redesplegar en Render** para que esté disponible. No hace falta
tocar el esquema —`auth_tokens` ya estaba— ni ninguna variable, aunque se puede
poner `RESET_TOKEN_HOURS` si se quiere otro plazo que la hora por defecto.

Y queda la **Fase F** —sugerencias de partidos destacados—, lo último de §20.

---

### 📌 Entrada 057 — 22 de agosto de 2026 — Un enlace azul, y la regla que faltaba

**Objetivo:** el usuario avisó de que «¿Olvidaste tu contraseña?» salía en azul y
no se veía bien. Un arreglo de dos líneas que resultó tener una causa más
general.

**La causa: la hoja de estilos no tenía NINGUNA regla para `<a>`.**

Cualquier enlace suelto salía con el azul por defecto del navegador, que sobre
este fondo oscuro se lee mal y desentona con todo lo demás.

No se había notado nunca porque **hasta ahora todos los enlaces vivían dentro de
`.bottom-nav` o `.action-card`**, que sí fijan su color. El primero que se puso
fuera —éste— lo destapó.

Así que en vez de pintar sólo ése, se añadió la regla general con `--primary`.
Los contenedores que ya tenían el suyo siguen ganando por especificidad, y el
próximo enlace suelto ya saldrá bien.

**Y de paso, el sitio.** Estaba pegado a «¿No tienes cuenta?», así que los dos
parecían una lista siendo cosas distintas: **recuperar la tuya** frente a **crear
una nueva**. Pasa a ir dentro del formulario, centrado bajo el botón, que es
donde se busca cuando no te acuerdas.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `private/css/styles.css` | Regla general para `a`, y `.enlace-bajo-boton` |
| `public/login.html` | El enlace entra en el formulario, bajo el botón |

**Verificación:**

```
npm test                                  → 325/325
las 14 de navegador que tocan el login    → verde
```

**Hallazgos nuevos:**

1. **Se comprobó con una captura de pantalla, no suponiéndolo.** Y valió la pena:
   el color quedó bien al primer intento, pero **la captura enseñó el problema de
   colocación**, que no era lo que se había reportado y que sólo se ve mirando.
   Un cambio de interfaz que no se mira no está comprobado.
2. **Un hueco en una hoja de estilos se esconde detrás de las convenciones del
   HTML.** No había regla para `a` desde el primer día, y el proyecto llevaba
   semanas sin enterarse porque todos los enlaces caían dentro de un contenedor
   que la suplía. **La ausencia no se nota hasta que alguien sale del camino
   trillado.**

**Pendiente / siguiente paso:**

⚠️ **Redesplegar en Render**, que arrastra también la recuperación de contraseña
de la Entrada 056. No hace falta tocar el esquema ni ninguna variable.

Y queda la **Fase F** —sugerencias de partidos destacados—, lo último de §20.

---

### 📌 Entrada 058 — 22 de agosto de 2026 — Auditar el propio documento, y lo que apareció debajo

**Objetivo:** el usuario preguntó si de verdad estaba todo documentado, tal que
abrir este archivo otro día bastara para saber dónde está el proyecto. En vez de
contestar de memoria, **se comprobó con un guion**. Menos mal.

## Lo que se midió, y lo que salió bien

Cuatro comprobaciones sobre el texto:

| Qué se comprobó | Resultado |
|---|---|
| Numeración de las entradas, de la 001 a la 057 | ✅ sin huecos |
| Las 199 referencias «Entrada NNN» apuntan a una que existe | ✅ ninguna rota |
| Los 88 commits tienen entrada | ✅ los 24 que marcó el guion eran falsos positivos: comparaba títulos, y muchas entradas titulan distinto que el commit |
| Las rutas de archivo citadas siguen existiendo | ⚠️ **aquí saltó** |

## ⛔ Lo que estaba mal: §2 prometía estar al día y era de la era Mongo

El inventario del repositorio lleva desde el 18 de agosto una nota que dice
*«este inventario sí se mantiene al día, porque es lo primero que se consulta al
retomar»*. **No se mantuvo.** Describía:

- `server.js` con 5.162 líneas — borrado hace tres entradas;
- `src/transacciones.js` — borrado;
- `test/integracion.test.js` con 73 pruebas contra MongoDB en memoria — borrado;
- 4 módulos en `src/` — hay **29**;
- `MONGO_URI_MULTIQUINIELA` como la variable obligatoria — hoy es `DATABASE_URL`;
- `connect-mongo` y `mongoose` entre las dependencias — fuera desde la 7.7.

⚠️ **Ésa es exactamente la sección que alguien lee primero al volver.** Una foto
vieja rotulada «al día» es peor que no tener foto: la de §13.1 decía «Suite
actual — 75 pruebas» y también era de la era Mongo, pero al menos §2 advertía de
que de §3 en adelante todo es el análisis original del 14 de agosto — de sí
misma, no.

Se reescribió entera contra el árbol, con las cifras **medidas, no recordadas**:
29 archivos de `src/`, 8 suites que suman 325, 12 de navegador que suman 68, 34
pantallas, 42 scripts. Y §13.1 pasa a llamarse «La suite del 17 de agosto
*(histórico)*», con un aviso que remite a §2.5.

## ⛔ Y debajo había un fallo de verdad: `.env.example` no traía `DATABASE_URL`

Al cotejar las variables que declara la plantilla contra las que el código lee
apareció que **`DATABASE_URL` no estaba en `.env.example`**. Es *la* variable
obligatoria: sin ella `arrancar.js` termina con `exit(1)`.

⚠️ Esto no es documentación: **quien siga el README —«copia `.env.example` a
`.env`»— obtiene una configuración que no arranca**, y el único rastro es un
proceso que se muere. Faltaba también `DB_MAX_CONEXIONES`.

Se añadieron las dos, con las condiciones que no son opcionales escritas al lado:
rol `app_quiniela` y nunca el dueño —el dueño se salta la RLS, que es lo único
que separa una quiniela de otra—, cadena del `-pooler` y `sslmode=verify-full`
explícito. `MONGO_URI_MULTIQUINIELA` baja al bloque del migrador, que es el
único que aún la lee.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `.env.example` | **`DATABASE_URL` y `DB_MAX_CONEXIONES`**, que faltaban; la de Mongo baja al migrador |
| `avance_proyecto.md` | §2 reescrito entero; §13.1 rotulado como histórico; §20 al día (E completada, F lo único que queda) |

**Verificación:**

```
npm test  → 325/325
numeración, referencias, commits y rutas → sin hallazgos tras el arreglo
```

**Hallazgos nuevos:**

1. ⛔ **Una sección que se declara «al día» y no lo está miente más que una sin
   fecha.** §2 llevaba la nota puesta desde el 18 y cuatro días de cambios
   encima. El resto del análisis envejeció igual, pero eso estaba **declarado**,
   así que no engaña a nadie. **El rótulo es lo que hace el daño**, no la
   antigüedad.
2. ⚠️ **Contestar de memoria habría sido contestar que sí.** La bitácora estaba
   impecable —57 entradas, sin huecos, sin referencias rotas— y esa parte era la
   que se recordaba. Lo que se había podrido era otra cosa. **La pregunta «¿está
   todo documentado?» sólo se puede responder mirando.**
3. ⚠️ **Un guion tosco con falsos positivos sirve igual, si se revisan.** Los 24
   commits «sin entrada» eran todos falsos, pero comprobarlos uno a uno costó dos
   comandos y confirmó de paso que la bitácora está completa. **Un filtro que
   sobra-marca es útil; uno que sub-marca no.**
4. **La comprobación de rutas fue la que encontró todo.** Numeración,
   referencias y commits miran el texto contra sí mismo, y por eso salieron
   limpios: un documento coherente puede estar coherentemente desfasado. **Sólo
   la que cotejó contra el árbol de verdad encontró algo.** Vale la pena
   repetirla antes de cada punto de control.

**Pendiente / siguiente paso:**

⚠️ Sigue pendiente **redesplegar en Render**, que arrastra la recuperación de
contraseña (Entrada 056) y el enlace (057). No hace falta tocar el esquema ni
ninguna variable.

Y queda la **Fase F**, con sus dos decisiones sin tomar.

---

### 📌 Entrada 059 — 23 de agosto de 2026 — Ligas favoritas de la quiniela

**Objetivo:** que quien arma una jornada no tenga que bajar hasta la «C» de Costa
Rica cada vez. El administrador marca sus torneos y salen de primeros.

La **Fase F** —sugerencias de partidos destacados— pasa al backlog por decisión
del usuario. Esto se hizo en su lugar y **no estaba en las diez peticiones**:
salió de ver el desplegable de la Fase C en uso.

## Las cuatro decisiones, tomadas antes de escribir nada

Se preguntaron primero porque cada una cambiaba el trabajo:

| Decisión | Qué se eligió |
|---|---|
| ¿De la quiniela o de cada administrador? | **De la quiniela.** Una quiniela de fútbol tico lo es mire quien mire, y sobrevive a que cambie el administrador. Entra en `configuracion`, que ya existe: **sin tabla nueva y sin migración** |
| ¿De dónde se escogen? | **De lo que juega la semana**, la misma lista que alimenta el desplegable. Marcar sobre el catálogo entero del proveedor serían cientos de torneos y un buscador aparte |
| ¿Y una favorita que esa semana no juega? | **Sale igual, en gris.** Que desaparezca sin explicación se siente como una configuración que se perdió |
| ¿Se repite abajo en su país? | **No.** Verla dos veces confunde más de lo que ayuda |

## ⛔ La trampa: la caché de ligas se comparte entre quinielas

Es lo único que tenía riesgo de verdad, y no se ve mirando la funcionalidad.

`guardarCacheLigas` tiene por clave **el rango de fechas y nada más**, a
propósito: dos quinielas que sigan los mismos días comparten la consulta al
proveedor, y ahí está el ahorro de cuota que prometía C-01.

⚠️ **Ordenar las favoritas antes de guardar habría metido las de una quiniela en
la respuesta que recibe la siguiente** —y con las ligas ya arrancadas de sus
países—. No es un fallo cosmético: es una fuga de configuración entre quinielas,
justo lo que la RLS existe para impedir en la base, colándose por una caché en
memoria que la RLS no ve.

El arreglo es de una línea de sitio: **se guarda lo que dijo el proveedor y se
aplican las favoritas al salir**, en las dos ramas de la ruta —la de caché y la
fresca—. El ahorro sigue en pie y el orden es de cada quiniela.

De ahí salen dos guardas: una prueba de ruta con dos quinielas de verdad que
comprueba que la segunda lee de caché **y no ve las favoritas de la primera**, y
un centinela en `architecture.test.js`. **El centinela se comprobó rompiendo el
código a propósito**: sin eso no se sabe si vigila algo.

Y una tercera, en la función pura: `aplicarFavoritas` **no toca lo que recibe**,
porque lo que recibe es la propia entrada de la caché. Copia y devuelve.

## Lo demás que hubo que decidir

1. **Se guarda `{ id, nombre }`, no sólo el id.** Parece redundante y no lo es:
   una favorita que esta semana no juega **no tiene de dónde sacar su rótulo**,
   porque los nombres llegan con los partidos. Sin el nombre guardado no se
   podría pintar en gris.
2. **Pero el rótulo que se muestra es el del proveedor, no el guardado.** Si
   renombraron el torneo, el nombre viejo es el desfasado. **El id identifica,
   el nombre sólo rotula** — es la lección de la Fase C, otra vez.
3. ⚠️ **En la pantalla de configuración, las ya marcadas se pintan SIEMPRE**,
   jueguen o no. Si sólo se listara lo que juega, una favorita en descanso no
   aparecería y **no habría manera de quitarla**.
4. **Hay un tope de 20, y pasarse avisa en vez de recortar en silencio.** Esto
   vive dentro de un `jsonb` que se lee entero en cada consulta de la quiniela.
   Quien marcó veinticinco tiene que enterarse de que cinco no se guardaron.
5. **Mandar la lista vacía es cómo se quitan todas**, así que se distingue «no
   vino» de «vino vacía». Y la lista **se sustituye entera**, no se funde: fundir
   listas no significa nada.

## Y un fallo que apareció de paso

`public/configuracion-quiniela.html` **abría dos documentos**: dos `<!DOCTYPE>`,
dos `<html>` y dos `<head>`. El navegador lo remienda y por eso nadie lo había
notado, pero `navegacion.js` colgaba de una cabecera que nunca se cerraba.
Corregido.

⚠️ **`miembros.html` tiene el mismo problema, con tres.** No se tocó porque no
era el asunto de hoy y no está roto a la vista. Queda anotado en §B.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/ligas.js` | `normalizarFavoritas` y `aplicarFavoritas`, ambas puras |
| `src/rutas/admin.js` | Las favoritas se aplican **después** de la caché |
| `src/rutas/plataforma.js` | `ligasFavoritas` en `PATCH /api/quiniela-actual/configuracion` |
| `private/js/jornadas.js` | El grupo «⭐ Favoritas», y las de gris sin poder elegirse |
| `public/configuracion-quiniela.html` | Panel nuevo, y el `<!DOCTYPE>` duplicado |
| `private/js/configuracion-quiniela.js` | Marcar y guardar favoritas |
| `test/dominio.test.js` | 9 pruebas puras |
| `test/rutas.test.js` | 8 de ruta |
| `test/architecture.test.js` | 1 centinela |
| `test/e2e/ligas-favoritas.spec.js` | **Nueva.** 4 por la interfaz |

**Verificación:**

```
npm test         → 343/343
npm run test:e2e →  76/76
el centinela, con el código roto a propósito → falla (comprobado)
```

**Hallazgos nuevos:**

1. ⛔ **Una caché compartida es una vía de fuga entre quinielas que la RLS no
   ve.** La seguridad por fila protege la base; no protege un `Map` en memoria.
   **Todo lo que se cachee con clave que no incluya la quiniela tiene que ser
   idéntico para todas** — y si no lo es, se personaliza al salir, nunca al
   guardar.
2. **Un centinela que no se ha visto fallar no se sabe si vigila.** Se rompió el
   código a propósito para comprobarlo. Costó dos comandos.
3. **Guardar el rótulo y no usarlo no es contradictorio.** Se guarda para el caso
   en que no hay de dónde sacarlo, y se ignora cuando sí lo hay. Escribirlo así
   en el comentario evita que alguien «limpie» una de las dos mitades.
4. **Preguntar cuatro cosas antes de escribir ahorró el trabajo.** La segunda
   respuesta —escoger de lo que juega la semana— **eliminó un buscador sobre el
   catálogo entero del proveedor**, que era la mitad del trabajo previsto.

**Pendiente / siguiente paso:**

⚠️ **Redesplegar en Render**, que arrastra esto, la recuperación de contraseña
(Entrada 056) y el enlace (057). No hace falta tocar el esquema ni ninguna
variable: `ligasFavoritas` entra en el `jsonb` que ya existía.

La **Fase F** queda en el backlog de §20.

---

### 📌 Entrada 060 — 23 de agosto de 2026 — La casilla que medía el ancho de la fila

**Objetivo:** el usuario avisó de que al escoger las ligas favoritas **costaba
saber qué casilla iba con qué nombre**: desalineadas en la computadora, y en el
celular la casilla arriba y el texto abajo. En las dos era fácil marcar la que
no era.

## La causa, y no era de las favoritas

Hay una regla global en la hoja de estilos que alcanza a **todos** los `input`:

```css
input, select, button, textarea { width: 100%; padding: 13px 14px; margin: 8px 0; }
```

Una casilla de verificación **no debe medir el ancho de la fila**. Cuando lo
mide: en el móvil ocupa la línea entera y empuja el texto abajo; en el
escritorio se estira hasta dejar el rótulo lejos de su propia casilla.

Y encima se había usado `class="field-label"`, que es `display: block` y está
pensada para el rótulo que va **encima** de un campo, no para una fila.

⚠️ **Lo interesante: el fallo no era nuevo.** Las dos casillas que ya llevaban
meses en esa pantalla —«Habilitar trivias» y «Conservar expulsados en el
ranking»— tenían exactamente el mismo problema. Eran **las dos únicas casillas
de todo el proyecto sin clase**, y se comprobó archivo por archivo. Nadie lo
había reportado porque con dos casillas sueltas se adivina cuál es cuál; con una
lista de treinta, no.

## Lo que se hizo

**No se inventó un componente: ya existía `.checkbox-card`**, que deshace la
regla global y se usa para el comodín en jornadas. Pero a una **lista larga** le
faltaban dos cosas, que son justo las que hacían marcar la equivocada:

1. **La fila entera clicable.** `.checkbox-card` lleva `width: fit-content`, así
   que el área que responde termina donde termina el texto. En una lista, una
   fila a todo el ancho es un blanco mucho mayor.
2. **La casilla alineada con la PRIMERA LÍNEA del nombre** (`flex-start`). Los
   nombres largos se parten en dos, y centrarla contra el bloque entero la
   despega de lo que rotula.

Más un fondo al pasar el cursor, para ver cuál se va a marcar **antes** de
pulsar, y `.grupo-titulo` para los países, que salían con el tamaño por defecto
del navegador.

**Se descartó poner dos columnas en pantalla grande**: cabría más lista sin
bajar, pero columnas juntas es justo lo que hace confundir la fila.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `private/css/styles.css` | `.checkbox-fila` y `.grupo-titulo` |
| `private/js/configuracion-quiniela.js` | La clase correcta, y el texto en su propio `<span>` |
| `public/configuracion-quiniela.html` | Las dos casillas de siempre, con el mismo arreglo |
| `test/architecture.test.js` | 1 centinela |

**Verificación:**

```
npm test         → 344/344
npm run test:e2e →  76/76
capturas en escritorio y móvil → miradas las dos
el centinela, con una casilla sin clase → falla (comprobado)
```

**Hallazgos nuevos:**

1. ⚠️ **Una regla global que dice `input` incluye las casillas de verificación,
   y casi nunca es lo que se quiere.** `width`, `padding` y `margin` pensados
   para una caja de texto rompen una casilla. El proyecto ya lo sabía —de ahí
   `.checkbox-card`— pero la lección vivía en una clase, no en una prueba. Ahora
   hay centinela.
2. **El fallo llevaba meses ahí y sólo se notó al crecer la lista.** Con dos
   casillas se adivina cuál es cuál; con treinta, no. **Una interfaz que se
   entiende por costumbre no está bien, está siendo tolerada** — y deja de
   tolerarse en cuanto crece.
3. **Reusar el componente que ya existía obligó a mirar por qué no servía tal
   cual.** De ahí salieron las dos diferencias reales entre una casilla suelta y
   una lista —el blanco y la alineación—, que es exactamente lo que había que
   arreglar. Inventar una clase nueva las habría escondido.
4. **Las capturas volvieron a valer la pena.** El móvil enseñó el caso que
   importaba —«Conservar expulsados en el ranking» partido en dos líneas, con la
   casilla pegada a la primera— y eso no se comprueba con una aserción.

**Pendiente / siguiente paso:**

⚠️ **Redesplegar en Render**, que ahora arrastra también esto.

Y sigue en §B.2 lo de `miembros.html`, que abre tres documentos HTML.

---

### 📌 Entrada 061 — 23 de agosto de 2026 — Cobros: quién pagó el torneo y quién las jornadas

**Objetivo:** que el administrador lleve el control de lo que paga cada quien, y
que el jugador vea su situación sin tener que preguntar. Petición del usuario, y
**lo primero del sistema que cuenta dinero**.

## Lo que se preguntó antes de escribir una línea

Cuatro cosas, y menos mal, porque **dos respuestas cambiaron el diseño entero**:

| Lo que yo había supuesto | Lo que el usuario dijo |
|---|---|
| «O torneo o jornada», un modo | ⚠️ **Los dos a la vez.** 10.000 del torneo para el premio final Y ADEMÁS algo por jornada para los premios de jornada. Son dos conceptos, no un interruptor |
| El saldo se lleva en número de jornadas | ⛔ **No se puede: el precio cambia.** «Esta jornada vale 5000 porque el premio está grande» |

Y dos que confirmaron el rumbo: **sólo informa** (deber no impide jugar), y el
precio nuevo **afecta sólo a lo que viene**.

## ⛔ Por qué el saldo tiene que ser en dinero

Si la jornada 9 vale 5.000 y la 8 valía 2.000, **«te quedan 3 jornadas» no
significa nada**: un saldo de 6.000 son tres a 2.000, o una a 5.000 y sobra.
Cuántas cubra depende de lo que valgan las que vienen, y eso **todavía no se
sabe**.

Así que el saldo se lleva en colones, y se separan dos afirmaciones que la
interfaz nunca mezcla:

- **«Jornada 8 — pagada» es EXACTO.** El precio de esa jornada ya está fijado.
- **«Te alcanza para 3 más» es una ESTIMACIÓN**, y sale siempre con el precio con
  el que se calculó: *«te alcanza para 3 jornadas más al precio de hoy
  (₡2.000)»*. Sin esa coletilla es una promesa que una final cara desmiente.

Cuando no hay precio, la función devuelve `null` y no un número: obliga a quien
pinta a no inventarse una cifra.

## La decisión que sostiene todo: el precio vive en la jornada

`jornadas` gana una columna `precio`, copiada de la configuración **al crear la
jornada**. Si el precio se leyera de `quinielas.configuracion` al calcular,
subirlo recalcularía hacia atrás lo que todos debían por las viejas — justo lo
contrario de lo pedido.

**No es un invento: el proyecto ya resolvía así este problema.**
`puntos_jornada.puntuacion` guarda las reglas con las que se congeló, para que
cambiar la puntuación en enero no reescriba la clasificación de marzo. Mismo
caso, mismo patrón.

⚠️ Y el detalle fino: `precio` entra en el `INSERT` pero **no en el `DO
UPDATE`**. Volver a guardar los partidos de una jornada vieja no la reprecifica.
Hay un centinela que lo vigila, porque ese fallo **no rompería nada**: cambiaría
la cuenta de todo el mundo hacia atrás, en silencio.

## Los abonos no se editan ni se borran

Un abono mal anotado se corrige con un **asiento inverso** que apunta al
original, y los dos quedan a la vista. El día que alguien diga *«yo sí pagué»*,
la discusión se resuelve mirando el historial, **no la palabra de quien pudo
reescribirlo**.

Un índice único sobre `anula_a` impide anular dos veces: sin él, dos pulsaciones
seguidas restarían el doble y **la cuenta quedaría mal sin que nada avisara**.

## Y las cuentas se calculan, no se guardan

No hay columna «saldo». Se suma lo abonado, se suma lo que costaron sus jornadas
y se resta. Es la misma decisión que el ranking: **si mañana se borra una jornada
o se corrige un abono, la cuenta sale bien sola.** Un contador que se va
descontando se desincroniza en cuanto algo cambia, y cuando se descubre ya nadie
sabe cuál era el número bueno.

## Tres cosas que salieron por el camino

1. **El pago cuelga de `jugadores`, no de `membresias`.** `jugadores.usuario_id`
   es nulable: hay gente sin cuenta —la que migró de la base anterior, y la que
   el administrador da de alta porque manda su quiniela por otro medio—. Colgarlo
   de las membresías dejaría fuera **justo a los que pagan en efectivo**.
2. **Quien entra en la jornada 7 no debe las seis anteriores.** Hacía falta saber
   cuándo llegó cada quien, y `jugadores` **no guardaba fecha**. Se añadió
   `cobrar_desde`, que se fija al darlo de alta porque después ya no hay forma
   de averiguarlo.
3. **No todo el mundo juega el torneo completo.** Quien entra a mitad de
   temporada juega por jornada; sin la marca `juega_torneo` aparecería como
   deudor eterno de algo que nunca quiso pagar.

## ⚠️ Y la primera migración incremental del proyecto

Hasta hoy los cambios de esquema se aplicaban recreando la base con
`db/poner-al-dia.sql`. Ese guion lleva escrito desde el 22 de agosto:

> ⛔ *SI ALGÚN DÍA HAY DATOS DE VERDAD, ESTE GUION NO SIRVE: habría que escribir
> las migraciones incrementales.*

Ese día llegó. Nace `db/migraciones/` con sus tres reglas —aditiva, idempotente,
y la misma verdad que `esquema.sql`— escritas en la cabecera de la primera.

Dentro, lo que más cuidado pedía: **`pagos` nace con RLS activada y forzada**.
Una tabla de pagos sin aislamiento sería una fuga de quién pagó cuánto en otra
quiniela, y **no fallaría**: devolvería filas de más. La prueba de `db.test.js`
que contaba tablas con RLS **detectó la nueva sola**, y se aprovechó para añadir
otra que dice **cuál** falta en vez de sólo cuántas.

Esa segunda encontró de paso que **`membresias` no tiene RLS**, y es deliberado:
`quinielas.deUsuario` la consulta **sin contexto de quiniela** para armar «mis
quinielas», y con políticas esa consulta devolvería cero filas y nadie podría
entrar a ninguna parte. Queda escrito como la única excepción, con su razón.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `db/migraciones/001-cobros.sql` | **Nueva.** La primera migración incremental |
| `db/esquema.sql` | `jornadas.precio`, dos columnas en `jugadores`, la tabla `pagos` y su RLS |
| `src/cobros.js` | **Nuevo.** La aritmética, pura |
| `src/pagos.js` | **Nuevo.** Abonos y cuentas. Ni edita ni borra |
| `src/jornadas.js` | El precio en el alta, y `cambiarPrecio` aparte |
| `src/jugadores.js` | `cobrar_desde` al dar de alta, y `deUsuario` |
| `src/membresias.js` | Lo mismo al aprobar un ingreso |
| `src/rutas/admin.js` | Cinco rutas de cobros |
| `src/rutas/plataforma.js` | Los cobros en la configuración, y `mi-cuenta` |
| `src/rutas/dominio.js` | La jornada nace con su precio |
| `src/servidor.js` | `cobros.html` entra en `PAGINAS_ADMIN` |
| `public/cobros.html`, `private/js/cobros.js` | **Nuevas.** La pantalla del administrador |
| `private/js/index-cuenta.js` | **Nueva.** «Mis pagos», en la portada |
| `public/configuracion-quiniela.html` + su JS | El panel para encender los cobros |
| `public/adminmode.html`, `public/index.html` | La tarjeta y el guion |
| `test/cobros.test.js` | **Nueva.** 19 puras |
| `test/rutas.test.js` | 15 de ruta |
| `test/db.test.js` | 1 nueva, y la del recuento al día |
| `test/architecture.test.js` | 2 centinelas |
| `test/e2e/cobros.spec.js` | **Nueva.** 4 por la interfaz |

**Verificación:**

```
npm test         → 381/381
npm run test:e2e →  84/84
capturas en escritorio y móvil → miradas las dos
los dos centinelas, con el código roto a propósito → fallan (comprobado)
```

**Hallazgos nuevos:**

1. ⛔ **Preguntar cuatro cosas antes de escribir cambió el diseño dos veces.** «Los
   dos cobros a la vez» y «el precio puede subir» tiraron abajo el modelo que yo
   tenía —un modo, y saldo contado en jornadas—. **Escribirlo primero y
   preguntar después habría costado rehacerlo entero.**
2. ⚠️ **Cuando un número es una estimación, decirlo forma parte del número.**
   «Te quedan 3» a secas es una promesa que una jornada cara desmiente. «Te
   alcanza para 3 al precio de hoy (₡2.000)» contesta lo mismo sin mentir. Y
   cuando no se puede estimar, la función devuelve `null` en vez de un cero que
   parecería una respuesta.
3. **Una prueba que cuenta debe tener al lado otra que nombre.** La del recuento
   de tablas con RLS detectó la tabla nueva, pero decía «13 ≠ 12» y nada más. La
   que se añadió dice **cuál** falta —y de paso destapó la excepción de
   `membresias`, que llevaba ahí desde siempre sin estar escrita en ningún sitio.
4. **Dos sesiones a la vez necesitan dos CONTEXTOS de navegador, no dos
   pestañas.** Las pestañas de un contexto comparten cookies, así que registrar
   al socio tumbaba la sesión de la administradora y las peticiones siguientes
   salían con la cuenta equivocada. Los ocho recorridos fallaron por eso.
5. **El patrón de la foto congelada ya estaba, y valía igual aquí.** No hubo que
   inventar cómo evitar que subir un precio reescribiera el pasado:
   `puntos_jornada.puntuacion` resolvía ese mismo problema desde la migración.
   **Buscar el precedente antes de diseñar ahorró la decisión.**

**Pendiente / siguiente paso:**

⛔ **Correr `db/migraciones/001-cobros.sql` en Neon ANTES de desplegar**, con el
rol dueño. Es la primera vez que un despliegue necesita tocar la base; los pasos
exactos están en «Lo siguiente».

Lo que **no** se hizo, y es a propósito: **nada de esto bloquea**. Deber dinero
no impide jugar ni saca del ranking. Si algún día se quiere, se añade encima.

---

### 📌 Entrada 062 — 23 de agosto de 2026 — La pantalla que parecía correcta y no lo era

**Objetivo:** el usuario contó que a veces, al entrar al Modo Administrador,
la pantalla se quedaba mostrando **el menú público** en vez del panel, y tenía
que irse a Inicio y volver a entrar. Mandó una captura.

## La captura bastaba para saberlo

`adminmode.html` tiene varias secciones y **sólo una estaba visible por defecto
en el marcado**: `guest-content`, el menú público. Las otras dos llevaban
`display: none`.

Y en el guion, la comprobación de permisos iba dentro de un `try` cuyo `catch`
**sólo escribía en la consola**:

```js
} catch (error) {
  console.error('Error al verificar permisos:', error);
}
```

Así que si cualquiera de las dos peticiones fallaba, no se llamaba a
`mostrarEstado`, no se avisaba de nada, y **quedaba puesto el estado de fábrica
del HTML**: justo el menú público de la captura.

⛔ **La pantalla no parecía rota: parecía correcta.** Un administrador veía un
menú, sin sus opciones y sin ninguna explicación. Es el mismo patrón que este
proyecto lleva encontrando toda la semana —un fallo que no falla visiblemente—,
y aquí en su forma más engañosa.

## Lo que se hizo, y por qué en ese orden

1. **Las cuatro secciones arrancan ocultas.** Es el arreglo de raíz: mientras
   una venga visible de fábrica, cualquier tropiezo la deja puesta **por
   accidente**. Ahora no se enseña nada hasta que el servidor contesta.
2. **Se reintenta una vez, a los dos segundos.** Es exactamente lo que el
   usuario hacía a mano —irse a Inicio y volver— y la causa más probable es
   pasajera. Haciéndolo el guion, no se entera nadie. **Sólo un reintento**: si
   a la segunda tampoco, insistir no lo arregla y lo que toca es decirlo.
3. **Y si aun así falla, se dice**, con un botón de reintentar.

**El diagnóstico de la CAUSA se dio como hipótesis, no como hecho**, y así se le
dijo al usuario: lo más probable es el arranque en frío de Render —el plan
gratuito duerme el servicio y la primera petición puede devolver una página de
error en HTML donde debería ir JSON, y ahí `response.json()` revienta—. La
captura prueba **el estado**; el disparador no se puede probar desde una imagen.

Por eso `pedirJson` comprueba ahora el `content-type` antes de interpretar: si
no viene JSON, el error dice *«el servidor respondió 502 sin datos, puede estar
arrancando»* en vez de un error de sintaxis que no ayuda a nadie.

## Y salir del modo administrador dejaba en la puerta

El usuario lo señaló al probarlo: **«Salir de Admin mode» dejaba el formulario
de «Confirmar acceso» en pantalla**, que es exactamente la puerta por la que
acababa de salir. Pedirle la contraseña a quien acaba de decir que ya no quiere
ser administrador es lo contrario de lo que pidió.

Ahora lleva a la portada. Y **sigue con la sesión abierta**: salir del modo
administrador no es cerrar sesión, y hay una prueba que lo fija porque son dos
botones contiguos y confundirlos sería fácil.

## Dos cosas que aparecieron por el camino

**`guest-content` era marcado inalcanzable, y lo había sido siempre.** Quien no
es administrador no llega a esa página: se le manda a `/index.html` unas líneas
antes. Lo único que mostraba ese menú era este fallo. Se deja oculto en vez de
borrarlo —son ~100 líneas y quitarlo es una decisión aparte—, pero ya no puede
salir por accidente.

⚠️ **Y el envío de la contraseña no recogía sus errores.** Si `fetch` fallaba,
la promesa quedaba rechazada sin recoger: se pulsaba el botón y **no pasaba
nada**. Un formulario que no responde parece roto. Ahora avisa.

## ⚠️ Un centinela que se dejó engañar por un comentario. Otra vez.

Al correr las pruebas, la que comprueba que toda pantalla con la etiqueta
`html` cargue `html-seguro.js` **falló acusando a `adminmode.js`**, que no la
usa. La culpa era de un comentario nuevo que menciona `\`/index.html\``: entre
comillas invertidas eso termina en `html\`` y el patrón lo daba por bueno.

⛔ **Es la MISMA trampa de la Entrada 055**, donde una prueba citó dentro de un
comentario el texto que buscaba. La lección ya estaba aprendida —hay un
`quitarComentarios` en el archivo desde hace días— pero **ese centinela no lo
usaba**. Se arregló el centinela en vez de reescribir la frase: la prosa era
legítima y el que buscaba mal era él.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `public/adminmode.html` | Las cuatro secciones ocultas, y el aviso de fallo |
| `private/js/adminmode.js` | Reescrito: `mostrarSolo`, reintento, `pedirJson` y errores recogidos |
| `test/architecture.test.js` | El centinela de `html` quita comentarios antes de buscar |
| `test/e2e/adminmode.spec.js` | **Nueva.** 5 pruebas |

**Verificación:**

```
npm test         → 381/381
npm run test:e2e →  94/94
con el comportamiento viejo puesto a propósito → 2 de las 4 nuevas fallan
```

**Hallazgos nuevos:**

1. ⛔ **Un estado por defecto es una decisión, aunque nadie la haya tomado.** El
   `display` de fábrica de `guest-content` era la respuesta de la página a
   «¿qué enseño si algo falla?», y nadie la había escrito. **Si hay un camino en
   el que no se decide nada, lo que se ve es lo que quedó puesto** — y aquí
   resultó ser lo más engañoso posible.
2. ⚠️ **`console.error` no es manejar un error, es esconderlo.** Nadie mira la
   consola. Un `catch` que sólo registra deja al usuario con lo que hubiera en
   pantalla y le hace creer que es correcto.
3. **Distinguir el estado de su disparador.** La captura probaba con certeza
   dónde quedaba la pantalla; la causa era hipótesis. Se dijo así, y el arreglo
   se hizo de forma que **funcione sea cual sea el disparador** en vez de
   apostar por uno.
4. ⚠️ **Una lección aprendida en un archivo no se aplica sola a todo el
   archivo.** `quitarComentarios` existía desde la Entrada 055 y este centinela
   seguía buscando sobre el texto crudo. **Vale la pena revisar si los demás lo
   usan**, porque la trampa ya ha mordido dos veces.

**Pendiente / siguiente paso:**

Redesplegar en Render para que llegue. **No toca la base**: la migración de los
cobros ya se corrió y se comprobó.

Y si el problema volviera a aparecer, ahora la pantalla dice qué pasó: con eso y
la consola (F12) se puede confirmar por fin cuál es el disparador.

---

### 📌 Entrada 063 — 23 de agosto de 2026 — Quitar un partido borraba los pronósticos de los demás

**Objetivo:** el usuario pidió que los partidos se ordenaran por hora de inicio
al crear la jornada, y que los añadidos después fueran al final. Al analizarlo
apareció **un fallo que ya estaba en producción y que costaba datos de la
gente**, así que se arregló primero.

## ⛔ Lo que estaba mal, y no avisaba

`guardar` emparejaba lo guardado con lo que llega **por posición**. La pantalla
de jornadas, al quitar un partido, no llama a `eliminarPartidos` —que renumera
bien—: lo saca de su lista en el navegador y **vuelve a guardar la jornada
entera** más corta.

Con `[A, B, C, D]` guardados, quitar B mandaba `[A, C, D]`:

| Posición | Tenía | Recibe | Qué pasaba |
|---|---|---|---|
| 0 | A | A | igual |
| 1 | B | C | fixture distinto → **borraba los pronósticos** |
| 2 | C | D | fixture distinto → **borraba los pronósticos** |
| 3 | D | — | fila eliminada |

**Se perdían los pronósticos de todos los partidos posteriores al que se quitó.**
No se corrompían —ninguno acababa apuntando al partido equivocado— pero
desaparecían.

⚠️ Y lo peor: `guardar` **contaba** los borrados y devolvía `pronosticosBorrados`
… y **la ruta tiraba ese número sin mirarlo**. El dato existía, estaba bien
calculado, y nadie lo veía.

## El arreglo: emparejar por identidad, no por posición

Desde la Fase D los partidos salen sólo del API, así que **todos traen
`api_fixture_id`**. Ésa es la señal fiable de si dos partidos son el mismo.

Ahora `guardar` empareja por ese identificador: C y D se reconocen, conservan su
fila, su `id` y sus pronósticos, y sólo desaparece B —el que de verdad se
quitó—. La red de seguridad sigue en pie: sustituir un partido por otro **sí**
se lleva lo que se pronosticó del viejo, porque ya no vale.

⚠️ **El camino por posición se conserva** para los partidos sin identificador,
que son los históricos de la migración. Ahí no hay forma de saber si es el
mismo, y adivinar podría dejar un pronóstico colgando del equivocado —**que es
peor que perderlo**—.

Y la ruta ya no tira el contador: si al guardar se retiró algún partido, la
pantalla lo dice. *«Se retiraron 1 partido(s) y con ellos se borraron 3
pronóstico(s)»*. Borrarlos puede ser correcto; callarlo no.

## Y entonces sí, el orden por hora

Una función pura, `ordenarParaGuardar(partidos, guardados)`:

- los que **ya estaban guardados conservan su orden exacto**, al principio;
- los **nuevos se ordenan entre sí** por hora de inicio y van al final;
- sin hora, al final de los nuevos.

Al crear una jornada no hay guardados, así que **se ordena todo** — que es lo
que se pedía. **Un solo camino cubre los dos casos**, y la seguridad sale de la
forma de la salida: como los guardados no se mueven de sitio, no hay reordenado
que pueda tocar una jornada que ya tiene pronósticos.

⚠️ **Se aplica en la ruta, nunca dentro de `guardar`.** Si viviera dentro,
cada guardado reordenaría también las jornadas viejas —el caso que el usuario
descartó a propósito, porque mueve de sitio partidos que la gente ya rellenó—.

**El desempate no es un adorno.** Dos partidos a la misma hora sin criterio fijo
saldrían en orden distinto en cada guardado —`sort` no promete estabilidad entre
listas diferentes— y la jornada bailaría sola. Se rompe por liga y luego equipo
local: arbitrario, pero siempre el mismo. Y la hora se lee con
`parseFechaPartidoCostaRica`, que ya existía y ya sabe que Costa Rica es UTC−6
todo el año.

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/jornadas.js` | Reconciliación por identidad, y `ordenarParaGuardar` |
| `src/rutas/dominio.js` | Ordena antes de guardar, e informa de lo borrado |
| `private/js/jornadas.js` | Avisa cuando se pierden pronósticos |
| `test/puntuacion.test.js` | 4 pruebas de la identidad del partido |
| `test/dominio.test.js` | 7 puras del orden |
| `test/rutas.test.js` | 3 de ruta |

**Verificación:**

```
npm test         → 395/395
npm run test:e2e →  94/94
forzando el camino por posición → fallan las 2 del borrado
desactivando el orden          → falla la de crear ordenado
```

**Hallazgos nuevos:**

1. ⛔ **La función segura existía y la pantalla no la usaba.** `eliminarPartidos`
   renumera bien desde la migración, y resultó que **sólo la llamaban las
   pruebas**. Tener el código correcto no sirve de nada si el camino que la
   gente recorre pasa por otro sitio. **Vale la pena comprobar de vez en cuando
   qué funciones sólo usan los tests.**
2. ⛔ **Un número bien calculado y tirado es peor que no calcularlo.** `guardar`
   sabía exactamente cuántos pronósticos borraba. La ruta descartaba su valor de
   retorno, así que el dato existía y no llegaba a nadie. Es la versión más
   silenciosa de la pérdida de datos: no hay error, no hay aviso, y hay una
   variable con la respuesta.
3. ⚠️ **Una prueba mía pasó por la razón equivocada.** `deJugador` devuelve una
   fila POR PARTIDO, con marcador nulo donde no hay pronóstico; contar sus filas
   cuenta partidos. La aserción daba el número correcto midiendo otra cosa. Se
   corrigió filtrando por `marcador1 !== null`. **Un número que cuadra no prueba
   que se esté midiendo lo que se cree.**
4. **La decisión del usuario eliminó el riesgo, no lo mitigó.** Pedir que los
   nuevos vayan al final —en vez de reordenar todo— dejó fuera el único caso
   peligroso. **Una restricción del usuario puede valer más que una salvaguarda
   del programador**, porque no hay nada que se pueda saltar.

**Pendiente / siguiente paso:**

Redesplegar en Render. **No toca la base.**

⚠️ Y queda una cosa que no se hizo y conviene tener presente: la pantalla sigue
quitando partidos por el camino de guardar la jornada entera, en vez de usar
`eliminarPartidos`. Ahora es **seguro** —por eso no urge— pero es un rodeo, y
`eliminarPartidos` sigue sin usarse fuera de las pruebas.

---

### 📌 Entrada 064 — 23 de agosto de 2026 — Auditoría de seguridad: tres agujeros y lo que sí estaba bien

**Objetivo:** el usuario preguntó si había alguna vulnerabilidad que tener en
cuenta, ahora que el sistema maneja dinero. Se auditó **con sondas ejecutables**,
no leyendo el código: cada sospecha se comprobó lanzando la petición y mirando
qué respondía.

## 1. ⛔ Cualquier miembro podía gastar la cuota del proveedor

`/api/football/fixtures` **no llevaba `requireAdmin`**. Su ruta hermana,
`ligas-disponibles`, sí. Comprobado con una sonda: un miembro normal recibía
**200** de la primera y **403** de la segunda.

⚠️ **La cuota de APIFootball es UNA SOLA para todas las quinielas.** Cualquiera
con cuenta en cualquier quiniela podía pedir rangos de fechas en bucle y dejar
al resto sin poder armar jornadas. No es fuga de datos —y por eso se coló— pero
sí **impacto entre quinielas**, que es justo lo que la RLS existe para impedir en
la base y aquí se escapaba por otro sitio.

Se puso la guardia en las tres rutas de `/api/football/*`, y un centinela que
recorre el archivo y **exige que todas la lleven**. Se comprobó quitándosela a
una a propósito.

## 2. ⛔ Cambiar la contraseña no echaba a quien ya estuviera dentro

Comprobado con dos sesiones abiertas: se cambió la contraseña desde una y **la
otra siguió respondiendo 200**. La contraseña vieja sí dejaba de servir, pero la
sesión que ya estaba abierta sobrevivía.

Lo llamativo es que **el proyecto ya sabía que eso está mal**: restablecer la
contraseña sí cierra todas las sesiones, y la Entrada 056 escribió por qué —*«si
el motivo del cambio fue que otra persona entró a la cuenta, su sesión no puede
sobrevivir»*—. Ese razonamiento **pesa más aquí**: quien cambia su contraseña
desde su perfil suele hacerlo precisamente porque sospecha.

`cerrarSesiones` ya existía; sólo había que llamarla. Y un detalle que sí hubo
que pensar: el borrado se lleva **todas** las sesiones, incluida la de quien lo
pidió, así que después se vuelve a guardar la suya. **No tiene sentido echar de
la aplicación a quien acaba de hacer lo correcto.**

## 3. Entradas inválidas daban 500 en vez de 400

Un `jugadorId` que no es uuid, o un monto de 10¹⁵ que desborda `numeric(12,2)`:
los dos devolvían **«error interno»**. No se filtraba nada —el mensaje es
genérico— pero **cada petición malformada escribía un error en el registro**, y
ese ruido puede tapar los que sí importan.

Se comprueba la forma antes de consultar, y hay un tope de diez millones por
abono: holgadísimo para una quiniela y suficiente para que el error salga como
mensaje y no como caída.

## Lo que se comprobó y estaba bien

Vale la pena dejarlo escrito, para no volver a auditarlo desde cero:

| Qué | Estado |
|---|---|
| Dependencias | `npm audit --omit=dev` → **0 vulnerabilidades** |
| Aislamiento entre quinielas | RLS **activada y forzada** en las 13 tablas, `pagos` incluida |
| Inyección SQL | Todas las consultas parametrizadas |
| Cookie de sesión | `httpOnly`, `secure` en producción, `sameSite: strict` |
| Salto de directorio | Cerrado con `path.basename`, y con su comentario |
| Tokens de correo | Sólo en SHA-256 |
| Los abonos | Ni se editan ni se borran; asiento inverso con autor |
| «Mis pagos» | Se resuelve desde la sesión, nunca desde un id de la URL |
| `cambiar-password` | Exige la contraseña actual y sólo permite la cuenta propia |

**Archivos modificados:**

| Archivo | Cambio |
|---|---|
| `src/rutas/admin.js` | `requireAdmin` en las rutas del proveedor; validación de uuid y tope de monto |
| `src/rutas/dominio.js` | Cambiar la contraseña cierra las demás sesiones |
| `src/cobros.js` | `MONTO_MAXIMO` y `esUuid` |
| `test/rutas.test.js` | 4 pruebas, una por hallazgo |
| `test/architecture.test.js` | 1 centinela para la cuota del proveedor |

**Verificación:**

```
npm test         → 400/400
npm run test:e2e →  94/94
npm audit --omit=dev → 0 vulnerabilidades
quitando la guardia a una ruta del proveedor → el centinela falla (comprobado)
```

**Hallazgos nuevos:**

1. ⛔ **Un agujero que no filtra datos se cuela más fácil.** El de la cuota no
   enseñaba nada de nadie: sólo dejaba sin servicio a quinielas ajenas. Por eso
   pasó desapercibido mientras la ruta hermana sí estaba protegida. **La
   revisión de permisos no puede mirar sólo quién ve qué; también quién gasta
   qué**, cuando lo que se gasta es compartido.
2. ⚠️ **Una lección escrita en una entrada no se aplica sola al resto del
   código.** El razonamiento de cerrar sesiones estaba redactado en la Entrada
   056 y aplicado en un solo sitio. **Es la tercera vez esta semana** que una
   lección aprendida vive en un lugar y falta en otro —pasó también con
   `quitarComentarios` (Entrada 062)—. Cuando se resuelve algo así, vale la
   pena buscar los demás sitios donde aplica **el mismo día**.
3. **Auditar ejecutando encuentra lo que leer no.** Las cuatro sondas eran
   peticiones reales contra el servidor en memoria. La de la cuota devolvió
   200 donde se esperaba 403, y eso no se ve leyendo una lista de rutas: se ve
   lanzándolas. Costó veinte minutos y encontró dos cosas de verdad.
4. **Una sonda que falla por el arnés no prueba nada.** El primer intento de la
   sonda de sesiones dio 409 —faltaba tener una quiniela seleccionada— y podría
   haberse leído como «no pasa nada». Hubo que repetirla bien para ver el 200
   que delataba el fallo. **Un resultado inesperado en una prueba de seguridad
   es sospechoso hasta que se entiende.**

**Pendiente / siguiente paso:**

Redesplegar en Render. **No toca la base.**

Queda anotado en §B.2 lo que se decidió no hacer: sin limitador en
`verificar-password` ni `cambiar-password` —poco explotable, exige la
contraseña actual y sólo sirve contra la cuenta propia— y la dependencia de
`cdnjs.cloudflare.com` en la CSP.

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

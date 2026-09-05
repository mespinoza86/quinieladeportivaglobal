# Llevar la quiniela a una aplicación de Android en Google Play

> Documento de planificación. Escrito el **4 de septiembre de 2026** a petición de
> Marco: qué haría falta para publicar esto como aplicación en la Play Store, qué
> instalar, qué cambiar y en qué orden.
>
> ⚠️ **Todavía no se ha hecho nada de esto.** Es el plan, no el registro de un
> trabajo. Lo que sí está medido contra el código de hoy va marcado como tal.

---

## 0. Lo primero, porque puede ahorrarte todo lo demás

**Hoy ya se puede instalar en un teléfono sin pasar por la Play Store.**

En Android, Chrome ofrece «Añadir a la pantalla de inicio» en cualquier sitio
web. Queda un icono en el escritorio, se abre a pantalla completa y por fuera no
se distingue de una aplicación. **Cuesta cero, no lo revisa nadie y no hay
política que cumplir.**

Con lo del apartado 1 —el manifiesto y los iconos, que es media tarde— eso queda
bastante fino: nombre propio, icono decente y sin la barra del navegador.

⛔ **Y conviene decirlo antes de nada porque la Play Store trae dos cosas que no
se ven al empezar**: un problema de política que puede acabar en rechazo (§1) y
un mantenimiento anual para siempre (§8).

**La Play Store aporta tres cosas de verdad**, y sólo tú puedes decir si las
necesitas:

- Que la gente lo encuentre buscando, en vez de tener que pasarles un enlace.
- Que se instale como cualquier otra aplicación, sin explicarle a nadie lo de
  «añadir a la pantalla de inicio».
- Notificaciones que llegan al teléfono sin que la persona abra nada.

Si lo que te mueve es la tercera, hay un atajo: **las notificaciones web
funcionan en Android sin publicar nada** (§7.3).

---

## 1. ⛔ El problema que hay que resolver ANTES de escribir una línea

**Google Play tiene una política específica sobre juego con dinero real,
concursos y apuestas.** Y una quiniela con cuotas y premio se le parece lo
suficiente como para que esto no sea un detalle: es **el riesgo principal de todo
el proyecto**.

⚠️ **No soy abogado, y esta política cambia.** Lo de abajo es el mapa del
terreno, no un dictamen. Antes de invertir tiempo hay que leer la versión vigente
de la política de *Real-Money Gambling, Games, and Contests* en la Play Console.

### Lo que juega a favor

Y es bastante, si se cuenta bien:

- **La aplicación no cobra ni paga nada.** No hay pasarela, no hay tarjeta, no se
  mueve un céntimo por dentro. El dinero va por SINPE o en efectivo, entre
  personas que se conocen.
- **Lo que hay es un cuaderno de cuentas**: quién puso, quién debe, cuánto hay en
  el bote. La aplicación lo *anota*, no lo *mueve*.
- **No hay cuotas de apuesta ni casa que gane.** Nadie apuesta contra la casa; el
  premio es el dinero que pusieron los jugadores.
- **Es un grupo cerrado.** Se entra con un código de ingreso, no hay registro
  abierto a cualquiera que pase por ahí.
- **Y todo lo del dinero ya está detrás de Admin Mode**, que es lo que ve el
  administrador y no el jugador. Eso no hubo que hacerlo para esto: ya era así.

### Lo que juega en contra

- Hay **cuotas**, hay **premio** y hay **bote acumulado**. En una captura de
  pantalla, eso se lee como una porra de dinero.
- Google mira **la ficha de la tienda** —título, descripción, capturas— tanto o
  más que el código. Una descripción mal escrita pesa más que la verdad del
  código.
- La política cubre países aprobados con licencia. **Hay que comprobar si Costa
  Rica está en la lista vigente**, y no darlo por hecho en ningún sentido.

### Lo que yo haría

1. **Presentarlo por lo que es**: una herramienta para llevar los pronósticos y
   la tabla de un grupo privado de amigos. Nada de «apuestas», «porra», «casa»,
   «bet» ni «ganancias» en el título ni en la descripción.
2. **Dejar fuera de las capturas todo lo del dinero.** Las capturas se eligen, y
   las de cobros no aportan nada a quien busca la aplicación.
3. **Decir la verdad en la ficha**, y decirla completa: que no se procesan pagos
   dentro de la aplicación. Es el hecho que más te protege, y conviene que esté
   escrito y no que lo deduzcan.
4. ⚠️ **Preguntar antes de construir.** La Play Console tiene un canal de
   consulta de políticas. Media hora escribiendo una consulta ahora vale más que
   una semana de trabajo rechazada después.

⛔ **Y el riesgo que hay que tener presente aunque sea incómodo:** un rechazo por
política no siempre se queda en «vuelve a intentarlo». Si Google decide que hay
una infracción, puede cerrar la cuenta de desarrollador entera. Por eso el paso 4
va **antes** que el código, y no después.

---

## 2. Los tres caminos técnicos

| | Qué es | Trabajo | Cuándo tiene sentido |
|---|---|---|---|
| **A. TWA** | La Play Store abre tu sitio a pantalla completa, con Chrome por debajo y sin barra de direcciones | **Poco** | ✅ **Éste** |
| **B. Capacitor** | La web dentro de un contenedor nativo, con acceso a cosas del teléfono | Medio-alto | Si hiciera falta cámara, GPS o notificaciones nativas |
| **C. Reescribir** | React Native o Flutter, la aplicación otra vez desde cero | Meses | No |

### Por qué la A, y con un motivo concreto de ESTE código

No es sólo que sea la más barata. Es que **las otras dos rompen la sesión**.

La aplicación mantiene la sesión con una cookie (`express-session`), y la CSP
está en `connectSrc: ["'self'"]` — o sea, el navegador sólo habla con su propio
origen.

- En una **TWA**, por dentro es Chrome abriendo
  `https://quinieladeportivaglobal.onrender.com`. Mismo origen, misma cookie,
  misma CSP. **Funciona hoy, sin tocar nada.**
- En **Capacitor**, los archivos se sirven desde el propio teléfono
  (`https://localhost` o `capacitor://`), así que las peticiones al servidor son
  **de otro origen**: haría falta CORS, `SameSite=None; Secure` en la cookie de
  sesión, y repasar la CSP entera. Es tocar la parte del sistema que más cuidado
  ha costado.

⚠️ Y hay un segundo motivo, menos técnico y más importante a la larga: **con una
TWA, cada despliegue en Render llega al teléfono al instante.** No hay que
recompilar, ni volver a subir, ni esperar revisión. Con Capacitor, cada cambio de
pantalla es una versión nueva en la tienda.

---

## 3. Qué hay que instalar

Todo en tu misma máquina. **Node ya lo tienes** (v24).

| Programa | Para qué | Cómo |
|---|---|---|
| **JDK 17** | Compilar Android | Temurin, o dejar que Bubblewrap lo baje solo |
| **Android SDK** | Herramientas de compilación | Con Android Studio, o sólo las de línea de comandos |
| **Bubblewrap** | Genera la TWA a partir del sitio | `npm i -g @bubblewrap/cli` |

```bash
npm install -g @bubblewrap/cli
bubblewrap doctor          # dice qué falta y se ofrece a bajar JDK y SDK
```

> **Atajo sin instalar nada:** [pwabuilder.com](https://www.pwabuilder.com) hace
> lo mismo desde el navegador — le das la URL y te devuelve el paquete firmado.
> Para la primera vez está bien; para repetirlo cada año, mejor Bubblewrap.

⚠️ **Android Studio pesa varios gigas.** Si sólo vas a empaquetar, con las
herramientas de línea de comandos sobra. Sólo hace falta entero si quieres el
emulador.

---

## 4. Qué hay que cambiar en este proyecto

Medido contra el código de hoy. **Ahora mismo no hay nada de esto**: ni
manifiesto, ni iconos, ni *service worker*. De hecho **el proyecto no tiene una
sola imagen** — ni un PNG, ni un SVG, ni un `.ico`.

### 4.1 El manifiesto — `public/manifest.webmanifest`

Es lo que le dice al teléfono cómo se llama, de qué color es y por dónde empieza.

```json
{
  "name": "Quiniela Deportiva Global",
  "short_name": "Quiniela",
  "start_url": "/index.html",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#1b5e3f",
  "background_color": "#ffffff",
  "lang": "es",
  "icons": [
    { "src": "/iconos/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/iconos/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/iconos/512-mask.png", "sizes": "512x512", "type": "image/png",
      "purpose": "maskable" }
  ]
}
```

> El `theme_color` sale del verde de los botones de los correos (`#1b5e3f`, en
> `src/correo.js`), para que la barra de estado no desentone.

### 4.2 Los iconos

Hacen falta al menos **192×192**, **512×512** y una versión *maskable* de 512
—con margen alrededor, porque Android la recorta en círculo—. Hay que dibujarlos:
no hay ninguno de donde partir.

### 4.3 ⚠️ Enlazar el manifiesto desde las 39 pantallas

`public/` tiene **39 archivos HTML**, y cada uno necesita dos líneas en su
`<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#1b5e3f" />
```

⛔ **Esto se hace con un guion, no a mano.** Treinta y nueve archivos editados a
mano es donde se olvida uno, y el síntoma sería que esa pantalla concreta pierde
el aspecto de aplicación sin que nada falle. Es la misma lección de los `onclick`
de la Entrada 024, donde 23 pantallas hubo que tocar y un botón sin conectar no
daba ningún error.

⚠️ Y conviene un **centinela** en `test/architecture.test.js` que compruebe que
todas lo llevan. Al añadir la pantalla número 40, el guardián avisa; sin él, se
olvida.

### 4.4 `public/.well-known/assetlinks.json`

Es lo que le demuestra a Android que ese sitio y esa aplicación son de la misma
persona. **Sin esto la TWA se abre con la barra de direcciones de Chrome
encima**, y ya no parece una aplicación.

Lleva la huella SHA-256 de la firma, que da la Play Console al subir la
aplicación:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.quinieladeportivaglobal.app",
    "sha256_cert_fingerprints": ["AA:BB:..."]
  }
}]
```

✅ **Comprobado el 4 de septiembre**: `express.static` sirve la carpeta
`.well-known` tal como está el servidor hoy, sin tocar nada. Se probó levantando
un Express con esa configuración y pidiendo el archivo, con un archivo normal de
control al lado:

```
/normal.txt                    -> 200
/.well-known/assetlinks.json   -> 200
```

⚠️ Hacía falta comprobarlo porque `serve-static` **ignora los archivos que
empiezan por punto** por defecto; lo que salva el caso es que la excepción
documentada cubre los archivos *dentro* de una carpeta con punto. Es
suficientemente raro como para no fiarse de la lectura: por eso se midió.

### 4.5 El *service worker* — `public/sw.js`

No es imprescindible para que la TWA compile, pero sí para que el sitio se
considere instalable y para que la aplicación no enseñe el dinosaurio de Chrome
cuando no hay red.

Con este proyecto hay que tener cuidado: **casi todo depende del servidor**, así
que cachear pantallas sería mentir. Lo sensato es lo mínimo:

- Guardar el CSS, los `js/` y los iconos.
- Una pantalla de «sin conexión» decente.
- ⛔ **No cachear nada de `/api/`.** Un ranking o unas cuentas servidas de una
  caché vieja son números creíbles y equivocados — que es exactamente la clase de
  fallo que este proyecto lleva ocho entradas de bitácora persiguiendo.

---

## 5. Los pasos, en orden

```
 1. Consultar la política de Google  ← §1. ANTES de todo lo demás
 2. Manifiesto + iconos + service worker + enlazar las 39 pantallas
 3. Desplegar y comprobar que el sitio se declara instalable
 4. Crear la cuenta de Play Console (25 USD, una vez)
 5. bubblewrap init --manifest https://.../manifest.webmanifest
 6. bubblewrap build   → sale un .aab firmado
 7. Subirlo, copiar la huella SHA-256 de la Play Console
 8. Poner assetlinks.json con esa huella y volver a desplegar el sitio
 9. Instalarlo y comprobar que NO sale la barra de direcciones
10. Ficha de la tienda, política de privacidad, seguridad de los datos,
    clasificación por edades
11. Pruebas cerradas   ← ⚠️ ver §6.2
12. Publicar
```

⚠️ **El orden de 5 a 8 tiene trampa y es circular**: para firmar hace falta la
aplicación, y para `assetlinks.json` hace falta la huella de la firma, que sólo
aparece **después** de subirla. Así que la primera versión se sube sabiendo que
la verificación fallará, y el `assetlinks.json` se pone después. Es normal; sólo
sorprende si nadie te lo dijo antes.

---

## 6. La Play Console: la parte que no es programar

### 6.1 Lo que piden sí o sí

| Qué | Detalle |
|---|---|
| **Cuenta** | 25 USD, pago único |
| **Política de privacidad** | ⚠️ **Obligatoria**, con URL pública. Esta aplicación guarda correo, nombre y quién juega dónde |
| **Seguridad de los datos** | Un formulario declarando qué se recoge. Aquí: correo, nombre de usuario y actividad dentro de la aplicación |
| **Clasificación por edades** | Un cuestionario. ⚠️ Hay preguntas sobre juego y apuestas: se responden con la verdad, y la verdad aquí es que no se procesan pagos |
| **Formato** | Un `.aab`, no un `.apk` |
| **Nivel de API** | Google obliga a apuntar a una versión reciente de Android, y **sube el listón cada año** |

⚠️ **La política de privacidad hay que escribirla.** No existe todavía. Puede ser
una pantalla más del propio sitio —`public/privacidad.html`— y así se despliega
con todo lo demás.

### 6.2 ⚠️ Lo que pilla por sorpresa: las pruebas cerradas

Las cuentas de desarrollador **personales** creadas en los últimos años tienen
que pasar por una fase de pruebas cerradas antes de poder publicar:
aproximadamente **12 personas usándola durante 14 días seguidos**.

No son 12 descargas: son 12 cuentas que se apuntan a la prueba y siguen dentro
las dos semanas. Con una quiniela de doce jugadores eso es justo lo que hay, así
que **se puede** — pero hay que contar con esas dos semanas en el calendario y
con pedírselo a la gente.

Las cuentas de **organización** (empresa) no pasan por ahí, pero registrarlas
pide documentación de la empresa.

⚠️ Estos requisitos cambian. **Míralos el día que vayas a empezar**, no el día
que leas esto.

---

## 7. Lo que cambia y lo que no

### 7.1 Lo que no hay que tocar

- **El servidor, entero.** La TWA abre el mismo sitio.
- **La sesión y las cookies**: por dentro es Chrome, así que funcionan igual.
- **La CSP**: mismo origen, ninguna directiva se queda corta.
- **El aviso por correo** de la Entrada 086 sigue funcionando igual.

### 7.2 ⛔ Y una dependencia que se vuelve más seria

Si el sitio no responde, **la aplicación es una pantalla en blanco**. Hoy eso es
una web que no carga; en una aplicación instalada es una reseña de una estrella.

`render.yaml` dice `plan: free`. El plan gratuito de Render **duerme el servicio**
tras un rato sin tráfico, y despertarlo tarda. Con doce personas que entran el
domingo, la primera se come la espera.

⚠️ Conviene aclarar en qué plan está de verdad **antes** de publicar, no después.
El proceso lleva días enteros despierto, así que puede que ya esté en uno de pago.

### 7.3 Las notificaciones, que es probablemente lo que más quieres

Aquí hay una cosa que conviene saber: **las notificaciones web funcionan en
Android sin publicar nada en la Play Store.** Chrome las admite desde hace años.

Así que si el motivo de todo esto es que te llegue un aviso al teléfono cuando
arranca un partido —en vez del correo de la Entrada 086—, **eso se puede tener
sin la tienda**: hace falta el *service worker* del §4.5 y las claves de Web
Push, y el enganche del planificador ya está escrito.

⚠️ Es bastante más trabajo que el correo, y el correo ya funciona. Pero es
honesto decir que **no hace falta la Play Store para esto**, que es lo que mucha
gente cree.

---

## 8. Lo que cuesta mantener, que es lo que nadie cuenta

Publicar es un rato. Sostenerlo es para siempre:

- **Cada año**, Google sube el nivel mínimo de API. Hay que recompilar y volver a
  subir, aunque no hayas tocado nada. Si no, la aplicación deja de estar
  disponible para los teléfonos nuevos.
- **Las políticas cambian**, y llegan correos con plazos.
- **Las reseñas y los informes de fallos** hay que mirarlos.
- **La firma de la aplicación es para siempre.** Si se pierde la clave, no se
  puede actualizar nunca más y hay que publicar otra aplicación distinta. (Play
  App Signing lo mitiga: Google guarda la clave.)

⚠️ Nada de esto es difícil. Pero es **trabajo recurrente sobre un proyecto que
hoy no tiene ninguno**: hoy empujas a `main` y ya está.

---

## 9. Resumen, y lo que yo recomendaría

**Si sólo quieres que se vea y se instale como una aplicación:** haz el §4 —
manifiesto, iconos, *service worker*— y quédate ahí. Es media tarde, no hay
política que cumplir, no hay cuota, no hay mantenimiento anual, y la gente lo
instala desde Chrome con dos toques. **El 90% del beneficio por el 5% del
trabajo.**

**Si además quieres estar en la tienda:** el §4 es igualmente el primer paso
—nada se tira—, pero **antes de empezar, pregúntale a Google por la política de
juego** (§1). Es lo único que puede tumbar el proyecto entero, y preguntar es
gratis.

**Si lo que quieres son notificaciones en el teléfono:** §7.3. No hace falta la
tienda.

⛔ **Lo que no recomiendo en ningún caso es reescribirlo en Flutter o React
Native.** Serían meses para llegar a lo que ya funciona, y el día del estreno
tendrías dos aplicaciones que mantener en vez de una.

---

## Anexo — lo que se comprobó al escribir esto

No es opinión; se miró el código el 4 de septiembre de 2026:

| Comprobación | Resultado |
|---|---|
| ¿Hay manifiesto, *service worker* o iconos? | **No hay nada.** Ni una imagen en el proyecto |
| ¿Cuántas pantallas hay que tocar? | **39** archivos en `public/` |
| ¿Se sirve `/.well-known/`? | ✅ **Sí**, con el `express.static` de hoy. Probado con un control al lado |
| ¿La CSP estorba a una TWA? | **No.** Mismo origen |
| ¿Y a Capacitor? | ⛔ **Sí**: `connectSrc: 'self'` y la cookie de sesión |
| ¿En qué plan está Render? | `render.yaml` dice `free`. **Hay que confirmarlo** |

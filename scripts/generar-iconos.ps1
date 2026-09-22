# Genera los iconos de la aplicacion a partir del dibujo original.
#
# ⚠️ ESTO NO SE CORRE EN CADA DESPLIEGUE. Los PNG que produce estan commiteados
# en `public/iconos/`. Este guion existe para poder REHACERLOS si algun dia
# cambia el dibujo o hace falta un tamano nuevo, no para ejecutarse solo.
#
# ⚠️ Es de Windows a proposito: usa System.Drawing, que viene con el sistema.
# La alternativa era meter `sharp` en el proyecto —una dependencia con binarios
# nativos que habria que compilar tambien en Render— para una tarea que se hace
# una vez cada dos anos. No compensa.
#
#   powershell -File scripts/generar-iconos.ps1 -Origen "C:\ruta\al\dibujo.png"

param(
  [string]$Origen = "public/iconos/icono-512.png",
  [string]$Destino = "public/iconos"
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Origen)) { throw "No encuentro el dibujo original: $Origen" }
if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Path $Destino | Out-Null }

# ⚠️ RUTA ABSOLUTA OBLIGATORIA. `Save` de GDI+ no resuelve las rutas relativas
# contra el directorio de PowerShell sino contra el del proceso, que puede ser
# otro. Con una ruta relativa no dice «no encuentro la carpeta»: suelta
# «A generic error occurred in GDI+» y a adivinar.
$Destino = (Resolve-Path $Destino).Path

# ⚠️ Se carga por memoria, NO con `Bitmap($ruta)`: ese constructor deja el
# archivo BLOQUEADO mientras viva el objeto, y como el origen por defecto es uno
# de los iconos que este mismo guion escribe, guardarlo reventaria a mitad.
$crudo = [System.IO.File]::ReadAllBytes((Resolve-Path $Origen))
$flujo = New-Object System.IO.MemoryStream(, $crudo)
$original = [System.Drawing.Bitmap]::FromStream($flujo)
"origen: $Origen  ($($original.Width) x $($original.Height))"

# El azul del fondo del dibujo. Se usa para rellenar los bordes de la version
# `maskable`, para que el relleno no se note.
$fondo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 1, 24, 65))

<#
  Dibuja `$original` dentro de un lienzo cuadrado de $lado px.

  `$encoge` < 1 mete el dibujo en un cuadro mas pequeno y centrado, rellenando
  lo que sobra con el azul del fondo. Es lo que necesita la version `maskable`:
  Android RECORTA el icono a un circulo (u otra forma, segun el fabricante), asi
  que lo que quede fuera del circulo central se pierde. Sin encogerlo, la corona
  del escudo se va cortada.
#>
function Escribir([int]$lado, [string]$nombre, [double]$encoge) {
  # ⚠️ `$lienzo`, NO `$destino`: PowerShell NO distingue mayusculas, asi que una
  # variable local llamada `$destino` es la MISMA que el parametro `$Destino`
  # con la carpeta. Llamarla asi la pisaba con el mapa de bits, y la ruta salia
  # 'System.Drawing.Bitmap\icono-1024.png'. GDI+ solo decia «generic error».
  $lienzo = New-Object System.Drawing.Bitmap($lado, $lado)
  $g = [System.Drawing.Graphics]::FromImage($lienzo)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.FillRectangle($fondo, 0, 0, $lado, $lado)

  $dentro = $lado * $encoge
  $margen = ($lado - $dentro) / 2.0
  $g.DrawImage($original, $margen, $margen, $dentro, $dentro)

  $g.Dispose()
  $ruta = Join-Path $Destino $nombre
  try {
    $lienzo.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
  } catch {
    # GDI+ contesta «A generic error occurred» a casi todo. Sin decir a que
    # ruta le paso, el mensaje no sirve para nada: este `catch` esta aqui
    # porque fue justo lo que destapo el fallo de arriba.
    throw "No pude guardar '$ruta': $($_.Exception.Message)"
  }
  $lienzo.Dispose()

  $kb = [Math]::Round((Get-Item $ruta).Length / 1KB, 1)
  "  $nombre  -> $lado x $lado, $kb KB"
}

<#
  Los `any`: el dibujo entero, tal cual lo entrego Marco. Ya trae su propio
  margen (un 12% a los lados), que es el que le corresponde a un icono.

  ⭐ EL DE 512 ES EL MAESTRO, y por eso es el origen por defecto. De el salen
  todos los demas, y es ademas el tamano exacto que pide Google Play para el
  icono de la ficha. Asi el dibujo original no queda de peso muerto en el
  repositorio: el maestro es tambien un icono que se usa.

  ⚠️ SE HIZO UN 1024 Y SE TIRO. Pesaba 1.431 KB —mas que el original— y Play
  no acepta iconos de mas de 1 MB, asi que no habria servido ni para eso.

  ⚠️ NO SE BAJA A 24 BITS NI SE PASA A PALETA, y se midio antes de decidirlo:
  el dibujo tiene 31.395 colores distintos (son degradados), asi que una paleta
  de 256 lo bandea; y quitar el canal alfa solo ahorra un 8% —de 381 a 350 KB—
  a cambio de que Play, que pide PNG de 32 bits, pueda protestar.
#>
if ((Resolve-Path $Origen).Path -ne (Join-Path $Destino "icono-512.png")) {
  Escribir 512 "icono-512.png" 1.0
} else {
  "  icono-512.png  -> es el origen, no se reescribe"
}
Escribir 192 "icono-192.png" 1.0
Escribir 180 "icono-180.png" 1.0
Escribir  32 "icono-32.png"  1.0

<#
  El `maskable`, encogido.

  El 0,87 no es a ojo. Se recorrio el dibujo pixel a pixel buscando el mas
  lejano del centro del lienzo: la punta izquierda del escudo, a 575,7 px de un
  semiancho de 626,5 —o sea al 91,9% del borde—. El circulo de seguridad de
  Android llega al 40% del lado, asi que el encoge maximo es
  0,4 / 0,919 = 0,871.

  Con eso el escudo ocupa el 72% del alto del icono: grande, no un sello
  perdido en medio. Y como es una fraccion, vale igual sea cual sea el tamano
  del dibujo de origen.
#>
Escribir 512 "icono-maskable-512.png" 0.87

$fondo.Dispose()
$original.Dispose()
$flujo.Dispose()
"listo."

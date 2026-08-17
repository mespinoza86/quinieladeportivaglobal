# Datos heredados

Volcados en JSON de la versión anterior a MongoDB (la quiniela mundialista de una
sola instancia). Se conservan como **respaldo histórico**.

**Ningún archivo de este directorio se lee desde el código.** No son configuración.
Estaban en la raíz del repositorio y se movieron aquí el 16 de agosto de 2026 para
que no se confundan con archivos activos.

| Archivo | Contenido |
|---|---|
| `equipos.json` | Equipos |
| `jornadas.json` | Jornadas y sus partidos |
| `jugadores.json` | Jugadores |
| `resultados.json` | Pronósticos de los jugadores |
| `resultados-oficiales.json` | Resultados oficiales |

Para migrar datos reales hacia la base multi-quiniela **no se usan estos archivos**,
sino `scripts/migrate-legacy.js`, que lee directamente de la base anterior mediante
una conexión de solo lectura (`MONGO_URI_LEGACY_READONLY`).

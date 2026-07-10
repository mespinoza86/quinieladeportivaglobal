# Quiniela Deportiva Global

Aplicación multi-quiniela con cuentas personales, roles por quiniela, jornadas, pronósticos, resultados oficiales, trivias, campeón y puntuación configurable.

## Requisitos

- Node.js 20 o superior.
- Una base MongoDB nueva para esta versión.
- Credencial de APIFootball para importar y sincronizar partidos.

## Configuración

1. Copia `.env.example` como `.env`.
2. Configura obligatoriamente `MONGO_URI_MULTIQUINIELA` y `SESSION_SECRET`.
3. Ejecuta `npm install`.
4. Inicia con `npm start`.

El servidor nunca utiliza `MONGO_URI` como alternativa. Si falta `MONGO_URI_MULTIQUINIELA`, termina inmediatamente para proteger la base de datos anterior.

## Modelo de acceso

- Cada cuenta tiene un `username` y correo globalmente únicos.
- Es posible iniciar sesión con cualquiera de los dos.
- El creador de una quiniela es su `propietario`.
- Una solicitud de ingreso necesita aprobación de un propietario o administrador.
- Los roles disponibles son `propietario`, `admin` y `user`.
- Solamente el propietario puede transferir la propiedad o eliminar la quiniela.
- Propietarios y administradores pueden archivarla, aprobar solicitudes, cambiar roles y expulsar miembros.
- Los retiros solicitados por usuarios requieren aprobación administrativa.

## Migración sin modificar la base anterior

La migración es una copia y usa una conexión de origen separada. La credencial indicada por `MONGO_URI_LEGACY_READONLY` debe tener permisos exclusivamente de lectura.

Primero registra en la aplicación nueva la cuenta que será propietaria. Luego configura las variables de migración descritas en `.env.example`.

Simulación sin escrituras:

```bash
npm run migrate:legacy:dry
```

Copia explícita hacia la base nueva:

```bash
npm run migrate:legacy
```

El script rechaza configuraciones donde el nombre o la URI de origen y destino sean iguales, y usa identificadores de migración para evitar duplicados al repetirlo.

## Verificación

```bash
npm run check
```

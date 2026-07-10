# Continuidad del trabajo — Multi-quiniela

Fecha: 9 de julio de 2026

## Objetivo acordado

Convertir la aplicación original de una sola quiniela en una plataforma multi-quiniela con cuentas personales y roles independientes por quiniela.

## Decisiones confirmadas

- Registro con nombre de usuario, correo, contraseña y confirmación.
- Usuario y correo deben ser globalmente únicos.
- Inicio de sesión con usuario o correo.
- No se verifica el correo todavía, pero el modelo queda preparado.
- Roles: `propietario`, `admin` y `user`.
- El creador de la quiniela es su propietario.
- Solo el propietario puede transferir la propiedad y eliminar la quiniela.
- Propietarios y administradores pueden archivarla y restaurarla.
- El ingreso requiere código y aprobación administrativa.
- El retiro se solicita y debe aprobarlo un administrador.
- Los administradores pueden expulsar miembros y cambiar roles.
- Una quiniela nunca puede quedar sin propietario/administración.
- Cada quiniela configura su puntuación y decide si utiliza trivias.
- Todas usan APIFootball, pero cada administrador elige partidos, ligas y equipos.
- La base anterior no se modifica. La versión nueva usa otra base.

## Implementación realizada

- Modelos `Usuario`, `Quiniela` y `Membresia`.
- Aislamiento automático mediante `quinielaId` en todos los modelos deportivos.
- Conexión obligatoria mediante `MONGO_URI_MULTIQUINIELA`; no existe fallback a `MONGO_URI`.
- Sesiones persistentes mediante `connect-mongo`.
- Registro, login, logout y consulta de cuenta.
- Crear, solicitar ingreso y seleccionar quinielas.
- Aprobación/rechazo, retiro, expulsión, roles y transferencia.
- Puntuación configurable, trivias opcionales, archivo y eliminación lógica.
- Pantallas nuevas: registro, mis quinielas, miembros y configuración.
- Pantallas deportivas adaptadas a la cuenta y quiniela activa.
- Protección de pronósticos y trivias ajenas antes del cierre.
- Migrador seguro, en simulación por defecto, desde una conexión antigua de solo lectura.
- README, `.env.example`, `.gitignore` y pruebas arquitectónicas.

## Verificación realizada

- `npm test`: 5 pruebas aprobadas.
- `npm run check`: sintaxis del servidor válida.
- Todos los scripts JavaScript pasaron `node --check`.
- No hay referencias locales JS/CSS ausentes.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Se verificó que el servidor no arranca sin la nueva base.

## Siguiente paso

1. Crear una base MongoDB nueva.
2. Crear `.env` a partir de `.env.example`.
3. Configurar `MONGO_URI_MULTIQUINIELA`, `SESSION_SECRET` y `APIFOOTBALL_COM_KEY`.
4. Arrancar la aplicación.
5. Probar de extremo a extremo con al menos dos cuentas y dos quinielas.
6. Corregir cualquier detalle encontrado en la prueba integrada.
7. Registrar la cuenta propietaria definitiva.
8. Ejecutar primero `npm run migrate:legacy:dry` y revisar conteos antes de cualquier copia.

## Seguridad de la base anterior

No se ha conectado ni modificado la base original. La migración no se ha ejecutado. Cuando se haga, `MONGO_URI_LEGACY_READONLY` debe usar credenciales de solo lectura y el destino debe ser una base diferente.

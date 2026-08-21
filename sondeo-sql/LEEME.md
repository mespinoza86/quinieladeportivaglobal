# Sondeo SQL — material de una exploración, no de una migración

> ⚠️ **Esto no es código de la aplicación y nada lo usa.** Es el resultado de una
> sesión de sondeo con límite y sin compromiso, hecha el 20 de agosto de 2026
> para contestar con números —y no con opiniones— si conviene pasar de MongoDB a
> PostgreSQL. El relato completo está en la **Entrada 032** de
> `avance_proyecto.md`.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `esquema.sql` | Las 13 colecciones de Mongo modeladas en PostgreSQL: 16 tablas, claves ajenas de verdad y RLS |
| `sondeo-pglite.js` | El banco de pruebas: arranca un Postgres, aplica el esquema y hace 10 comprobaciones de aislamiento |

## Cómo se ejecuta

No está enganchado a `npm test` a propósito: la aplicación no depende de nada de
esto, y no queremos que un sondeo rompa el CI.

```bash
cd sondeo-sql
npm install
npm run sondeo
```

Debe terminar con `10/10 comprobaciones pasan.` Tarda unos 3 segundos.

La carpeta tiene su propio `package.json` con su única dependencia, justo para
que **no toque el `package.json` de la aplicación**.

## Las tres cosas que hay que saber antes de leer el esquema

1. **El aislamiento lo aplica la base, no el ORM.** Donde hoy hay un
   `tenantPlugin` de Mongoose que engancha `find*`, `update*` y `delete*`, aquí
   hay *Row-Level Security*. La diferencia importa porque el plugin **no
   engancha `aggregate`, `insertMany` ni `bulkWrite`**: hoy no se usa ninguno de
   los tres, así que no hay fuga, pero el día que alguien escriba el primer
   `aggregate` la consulta sale sin filtro y en silencio.

2. **⚠️ Un superusuario se salta RLS siempre**, aunque la tabla tenga
   `FORCE ROW LEVEL SECURITY`. Si la aplicación se conecta con el rol dueño de la
   base —que es justo lo que dan por defecto Neon y casi cualquier proveedor—
   **el aislamiento no existe y nada avisa**. Por eso el sondeo crea un rol `app`
   sin privilegios y comprueba las dos cosas: que con `app` no se ve lo ajeno, y
   que con el dueño se ve todo. Es la trampa más cara de todo este material.

3. **Los cinco arreglos incrustados se vuelven tablas hijas**, y al hacerlo cada
   partido y cada pronóstico gana identidad propia. Eso cierra M-02 —hoy el
   vínculo partido↔pronóstico es el índice de un array— pero **no es traducción
   mecánica**: es la parte que obliga a repensar consultas, no solo a reescribirlas.

## Lo que este banco NO puede probar

PGlite atiende **una sola conexión**. Por eso quedan sin verificar:

- La disciplina de `SET LOCAL` dentro de transacción con un *pool* de verdad,
  que es lo que impide que el contexto de una quiniela se filtre a la petición
  siguiente que reutilice la misma conexión.
- Cualquier carrera real. La del cerrojo se comprueba en su semántica —el primero
  entra, el segundo rebota, el caducado se puede tomar— pero de forma secuencial.

Las dos cosas necesitan un PostgreSQL de verdad. En esta máquina no lo hubo: no
hay Docker ni `psql`, y los binarios de `embedded-postgres` no arrancan
(`STATUS_IN_PAGE_ERROR`, probado con las series 17 y 18; todas sus versiones
publicadas son *beta*). En CI sí es fácil: GitHub Actions levanta un Postgres
como servicio en tres líneas.

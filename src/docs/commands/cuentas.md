# /miscuentas

## Descripción
Lista todas las tablas del esquema `public`, interpretándolas como cuentas legacy, y responde con un listado numerado para referencia rápida.【F:commands/cuentas.js†L1-L25】

## Flujo principal
1. Ejecuta `SELECT tablename FROM pg_tables WHERE schemaname = 'public'` para recuperar todas las tablas disponibles.【F:commands/cuentas.js†L3-L12】
2. Convierte el resultado en una lista numerada y la envía al usuario; si no hay tablas, informa que no existen cuentas registradas.【F:commands/cuentas.js†L13-L18】
3. En caso de error en la consulta, registra la excepción y envía un mensaje de advertencia.【F:commands/cuentas.js†L19-L22】

## Entradas relevantes
- No requiere argumentos adicionales; usa el contexto de la conexión PostgreSQL configurada en `psql/db.js`.【F:commands/cuentas.js†L1-L12】

## Salidas
- Texto con el listado de cuentas o mensajes de error cuando la consulta falla.【F:commands/cuentas.js†L13-L22】

## Dependencias
- Se apoya en el pool PostgreSQL para consultar `pg_tables` y en `ctx.reply` para enviar la respuesta al chat.【F:commands/cuentas.js†L1-L22】

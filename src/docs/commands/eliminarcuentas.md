# /eliminarcuenta

## Descripción
Elimina una cuenta legacy representada por una tabla específica en el esquema `public`, utilizando `DROP TABLE IF EXISTS` para tolerar nombres inexistentes.【F:commands/eliminarcuentas.js†L1-L25】

## Flujo principal
1. Obtiene el nombre de la cuenta desde el mensaje (`/eliminarcuenta <nombre>`); si falta, avisa al usuario y termina.【F:commands/eliminarcuentas.js†L4-L10】
2. Ejecuta `DROP TABLE IF EXISTS "<cuenta>"` y confirma la eliminación si la sentencia se ejecuta sin errores.【F:commands/eliminarcuentas.js†L12-L19】
3. En caso de fallo en la consulta, registra la excepción y responde con un mensaje de advertencia.【F:commands/eliminarcuentas.js†L19-L22】

## Entradas relevantes
- Nombre de la tabla/cuenta proporcionado en el comando por el operador.【F:commands/eliminarcuentas.js†L4-L14】

## Salidas
- Mensaje de confirmación o advertencia según el resultado del `DROP TABLE`.【F:commands/eliminarcuentas.js†L17-L22】

## Dependencias
- Requiere acceso al pool PostgreSQL configurado en `psql/db.js`; las consultas se ejecutan directamente sobre la base legacy.【F:commands/eliminarcuentas.js†L1-L22】

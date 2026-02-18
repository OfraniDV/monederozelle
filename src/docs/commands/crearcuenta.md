# /crearcuenta

## Descripción
Crea una tabla de cuenta legacy si no existe, inicializándola con un saldo inicial opcional y un registro “Saldo inicial”. Está pensado para migraciones antiguas donde cada cuenta es una tabla separada.【F:commands/crearcuenta.js†L1-L48】

## Flujo principal
1. Extrae el nombre de la cuenta y un saldo inicial opcional (`/crearcuenta <nombre> [saldo]`).【F:commands/crearcuenta.js†L3-L4】
2. Verifica en `pg_tables` si ya existe una tabla con ese nombre y avisa si está duplicada.【F:commands/crearcuenta.js†L7-L18】
3. Si no existe, ejecuta `CREATE TABLE` con columnas `descripcion`, `debito`, `credito`, `total` y `fecha`, seguido de un `INSERT` del saldo inicial proporcionado.【F:commands/crearcuenta.js†L19-L37】
4. Responde con confirmación de creación o, en caso de error SQL, envía un mensaje genérico indicando que se reintente.【F:commands/crearcuenta.js†L35-L45】

## Entradas relevantes
- Nombre de cuenta (obligatorio) y saldo inicial (opcional) proporcionados en el mensaje del usuario.【F:commands/crearcuenta.js†L3-L4】

## Salidas
- Confirmación textual con el saldo inicial aplicado, aviso de duplicado o errores de ejecución.【F:commands/crearcuenta.js†L16-L45】

## Dependencias
- Usa el pool PostgreSQL y consultas dinámicas interpolando el nombre de la tabla; requiere privilegios para crear tablas en el esquema `public`.【F:commands/crearcuenta.js†L1-L37】

# /resumentotal

## Descripción
Recorre todas las tablas públicas (excepto `usuarios`) y envía un resumen individual por cuenta, reutilizando la lógica de cálculo de subtotales diarios y totales mensuales de créditos/débitos de las cuentas legacy.【F:commands/resumentotal.js†L1-L115】

## Flujo principal
1. `obtenerTablas` lista las tablas visibles en `public` y filtra la tabla de control de usuarios para enfocarse en cuentas de legado.【F:commands/resumentotal.js†L4-L20】
2. `generarResumenCuenta` ejecuta `SELECT * FROM <cuenta>` ordenado por fecha, compone el detalle diario y devuelve un bloque de texto con totales por mes.【F:commands/resumentotal.js†L22-L84】
3. `enviarResumen` divide el texto en fragmentos de 4096 caracteres para respetar el límite de Telegram.【F:commands/resumentotal.js†L91-L99】
4. `resumenTotal` itera sobre todas las tablas y envía cada resumen por separado, avisando si no existen cuentas registradas.【F:commands/resumentotal.js†L101-L114】

## Entradas relevantes
- Tablas existentes en el esquema público, incluyendo contenido de columnas `descripcion`, `debito`, `credito`, `total` y `fecha` por cada cuenta.【F:commands/resumentotal.js†L4-L112】

## Salidas
- Mensajes de texto con resúmenes completos por cuenta, cada uno con saldos diarios y totales mensuales de débito/crédito, o errores por cuenta vacía o inexistente.【F:commands/resumentotal.js†L32-L112】

## Dependencias
- Requiere el pool PostgreSQL y la utilidad `escapeMarkdown` para proteger el nombre de la cuenta en la salida.【F:commands/resumentotal.js†L1-L84】

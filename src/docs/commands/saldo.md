# /saldo

## Descripción
Wizard para actualizar saldo de tarjeta con tres modos: fijar saldo actual, aumentar y retirar. Calcula delta automáticamente y registra movimiento en `movimiento`.

## Flujo
1. Selección de agente.
2. Selección de tarjeta del agente.
3. Selección de operación (`SET`, `ADD`, `SUB`).
4. Entrada de monto/saldo final.
5. Confirmación con resumen + historial del día.

## Navegación
- Botones de `Volver` y `Salir` en cada etapa.
- Cancelación global por botón y por texto (`/cancel`, `salir`).

## Salidas
- Resumen HTML con saldo anterior, importe y saldo nuevo.
- Reporte adicional con `sendAndLog` para trazabilidad.

## Premium UI
- Todos los botones inline usan autoestilo global.
- Callbacks de navegación y selección de entidades (`AG_`, `TA_`, etc.) reciben icono premium automático.

## Implementación
- `src/commands/saldo.js`

# /saldo

## Descripción
Wizard interactivo para actualizar el saldo real de una tarjeta. Permite elegir agente, seleccionar tarjeta y registrar un movimiento con cálculo automático del delta y un historial del día, incluyendo totales por moneda (con equivalente en USD) en los listados de agentes y tarjetas, y reabre el menú de tarjetas tras cada actualización.【F:commands/saldo.js†L1-L433】

## Flujo principal
1. Paso 0: muestra la lista de agentes disponibles con un botón `❌ Salir` permanente y un bloque de totales globales por moneda (incluye equivalente en USD).【F:commands/saldo.js†L39-L118】
2. Paso 1: al seleccionar un agente carga sus tarjetas, mostrando un resumen de totales por moneda para ese agente antes de listar las tarjetas; si no hay tarjetas, cierra la escena tras avisar.【F:commands/saldo.js†L120-L206】
3. Paso 2: tras elegir tarjeta, solicita el saldo actual vía mensaje editado con la leyenda de salida y permite volver a agentes o tarjetas anteriores desde el teclado inline.【F:commands/saldo.js†L258-L279】
4. Paso 3: valida el número ingresado, calcula delta y saldo anterior consultando el último movimiento, inserta la nueva fila en `movimiento`, genera historial diario, envía mensaje de confirmación (con recordatorio de “salir”), notifica por log y recarga el menú de tarjetas para seguir actualizando.【F:commands/saldo.js†L282-L433】

## Entradas relevantes
- Selección de agente/tarjeta mediante callbacks inline y saldo actual introducido por texto numérico.【F:commands/saldo.js†L240-L433】

## Salidas
- Mensaje HTML con resumen del ajuste, historial del día y retorno inmediato al menú de tarjetas; envía también un registro al canal configurado a través de `sendAndLog`.【F:commands/saldo.js†L391-L418】

## Dependencias
- Utiliza `psql/db.js` para consultar e insertar movimientos, helpers de formato (`escapeHtml`, `fmtMoney`, `boldHeader`), el resumen centralizado de moneda en `helpers/saldoSummary`, `sendAndLog` para reportes, `recordChange`/`handleGlobalCancel` para resúmenes de sesión y `runFondo` para disparar el asesor financiero al salir.【F:commands/saldo.js†L16-L469】

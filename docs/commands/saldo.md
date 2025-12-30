# /saldo

## Descripción
Wizard interactivo para actualizar el saldo real de una tarjeta. Permite elegir agente, seleccionar tarjeta y registrar un movimiento con cálculo automático del delta y un historial del día, incluyendo totales por moneda (con equivalente en USD) en los listados de agentes y tarjetas.【F:commands/saldo.js†L1-L431】

## Flujo principal
1. Paso 0: muestra la lista de agentes disponibles con un botón `❌ Salir` permanente y un bloque de totales globales por moneda (incluye equivalente en USD).【F:commands/saldo.js†L45-L123】
2. Paso 1: al seleccionar un agente carga sus tarjetas, mostrando un resumen de totales por moneda para ese agente antes de listar las tarjetas; si no hay tarjetas, cierra la escena tras avisar.【F:commands/saldo.js†L126-L212】
3. Paso 2: tras elegir tarjeta, solicita el saldo actual vía mensaje editado con la leyenda de salida y permite volver a agentes o tarjetas anteriores desde el teclado inline.【F:commands/saldo.js†L264-L286】
4. Paso 3: valida el número ingresado, calcula delta y saldo anterior consultando el último movimiento, inserta la nueva fila en `movimiento`, genera historial diario, envía mensaje de confirmación (con recordatorio de “salir”) y notifica por log.【F:commands/saldo.js†L288-L440】
5. Paso 4: ofrece continuar con otra tarjeta o agente; al salir ejecuta `runFondo` para actualizar el análisis financiero (en privado si el chat es grupo).【F:commands/saldo.js†L444-L503】

## Entradas relevantes
- Selección de agente/tarjeta mediante callbacks inline y saldo actual introducido por texto numérico.【F:commands/saldo.js†L96-L440】

## Salidas
- Mensaje HTML con resumen del ajuste, historial del día y opciones para continuar; envía también un registro al canal configurado a través de `sendAndLog`.【F:commands/saldo.js†L397-L430】

## Dependencias
- Utiliza `psql/db.js` para consultar e insertar movimientos, helpers de formato (`escapeHtml`, `fmtMoney`, `boldHeader`), el resumen centralizado de moneda en `helpers/saldoSummary`, `sendAndLog` para reportes, `recordChange`/`handleGlobalCancel` para resúmenes de sesión y `runFondo` para disparar el asesor financiero al salir.【F:commands/saldo.js†L16-L503】

# /saldo

## Descripción
Wizard interactivo para actualizar el saldo real de una tarjeta. Permite elegir agente, seleccionar tarjeta y registrar un movimiento con cálculo automático del delta y un historial del día, enviando además un resumen al canal de reportes.【F:commands/saldo.js†L1-L427】

## Flujo principal
1. Paso 0: muestra la lista de agentes disponibles y permite cancelar en cualquier momento mediante botones o comandos `/cancel`/`salir`.【F:commands/saldo.js†L36-L93】【F:commands/saldo.js†L171-L181】
2. Paso 1: al seleccionar un agente carga sus tarjetas, mostrando saldo actual, banco y moneda. Si no hay tarjetas, cierra la escena.【F:commands/saldo.js†L95-L153】【F:commands/saldo.js†L183-L199】
3. Paso 2: tras elegir tarjeta, solicita el saldo actual vía mensaje editado y permite volver a agentes o tarjetas anteriores desde el teclado inline.【F:commands/saldo.js†L156-L223】
4. Paso 3: valida el número ingresado, calcula delta y saldo anterior consultando el último movimiento, inserta la nueva fila en `movimiento`, genera historial diario, envía mensaje de confirmación y notifica por log.【F:commands/saldo.js†L239-L350】
5. Paso 4: ofrece continuar con otra tarjeta o agente; al salir ejecuta `runFondo` para actualizar el análisis financiero (en privado si el chat es grupo).【F:commands/saldo.js†L364-L417】

## Entradas relevantes
- Selección de agente/tarjeta mediante callbacks inline y saldo actual introducido por texto numérico.【F:commands/saldo.js†L95-L350】

## Salidas
- Mensaje HTML con resumen del ajuste, historial del día y opciones para continuar; envía también un registro al canal configurado a través de `sendAndLog`.【F:commands/saldo.js†L311-L350】

## Dependencias
- Utiliza `psql/db.js` para consultar e insertar movimientos, helpers de formato (`escapeHtml`, `fmtMoney`, `boldHeader`), `sendAndLog` para reportes, `recordChange/flushOnExit` para resúmenes de sesión y `runFondo` para disparar el asesor financiero al salir.【F:commands/saldo.js†L16-L417】

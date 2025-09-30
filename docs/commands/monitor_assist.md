# /monitor (asistente)

## Descripción
Asistente de filtros para el comando `/monitor` que permite combinar periodo, moneda, agente y banco desde un menú interactivo. Edita el mensaje en lugar de enviar nuevos, ofrece opción de ver el reporte en privado cuando se usa en grupos y reusa `runMonitor` para generar la salida final.【F:commands/monitor_assist.js†L1-L374】

## Flujo principal
1. Inicializa filtros con el periodo por defecto (`getDefaultPeriod`) y muestra un resumen editable con botones para cada filtro y para ejecutar la consulta.【F:commands/monitor_assist.js†L48-L80】【F:commands/monitor_assist.js†L212-L227】
2. Proporciona menús específicos para periodo (día/semana/mes/año), selección de día o mes, moneda, agente y banco, incluyendo opciones “Todos” y bloqueos para fechas futuras.【F:commands/monitor_assist.js†L82-L208】
3. Al ejecutar (`RUN`) construye un comando `/monitor` con flags según filtros activos, muestra un mensaje de “Generando reporte…”, invoca `runMonitor` y normaliza el resultado con `chunkHtml` para reusar bloques seguros al guardar.【F:commands/monitor_assist.js†L234-L263】
4. Tras generar el reporte, ofrece guardar/enviar por otros canales mediante `sendReportWithKb` y `sendAndLog`, o regresar al menú para realizar otra consulta. Las cancelaciones delegan en `handleGlobalCancel` del helper `wizardCancel` para limpiar el estado del wizard.【F:commands/monitor_assist.js†L20-L357】
5. El botón “Ver en privado” responde con el enlace del bot cuando el comando se usa en grupos, fomentando consultas 1:1.【F:commands/monitor_assist.js†L70-L271】

## Entradas relevantes
- Callbacks inline (p.ej., `PER_*`, `DAY_*`, `MO_*`, `AG_*`, `BK_*`) y combinaciones de filtros almacenadas en `ctx.wizard.state.filters`.【F:commands/monitor_assist.js†L82-L357】

## Salidas
- Mensaje HTML resumido con filtros activos y reportes generados por `/monitor`, además de respuestas de confirmación cuando se guardan o cancelan consultas.【F:commands/monitor_assist.js†L48-L357】

## Dependencias
- Utiliza helpers de UI (`editIfChanged`, `arrangeInlineButtons`, `buildBackExitRow`, `buildSaveBackExitKeyboard`), `chunkHtml`, `sendReportWithKb`, `sendAndLog`, `handleGlobalCancel` y `runMonitor`. Consulta tablas `agente`, `banco` y `moneda` para poblar menús.【F:commands/monitor_assist.js†L20-L357】

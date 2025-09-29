# /tarjetas (asistente)

## Descripción
Asistente de navegación que permite explorar tarjetas sin generar nuevos mensajes: ofrece vistas por agente, por combinación moneda-banco, resumen global y detalle completo, reutilizando `sendLargeMessage` para bloques extensos y teclados inline para moverse entre rutas.【F:commands/tarjetas_assist.js†L1-L220】

## Flujo principal
1. Carga todos los saldos de tarjetas con metadatos de agente, banco y moneda, agrupando por agente y por moneda/banco para construir estructuras reutilizables.【F:commands/tarjetas_assist.js†L82-L168】
2. Presenta un menú principal con opciones “Por moneda y banco”, “Por agente”, “Resumen USD global” y “Ver todas”, cada una navegable con botones `Volver`/`Salir`.【F:commands/tarjetas_assist.js†L170-L204】
3. Las rutas de agente muestran tarjetas y totales por moneda, mientras que las vistas por moneda+banco separan saldos positivos y negativos para resaltar capacidad versus deudas. Los bloques resultantes se normalizan con `chunkHtml` antes de reutilizarlos.【F:commands/tarjetas_assist.js†L51-L360】
4. Todas las respuestas se envían editando el mensaje original mediante `editIfChanged`; para listados largos se usa `sendLargeMessage` o `sendReportWithKb` evitando errores 400 por contenido repetido y cerrando correctamente etiquetas HTML.【F:commands/tarjetas_assist.js†L25-L360】

## Entradas relevantes
- Interacción del operador mediante callbacks inline (`AG_*`, `MON_*`, etc.) y botones de navegación estándar (`Volver`, `Salir`).【F:commands/tarjetas_assist.js†L170-L220】

## Salidas
- Bloques HTML escapados con resúmenes por agente y moneda, enviados como mensaje editado o división automática cuando superan los 4096 caracteres.【F:commands/tarjetas_assist.js†L25-L220】

## Dependencias
- Utiliza helpers de UI (`editIfChanged`, `arrangeInlineButtons`, `buildBackExitRow`), `chunkHtml`, `createExitHandler` y `sendLargeMessage`/`sendAndLog` para reportes, además del pool PostgreSQL para obtener datos.【F:commands/tarjetas_assist.js†L22-L360】

# /tarjetas

## Descripción
Lista todas las tarjetas registradas mostrando saldos iniciales y finales, variaciones, descripciones del último movimiento y equivalentes en USD agrupados por moneda, banco y agente.【F:commands/tarjetas.js†L1-L209】

## Flujo principal
1. Ejecuta `LAST_MOVEMENTS_SQL` para obtener, por tarjeta, el último movimiento junto con metadatos de agente, banco, moneda, emojis y tasa USD.【F:commands/tarjetas.js†L25-L58】
2. Agrupa las filas por moneda, sumando saldos iniciales y finales, y anida agregaciones por banco y por agente para construir resúmenes temáticos.【F:commands/tarjetas.js†L60-L133】
3. Construye bloques de salida con totales por moneda, por agente (en USD), detalle por tarjeta y subtotales por banco, incluyendo marcas temporales y descripciones cuando existen.【F:commands/tarjetas.js†L135-L199】
4. Envía todos los bloques en secuencia usando `sendLargeMessage` para respetar el límite de caracteres de Telegram.【F:commands/tarjetas.js†L135-L205】

## Entradas relevantes
- No recibe argumentos adicionales; usa la conexión PostgreSQL (`pool`) y la consulta SQL embebida.【F:commands/tarjetas.js†L7-L58】

## Salidas
- Bloques HTML con encabezados en negritas, listas de tarjetas, subtotales y equivalentes en USD, generados mediante utilidades de formato (`escapeHtml`, `boldHeader`, `fmt`).【F:commands/tarjetas.js†L14-L205】

## Dependencias
- Utiliza `helpers/format` para escapar HTML y destacar encabezados, y `helpers/sendLargeMessage` para dividir mensajes extensos.【F:commands/tarjetas.js†L7-L205】

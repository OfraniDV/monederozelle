# /monitor

## Descripción
Genera un monitoreo financiero comparando saldos iniciales y finales de tarjetas en un periodo configurable (día, semana, mes o año). Calcula variaciones en CUP y USD, volumen de movimientos y estados por tarjeta, agregando resultados por moneda, agente y banco.【F:commands/monitor.js†L1-L756】

## Flujo principal
1. `parseArgs` interpreta flags como `--historial`, `--solo-cambio`, `--agente`, `--banco`, `--moneda`, `--tz`, `--limite` y `--orden`, normalizando entradas con soporte para tildes y alias de periodo.【F:commands/monitor.js†L20-L120】
2. `calcRanges` calcula el rango temporal actual y el previo según el periodo solicitado, utilizando `moment-timezone` para fijar la zona horaria por defecto en `America/Havana`.【F:commands/monitor.js†L130-L210】
3. `SQL_BASE` consulta saldos históricos y del periodo, conteo de movimientos y volúmenes mediante varias CTE sobre la tabla `movimiento`, uniendo con `tarjeta`, `banco`, `agente` y `moneda`. Cada fila se transforma con `transformRow` para calcular deltas y equivalentes en USD.【F:commands/monitor.js†L246-L356】
4. Aplica filtros opcionales por agente, banco o moneda mediante `buildEntityFilter`, ordena por delta/volumen/movimientos y obtiene historiales detallados cuando se usa `--historial`.【F:commands/monitor.js†L380-L720】
5. Agrupa resultados por moneda y genera mensajes HTML con resúmenes y tablas, enviando cada bloque mediante `sendLargeMessage`. Registra advertencias cuando no se encuentran datos o filtros son ambiguos.【F:commands/monitor.js†L700-L739】

## Entradas relevantes
- Comando `/monitor [periodo]` con flags opcionales y filtros textuales; consulta la base PostgreSQL para tarjetas, movimientos, bancos y agentes.【F:commands/monitor.js†L20-L356】【F:commands/monitor.js†L380-L720】

## Salidas
- Mensajes HTML con encabezados, tablas por moneda, indicadores de tendencia (emoji) y, si se solicita, historial de movimientos dentro del rango. Maneja respuestas amigables cuando no hay datos o ocurre un error.【F:commands/monitor.js†L330-L739】

## Dependencias
- Requiere `moment-timezone`, helpers de formato (`escapeHtml`, `fmtMoney`, `boldHeader`), `buildEntityFilter` y `sendLargeMessage`. Usa la conexión `psql/db.js` para ejecutar la consulta compleja y obtener tasas de venta.【F:commands/monitor.js†L1-L739】

# Auditoría: diferencias entre /fondo y /tarjetas

## Resumen ejecutivo
- `/fondo` toma los últimos saldos de todas las tarjetas, calcula la liquidez utilizable en CUP y recomienda acciones de venta o cobertura. Filtra cuentas etiquetadas como deudas y solo suma activos positivos en CUP que pertenezcan a bancos de liquidez configurados.【F:middlewares/fondoAdvisor.js†L496-L618】【F:middlewares/fondoAdvisor.js†L1094-L1215】
- `/tarjetas` lista los últimos movimientos sin filtrar, agrupando por moneda, banco y agente; reporta tanto saldos positivos como negativos y convierte cada monto a USD con la tasa guardada en la tarjeta.【F:commands/tarjetas.js†L25-L200】

## Fuentes de datos
- Ambos comandos consultan el último movimiento por tarjeta mediante un `JOIN` lateral sobre `movimiento`, pero `/fondo` solo conserva los campos esenciales para agregación (moneda, banco, agente, número, tasa y saldo).【F:middlewares/fondoAdvisor.js†L496-L516】
- `/tarjetas` recupera metadatos adicionales —emojis, descripción y fecha del último movimiento— para mostrarlos en la interfaz y construir resúmenes por moneda y agente.【F:commands/tarjetas.js†L25-L133】

## Reglas de agregación
- `/fondo` ignora saldos negativos al sumar activos CUP y traslada los negativos a la métrica `deudas`. También excluye cualquier tarjeta cuyo agente, banco o número coincida con la expresión regular `(debe|deuda|deudas|deudor)` para evitar contar cuentas por cobrar como liquidez.【F:middlewares/fondoAdvisor.js†L543-L606】
- Al calcular inventario en USD, `/fondo` solo incluye tarjetas etiquetadas como USD o MLC y multiplica el saldo por `tasa_usd`.【F:middlewares/fondoAdvisor.js†L606-L612】
- `/tarjetas` no aplica filtros: acumula saldos iniciales y finales por moneda y banco, registra el delta de cada tarjeta y calcula equivalentes en USD directamente en los bloques de salida.【F:commands/tarjetas.js†L60-L200】

## Salida y notificaciones
- `/fondo` construye bloques con métricas de liquidez, necesidades de CUP, plan de venta, límites mensuales y proyección posterior. Si el comando se lanza en un grupo, reenvía el resultado por mensaje privado al usuario para evitar spam.【F:middlewares/fondoAdvisor.js†L1183-L1321】
- `/tarjetas` genera múltiples bloques con resúmenes globales, detalle por moneda y tarjetas por agente y envía el resultado usando `sendLargeMessage` directamente en el chat origen.【F:commands/tarjetas.js†L135-L209】

## Recomendaciones de control
1. Mantener sincronizada la lista de bancos líquidos (`liquidityBanks`) para que `/fondo` considere todos los canales de liquidez válidos.【F:middlewares/fondoAdvisor.js†L543-L582】【F:middlewares/fondoAdvisor.js†L1094-L1110】
2. Revisar periódicamente los registros `[fondoAdvisor] Excluida fila…` para detectar tarjetas clasificadas como deudas y ajustar su nomenclatura si deben contarse como activos.【F:middlewares/fondoAdvisor.js†L572-L604】
3. Cuando se investiguen discrepancias, comparar el total USD de `/tarjetas` con el inventario USD reportado por `/fondo` para confirmar que la tasa `tasa_usd` está actualizada en ambas vistas.【F:middlewares/fondoAdvisor.js†L606-L612】【F:commands/tarjetas.js†L102-L200】

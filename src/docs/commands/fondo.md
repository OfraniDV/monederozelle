# /fondo

## Descripción
El comando ejecuta el asesor financiero avanzado definido en `middlewares/fondoAdvisor.js`. Calcula liquidez neta en CUP, inventario en USD y planes de venta basados en la configuración del entorno y los saldos más recientes de cada tarjeta.【F:commands/fondo.js†L1-L7】【F:middlewares/fondoAdvisor.js†L1094-L1233】

## Flujo principal
1. Carga la configuración combinando valores por defecto con variables de entorno o sobrescrituras del comando.【F:middlewares/fondoAdvisor.js†L1102-L1111】
2. Obtiene la tasa de compra desde la base de datos (o sobrescrituras) y los saldos actuales junto a los cierres del día y mes anteriores mediante `JOIN` laterales sobre `movimiento`.【F:middlewares/fondoAdvisor.js†L1117-L1155】【F:middlewares/fondoAdvisor.js†L496-L521】
3. Agrega los saldos: suma CUP positivos, separa deudas y construye inventario USD con tarjetas USD/MLC, respetando exclusiones por regex y bancos líquidos configurados.【F:middlewares/fondoAdvisor.js†L543-L612】
4. Calcula necesidades de efectivo, plan de venta y distribuciones sugeridas según límites mensuales, proyectando el estado posterior.【F:middlewares/fondoAdvisor.js†L1156-L1215】
5. Renderiza bloques HTML y los envía por privado si el comando se ejecuta en un grupo, usando `sendLargeMessage` para respetar límites de Telegram.【F:middlewares/fondoAdvisor.js†L1183-L1321】

## Entradas relevantes
- Variables de entorno `ADVISOR_*` y límites mensuales que ajustan tasas, colchón y bancos de liquidez.【F:middlewares/fondoAdvisor.js†L367-L418】【F:middlewares/fondoAdvisor.js†L1094-L1199】
- Saldos de tarjetas y tasa USD almacenada en la tabla `moneda`.【F:middlewares/fondoAdvisor.js†L496-L516】【F:middlewares/fondoAdvisor.js†L519-L539】

## Salidas
- Bloques con métricas de activos, deudas, urgencia y plan de acción en texto HTML, enviados mediante `sendLargeMessage` o la función `opts.send` cuando se invoca desde otros asistentes.【F:middlewares/fondoAdvisor.js†L1183-L1267】
- El bloque de venta anota los equivalentes en USD con la tasa neta de venta (`sellNet`) y, cuando no hay tasa de compra válida, omite esos aproximados para mantener la coherencia con la nota informativa final.【F:middlewares/fondoAdvisor.js†L918-L932】
- El bloque de deudas muestra cada tarjeta junto al agente en un `<pre>`, sin enmascarar el número y con el subtotal por agente y el total general incluyendo equivalente en USD cuando existe tasa de compra.【F:middlewares/fondoAdvisor.js†L890-L918】【F:middlewares/fondoAdvisor.js†L926-L941】
- La métrica `netoCup` descuenta automáticamente el colchón objetivo configurado para mostrar únicamente el efectivo disponible tras reservar esa cobertura.【F:middlewares/fondoAdvisor.js†L1238-L1245】
- El bloque «Comparativo temporal» confronta el colchón disponible actual con los cierres del día y del mes anteriores, mostrando la variación en CUP y su equivalente en USD cuando exista tasa de compra.【F:middlewares/fondoAdvisor.js†L872-L906】

## Dependencias
- Middleware `runFondo` es reusado por asistentes de tarjetas, monitor y extracto al abandonar sus escenas para mantener actualizado el diagnóstico financiero.【F:middlewares/fondoAdvisor.js†L1274-L1321】

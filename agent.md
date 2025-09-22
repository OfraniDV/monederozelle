# Agent Notes

- `buildSaveExitRow()` genera una sola fila con los botones `💾 Salvar` y `❌ Salir`.
- `buildSaveBackExitKeyboard()` genera el teclado estándar con `💾 Salvar`, `🔙 Volver` y `❌ Salir` en dos filas para mantener la escena abierta.
- `sendReportWithKb(ctx, pages, kb)` envía cada página del reporte y luego un mensaje
  final con esos botones.
- Los asistentes deben enviar primero el reporte y **después** un mensaje con el teclado;
  nunca se edita un mensaje largo para insertar botones.

## Asesor de Fondo

- El asistente de `/saldo` llama a `runFondo(ctx)` desde su `leaveMiddleware`; los asistentes de tarjetas/monitor/extracto lo
  hacen mediante el hook global en `registerFondoAdvisor` (usa `setImmediate` para esperar la persistencia de saldos).
- El reporte se arma con HTML plano (sin `<br>`/`<ul>`) y se envía con `sendLargeMessage` en `parse_mode: 'HTML'`.
- El análisis calcula necesidad = |deudas| + colchón − activos, determina la venta objetivo/instantánea a la tasa SELL y clasifica urgencia 🔴/🟠/🟢 según inventario disponible.
- Cuando el inventario USD no alcanza el mínimo configurado se muestra la alerta “⚠️ inventario menor al mínimo…”, y se omite cualquier sugerencia de ciclos de compra.
- El informe expone ahora la tasa de compra proveniente de `moneda.tasa_usd`, la tasa de venta configurada y las equivalencias en USD para Activos y Neto usando esa tasa de compra.
- La sección 🏦 Liquidez rápida disponible añade el equivalente en USD por banco cuando hay tasa de compra válida; si no, conserva solo los montos en CUP.

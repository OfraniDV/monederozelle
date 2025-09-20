# Agent Notes

- `buildSaveExitRow()` genera una sola fila con los botones `💾 Salvar` y `❌ Salir`.
- `sendReportWithKb(ctx, pages, kb)` envía cada página del reporte y luego un mensaje
  final con esos botones.
- Los asistentes deben enviar primero el reporte y **después** un mensaje con el teclado;
  nunca se edita un mensaje largo para insertar botones.

## Asesor de Fondo

- El asistente de `/saldo` llama a `runFondo(ctx)` desde su `leaveMiddleware`; los asistentes de tarjetas/monitor/extracto lo
  hacen mediante el hook global en `registerFondoAdvisor` (usa `setImmediate` para esperar la persistencia de saldos).
- El reporte se arma con HTML plano (sin `<br>`/`<ul>`) y se envía con `sendLargeMessage` en `parse_mode: 'HTML'`.
- Los cálculos usan la tasa SELL de la base (fallback en env), aplican colchón de 150 000 CUP y clasifican urgencia 🔴/🟠/🟢.

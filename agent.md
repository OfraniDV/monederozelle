# Agent Notes

- `buildSaveExitRow()` genera una sola fila con los botones `💾 Salvar` y `❌ Salir`.
- `sendReportWithKb(ctx, pages, kb)` envía cada página del reporte y luego un mensaje
  final con esos botones.
- Los asistentes deben enviar primero el reporte y **después** un mensaje con el teclado;
  nunca se edita un mensaje largo para insertar botones.

## Asesor de Fondo

- `runFondo(ctx)` calcula la venta USD necesaria tras los asistentes de saldo/tarjetas/monitor/extracto usando `setImmediate`
  en el evento `leave` para esperar la persistencia de saldos.
- El reporte se arma con HTML plano (sin `<br>`/`<ul>`) y se envía con `sendLargeMessage` en `parse_mode: 'HTML'`.
- Los cálculos usan la tasa SELL de la base (fallback en env), aplican colchón de 150 000 CUP y clasifican urgencia 🔴/🟠/🟢.

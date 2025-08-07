# Agent Notes

- `buildSaveExitRow()` genera una sola fila con los botones `💾 Salvar` y `❌ Salir`.
- `sendReportWithKb(ctx, pages, kb)` envía cada página del reporte y luego un mensaje
  final con esos botones.
- Los asistentes deben enviar primero el reporte y **después** un mensaje con el teclado;
  nunca se edita un mensaje largo para insertar botones.

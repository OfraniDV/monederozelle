# Agent Notes

## Protocolo de contribución
- Documenta en la carpeta pertinente cada ajuste o hallazgo (README, docs, auditorías, TODO, etc.).
- Mantén intactas las lógicas vigentes y la base de datos salvo que una instrucción explícita indique lo contrario.
- Ubica las pruebas nuevas en `tests/` dentro de la subcarpeta correspondiente.

- `buildSaveExitRow()` genera una sola fila con los botones `💾 Salvar` y `❌ Salir`.
- `buildSaveBackExitKeyboard()` genera el teclado estándar con `💾 Salvar`, `🔙 Volver` y `❌ Salir` en dos filas para mantener la escena abierta.
- `sendReportWithKb(ctx, pages, kb)` envía cada página del reporte y luego un mensaje
  final con esos botones.
- Los asistentes deben enviar primero el reporte y **después** un mensaje con el teclado;
  nunca se edita un mensaje largo para insertar botones.
- Usa `helpers/wizardCancel.js` para todas las salidas: registra hooks opcionales con `registerCancelHooks(ctx, { beforeLeave, afterLeave })` y deja que `handleGlobalCancel(ctx)` limpie escena, estado y envíe “❌ Operación cancelada.” (responde a `/cancel`, `/salir`, `salir` y al botón `GLOBAL_CANCEL`).

## Asesor de Fondo

- El asistente de `/saldo` llama a `runFondo(ctx)` desde su `leaveMiddleware`; los asistentes de tarjetas/monitor/extracto lo
  hacen mediante el hook global en `registerFondoAdvisor` (usa `setImmediate` para esperar la persistencia de saldos).
- En grupos/supergrupos el informe se envía por DM al operador; si no es posible abrir chat, se omite para evitar spam.
- El reporte se arma con HTML plano (sin `<br>`/`<ul>`) y se envía con `sendLargeMessage` en `parse_mode: 'HTML'`.
- El análisis calcula necesidad = |deudas| + colchón − activos, determina la venta objetivo/instantánea a la tasa SELL y clasifica urgencia 🔴/🟠/🟢 según inventario disponible.
- Cuando el inventario USD no alcanza el mínimo configurado se muestra la alerta “⚠️ inventario menor al mínimo…”, y se omite cualquier sugerencia de ciclos de compra.
- El informe expone ahora la tasa de compra proveniente de `moneda.tasa_usd`, la tasa de venta configurada y las equivalencias en USD para Activos y Neto usando esa tasa de compra.
- La sección 🏦 Liquidez rápida disponible añade el equivalente en USD por banco cuando hay tasa de compra válida; si no, conserva solo los montos en CUP.

## Monitor

- El snapshot actual reportado por `/monitor` es la suma de saldos finales por tarjeta y debe coincidir con `/tarjetas`.
- El período se calcula como `saldo_fin_per − saldo_ini_per`, usando el saldo inmediatamente anterior al rango y el último saldo ≤ fin.
- Las tarjetas creadas dentro del rango arrancan con `saldo_ini_period = 0`; movimientos fuera del rango no inflan ese inicio.
- Se registran en los logs `cardsInRange`, `cardsBornInRange` y ejemplos de tarjetas cuyo inicio se fuerza a 0.
- Las equivalencias en USD usan la tasa actual almacenada en `moneda.tasa_usd`.

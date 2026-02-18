# /monitor (asistente)

## Descripción
Asistente de filtros para comparar rendimiento financiero por periodo, moneda, agente y banco antes de ejecutar `/monitor`.

## Flujo
1. Inicializa filtros por defecto.
2. Permite editar periodo/moneda/agente/banco.
3. Ejecuta `RUN` y delega en `runMonitor`.
4. Ofrece guardar, volver a consultar o salir.

## Navegación
- Todo el flujo usa un mensaje editable para reducir ruido.
- Botón opcional `Ver en privado` cuando se usa en grupos.
- Salida por `❌ Salir` o comandos de cancelación.

## Premium UI
- Botones de filtros (`PER_*`, `MO_*`, `AG_*`, `BK_*`, `RUN`) con iconografía premium automática.
- Botones de calendario también quedan cubiertos por mapeo premium por callback.

## Implementación
- `src/commands/monitor_assist.js`

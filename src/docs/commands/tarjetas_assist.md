# /tarjetas (asistente)

## Descripción
Asistente de consulta para ver tarjetas por distintas vistas: por agente, por moneda/banco, resumen global y listado completo.

## Flujo
1. Carga dataset de tarjetas con agente, banco y moneda.
2. Muestra menú principal de vistas.
3. Navega entre vistas con edición del mismo mensaje.
4. Para salidas largas, pagina/envía bloques sin romper HTML.

## Navegación
- Flujo basado en callbacks inline.
- Controles de `Volver` y `Salir`.
- Cancelación centralizada con `handleGlobalCancel`.

## Premium UI
- Botones de vista (`VIEW_*`) y navegación reciben icono premium automático.
- Fallback premium para callbacks no mapeados evita botones sin icono.

## Implementación
- `src/commands/tarjetas_assist.js`

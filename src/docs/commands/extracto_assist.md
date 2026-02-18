# /extracto (asistente)

## Descripción
Asistente para generar extractos bancarios con filtros por agente, moneda, banco, tarjeta y periodo.

## Flujo
1. Carga catálogos y estado inicial de filtros.
2. Navega entre menús de filtro.
3. Ejecuta `RUN` para construir el extracto.
4. Envía reporte paginado y opciones de continuidad.

## Navegación
- Menús inline con `Anterior`, `Menú inicial` y `Salir`.
- Manejo de `Volver` y cancelación global sin duplicar mensajes.

## Premium UI
- Autoemoji premium para callbacks de filtros (`FIL_*`, `AG_*`, `MO_*`, `BK_*`, `TA_*`, `PER_*`).
- Navegación y acciones (`RUN`, `GLOBAL_CANCEL`) con estilo/ícono automático.

## Implementación
- `src/commands/extracto_assist.js`

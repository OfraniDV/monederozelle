# /acceso (asistente)

## Descripción
Asistente de administración de usuarios autorizados. Permite listar, agregar y eliminar IDs de Telegram con acceso al bot.

## Flujo
1. Muestra lista de accesos actuales.
2. Permite eliminar desde botones `DEL_*`.
3. Permite agregar entrando en modo `ADD` e introduciendo ID.
4. Refresca la lista tras cada operación.

## Navegación
- Interacción inline en un solo mensaje.
- Salida por botón `❌ Salir` o cancelación global.

## Premium UI
- Botones de gestión (`ADD`, `DEL_*`, `GLOBAL_CANCEL`) con icono premium automático.
- Mapeo por callback garantiza cobertura en botones dinámicos.

## Implementación
- `src/commands/acceso_assist.js`

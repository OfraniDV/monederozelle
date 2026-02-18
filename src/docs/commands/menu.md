# /menu (ASSISTANT_MENU)

## Descripción
Asistente de navegación global para abrir cualquier asistente disponible, ahora organizado por categorías.

## Categorías
- `💼 Operación diaria`: saldo y tarjetas.
- `📊 Análisis y reportes`: monitor y extracto.
- `🛠 Administración` (solo owner): accesos y asistentes de mantenimiento.

## Flujo
1. Entra a la escena `ASSISTANT_MENU`.
2. Renderiza teclado inline agrupado por categoría.
3. El callback `ASSIST:<SCENE_ID>` valida permisos y entra a la escena objetivo.
4. `❌ Salir` cancela usando el controlador global.

## Navegación
- Los encabezados de categoría son botones `NOOP:CATEGORY:*` (informativos).
- El mensaje del menú se elimina al salir o al entrar al asistente elegido.

## Premium UI
- El teclado usa autoestilo/autoemoji global.
- Los callbacks `ASSIST:*` reciben emoji premium contextual según escena.

## Implementación
- `src/commands/assist_menu.js`
- `src/helpers/assistMenu.js`

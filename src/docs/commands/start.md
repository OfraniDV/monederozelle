# /start

## Descripción
`/start` es el hub principal del bot. Muestra un menú inline con accesos rápidos a asistentes, organizado por categorías.

## Flujo
1. Renderiza bienvenida + teclado inline categorizado.
2. `START:SCENE:<SCENE_ID>` abre el asistente elegido (si está permitido).
3. `🧭 Menú completo` entra en `ASSISTANT_MENU`.
4. `📜 Comandos` muestra ayuda inline y permite volver a `🏠 Inicio`.
5. `❌ Cerrar` reemplaza el menú por un mensaje de cierre.

## Navegación y control
- El handler responde `answerCbQuery()` antes de procesar callbacks.
- El mensaje de `/start` se edita en sitio cuando aplica (sin spamear mensajes nuevos).
- Se aplica deduplicación por `update_id` para evitar teclado duplicado por retries.
- Se mantiene un único menú de `/start` activo por chat (si existe uno anterior, se elimina).

## Permisos
- Usuarios con acceso: asistentes operativos (`SALDO_WIZ`, `TARJETAS_ASSIST`, `MONITOR_ASSIST`, `EXTRACTO_ASSIST`).
- Owners: además ven accesos administrativos (`TARJETA_WIZ`, `ACCESO_ASSIST`).

## Premium UI
- Todos los botones inline pasan por autoestilo global.
- Se inyecta `icon_custom_emoji_id` automático por texto/callback, con fallback para callbacks no mapeados.

## Implementación
- `src/app.js`
- `src/helpers/assistMenu.js`
- `src/helpers/telegramButtonStyle.js`

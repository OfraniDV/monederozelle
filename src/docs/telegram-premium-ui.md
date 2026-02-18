# Capa Global Premium UI (Telegram)

## Objetivo
Centralizar el procesamiento de textos y botones para:
- Aplicar emojis premium (`<tg-emoji>`) de forma global.
- Autoestilar botones con `style` e `icon_custom_emoji_id`.
- Evitar duplicación (DRY) en comandos y asistentes.
- Tener fallback automático cuando Telegram rechaza IDs premium o estilos.

## Archivos principales
- `src/helpers/premiumEmojis.js`: diccionario central de IDs premium (portado desde Bolitero).
- `src/helpers/premiumEmojiText.js`: reemplazo de emojis Unicode/`:TOKEN:` por etiquetas premium.
- `src/helpers/buttonInputParser.js`: normalizadores para estilo e `icon_custom_emoji_id`.
- `src/helpers/telegramButtonStyle.js`: reglas automáticas para estilo/iconos por intención del botón.
- `src/helpers/telegramButtonAutoStyle.js`: parchea `Markup.button`/`Markup.inlineKeyboard` globalmente.
- `src/helpers/telegramOutboundFilter.js`: transforma texto/opciones salientes.
- `src/helpers/telegramGlobalController.js`: controlador global que envuelve `bot.telegram` y aplica fallback.

## Integración global
Se instala al iniciar el bot:
- `src/bot.js` llama `installGlobalTelegramControllers(bot)`.

Con esto, todos los `ctx.reply`, `ctx.telegram.sendMessage`, `editMessageText`, envío con caption y teclados inline pasan por la misma capa.

## Fallbacks
Si Telegram devuelve errores de premium UI (`invalid custom emoji identifier`, `document_invalid`, `entity_text_invalid`, etc.):
1. Reintenta sin `icon_custom_emoji_id`/`style` y sin tags premium.
2. Si sigue fallando, reintenta en texto plano sin `parse_mode`.

## Variables de entorno útiles
- `PREMIUM_TEXT_EMOJI_ENABLED=true|false`
- `TELEGRAM_BUTTON_STYLES_ENABLED=true|false`
- `TELEGRAM_BUTTON_AUTO_STYLE_ENABLED=true|false`
- `TELEGRAM_BUTTON_AUTO_PREMIUM_EMOJI_ENABLED=true|false`

> Si no se definen, se usan valores por defecto compatibles con producción.

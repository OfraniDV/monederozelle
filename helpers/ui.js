// helpers/ui.js
//
// Funciones reutilizables para asistentes tipo wizard.
// Incluye:
//   - editIfChanged: evita el error 400 "message is not modified" comparando
//     el texto y el teclado anterior antes de editar.
//   - buildNavKeyboard: genera botones de navegación estándar.
//   - buildBackExitRow: fila con botones "Volver" y "Salir".
//
// Todos los mensajes usan parse_mode HTML; se asume que los textos dinámicos
// ya vienen saneados con escapeHtml.
const { Markup } = require('telegraf');

// Deep compare simplificado para reply_markup
function sameMarkup(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function editIfChanged(ctx, chatId, messageId, text, extra = {}, useCaption = false) {
  const last = ctx.wizard?.state?.lastRender || {};
  const markup = extra.reply_markup || null;
  if (last.text === text && sameMarkup(last.reply_markup, markup)) {
    return false; // sin cambios
  }
  const method = useCaption ? 'editMessageCaption' : 'editMessageText';
  await ctx.telegram[method](chatId, messageId, undefined, text, extra);
  ctx.wizard.state.lastRender = { text, reply_markup: markup };
  return true;
}

function buildBackExitRow() {
  return [
    Markup.button.callback('🔙 Volver', 'BACK'),
    Markup.button.callback('❌ Salir', 'EXIT'),
  ];
}

function buildNavKeyboard(totalPages) {
  const rows = [
    [
      Markup.button.callback('⏮️', 'FIRST'),
      Markup.button.callback('◀️', 'PREV'),
      Markup.button.callback('▶️', 'NEXT'),
      Markup.button.callback('⏭️', 'LAST'),
    ],
    buildBackExitRow(),
  ];
  return Markup.inlineKeyboard(rows);
}

module.exports = { editIfChanged, buildNavKeyboard, buildBackExitRow };

// helpers/ui.js
//
// Funciones reutilizables para asistentes tipo wizard.
// Incluye:
//   - editIfChanged: evita el error 400 "message is not modified" comparando
//     el texto y el teclado anterior antes de editar.
//   - buildNavKeyboard: genera botones de navegación estándar y controles de
//     Volver/Salir.
//   - arrangeInlineButtons: distribuye botones en filas de máximo dos.
//   - buildBackExitRow: fila con botones "Volver" y "Salir".
//
// Todos los mensajes usan parse_mode HTML; se asume que los textos dinámicos
// ya vienen saneados con escapeHtml.
const { Markup } = require('telegraf');

/**
 * Compara dos estructuras de reply_markup para detectar cambios.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function sameMarkup(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Edita el mensaje original solo si cambian texto o teclado.
 * Internamente usa ctx.wizard.state.msgId para mantener un único mensaje.
 *
 * @param {object} ctx   Contexto de Telegraf.
 * @param {string} text  Nuevo texto (parse_mode HTML).
 * @param {object} [extra] Opciones adicionales para Telegram.
 * @param {boolean} [useCaption=false] Si true, edita la caption.
 * @returns {Promise<boolean>} true si se editó el mensaje.
 */
async function editIfChanged(ctx, text, extra = {}, useCaption = false) {
  const chatId = ctx.chat?.id;
  const messageId = ctx.wizard?.state?.msgId;
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

/**
 * Fila estándar de navegación para volver o salir.
 * @param {string} [back='BACK']  Callback para volver.
 * @param {string} [exit='EXIT']  Callback para salir.
 * @returns {Array}
 */
function buildBackExitRow(back = 'BACK', exit = 'EXIT') {
  return [
    Markup.button.callback('🔙 Volver', back),
    Markup.button.callback('❌ Salir', exit),
  ];
}

/**
 * Construye un teclado estándar con controles de paginación.
 *
 * @param {object} opts
 * @param {string} [opts.first='FIRST'] Callback para ir a la primera página.
 * @param {string} [opts.prev='PREV']   Callback para ir a la anterior.
 * @param {string} [opts.next='NEXT']   Callback para ir a la siguiente.
 * @param {string} [opts.last='LAST']   Callback para ir a la última.
 * @param {string} [opts.back='BACK']   Callback para volver.
 * @param {string} [opts.exit='EXIT']   Callback para salir.
 * @param {Array}  [opts.extraRows=[]]  Filas adicionales a insertar antes de
 *                                      la fila Volver/Salir.
 * @returns {object} Objeto Markup.inlineKeyboard listo para usarse.
 */
function buildNavKeyboard({
  first = 'FIRST',
  prev = 'PREV',
  next = 'NEXT',
  last = 'LAST',
  back = 'BACK',
  exit = 'EXIT',
  extraRows = [],
} = {}) {
  const rows = [
    [
      Markup.button.callback('⏮️', first),
      Markup.button.callback('◀️', prev),
      Markup.button.callback('▶️', next),
      Markup.button.callback('⏭️', last),
    ],
    ...extraRows,
    buildBackExitRow(back, exit),
  ];
  return Markup.inlineKeyboard(rows);
}

/**
 * Organiza un arreglo plano de botones en filas de dos.
 * @param {Array} buttons Lista de botones (Markup.button.callback).
 * @returns {Array} Matriz con máximo dos botones por fila.
 */
function arrangeInlineButtons(buttons = []) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

module.exports = { editIfChanged, buildNavKeyboard, buildBackExitRow, arrangeInlineButtons };

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
const { chunkHtml } = require('./format');

const EXIT_HINT_TEXT = 'Puedes pulsar «Salir» o escribir "salir" en cualquier momento.';

function withExitHint(text = '') {
  const base = String(text).trimEnd();
  if (!base) {
    return EXIT_HINT_TEXT;
  }
  if (base.includes(EXIT_HINT_TEXT)) {
    return base;
  }
  return `${base}\n\n${EXIT_HINT_TEXT}`;
}

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
 * @param {string} [exit='GLOBAL_CANCEL']  Callback para salir.
 * @returns {Array}
 */
function buildBackExitRow(back = 'BACK', exit = 'GLOBAL_CANCEL') {
  return [
    Markup.button.callback('🔙 Volver', back),
    Markup.button.callback('❌ Salir', exit),
  ];
}

// UX-2025: fila estándar de guardado/salida en una sola fila
function buildSaveExitRow(save = 'SAVE', exit = 'GLOBAL_CANCEL') {
  return [
    Markup.button.callback('💾 Salvar', save),
    Markup.button.callback('❌ Salir', exit),
  ];
}

// UX-2025: teclado estándar con guardar, volver y salir en dos filas
function buildSaveBackExitKeyboard({ save = 'SAVE', back = 'BACK', exit = 'GLOBAL_CANCEL' } = {}) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💾 Salvar', save), Markup.button.callback('🔙 Volver', back)],
    [Markup.button.callback('❌ Salir', exit)],
  ]);
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
 * @param {string} [opts.exit='GLOBAL_CANCEL']   Callback para salir.
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
  exit = 'GLOBAL_CANCEL',
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
 * Organiza un arreglo plano de botones en filas.
 * Por defecto usa 2 botones por fila, pero si un botón tiene un texto
 * muy largo, se le asigna su propia fila.
 *
 * @param {Array} buttons Lista de botones.
 * @param {number} [maxPerRow=2] Máximo de botones por fila.
 * @param {number} [threshold=20] Umbral de longitud para forzar fila única.
 * @returns {Array} Matriz de botones.
 */
function arrangeInlineButtons(buttons = [], maxPerRow = 2, threshold = 18) {
  const rows = [];
  let currentRow = [];

  buttons.forEach((btn) => {
    const text = btn.text || '';
    const isLong = text.length > threshold;

    if (isLong) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([btn]);
    } else {
      currentRow.push(btn);
      if (currentRow.length >= maxPerRow) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
  });

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

// UX-2025: envía páginas y agrega teclado de acción al final
async function sendReportWithKb(ctx, pages = [], kbInline, { message } = {}) {
  const messageIds = [];
  for (const p of pages) {
    const parts = chunkHtml(p).filter((segment) => segment.trim());
    for (const part of parts) {
      const sent = await ctx.reply(part, { parse_mode: 'HTML' });
      messageIds.push(sent.message_id);
    }
  }
  const extra = { parse_mode: 'HTML' };
  if (kbInline) {
    extra.reply_markup = kbInline.reply_markup || kbInline;
  }
  const finalMsg = await ctx.reply(
    withExitHint(message || 'Reporte generado.\nSelecciona una acción:'),
    extra,
  );
  messageIds.push(finalMsg.message_id);
  return messageIds;
}

function ensureNavState(ctx) {
  if (!ctx?.wizard) return null;
  if (!ctx.wizard.state.nav) {
    ctx.wizard.state.nav = { stack: [] };
  }
  return ctx.wizard.state.nav;
}

async function deleteNavMessage(ctx) {
  const nav = ctx?.wizard?.state?.nav;
  const chatId = ctx.chat?.id;
  if (nav?.msgId && chatId) {
    await ctx.telegram.deleteMessage(chatId, nav.msgId).catch(() => {});
    nav.msgId = null;
  }
}

async function renderWizardMenu(ctx, { route, text, extra = {}, pushHistory = true } = {}) {
  const nav = ensureNavState(ctx);
  await deleteNavMessage(ctx);
  const payload = { parse_mode: 'HTML', ...extra };
  const msg = await ctx.reply(text, payload);
  if (nav) {
    if (pushHistory && nav.current) {
      nav.stack.push(nav.current);
    }
    nav.current = route;
    nav.msgId = msg.message_id;
  }
  if (ctx.wizard) {
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.route = route;
    if (ctx.wizard.state.lastRender) {
      delete ctx.wizard.state.lastRender;
    }
  }
  return msg;
}

async function goBackMenu(ctx, handlers = {}, { fallback } = {}) {
  const nav = ensureNavState(ctx);
  if (!nav || !nav.stack.length) {
    if (fallback) {
      await fallback(ctx);
    }
    return false;
  }
  const previousRoute = nav.stack.pop();
  const handler = handlers[previousRoute];
  if (typeof handler === 'function') {
    await handler(ctx, { pushHistory: false, fromBack: true });
    return true;
  }
  if (fallback) {
    await fallback(ctx);
  }
  return false;
}

async function clearWizardMenu(ctx) {
  await deleteNavMessage(ctx);
  const chatId = ctx.chat?.id;
  const resultIds = ctx?.wizard?.state?.resultMsgIds;
  if (Array.isArray(resultIds) && chatId) {
    for (const id of resultIds) {
      await ctx.telegram.deleteMessage(chatId, id).catch(() => {});
    }
    ctx.wizard.state.resultMsgIds = [];
  }
  if (ctx?.wizard?.state) {
    ctx.wizard.state.msgId = null;
    ctx.wizard.state.route = null;
    if (ctx.wizard.state.nav) {
      ctx.wizard.state.nav.stack = [];
      ctx.wizard.state.nav.current = null;
      ctx.wizard.state.nav.msgId = null;
    }
    if (ctx.wizard.state.lastRender) {
      delete ctx.wizard.state.lastRender;
    }
  }
}

module.exports = {
  editIfChanged,
  buildNavKeyboard,
  buildBackExitRow,
  arrangeInlineButtons,
  buildSaveExitRow,
  buildSaveBackExitKeyboard,
  sendReportWithKb,
  renderWizardMenu,
  goBackMenu,
  clearWizardMenu,
  withExitHint,
};

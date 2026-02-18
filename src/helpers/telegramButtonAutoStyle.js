'use strict';

const { Markup } = require('telegraf');
const {
  isButtonAutoStyleEnabled,
  applyAutoButtonStyle
} = require('./telegramButtonStyle');

const PATCH_FLAG = Symbol.for('bolitero.telegramButtonAutoStyle.patched');

function styleButtonRow(row) {
  if (!Array.isArray(row)) {
    return applyAutoButtonStyle(row);
  }
  return row.map((btn) => applyAutoButtonStyle(btn));
}

function styleInlineButtons(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => styleButtonRow(row));
}

function styleKeyboardButtons(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    return row.map((btn) => (typeof btn === 'string' ? btn : applyAutoButtonStyle(btn)));
  });
}

function applyAutoStyleToReplyMarkup(replyMarkup) {
  if (!replyMarkup || typeof replyMarkup !== 'object') {
    return replyMarkup;
  }

  const inlineKeyboard = Array.isArray(replyMarkup.inline_keyboard)
    ? styleInlineButtons(replyMarkup.inline_keyboard)
    : replyMarkup.inline_keyboard;
  const keyboard = Array.isArray(replyMarkup.keyboard)
    ? styleKeyboardButtons(replyMarkup.keyboard)
    : replyMarkup.keyboard;

  if (inlineKeyboard === replyMarkup.inline_keyboard && keyboard === replyMarkup.keyboard) {
    return replyMarkup;
  }

  return {
    ...replyMarkup,
    ...(inlineKeyboard ? { inline_keyboard: inlineKeyboard } : {}),
    ...(keyboard ? { keyboard } : {})
  };
}

function applyAutoStyleToMessageOptions(options) {
  if (!options || typeof options !== 'object') {
    return options;
  }

  if (options.reply_markup) {
    const styledMarkup = applyAutoStyleToReplyMarkup(options.reply_markup);
    if (styledMarkup === options.reply_markup) {
      return options;
    }
    return {
      ...options,
      reply_markup: styledMarkup
    };
  }

  if (options.inline_keyboard || options.keyboard) {
    return applyAutoStyleToReplyMarkup(options);
  }

  return options;
}

function patchMarkupButtonFactories() {
  if (!Markup?.button || typeof Markup.button !== 'object') {
    return;
  }

  for (const key of Object.keys(Markup.button)) {
    const original = Markup.button[key];
    if (typeof original !== 'function') continue;
    if (original?.[PATCH_FLAG]) continue;

    const wrapped = (...args) => {
      const button = original(...args);
      return applyAutoButtonStyle(button);
    };
    wrapped[PATCH_FLAG] = true;
    Markup.button[key] = wrapped;
  }
}

function patchInlineKeyboardBuilder() {
  if (typeof Markup.inlineKeyboard !== 'function') {
    return;
  }

  const original = Markup.inlineKeyboard;
  if (original?.[PATCH_FLAG]) {
    return;
  }

  const wrapped = (buttons, options) => {
    const styledButtons = styleInlineButtons(buttons);
    return original(styledButtons, options);
  };
  wrapped[PATCH_FLAG] = true;
  Markup.inlineKeyboard = wrapped;
}

function patchReplyKeyboardBuilder() {
  if (typeof Markup.keyboard !== 'function') {
    return;
  }

  const original = Markup.keyboard;
  if (original?.[PATCH_FLAG]) {
    return;
  }

  const wrapped = (buttons, options) => {
    const styledButtons = styleKeyboardButtons(buttons);
    return original(styledButtons, options);
  };
  wrapped[PATCH_FLAG] = true;
  Markup.keyboard = wrapped;
}

function patchTelegrafButtonStyles() {
  if (!isButtonAutoStyleEnabled()) {
    return;
  }

  patchMarkupButtonFactories();
  patchInlineKeyboardBuilder();
  patchReplyKeyboardBuilder();
}

module.exports = {
  applyAutoStyleToReplyMarkup,
  applyAutoStyleToMessageOptions,
  patchTelegrafButtonStyles
};

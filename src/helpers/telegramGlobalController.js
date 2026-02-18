'use strict';

const { patchTelegrafButtonStyles } = require('./telegramButtonAutoStyle');
const {
  styleMessageOptions,
  transformMessageText,
  transformCaptionOptions,
  normalizeOutgoingText,
  stripTgEmojiTags,
} = require('./telegramOutboundFilter');
const { stripPremiumEmojiTags } = require('./premiumEmojiText');

const WRAPPED_TELEGRAM = Symbol('premium.telegram.wrapped');

function extractErrorDescription(error = {}) {
  return String(error?.response?.description || error?.description || error?.message || '').toLowerCase();
}

function isPremiumUiError(error = {}) {
  const description = extractErrorDescription(error);
  const code = Number(error?.code ?? error?.response?.error_code ?? error?.error_code);
  if (code !== 400) return false;
  return (
    description.includes('invalid custom emoji identifier') ||
    description.includes('document_invalid') ||
    description.includes('file_id_invalid') ||
    description.includes('wrong file identifier') ||
    description.includes('entity_text_invalid') ||
    description.includes('can\'t parse entities') ||
    description.includes('button') && description.includes('style')
  );
}

function stripHtmlTags(text = '') {
  return String(text)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

function sanitizeReplyMarkup(markup) {
  if (!markup || typeof markup !== 'object') return markup;
  const next = Array.isArray(markup) ? [] : {};
  for (const [key, value] of Object.entries(markup)) {
    if (key === 'icon_custom_emoji_id' || key === 'style') {
      continue;
    }
    if (Array.isArray(value)) {
      next[key] = value.map((item) => sanitizeReplyMarkup(item));
      continue;
    }
    if (value && typeof value === 'object') {
      next[key] = sanitizeReplyMarkup(value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function buildPremiumFallbackText(input) {
  return normalizeOutgoingText(
    stripPremiumEmojiTags(stripTgEmojiTags(String(input ?? '')))
  );
}

function buildPlainFallbackText(input) {
  return normalizeOutgoingText(stripHtmlTags(buildPremiumFallbackText(input)));
}

function styleOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return options;
  return styleMessageOptions(options);
}

function fallbackOptions(options = {}, { removeParseMode = false } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return options;
  const next = {
    ...options,
    reply_markup: sanitizeReplyMarkup(options.reply_markup),
  };
  if (typeof next.caption === 'string') {
    next.caption = removeParseMode
      ? buildPlainFallbackText(next.caption)
      : buildPremiumFallbackText(next.caption);
  }
  if (removeParseMode) {
    delete next.parse_mode;
    delete next.parseMode;
    delete next.entities;
  }
  return next;
}

function createMessageArgs(args = []) {
  const next = Array.isArray(args) ? args.slice() : [];
  const options = styleOptions(next[2] || {});
  next[2] = options;
  next[1] = transformMessageText(next[1], options, { forcePremium: true });
  return next;
}

function createEditTextArgs(args = []) {
  const next = Array.isArray(args) ? args.slice() : [];
  const options = styleOptions(next[4] || {});
  next[4] = options;
  next[3] = transformMessageText(next[3], options, { forcePremium: true });
  return next;
}

function createCaptionArgs(args = [], optionsIndex = 2) {
  const next = Array.isArray(args) ? args.slice() : [];
  const options = transformCaptionOptions(styleOptions(next[optionsIndex] || {}), {
    forcePremium: true,
  });
  next[optionsIndex] = options;
  return next;
}

function createEditCaptionArgs(args = []) {
  const next = Array.isArray(args) ? args.slice() : [];
  const options = styleOptions(next[4] || {});
  next[3] = transformMessageText(next[3], options, { forcePremium: true });
  const captionOptions = transformCaptionOptions(options, { forcePremium: true });
  next[4] = captionOptions;
  return next;
}

function createCbArgs(args = []) {
  const next = Array.isArray(args) ? args.slice() : [];
  if (typeof next[1] === 'string') {
    next[1] = buildPremiumFallbackText(next[1]).slice(0, 200);
  }
  return next;
}

function makeRetries({ original, label, name, premiumArgs, premiumTextIndex, optionsIndex }) {
  return async () => {
    try {
      return await original(...premiumArgs);
    } catch (error) {
      if (!isPremiumUiError(error)) throw error;
      console.warn(`[premium-ui] ${label}.${name} fallback premium->safe:`, error.message);

      const safeArgs = premiumArgs.slice();
      if (premiumTextIndex !== null && premiumTextIndex >= 0) {
        safeArgs[premiumTextIndex] = buildPremiumFallbackText(safeArgs[premiumTextIndex]);
      }
      if (optionsIndex !== null && optionsIndex >= 0) {
        safeArgs[optionsIndex] = fallbackOptions(safeArgs[optionsIndex], { removeParseMode: false });
      }
      try {
        return await original(...safeArgs);
      } catch (errorSafe) {
        if (!isPremiumUiError(errorSafe)) throw errorSafe;
        console.warn(`[premium-ui] ${label}.${name} fallback safe->plain:`, errorSafe.message);
        const plainArgs = safeArgs.slice();
        if (premiumTextIndex !== null && premiumTextIndex >= 0) {
          plainArgs[premiumTextIndex] = buildPlainFallbackText(plainArgs[premiumTextIndex]);
        }
        if (optionsIndex !== null && optionsIndex >= 0) {
          plainArgs[optionsIndex] = fallbackOptions(plainArgs[optionsIndex], { removeParseMode: true });
        }
        return original(...plainArgs);
      }
    }
  };
}

function wrapTelegramMethod(telegram, name, transformArgs, retryMeta = {}) {
  const current = telegram?.[name];
  if (typeof current !== 'function') return;
  if (current?.[WRAPPED_TELEGRAM]) return;
  const original = current.bind(telegram);

  const wrapped = async (...args) => {
    const premiumArgs = transformArgs ? transformArgs(args) : args;
    const { premiumTextIndex = null, optionsIndex = null, label = 'telegram' } = retryMeta;
    const run = makeRetries({
      original,
      label,
      name,
      premiumArgs,
      premiumTextIndex,
      optionsIndex,
    });
    return run();
  };
  wrapped[WRAPPED_TELEGRAM] = true;
  telegram[name] = wrapped;
}

function wrapTelegramForPremium(telegram, { label = 'telegram' } = {}) {
  if (!telegram || typeof telegram !== 'object') return telegram;
  if (telegram[WRAPPED_TELEGRAM]) return telegram;

  patchTelegrafButtonStyles();

  wrapTelegramMethod(
    telegram,
    'sendMessage',
    createMessageArgs,
    { label, premiumTextIndex: 1, optionsIndex: 2 }
  );
  wrapTelegramMethod(
    telegram,
    'editMessageText',
    createEditTextArgs,
    { label, premiumTextIndex: 3, optionsIndex: 4 }
  );
  wrapTelegramMethod(
    telegram,
    'sendPhoto',
    (args) => createCaptionArgs(args, 2),
    { label, premiumTextIndex: null, optionsIndex: 2 }
  );
  wrapTelegramMethod(
    telegram,
    'sendVideo',
    (args) => createCaptionArgs(args, 2),
    { label, premiumTextIndex: null, optionsIndex: 2 }
  );
  wrapTelegramMethod(
    telegram,
    'sendAnimation',
    (args) => createCaptionArgs(args, 2),
    { label, premiumTextIndex: null, optionsIndex: 2 }
  );
  wrapTelegramMethod(
    telegram,
    'sendDocument',
    (args) => createCaptionArgs(args, 2),
    { label, premiumTextIndex: null, optionsIndex: 2 }
  );
  wrapTelegramMethod(
    telegram,
    'editMessageCaption',
    createEditCaptionArgs,
    { label, premiumTextIndex: 3, optionsIndex: 4 }
  );
  wrapTelegramMethod(
    telegram,
    'answerCbQuery',
    createCbArgs,
    { label, premiumTextIndex: 1, optionsIndex: 2 }
  );

  telegram[WRAPPED_TELEGRAM] = true;
  return telegram;
}

function installGlobalTelegramControllers(bot) {
  if (!bot) return;
  wrapTelegramForPremium(bot.telegram, { label: 'bot.telegram' });
  bot.use(async (ctx, next) => {
    wrapTelegramForPremium(ctx.telegram, { label: 'ctx.telegram' });
    return next();
  });
}

module.exports = {
  installGlobalTelegramControllers,
  wrapTelegramForPremium,
  sanitizeReplyMarkup,
};

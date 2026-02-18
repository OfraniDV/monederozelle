'use strict';

const { applyAutoStyleToMessageOptions } = require('./telegramButtonAutoStyle');
const { replaceKnownPremiumEmojis, stripPremiumEmojiTags } = require('./premiumEmojiText');

function sanitizeTelegramText(input = '') {
  const str = input == null ? '' : String(input);
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);

    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        out += str[i] + str[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue;
    if (code === 0x00) continue;
    if (code < 0x20 && code !== 0x0A && code !== 0x09 && code !== 0x0D) continue;
    if (code === 0x7F) continue;
    out += str[i];
  }
  return out;
}

function normalizeParseMode(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return null;
  }
  return options.parse_mode || options.parseMode || null;
}

function styleMessageOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return options;
  }
  return applyAutoStyleToMessageOptions(options);
}

function normalizeOutgoingText(value, { warnOnObject = false } = {}) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str === '[object Object]' && typeof value === 'object') {
    if (warnOnObject) {
      console.error('[telegramOutboundFilter] Se intento enviar un objeto como texto:', JSON.stringify(value));
    }
    return '[ERROR] El sistema intento enviar un objeto en lugar de texto.';
  }
  return sanitizeTelegramText(str);
}

function stripTgEmojiTags(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .replace(/<tg-emoji\b[^>]*>/gi, '')
    .replace(/<\/tg-emoji>/gi, '');
}

function transformMessageText(text, options = {}, { forcePremium = true } = {}) {
  if (typeof text !== 'string') {
    return text;
  }

  const currentMode = normalizeParseMode(options);
  const isMarkdown = currentMode === 'Markdown' || currentMode === 'MarkdownV2';
  if (isMarkdown) {
    return normalizeOutgoingText(text);
  }

  const replaced = replaceKnownPremiumEmojis(text, {
    parseMode: currentMode,
    force: forcePremium
  });

  if (/<tg-emoji\b/i.test(replaced) && !currentMode && options && typeof options === 'object' && !Array.isArray(options)) {
    options.parse_mode = 'HTML';
  }

  return normalizeOutgoingText(replaced);
}

function transformCaptionOptions(options, { forcePremium = true } = {}) {
  const styled = styleMessageOptions(options);
  if (!styled || typeof styled !== 'object' || Array.isArray(styled)) {
    return styled;
  }
  if (typeof styled.caption !== 'string') {
    return styled;
  }
  const caption = transformMessageText(styled.caption, styled, { forcePremium });
  if (caption === styled.caption) {
    return styled;
  }
  return {
    ...styled,
    caption
  };
}

function transformCaptionOptionsStrippingTgEmoji(options) {
  const styled = styleMessageOptions(options);
  if (!styled || typeof styled !== 'object' || Array.isArray(styled)) {
    return styled;
  }
  if (typeof styled.caption !== 'string') {
    return styled;
  }
  const normalizedCaption = normalizeOutgoingText(stripTgEmojiTags(styled.caption));
  if (normalizedCaption === styled.caption) {
    return styled;
  }
  return {
    ...styled,
    caption: normalizedCaption
  };
}

function hasRenderableTelegramText(value) {
  const safe = normalizeOutgoingText(value);
  const withoutPremium = stripPremiumEmojiTags(stripTgEmojiTags(safe));
  const withoutHtml = withoutPremium.replace(/<[^>]+>/g, '');
  const normalized = withoutHtml.replace(/&nbsp;/gi, ' ').trim();
  return normalized.length > 0;
}

module.exports = {
  normalizeParseMode,
  styleMessageOptions,
  normalizeOutgoingText,
  stripTgEmojiTags,
  transformMessageText,
  transformCaptionOptions,
  transformCaptionOptionsStrippingTgEmoji,
  hasRenderableTelegramText
};

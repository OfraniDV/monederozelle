'use strict';

// helpers/telegram.js
// -----------------------------------------------------------------------------
// Utilidades centralizadas para manejar errores comunes al usar la API de
// Telegram. En especial, los errores "can't parse entities" (HTML inválido)
// y "Unsupported start tag" suelen aparecer cuando enviamos textos complejos
// con parse_mode: 'HTML'. Este módulo expone funciones que permiten degradar
// el mensaje a texto plano de forma segura y reutilizable.
// -----------------------------------------------------------------------------

const ENTITY_PARSE_RE = /can't parse entities/i;
const UNSUPPORTED_TAG_RE = /unsupported start tag/i;
const INVALID_PREMIUM_RE = /invalid custom emoji identifier|document_invalid|file_id_invalid|wrong file identifier|entity_text_invalid/i;
const ALLOWED_TAGS = ['b', 'i', 'pre', 'code'];
const {
  styleMessageOptions,
  transformMessageText,
  transformCaptionOptions,
  stripTgEmojiTags,
  normalizeOutgoingText,
} = require('./telegramOutboundFilter');
const { stripPremiumEmojiTags } = require('./premiumEmojiText');

function normalizeErrorMessage(err = {}) {
  return (
    err?.response?.description ||
    err?.description ||
    err?.message ||
    ''
  );
}

function isEntityParseError(err) {
  const message = normalizeErrorMessage(err);
  return ENTITY_PARSE_RE.test(message) || UNSUPPORTED_TAG_RE.test(message) || INVALID_PREMIUM_RE.test(message);
}

function sanitizeAllowedHtml(html = '') {
  const raw = html ?? '';
  let safe = String(raw).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  ALLOWED_TAGS.forEach((tag) => {
    const open = new RegExp(`&lt;${tag}&gt;`, 'gi');
    const close = new RegExp(`&lt;\/${tag}&gt;`, 'gi');
    safe = safe.replace(open, `<${tag}>`).replace(close, `</${tag}>`);
  });
  return safe;
}

function logHtmlErrorSnippet(context, html = '') {
  if (typeof html !== 'string' || !html.length) return;
  const start = html.slice(0, 200);
  const end = html.slice(-200);
  console.warn(`${context} html start:`, start);
  console.warn(`${context} html end:`, end);
  const suspicious = /&lt;(?!\/?(?:b|i|pre|code)&gt;)/i;
  if (suspicious.test(html)) {
    console.warn(`${context} pista: probable '<' sin escapar fuera de <pre>`);
  }
}

function htmlToPlainText(html = '') {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?p[^>]*>/gi, '\n')
    .replace(/<\s*\/?div[^>]*>/gi, '\n')
    .replace(/<\s*\/?pre[^>]*>/gi, '\n')
    .replace(/<\s*\/?code[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function buildFallbackExtra(extra = {}) {
  const fallback = { ...extra };
  delete fallback.parse_mode;
  delete fallback.entities;
  if (fallback.reply_markup && typeof fallback.reply_markup === 'object') {
    const sanitizeMarkup = (node) => {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(sanitizeMarkup);
      const next = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === 'icon_custom_emoji_id' || key === 'style') continue;
        next[key] = sanitizeMarkup(value);
      }
      return next;
    };
    fallback.reply_markup = sanitizeMarkup(fallback.reply_markup);
  }
  return fallback;
}

async function safeReply(ctx, text, extra = {}, { transformText } = {}) {
  const options = styleMessageOptions({ ...extra });
  const transform = typeof transformText === 'function' ? transformText : null;
  const preparedSource = transform ? transform(text, options) : text;
  const prepared = transformMessageText(preparedSource, options, { forcePremium: true });
  try {
    return await ctx.reply(prepared, options);
  } catch (err) {
    if (!isEntityParseError(err) || !options.parse_mode) throw err;
    console.warn(
      '[telegram] parse error en ctx.reply, degradando mensaje:',
      normalizeErrorMessage(err),
    );
    logHtmlErrorSnippet('[telegram] ctx.reply', prepared);
    const fallbackSource = typeof prepared === 'string' ? prepared : String(prepared || '');
    const fallbackText = normalizeOutgoingText(
      stripPremiumEmojiTags(stripTgEmojiTags(htmlToPlainText(fallbackSource))),
    );
    const fallbackExtra = buildFallbackExtra(options);
    return ctx.reply(fallbackText, fallbackExtra);
  }
}

async function safeSendMessage(telegram, chatId, text, extra = {}, { transformText } = {}) {
  const options = styleMessageOptions({ ...extra });
  const transform = typeof transformText === 'function' ? transformText : null;
  const preparedSource = transform ? transform(text, options) : text;
  const prepared = transformMessageText(preparedSource, options, { forcePremium: true });
  try {
    return await telegram.sendMessage(chatId, prepared, options);
  } catch (err) {
    if (!isEntityParseError(err) || !options.parse_mode) throw err;
    console.warn(
      `[telegram] parse error enviando a ${chatId}, degradando mensaje:`,
      normalizeErrorMessage(err),
    );
    logHtmlErrorSnippet(`[telegram] sendMessage ${chatId}`, prepared);
    const fallbackSource = typeof prepared === 'string' ? prepared : String(prepared || '');
    const fallbackText = normalizeOutgoingText(
      stripPremiumEmojiTags(stripTgEmojiTags(htmlToPlainText(fallbackSource))),
    );
    const fallbackExtra = buildFallbackExtra(options);
    return telegram.sendMessage(chatId, fallbackText, fallbackExtra);
  }
}

module.exports = {
  safeReply,
  safeSendMessage,
  htmlToPlainText,
  isEntityParseError,
  sanitizeAllowedHtml,
};

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
  return ENTITY_PARSE_RE.test(message) || UNSUPPORTED_TAG_RE.test(message);
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
  return fallback;
}

async function safeReply(ctx, text, extra = {}, { transformText } = {}) {
  const options = { ...extra };
  try {
    return await ctx.reply(text, options);
  } catch (err) {
    if (!isEntityParseError(err) || !options.parse_mode) throw err;
    const fallbackText = transformText
      ? transformText(text, options, err)
      : htmlToPlainText(text);
    const fallbackExtra = buildFallbackExtra(options);
    console.warn(
      '[telegram] parse error en ctx.reply, degradando mensaje:',
      normalizeErrorMessage(err),
    );
    return ctx.reply(fallbackText, fallbackExtra);
  }
}

async function safeSendMessage(telegram, chatId, text, extra = {}, { transformText } = {}) {
  const options = { ...extra };
  try {
    return await telegram.sendMessage(chatId, text, options);
  } catch (err) {
    if (!isEntityParseError(err) || !options.parse_mode) throw err;
    const fallbackText = transformText
      ? transformText(text, options, err)
      : htmlToPlainText(text);
    const fallbackExtra = buildFallbackExtra(options);
    console.warn(
      `[telegram] parse error enviando a ${chatId}, degradando mensaje:`,
      normalizeErrorMessage(err),
    );
    return telegram.sendMessage(chatId, fallbackText, fallbackExtra);
  }
}

module.exports = {
  safeReply,
  safeSendMessage,
  htmlToPlainText,
  isEntityParseError,
};

/**
 * helpers/format.js
 *
 * Central helper for escaping dynamic content when using HTML parse mode.
 * All interactive messages should pass user-provided values through escapeHtml
 * to avoid Telegram parse errors or HTML injection. Extend here if a Markdown
 * fallback is ever required.
 */
const { safeSplitHtmlBlock } = require('./sendLargeMessage');

function escapeHtml(text) {
  if (!text && text !== 0) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  return Number.parseFloat(n || 0).toFixed(2);
}

function boldHeader(icon, text) {
  return `${icon} <b>${escapeHtml(text)}</b>`;
}

function chunkHtml(text, limit = 4000) {
  if (text === undefined || text === null) return [''];
  const str = String(text);
  if (str.length <= limit) return [str];
  return safeSplitHtmlBlock(str, limit);
}

module.exports = { escapeHtml, fmtMoney, boldHeader, chunkHtml };

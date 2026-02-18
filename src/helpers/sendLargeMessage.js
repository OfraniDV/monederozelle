// helpers/sendLargeMessage.js
//
// Envío de mensajes largos a Telegram respetando el límite de 4096
// caracteres. Recibe bloques lógicos de texto y los concatena hasta
// un margen seguro (4000). Si un bloque individual excede el límite,
// se divide conservando etiquetas HTML abiertas, cerrándolas al final
// de cada fragmento y reabriéndolas al comenzar el siguiente.
//
// Estrategia:
//   1. Agrupar bloques mientras no excedan el margen.
//   2. Si un bloque supera el límite, se corta en saltos de línea o
//      espacios cuidando de no romper etiquetas HTML.
//   3. Enviar las partes numeradas (1/N) solo cuando N > 1.
//   4. Fallback sin parse_mode (texto plano) si Telegram rechaza el HTML.
//
// También registra por consola cuántas partes se enviaron y su tamaño.

const { safeReply, sanitizeAllowedHtml } = require('./telegram');

const MAX_CHARS = 4000; // margen respecto al límite de 4096

/**
 * Reemplaza caracteres inválidos asegurando una cadena UTF-8 válida para Telegram.
 * @param {string} text
 * @returns {string}
 */
function sanitizeUtf8(text = '') {
  return Buffer.from(text, 'utf8').toString('utf8');
}

/**
 * Devuelve las etiquetas HTML abiertas que quedan sin cerrar en un
 * fragmento. Se usa para cerrar/reabrir al dividir.
 * @param {string} html
 * @returns {string[]} pila de etiquetas abiertas
 */
function getOpenTags(html = '') {
  const stack = [];
  const regex = /<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi;
  let m;
  while ((m = regex.exec(html))) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    if (full[1] === '/') {
      // cierre
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.splice(idx, 1);
    } else if (!full.endsWith('/>')) {
      // apertura (omitimos tags autoclosed tipo <br/>)
      stack.push(tag);
    }
  }
  return stack;
}

/**
 * Divide un bloque HTML en partes seguras sin romper etiquetas.
 * @param {string} block Texto HTML.
 * @param {number} limit  Máximo de caracteres por parte.
 * @returns {string[]} Partes divididas.
 */
function safeSplitHtmlBlock(block, limit = MAX_CHARS) {
  const parts = [];
  let text = block;
  let carry = [];
  while (text.length) {
    let slice = text.slice(0, limit);
    // Evitar cortar dentro de una etiqueta
    const lt = slice.lastIndexOf('<');
    const gt = slice.lastIndexOf('>');
    if (lt > gt) slice = slice.slice(0, lt);
    // Preferir corte en salto de línea o espacio
    if (slice.length === limit) {
      const nl = slice.lastIndexOf('\n');
      const sp = slice.lastIndexOf(' ');
      const cut = Math.max(nl, sp);
      if (cut > 0) slice = slice.slice(0, cut);
    }
    const open = getOpenTags(slice);
    const closing = open.map((t) => `</${t}>`).reverse().join('');
    const opening = carry.map((t) => `<${t}>`).join('');
    parts.push(opening + slice + closing);
    carry = open;
    text = text.slice(slice.length);
  }
  return parts;
}

/**
 * Envía bloques lógicos concatenados hasta ~4000 caracteres.
 * @param {object} ctx      Contexto de Telegraf.
 * @param {string[]} blocks Bloques de texto (HTML ya escapado).
 * @param {object} [opts]   Opciones extra para ctx.reply.
 */
async function sendLargeMessage(ctx, blocks = [], opts = {}) {
  const chunks = [];
  let buffer = '';
  blocks.forEach((b) => {
    const text = b.trim();
    if (!text) return;
    const sep = buffer ? '\n' : '';
    if (buffer && buffer.length + sep.length + text.length > MAX_CHARS) {
      chunks.push(buffer);
      buffer = text;
    } else if (text.length > MAX_CHARS) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      safeSplitHtmlBlock(text).forEach((p) => chunks.push(p));
    } else {
      buffer += sep + text;
    }
  });
  if (buffer) chunks.push(buffer);
  const total = chunks.length;
  const sizes = [];
  for (let i = 0; i < total; i++) {
    const prefix = total > 1 ? `(${i + 1}/${total})\n` : '';
    const msg = sanitizeUtf8(prefix + chunks[i]);
    await safeReply(ctx, msg, { parse_mode: 'HTML', ...opts }, { transformText: sanitizeAllowedHtml });
    sizes.push(msg.length);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`[sendLargeMessage] partes=${total} tamaños=${sizes.join(',')}`);
}

module.exports = { sendLargeMessage, safeSplitHtmlBlock, sanitizeUtf8 };

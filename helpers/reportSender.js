const { statsChatId, ownerIds } = require('../config');
const { escapeHtml } = require('./format');

async function notifyOwners(ctx, html, extra = {}) {
  for (const id of ownerIds) {
    try {
      await ctx.telegram.sendMessage(id, html, { parse_mode: 'HTML', ...extra });
    } catch (err) {
      console.error('[reportSender] error notificando a owner', id, err);
    }
  }
}

async function sendAndLog(ctx, html, extra = {}) {
  if (!html || !html.trim()) return null;
  const safe = html.trim();
  let msg = null;
  try {
    msg = await ctx.reply(safe, { parse_mode: 'HTML', ...extra });
  } catch (err) {
    console.error('[reportSender] error ctx.reply', err);
    await notifyOwners(ctx, `❗️ Error enviando reporte: ${escapeHtml(err.message)}`);
    return null;
  }
  const chatId = String(statsChatId || '').trim();
  if (chatId) {
    try {
      await ctx.telegram.sendMessage(chatId, safe, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[reportSender] error enviando a STATS_CHAT_ID', err);
      await notifyOwners(
        ctx,
        `⚠️ No se pudo enviar a STATS_CHAT_ID (${escapeHtml(err.message)})`,
      );
    }
  }
  return msg;
}

module.exports = { sendAndLog, notifyOwners };

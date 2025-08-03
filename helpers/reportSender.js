const { statsChatId, ownerIds } = require('../config');

async function sendAndLog(ctx, html, extra = {}) {
  const msg = await ctx.reply(html, { parse_mode: 'HTML', ...extra });
  if (statsChatId) {
    try {
      await ctx.telegram.sendMessage(statsChatId, html, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[reportSender] error enviando a STATS_CHAT_ID', err);
    }
  }
  return msg;
}

async function notifyOwners(ctx, html, extra = {}) {
  for (const id of ownerIds) {
    try {
      await ctx.telegram.sendMessage(id, html, { parse_mode: 'HTML', ...extra });
    } catch (err) {
      console.error('[reportSender] error notificando a owner', id, err);
    }
  }
}

module.exports = { sendAndLog, notifyOwners };

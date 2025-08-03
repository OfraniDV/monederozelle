const ownerIds = (process.env.OWNER_ID || '')
  .split(/[,\s]+/)
  .filter(Boolean)
  .map((id) => parseInt(id, 10))
  .filter((n) => !isNaN(n));

const statsChatId = process.env.STATS_CHAT_ID ? parseInt(process.env.STATS_CHAT_ID, 10) : null;
if (!statsChatId) {
  console.warn('[config] STATS_CHAT_ID no definido; se omitirá el reenvío de estadísticas.');
}

module.exports = { ownerIds, statsChatId };

const ownerIds = (process.env.OWNER_ID || '')
  .split(/[,\s]+/)
  .filter(Boolean)
  .map((id) => parseInt(id, 10))
  .filter((n) => !isNaN(n));

const statsChatId = process.env.STATS_CHAT_ID ? parseInt(process.env.STATS_CHAT_ID, 10) : null;
if (!statsChatId) {
  console.warn('[config] STATS_CHAT_ID no definido; se omitirá el reenvío de estadísticas.');
}

const comercialesGroupId = process.env.ID_GROUP_COMERCIALES
  ? parseInt(process.env.ID_GROUP_COMERCIALES, 10)
  : null;
if (!comercialesGroupId) {
  console.warn(
    '[config] ID_GROUP_COMERCIALES no definido; se omitirá el reenvío al grupo de comerciales.',
  );
}

module.exports = { ownerIds, statsChatId, comercialesGroupId };

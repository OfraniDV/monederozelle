// helpers/reportSender.js
// -----------------------------------------------------------------------------
// Envío centralizado de reportes:
//   • ctx.reply() al chat actual (devolvemos el objeto mensaje para poder
//     actualizar estados en los wizards).
//   • Reenvío opcional al grupo de estadísticas (STATS_CHAT_ID).
//   • Reenvío opcional al grupo de comerciales (ID_GROUP_COMERCIALES).
//   • Notificación a los owners cuando ocurre un error.
// -----------------------------------------------------------------------------

const { statsChatId, comercialesGroupId, ownerIds } = require('../config');
const { escapeHtml } = require('./format');
const { safeReply, safeSendMessage, sanitizeAllowedHtml } = require('./telegram');

/* -------------------------------------------------------------------------- */
/* Owners                                                                     */
/* -------------------------------------------------------------------------- */
async function notifyOwners(ctx, html, extra = {}) {
  for (const id of ownerIds) {
    try {
      await safeSendMessage(
        ctx.telegram,
        id,
        html,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...extra,
        },
        { transformText: sanitizeAllowedHtml }
      );
    } catch (err) {
      console.error('[reportSender] error notificando a owner', id, err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Enviar mensaje principal + reenvíos                                         */
/* -------------------------------------------------------------------------- */
async function sendAndLog(ctx, html, extra = {}) {
  if (!html || !html.trim()) return null;

  const safe = html.trim();
  let message = null;

  /* 1⃣  Enviar al chat actual */
  try {
    // Mezcla de opciones: garantizamos parse_mode y no rompemos reply_markup.
    const opts = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra, // reply_markup o lo que venga del caller
    };
    message = await safeReply(ctx, safe, opts, { transformText: sanitizeAllowedHtml });
  } catch (err) {
    console.error('[reportSender] error ctx.reply', err);
    await notifyOwners(
      ctx,
      `❗️ Error enviando reporte en chat ${ctx.chat?.id}: ${escapeHtml(
        err.message,
      )}`,
    );
    return null;
  }

  /* 2⃣  Reenvío al grupo de estadísticas */
  if (statsChatId) {
    try {
      await safeSendMessage(
        ctx.telegram,
        statsChatId,
        safe,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { transformText: sanitizeAllowedHtml }
      );
    } catch (err) {
      console.error('[reportSender] error enviando a STATS_CHAT_ID', err);
      await notifyOwners(
        ctx,
        `⚠️ No se pudo reenviar a STATS_CHAT_ID (${escapeHtml(err.message)})`,
      );
    }
  }

  /* 3⃣  Reenvío al grupo de comerciales (si existe) */
  if (comercialesGroupId) {
    try {
      await safeSendMessage(
        ctx.telegram,
        comercialesGroupId,
        safe,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { transformText: sanitizeAllowedHtml }
      );
    } catch (err) {
      console.error('[reportSender] error enviando a ID_GROUP_COMERCIALES', err);
      await notifyOwners(
        ctx,
        `⚠️ No se pudo reenviar a ID_GROUP_COMERCIALES (${escapeHtml(err.message)})`,
      );
    }
  }

  /* 4⃣  Devolver el mensaje para que el caller pueda usar message_id */
  return message;
}

module.exports = { sendAndLog, notifyOwners };

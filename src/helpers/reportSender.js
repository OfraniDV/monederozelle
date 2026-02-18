// helpers/reportSender.js
// -----------------------------------------------------------------------------
// Envío centralizado de reportes:
//   • ctx.reply() al chat actual (devolvemos el objeto mensaje para poder
//     actualizar estados en los wizards).
//   • Reenvío opcional al grupo de comerciales (ID_GROUP_COMERCIALES).
//   • Notificación a los owners cuando ocurre un error.
// -----------------------------------------------------------------------------

const { comercialesGroupId, ownerIds } = require('../config');
const { escapeHtml } = require('./format');
const { safeReply, safeSendMessage, sanitizeAllowedHtml } = require('./telegram');
const { Telegram } = require('telegraf');
const { wrapTelegramForPremium } = require('./telegramGlobalController');

let fallbackTelegram = null;

function getFallbackTelegram() {
  if (fallbackTelegram) return fallbackTelegram;
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  fallbackTelegram = new Telegram(token);
  wrapTelegramForPremium(fallbackTelegram, { label: 'reportSender.fallback' });
  return fallbackTelegram;
}

function resolveTelegram(ctx) {
  if (ctx?.telegram?.sendMessage) return ctx.telegram;
  return getFallbackTelegram();
}

/* -------------------------------------------------------------------------- */
/* Owners                                                                     */
/* -------------------------------------------------------------------------- */
async function notifyOwners(ctx, html, extra = {}) {
  const telegram = resolveTelegram(ctx);
  if (!telegram) {
    console.warn('[reportSender] No hay instancia de Telegram para notificar owners.');
    return;
  }
  for (const id of ownerIds) {
    try {
      await safeSendMessage(
        telegram,
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

  /* 2⃣  Reenvío al grupo de comerciales (si existe) */
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

  /* 3⃣  Devolver el mensaje para que el caller pueda usar message_id */
  return message;
}

module.exports = { sendAndLog, notifyOwners };

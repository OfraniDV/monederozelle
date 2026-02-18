// src/controllers/errorController.js
// -----------------------------------------------------------------------------
// Controlador centralizado de errores.
// Captura excepciones, loguea detalles y notifica a los OWNER_IDs.
// -----------------------------------------------------------------------------

const { notifyOwners } = require('../helpers/reportSender');
const { escapeHtml } = require('../helpers/format');

/**
 * Maneja un error de forma centralizada.
 * @param {Error} error - El objeto de error capturado.
 * @param {Object} ctx - El contexto de Telegraf (opcional).
 * @param {string} contextInfo - Información adicional del contexto (ej: nombre del comando).
 */
async function handleError(error, ctx = null, contextInfo = 'unknown') {
  const timestamp = new Date().toISOString();
  const errorCode = error.code || 'NO_CODE';
  const errorMessage = error.message || 'Error desconocido';
  const errorStack = error.stack || 'No hay stack trace disponible';

  // 1. Logging detallado en consola
  console.error(`[ERR] [${timestamp}] [${contextInfo}]`);
  console.error(`Mensaje: ${errorMessage}`);
  console.error(`Stack: ${errorStack}`);

  // 2. Notificación a Owners
  let userInfo = 'Sistema/Global';
  let chatId = 'N/A';

  if (ctx) {
    const from = ctx.from || {};
    userInfo = `@${from.username || 'sin_user'} (${from.id || 'sin_id'})`;
    chatId = ctx.chat?.id || 'N/A';
  }

  const reportHtml = 
    `🚨 <b>ERROR DETECTADO</b> 🚨\n\n` +
    `<b>Contexto:</b> <code>${escapeHtml(contextInfo)}</code>\n` +
    `<b>Usuario:</b> ${escapeHtml(userInfo)}\n` +
    `<b>Chat ID:</b> <code>${chatId}</code>\n` +
    `<b>Código:</b> <code>${escapeHtml(errorCode)}</code>\n` +
    `<b>Mensaje:</b> <code>${escapeHtml(errorMessage)}</code>\n\n` +
    `<b>Stack:</b>\n<pre>${escapeHtml(errorStack.substring(0, 1000))}</pre>`;

  try {
    // Si tenemos ctx, usamos notifyOwners que ya conoce los ownerIds
    if (ctx) {
      await notifyOwners(ctx, reportHtml);
    } else {
      // Fallback si no hay ctx (errores globales)
      // Nota: notifyOwners requiere ctx para acceder a ctx.telegram,
      // pero podríamos importar el bot directamente si fuera necesario.
      // Por ahora, asumimos que la mayoría de errores relevantes tienen ctx.
      console.warn('[errorController] Error sin contexto de Telegram, no se puede notificar por bot.');
    }
  } catch (err) {
    console.error('[errorController] Error al intentar notificar a owners:', err.message);
  }

  // 3. Respuesta al usuario (si hay ctx y es un mensaje/callback)
  if (ctx && (ctx.updateType === 'message' || ctx.updateType === 'callback_query')) {
    try {
      const userMessage = '⚠️ <b>Lo siento, ha ocurrido un error inesperado.</b>\n' +
        'El equipo técnico ha sido notificado automáticamente. Por favor, intenta de nuevo en unos momentos.';
      
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('❌ Error crítico').catch(() => {});
        await ctx.reply(userMessage, { parse_mode: 'HTML' }).catch(() => {});
      } else {
        await ctx.reply(userMessage, { parse_mode: 'HTML' }).catch(() => {});
      }
    } catch (err) {
      console.error('[errorController] Error al responder al usuario:', err.message);
    }
  }
}

module.exports = {
  handleError
};

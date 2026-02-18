'use strict';

const { flushOnExit } = require('./sessionSummary');
const { safeReply, sanitizeAllowedHtml } = require('./telegram');

const GLOBAL_CANCEL_TEXTS = ['/cancel', '/salir', 'salir'];
const GLOBAL_CANCEL_CALLBACKS = new Set(['GLOBAL_CANCEL', 'EXIT']);

function normalizeText(text = '') {
  return String(text).trim().toLowerCase();
}

function isGlobalCancel(ctx = {}) {
  const data = ctx.callbackQuery?.data;
  if (GLOBAL_CANCEL_CALLBACKS.has(data)) {
    return true;
  }
  const messageText = normalizeText(ctx.message?.text);
  if (!messageText) return false;
  return GLOBAL_CANCEL_TEXTS.includes(messageText);
}

function getCancelHooks(ctx = {}) {
  return ctx?.wizard?.state?.__cancelHooks || {};
}

function registerCancelHooks(ctx, hooks = {}) {
  if (!ctx?.wizard) return;
  if (!ctx.wizard.state) {
    ctx.wizard.state = {};
  }
  ctx.wizard.state.__cancelHooks = { ...hooks };
  const keys = Object.keys(ctx.wizard.state.__cancelHooks || {});
  console.log(`[GLOBAL_CANCEL] hooks registrados: ${keys.join(', ') || 'ninguno'}`);
}

function clearCancelHooks(ctx) {
  if (ctx?.wizard?.state?.__cancelHooks) {
    delete ctx.wizard.state.__cancelHooks;
    console.log('[GLOBAL_CANCEL] hooks limpiados');
  }
}

async function handleGlobalCancel(ctx = {}) {
  const viaCallback = Boolean(ctx.callbackQuery);
  if (!isGlobalCancel(ctx)) {
    return false;
  }
  const userId = ctx.from?.id || 'unknown_user';
  const chatId = ctx.chat?.id || 'unknown_chat';
  const transport = viaCallback ? 'callback' : 'message';
  console.log(`[GLOBAL_CANCEL] recibido via ${transport} user:${userId} chat:${chatId}`);

  if (viaCallback && typeof ctx.answerCbQuery === 'function') {
    try {
      await ctx.answerCbQuery();
      console.log('[GLOBAL_CANCEL] answerCbQuery resuelto');
    } catch (err) {
      console.warn('[GLOBAL_CANCEL] answerCbQuery falló:', err?.message || err);
    }
  }

  const hooks = { ...getCancelHooks(ctx) };
  if (typeof hooks.beforeLeave === 'function') {
    try {
      await hooks.beforeLeave(ctx);
      console.log('[GLOBAL_CANCEL] beforeLeave ejecutado');
    } catch (err) {
      console.error('[GLOBAL_CANCEL] beforeLeave error:', err);
    }
  }

  if (ctx.scene?.current) {
    try {
      await flushOnExit(ctx);
      console.log('[GLOBAL_CANCEL] flushOnExit completado');
    } catch (err) {
      console.error('[GLOBAL_CANCEL] flushOnExit error:', err);
    }
    try {
      await ctx.scene.leave();
      console.log('[GLOBAL_CANCEL] scene.leave completado');
    } catch (err) {
      console.error('[GLOBAL_CANCEL] scene.leave error:', err);
    }
  } else {
    console.log('[GLOBAL_CANCEL] sin escena activa');
  }

  if (ctx.wizard) {
    ctx.wizard.state = {};
    console.log('[GLOBAL_CANCEL] estado del wizard limpiado');
  }

  const notify = hooks.notify !== false;
  if (notify) {
    try {
      await safeReply(
        ctx,
        '❌ Operación cancelada.',
        { parse_mode: 'HTML' },
        { transformText: (text) => sanitizeAllowedHtml(text) },
      );
      console.log('[GLOBAL_CANCEL] confirmación enviada');
    } catch (err) {
      console.error('[GLOBAL_CANCEL] error enviando confirmación:', err);
    }
  } else {
    console.log('[GLOBAL_CANCEL] confirmación omitida por configuración');
  }

  if (typeof hooks.afterLeave === 'function') {
    try {
      await hooks.afterLeave(ctx);
      console.log('[GLOBAL_CANCEL] afterLeave ejecutado');
    } catch (err) {
      console.error('[GLOBAL_CANCEL] afterLeave error:', err);
    }
  }

  clearCancelHooks(ctx);
  return true;
}

module.exports = {
  isGlobalCancel,
  handleGlobalCancel,
  registerCancelHooks,
  clearCancelHooks,
};

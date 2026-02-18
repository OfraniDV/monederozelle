'use strict';

const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const { arrangeInlineButtons, editIfChanged, withExitHint, buildNavRow } = require('../helpers/ui');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');
const {
  ADVISOR_SETTING_KEYS,
  ADVISOR_SETTING_META,
  getAdvisorSettingsSnapshot,
  saveAdvisorSetting,
  deleteAdvisorSetting,
} = require('../helpers/advisorSettings');

const SET_PREFIX = 'CFG_SET:';
const RESET_PREFIX = 'CFG_RESET:';
const REFRESH_CB = 'CFG_REFRESH';
const BACK_CB = 'CFG_BACK';

function buildMainKeyboard() {
  const buttons = ADVISOR_SETTING_KEYS.map((key) => {
    const label = ADVISOR_SETTING_META[key]?.label || key;
    return Markup.button.callback(`⚙️ ${label}`, `${SET_PREFIX}${key}`);
  });
  const rows = arrangeInlineButtons(buttons);
  rows.push([
    Markup.button.callback('🔄 Actualizar', REFRESH_CB),
    Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'),
  ]);
  return { inline_keyboard: rows };
}

function buildEditKeyboard(key) {
  return {
    inline_keyboard: [
      [Markup.button.callback('🗑 Usar valor de .env', `${RESET_PREFIX}${key}`)],
      [
        Markup.button.callback('🔙 Volver', BACK_CB),
        Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'),
      ],
    ],
  };
}

async function renderMain(ctx) {
  const snapshot = await getAdvisorSettingsSnapshot();
  ctx.wizard.state.snapshot = snapshot;
  const flash = ctx.wizard.state.flash ? `${ctx.wizard.state.flash}\n\n` : '';
  ctx.wizard.state.flash = null;
  const lines = snapshot.map((item) => (
    `• <b>${escapeHtml(item.key)}</b>: <code>${escapeHtml(item.effectiveValue || '—')}</code> ` +
    `<i>[${item.source.toUpperCase()}]</i>`
  ));
  const text = withExitHint(
    `${flash}⚙️ <b>Configuración del Asesor de Fondo</b>\n\n` +
    'Toca un parámetro para editarlo.\n\n' +
    lines.join('\n')
  );
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: buildMainKeyboard(),
  });
  ctx.wizard.state.route = 'MAIN';
}

async function renderEdit(ctx, key) {
  const snapshot = await getAdvisorSettingsSnapshot();
  const item = snapshot.find((row) => row.key === key);
  if (!item) {
    ctx.wizard.state.flash = '⚠️ Parámetro no encontrado.';
    return renderMain(ctx);
  }
  ctx.wizard.state.editKey = key;
  const text = withExitHint(
    `✏️ <b>Editar ${escapeHtml(key)}</b>\n\n` +
    `Etiqueta: <b>${escapeHtml(item.label)}</b>\n` +
    `Valor actual: <code>${escapeHtml(item.effectiveValue || '—')}</code> <i>[${item.source.toUpperCase()}]</i>\n` +
    `Valor en .env: <code>${escapeHtml(item.envValue || '—')}</code>\n` +
    `Override DB: <code>${escapeHtml(item.dbValue ?? '—')}</code>\n\n` +
    'Escribe el nuevo valor en el chat para guardarlo.'
  );
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: buildEditKeyboard(key),
  });
  ctx.wizard.state.route = 'EDIT';
}

const fondoConfigAssist = new Scenes.WizardScene(
  'FONDO_CONFIG_ASSIST',
  async (ctx) => {
    const msg = await ctx.reply(withExitHint('Cargando configuración…'), { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    registerCancelHooks(ctx, {
      beforeLeave: async (innerCtx) => {
        const messageId = innerCtx.wizard?.state?.msgId;
        if (!messageId || !innerCtx.chat) return;
        await innerCtx.telegram
          .editMessageText(innerCtx.chat.id, messageId, undefined, '❌ Operación cancelada.', {
            parse_mode: 'HTML',
          })
          .catch(() => {});
      },
      afterLeave: enterAssistMenu,
      notify: false,
    });
    await renderMain(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;

    const data = ctx.callbackQuery?.data;
    if (data) {
      await ctx.answerCbQuery().catch(() => {});
      if (data === REFRESH_CB || data === BACK_CB) {
        return renderMain(ctx);
      }
      if (data.startsWith(SET_PREFIX)) {
        const key = data.slice(SET_PREFIX.length);
        return renderEdit(ctx, key);
      }
      if (data.startsWith(RESET_PREFIX)) {
        const key = data.slice(RESET_PREFIX.length);
        try {
          await deleteAdvisorSetting(key);
          ctx.wizard.state.flash = `✅ ${key} vuelve a usar el valor de .env.`;
        } catch (err) {
          ctx.wizard.state.flash = `❌ No se pudo restaurar ${key}: ${err.message}`;
        }
        return renderMain(ctx);
      }
      return;
    }

    if (ctx.message?.text && ctx.wizard.state.route === 'EDIT' && ctx.wizard.state.editKey) {
      const key = ctx.wizard.state.editKey;
      try {
        const savedValue = await saveAdvisorSetting(key, ctx.message.text, {
          userId: ctx.from?.id || null,
        });
        ctx.wizard.state.flash = `✅ ${key} guardado en DB con valor: ${savedValue}`;
      } catch (err) {
        return ctx.reply(withExitHint(`⚠️ ${escapeHtml(err.message)}`), {
          parse_mode: 'HTML',
          reply_markup: buildEditKeyboard(key),
        });
      }
      return renderMain(ctx);
    }
  }
);

module.exports = fondoConfigAssist;


const { flushOnExit } = require('./sessionSummary');

const DEFAULT_TEXT_COMMANDS = ['/cancel', '/salir', 'salir'];

function createExitHandler({
  callbackValues = ['EXIT'],
  textCommands = DEFAULT_TEXT_COMMANDS,
  message = '❌ Operación cancelada.',
  logPrefix,
  answerCallback = true,
  clearState = true,
  notify = true,
  beforeLeave,
  afterLeave,
} = {}) {
  const callbackSet = new Set(callbackValues);
  const textSet = new Set(textCommands.map((t) => t.toLowerCase()));

  return async function handleExit(ctx) {
    const data = ctx.callbackQuery?.data;
    const text = ctx.message?.text?.trim().toLowerCase();
    const viaCallback = data && callbackSet.has(data);
    const viaText = text && textSet.has(text);

    if (!viaCallback && !viaText) return false;

    if (viaCallback && answerCallback) {
      await ctx.answerCbQuery().catch(() => {});
    }

    if (logPrefix) {
      console.log(`[${logPrefix}] cancelado por el usuario`);
    }

    if (beforeLeave) {
      await beforeLeave(ctx, { viaCallback, viaText });
    }

    await flushOnExit(ctx).catch(() => {});

    if (ctx.scene?.current) {
      await ctx.scene.leave();
    }

    if (clearState && ctx.wizard) {
      ctx.wizard.state = {};
    }

    if (notify && message) {
      await ctx.reply(message, { parse_mode: 'HTML' }).catch(() => {});
    }

    if (afterLeave) {
      await afterLeave(ctx, { viaCallback, viaText });
    }

    return true;
  };
}

module.exports = { createExitHandler };

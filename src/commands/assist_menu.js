const { Scenes } = require('telegraf');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { buildMenuKeyboard, getMenuItems } = require('../helpers/assistMenu');
const { withExitHint } = require('../helpers/ui');

const assistMenu = new Scenes.WizardScene(
  'ASSISTANT_MENU',
  async (ctx) => {
    const msg = await ctx.reply(withExitHint('Selecciona una categoría y luego el asistente que quieres abrir:'), {
      parse_mode: 'HTML',
      reply_markup: buildMenuKeyboard(ctx).reply_markup,
    });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.route = 'MENU';
    registerCancelHooks(ctx, {
      beforeLeave: async (innerCtx) => {
        const messageId = innerCtx.wizard?.state?.msgId;
        if (!messageId || !innerCtx.chat) return;
        await innerCtx.telegram.deleteMessage(innerCtx.chat.id, messageId).catch(() => {});
      },
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (!data.startsWith('ASSIST:')) return;
    const scene = data.split(':')[1];
    const items = getMenuItems(ctx);
    const target = items.find((item) => item.scene === scene);
    if (!target) return;
    const messageId = ctx.wizard?.state?.msgId;
    if (messageId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch(() => {});
    }
    await ctx.scene.enter(target.scene);
  }
);

module.exports = assistMenu;

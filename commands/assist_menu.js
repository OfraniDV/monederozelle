const { Scenes } = require('telegraf');
const { createExitHandler } = require('../helpers/wizard');
const { buildMenuKeyboard, getMenuItems } = require('../helpers/assistMenu');

const wantExit = createExitHandler({
  logPrefix: 'assist_menu',
  notify: false,
  beforeLeave: async (ctx) => {
    const messageId = ctx.wizard?.state?.msgId;
    if (!messageId || !ctx.chat) return;
    await ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch(() => {});
  },
});

const assistMenu = new Scenes.WizardScene(
  'ASSISTANT_MENU',
  async (ctx) => {
    const msg = await ctx.reply('Selecciona un asistente para continuar:', {
      parse_mode: 'HTML',
      reply_markup: buildMenuKeyboard(ctx).reply_markup,
    });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.route = 'MENU';
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
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

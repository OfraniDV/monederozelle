/**
 * commands/monitor_assist.js
 *
 * Wizard interactivo para el comando /monitor.
 * Muestra un menú de periodos y delega en runMonitor para generar los reportes.
 */

const { Scenes, Markup } = require('telegraf');
const { runMonitor } = require('./monitor');

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Día', 'PER_dia')],
    [Markup.button.callback('📆 Semana', 'PER_semana')],
    [Markup.button.callback('📅 Mes', 'PER_mes')],
    [Markup.button.callback('🗓 Año', 'PER_ano')],
    [Markup.button.callback('❌ Salir', 'EXIT')],
  ]);
}

const monitorAssist = new Scenes.WizardScene(
  'MONITOR_ASSIST',
  async (ctx) => {
    const msg = await ctx.reply(
      '📈 *Monitor*\nElige el periodo que deseas consultar:',
      { parse_mode: 'MarkdownV2', ...mainMenu() }
    );
    ctx.wizard.state.msgId = msg.message_id;
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'EXIT') {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.wizard.state.msgId,
        undefined,
        '❌ Operación cancelada.'
      );
      return ctx.scene.leave();
    }
    const periodo = data.split('_')[1];
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      ctx.wizard.state.msgId,
      undefined,
      'Generando reporte...'
    );
    await runMonitor(ctx, `/monitor ${periodo}`);
    return ctx.scene.leave();
  }
);

module.exports = monitorAssist;

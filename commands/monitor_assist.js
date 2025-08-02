/**
 * commands/monitor_assist.js
 *
 * Wizard interactivo para el comando /monitor.
 * Muestra un menú de periodos y delega en runMonitor para generar los reportes.
 */

// Migrado a HTML parse mode; escapeHtml centraliza la sanitización de datos
// dinámicos. Para un fallback a Markdown, ajustar los textos y parse_mode.
const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
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
    console.log('[MONITOR_ASSIST] paso 0: menú de periodos');
    const msg = await ctx.reply(
      '📈 <b>Monitor</b>\nElige el periodo que deseas consultar:',
      { parse_mode: 'HTML', ...mainMenu() }
    );
    ctx.wizard.state.msgId = msg.message_id;
    return ctx.wizard.next();
  },
  async (ctx) => {
    console.log('[MONITOR_ASSIST] paso 1: ejecutar monitor');
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'EXIT') {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.wizard.state.msgId,
        undefined,
        '❌ Operación cancelada.',
        { parse_mode: 'HTML' }
      );
      return ctx.scene.leave();
    }
    const periodo = escapeHtml(data.split('_')[1]);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      ctx.wizard.state.msgId,
      undefined,
      'Generando reporte...',
      { parse_mode: 'HTML' }
    );
    await runMonitor(ctx, `/monitor ${periodo}`);
    return ctx.scene.leave();
  }
);

module.exports = monitorAssist;

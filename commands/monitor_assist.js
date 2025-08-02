/**
 * commands/monitor_assist.js
 *
 * Wizard interactivo para /monitor con filtros combinables.
 *
 * Correcciones:
 * - Uso de editIfChanged para evitar errores de "message is not modified".
 * - Menú jerárquico para elegir periodo, moneda, agente y banco con posibilidad de
 *   combinar filtros.
 * - Botón "💬 Ver en privado" cuando se ejecuta en grupos.
 * - Distribución de botones en filas de dos usando arrangeInlineButtons.
 *
 * Todo el texto dinámico se sanitiza con escapeHtml y se usa parse_mode HTML.
 *
 * Casos de prueba manuales:
 * - Combinar filtros: seleccionar periodo y agente, ejecutar y volver.
 * - Usar en grupo y presionar "Ver en privado".
 * - Navegación entre menús sin crear mensajes nuevos ni errores 400.
 */

const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
} = require('../helpers/ui');
const pool = require('../psql/db.js');
const { runMonitor } = require('./monitor');

async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'EXIT') {
    await ctx.answerCbQuery().catch(() => {});
    const msgId = ctx.wizard.state.msgId;
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msgId,
      undefined,
      '❌ Operación cancelada.',
      { parse_mode: 'HTML' }
    );
    await ctx.scene.leave();
    return true;
  }
  return false;
}

async function showMain(ctx) {
  const f = ctx.wizard.state.filters;
  const text =
    `📈 <b>Monitor</b>\n` +
    `Periodo: <b>${escapeHtml(f.period)}</b>\n` +
    `Moneda: <b>${escapeHtml(f.monedaNombre || 'Todas')}</b>\n` +
    `Agente: <b>${escapeHtml(f.agenteNombre || 'Todos')}</b>\n` +
    `Banco: <b>${escapeHtml(f.bancoNombre || 'Todos')}</b>\n\n` +
    'Selecciona un filtro o ejecuta el reporte:';
  const buttons = [
    Markup.button.callback('📆 Periodo', 'PERIOD'),
    Markup.button.callback('💱 Moneda', 'CURR'),
    Markup.button.callback('👤 Agente', 'AGENT'),
    Markup.button.callback('🏦 Banco', 'BANK'),
    Markup.button.callback('🔍 Consultar', 'RUN'),
  ];
  if (ctx.chat.type !== 'private') {
    buttons.push(Markup.button.callback('💬 Ver en privado', 'PRIVATE'));
  }
  buttons.push(Markup.button.callback('❌ Salir', 'EXIT'));
  const kb = arrangeInlineButtons(buttons);
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'MAIN';
}

async function showPeriodMenu(ctx) {
  const buttons = [
    Markup.button.callback('📊 Día', 'PER_dia'),
    Markup.button.callback('📆 Semana', 'PER_semana'),
    Markup.button.callback('📅 Mes', 'PER_mes'),
    Markup.button.callback('🗓 Año', 'PER_ano'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = 'Selecciona el periodo:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'PERIOD';
}

async function showAgentMenu(ctx) {
  const rows = (
    await pool.query('SELECT id,nombre,emoji FROM agente ORDER BY nombre')
  ).rows;
  const buttons = [
    Markup.button.callback('Todos', 'AG_0'),
    ...rows.map((a) =>
      Markup.button.callback(
        `${a.emoji ? a.emoji + ' ' : ''}${escapeHtml(a.nombre)}`,
        `AG_${a.id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = 'Selecciona el agente:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'AGENT';
  ctx.wizard.state.tmpAgents = rows; // para buscar nombre luego
}

async function showBankMenu(ctx) {
  const rows = (
    await pool.query('SELECT id,codigo,emoji FROM banco ORDER BY codigo')
  ).rows;
  const buttons = [
    Markup.button.callback('Todos', 'BK_0'),
    ...rows.map((b) =>
      Markup.button.callback(
        `${b.emoji ? b.emoji + ' ' : ''}${escapeHtml(b.codigo)}`,
        `BK_${b.id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = 'Selecciona el banco:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'BANK';
  ctx.wizard.state.tmpBanks = rows;
}

async function showCurrMenu(ctx) {
  const rows = (
    await pool.query('SELECT id,codigo,emoji FROM moneda ORDER BY codigo')
  ).rows;
  const buttons = [
    Markup.button.callback('Todas', 'MO_0'),
    ...rows.map((m) =>
      Markup.button.callback(
        `${m.emoji ? m.emoji + ' ' : ''}${escapeHtml(m.codigo)}`,
        `MO_${m.id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = 'Selecciona la moneda:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'CURR';
  ctx.wizard.state.tmpMons = rows;
}

/* ───────── Wizard ───────── */
const monitorAssist = new Scenes.WizardScene(
  'MONITOR_ASSIST',
  async (ctx) => {
    console.log('[MONITOR_ASSIST] paso 0: menú principal');
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.filters = { period: 'dia', monedaNombre: 'Todas' };
    await showMain(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const route = ctx.wizard.state.route;
    switch (route) {
      case 'MAIN':
        if (data === 'PERIOD') return showPeriodMenu(ctx);
        if (data === 'CURR') return showCurrMenu(ctx);
        if (data === 'AGENT') return showAgentMenu(ctx);
        if (data === 'BANK') return showBankMenu(ctx);
        if (data === 'RUN') {
          const f = ctx.wizard.state.filters;
          let cmd = `/monitor ${f.period}`;
          if (f.agenteId) cmd += ` --agente=${f.agenteId}`;
          if (f.bancoId) cmd += ` --banco=${f.bancoId}`;
          if (f.monedaId) cmd += ` --moneda=${f.monedaNombre}`;
          await editIfChanged(ctx, 'Generando reporte...', { parse_mode: 'HTML' });
          await runMonitor(ctx, cmd);
          return ctx.scene.leave();
        }
        if (data === 'PRIVATE') {
          const username = ctx.botInfo?.username;
          if (username) {
            await ctx.reply(`💬 https://t.me/${username}`);
          }
          return showMain(ctx);
        }
        break;
      case 'PERIOD':
        if (data === 'BACK') return showMain(ctx);
        if (data.startsWith('PER_')) {
          const period = data.split('_')[1];
          ctx.wizard.state.filters.period = period;
          return showMain(ctx);
        }
        break;
      case 'CURR':
        if (data === 'BACK') return showMain(ctx);
        if (data.startsWith('MO_')) {
          const id = +data.split('_')[1];
          ctx.wizard.state.filters.monedaId = id || null;
          ctx.wizard.state.filters.monedaNombre = id
            ? ctx.wizard.state.tmpMons.find((m) => m.id === id)?.codigo || ''
            : 'Todas';
          return showMain(ctx);
        }
        break;
      case 'AGENT':
        if (data === 'BACK') return showMain(ctx);
        if (data.startsWith('AG_')) {
          const id = +data.split('_')[1];
          ctx.wizard.state.filters.agenteId = id || null;
          ctx.wizard.state.filters.agenteNombre = id
            ? ctx.wizard.state.tmpAgents.find((a) => a.id === id)?.nombre || ''
            : 'Todos';
          return showMain(ctx);
        }
        break;
      case 'BANK':
        if (data === 'BACK') return showMain(ctx);
        if (data.startsWith('BK_')) {
          const id = +data.split('_')[1];
          ctx.wizard.state.filters.bancoId = id || null;
          ctx.wizard.state.filters.bancoNombre = id
            ? ctx.wizard.state.tmpBanks.find((b) => b.id === id)?.codigo || ''
            : 'Todos';
          return showMain(ctx);
        }
        break;
      default:
        break;
    }
  }
);

module.exports = monitorAssist;

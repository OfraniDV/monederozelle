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
const moment = require('moment');
const { escapeHtml, boldHeader } = require('../helpers/format');
const { getDefaultPeriod } = require('../helpers/period');
const { sendAndLog } = require('../helpers/reportSender');
const { flushOnExit } = require('../helpers/sessionSummary');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
  buildSaveExitRow,
  sendReportWithKb,
} = require('../helpers/ui');
const pool = require('../psql/db.js');
const { runMonitor } = require('./monitor');

async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'EXIT') {
    await ctx.answerCbQuery().catch(() => {});
    await flushOnExit(ctx);
    if (ctx.scene?.current) await ctx.scene.leave();
    await ctx.reply('❌ Operación cancelada.');
    return true;
  }
  return false;
}

async function showMain(ctx) {
  const f = ctx.wizard.state.filters;
  const text =
    `${boldHeader('📈', 'Monitor')}\n` +
    `Periodo: <b>${escapeHtml(f.fecha || f.mes || f.period)}</b>\n` +
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

async function showDayMenu(ctx) {
  const today = moment().date();
  const daysInMonth = moment().daysInMonth();
  const buttons = [];
  for (let d = 1; d <= daysInMonth; d++) {
    buttons.push(
      Markup.button.callback(
        d <= today ? String(d) : `\uD83D\uDD12 ${d}`,
        d <= today ? `DAY_${d}` : 'LOCKED',
      ),
    );
  }
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  await editIfChanged(ctx, 'Selecciona el día:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'DAY';
}

async function showMonthMenu(ctx) {
  const now = moment();
  const current = now.month();
  const months = moment.months();
  const buttons = months.map((m, idx) =>
    Markup.button.callback(
      idx <= current ? m : `\uD83D\uDD12 ${m}`,
      idx <= current ? `MES_${idx + 1}` : 'LOCKED',
    ),
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  await editIfChanged(ctx, 'Selecciona el mes:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'MONTH';
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
    ctx.wizard.state.filters = {
      period: getDefaultPeriod(),
      monedaNombre: 'Todas',
      fecha: null,
      mes: null,
    };
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
          if (f.fecha) cmd += ` --fecha=${f.fecha}`;
          if (f.mes) cmd += ` --mes=${f.mes}`;
          await editIfChanged(ctx, 'Generando reporte...', { parse_mode: 'HTML' });
          const msgs = await runMonitor(ctx, cmd);
          ctx.wizard.state.lastReport = msgs;
          const kb = Markup.inlineKeyboard([buildSaveExitRow()]).reply_markup; // UX-2025
          await sendReportWithKb(ctx, [], kb); // UX-2025
          ctx.wizard.state.route = 'AFTER_RUN';
          return;
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
        if (data === 'PER_dia') return showDayMenu(ctx);
        if (data === 'PER_mes') return showMonthMenu(ctx);
        if (data.startsWith('PER_')) {
          const period = data.split('_')[1];
          ctx.wizard.state.filters.period = period;
          ctx.wizard.state.filters.fecha = null;
          ctx.wizard.state.filters.mes = null;
          return showMain(ctx);
        }
        break;
      case 'DAY':
        if (data === 'BACK') return showPeriodMenu(ctx);
        if (data === 'LOCKED') return ctx.answerCbQuery('No disponible');
        if (data.startsWith('DAY_')) {
          const d = data.split('_')[1];
          const now = moment();
          ctx.wizard.state.filters.period = 'dia';
          ctx.wizard.state.filters.fecha = `${now.format('YYYY-MM')}-${String(d).padStart(2, '0')}`;
          ctx.wizard.state.filters.mes = null;
          return showMain(ctx);
        }
        break;
      case 'MONTH':
        if (data === 'BACK') return showPeriodMenu(ctx);
        if (data === 'LOCKED') return ctx.answerCbQuery('No disponible');
        if (data.startsWith('MES_')) {
          const m = data.split('_')[1];
          const year = moment().format('YYYY');
          ctx.wizard.state.filters.period = 'mes';
          ctx.wizard.state.filters.mes = `${year}-${String(m).padStart(2, '0')}`;
          ctx.wizard.state.filters.fecha = null;
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
      case 'AFTER_RUN':
        if (data === 'SAVE') {
          const reps = ctx.wizard.state.lastReport || [];
          for (const m of reps) {
            await sendAndLog(ctx, m);
          }
          const kb = [
            [Markup.button.callback('Sí', 'AGAIN')],
            [Markup.button.callback('No', 'EXIT')],
          ];
          await ctx.reply('¿Deseas consultar otro usuario?', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
          ctx.wizard.state.route = 'ASK_AGAIN';
          return;
        }
        break;
      case 'ASK_AGAIN':
        if (data === 'AGAIN') {
          return showMain(ctx);
        }
        break;
      default:
        break;
    }
  }
);

module.exports = monitorAssist;
module.exports.showDayMenu = showDayMenu;
module.exports.showMonthMenu = showMonthMenu;

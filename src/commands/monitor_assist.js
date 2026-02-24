/**
 * commands/monitor_assist.js
 *
 * Wizard interactivo para /monitor con filtros combinables.
 *
 * Correcciones:
 * - Uso de renderWizardMenu para recrear menús sin editar mensajes previos.
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
const { escapeHtml, boldHeader, chunkHtml } = require('../helpers/format');
const { getDefaultPeriod } = require('../helpers/period');
const { sendAndLog } = require('../helpers/reportSender');
const {
  buildNavRow,
  buildBackExitRow,
  arrangeInlineButtons,
  buildSaveBackExitKeyboard,
  sendReportWithKb,
  renderWizardMenu,
  goBackMenu,
  clearWizardMenu,
  withExitHint,
} = require('../helpers/ui');
const pool = require('../psql/db.js');
const { runMonitor } = require('./monitor');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');

async function showMain(ctx, opts = {}) {
  const f = ctx.wizard.state.filters;
  const text = withExitHint(
    `${boldHeader('📈', 'Monitor')}\n` +
      `Periodo: <b>${escapeHtml(f.fecha || f.mes || f.period)}</b>\n` +
      `Moneda: <b>${escapeHtml(f.monedaNombre || 'Todas')}</b>\n` +
      `Agente: <b>${escapeHtml(f.agenteNombre || 'Todos')}</b>\n` +
      `Banco: <b>${escapeHtml(f.bancoNombre || 'Todos')}</b>\n` +
      `Equivalencia: <b>${escapeHtml(f.equiv === 'cup' ? 'CUP' : '—')}</b>\n\n` +
      'Selecciona un filtro o ejecuta el reporte:'
  );
  const buttons = [
    Markup.button.callback('📆 Periodo', 'PERIOD'),
    Markup.button.callback('💱 Moneda', 'CURR'),
    Markup.button.callback('👤 Agente', 'AGENT'),
    Markup.button.callback('🏦 Banco', 'BANK'),
  ];
  buttons.push(
    f.equiv === 'cup'
      ? Markup.button.callback('➖ Ocultar equivalente en CUP', 'EQ_OFF')
      : Markup.button.callback('➕ Mostrar equivalente en CUP', 'EQ_ON')
  );
  buttons.push(Markup.button.callback('🔍 Consultar', 'RUN'));
  if (ctx.chat.type !== 'private') {
    buttons.push(Markup.button.callback('💬 Ver en privado', 'PRIVATE'));
  }
  buttons.push(Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'));
  const kb = arrangeInlineButtons(buttons);
  await renderWizardMenu(ctx, {
    route: 'MAIN',
    text,
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
}

async function showPeriodMenu(ctx, opts = {}) {
  const buttons = [
    Markup.button.callback('📊 Día', 'PER_dia'),
    Markup.button.callback('📆 Semana', 'PER_semana'),
    Markup.button.callback('📅 Mes', 'PER_mes'),
    Markup.button.callback('🗓 Año', 'PER_ano'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = withExitHint('Selecciona el periodo:');
  await renderWizardMenu(ctx, {
    route: 'PERIOD',
    text,
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
}

async function showDayMenu(ctx, opts = {}) {
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
  await renderWizardMenu(ctx, {
    route: 'DAY',
    text: withExitHint('Selecciona el día:'),
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
}

async function showMonthMenu(ctx, opts = {}) {
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
  await renderWizardMenu(ctx, {
    route: 'MONTH',
    text: withExitHint('Selecciona el mes:'),
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
}

async function showAgentMenu(ctx, opts = {}) {
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
  const text = withExitHint('Selecciona el agente:');
  await renderWizardMenu(ctx, {
    route: 'AGENT',
    text,
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
  ctx.wizard.state.tmpAgents = rows; // para buscar nombre luego
}

async function showBankMenu(ctx, opts = {}) {
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
  const text = withExitHint('Selecciona el banco:');
  await renderWizardMenu(ctx, {
    route: 'BANK',
    text,
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
  ctx.wizard.state.tmpBanks = rows;
}

async function showCurrMenu(ctx, opts = {}) {
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
  const text = withExitHint('Selecciona la moneda:');
  await renderWizardMenu(ctx, {
    route: 'CURR',
    text,
    extra: { reply_markup: { inline_keyboard: kb } },
    pushHistory: opts.pushHistory ?? true,
  });
  ctx.wizard.state.tmpMons = rows;
}

const ROUTE_HANDLERS = {
  MAIN: (ctx, opts) => showMain(ctx, opts),
  PERIOD: (ctx, opts) => showPeriodMenu(ctx, opts),
  DAY: (ctx, opts) => showDayMenu(ctx, opts),
  MONTH: (ctx, opts) => showMonthMenu(ctx, opts),
  CURR: (ctx, opts) => showCurrMenu(ctx, opts),
  AGENT: (ctx, opts) => showAgentMenu(ctx, opts),
  BANK: (ctx, opts) => showBankMenu(ctx, opts),
};

/* ───────── Wizard ───────── */
const monitorAssist = new Scenes.WizardScene(
  'MONITOR_ASSIST',
  async (ctx) => {
    console.log('[MONITOR_ASSIST] paso 0: menú principal');
    ctx.wizard.state.nav = { stack: [] };
    ctx.wizard.state.filters = {
      period: getDefaultPeriod(),
      monedaNombre: 'Todas',
      fecha: null,
      mes: null,
      equiv: null,
    };
    registerCancelHooks(ctx, {
      beforeLeave: clearWizardMenu,
      afterLeave: enterAssistMenu,
    });
    await showMain(ctx, { pushHistory: false });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
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
        if (data === 'EQ_ON') {
          ctx.wizard.state.filters.equiv = 'cup';
          return showMain(ctx);
        }
        if (data === 'EQ_OFF') {
          ctx.wizard.state.filters.equiv = null;
          return showMain(ctx);
        }
        if (data === 'RUN') {
          const f = ctx.wizard.state.filters;
          let cmd = `/monitor ${f.period}`;
          if (f.agenteId) cmd += ` --agente=${f.agenteId}`;
          if (f.bancoId) cmd += ` --banco=${f.bancoId}`;
          if (f.monedaId) cmd += ` --moneda=${f.monedaNombre}`;
          if (f.fecha) cmd += ` --fecha=${f.fecha}`;
          if (f.mes) cmd += ` --mes=${f.mes}`;
          if (f.equiv === 'cup') cmd += ' --equiv=cup';
          await renderWizardMenu(ctx, {
            route: 'LOADING',
            text: withExitHint('Generando reporte...'),
            pushHistory: false,
          });
          const msgs = await runMonitor(ctx, cmd);
          const safeMsgs = (msgs || [])
            .flatMap((m) => chunkHtml(m).filter((part) => part.trim()));
          ctx.wizard.state.lastReport = safeMsgs;
          const kb = buildSaveBackExitKeyboard({ back: 'BACK_TO_MAIN' }); // UX-2025
          await clearWizardMenu(ctx);
          ctx.wizard.state.resultMsgIds = await sendReportWithKb(ctx, [], kb); // UX-2025
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
        if (data === 'BACK') return goBackMenu(ctx, ROUTE_HANDLERS);
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
            [Markup.button.callback('No', 'GLOBAL_CANCEL')],
          ];
          await ctx.reply('¿Deseas consultar otro usuario?', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
          ctx.wizard.state.route = 'ASK_AGAIN';
          return;
        }
        if (data === 'BACK_TO_MAIN') {
          await clearWizardMenu(ctx);
          ctx.wizard.state.nav = { stack: [] };
          return showMain(ctx, { pushHistory: false });
        }
        break;
      case 'ASK_AGAIN':
        if (data === 'AGAIN') {
          return showMain(ctx, { pushHistory: false });
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

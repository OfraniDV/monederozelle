/**
 * commands/extracto_assist.js
 *
 * Asistente interactivo para generar un extracto bancario con filtros
 * combinables de agente, moneda, banco y tarjeta. El flujo imita al
 * asistente de `/monitor`, guiando al usuario paso a paso y ofreciendo
 * botones "Todos" para obtener resúmenes globales.
 *
 * Todos los textos dinámicos se sanitizan con `escapeHtml` y se utiliza
 * `parseFloat` para los cálculos monetarios limitando a dos decimales.
 */

const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
  buildNavKeyboard,
} = require('../helpers/ui');
const pool = require('../psql/db.js');

const LINES_PER_PAGE = 15;

function fmt(v, d = 2) {
  const num = parseFloat(v);
  const val = Number.isNaN(num) ? 0 : num;
  return escapeHtml(
    val.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );
}

function paginate(text, linesPerPage = LINES_PER_PAGE) {
  const lines = text.split('\n');
  const pages = [];
  let buf = '';
  let count = 0;
  for (const line of lines) {
    const nl = line + '\n';
    if (count >= linesPerPage || buf.length + nl.length > 4000) {
      pages.push(buf.trimEnd());
      buf = '';
      count = 0;
    }
    buf += nl;
    count++;
  }
  if (buf.trim().length) pages.push(buf.trimEnd());
  return pages.length ? pages : ['No hay datos.'];
}

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

/* ───────── helpers de datos ───────── */
async function loadTarjetas(filters) {
  const params = [];
  let where = '1=1';
  if (filters.agenteId) {
    params.push(filters.agenteId);
    where += ` AND t.agente_id=$${params.length}`;
  }
  if (filters.bancoId) {
    params.push(filters.bancoId);
    where += ` AND t.banco_id=$${params.length}`;
  }
  if (filters.monedaId) {
    params.push(filters.monedaId);
    where += ` AND t.moneda_id=$${params.length}`;
  }
  const sql = `
    SELECT t.id, t.numero,
           COALESCE(ag.nombre,'') AS agente,
           COALESCE(ag.emoji,'') AS agente_emoji,
           COALESCE(b.id,0) AS banco_id,
           COALESCE(b.codigo,'Sin banco') AS banco,
           COALESCE(b.emoji,'') AS banco_emoji,
           COALESCE(m.id,0) AS moneda_id,
           COALESCE(m.codigo,'---') AS moneda,
           COALESCE(m.emoji,'') AS moneda_emoji,
           COALESCE(m.tasa_usd,1) AS tasa_usd
      FROM tarjeta t
      LEFT JOIN agente ag ON ag.id=t.agente_id
      LEFT JOIN banco  b ON b.id=t.banco_id
      LEFT JOIN moneda m ON m.id=t.moneda_id
     WHERE ${where}
     ORDER BY t.numero;`;
  const rows = (await pool.query(sql, params)).rows;
  return rows;
}

function uniqueBy(arr, key) {
  const map = new Map();
  arr.forEach((it) => {
    const k = it[key];
    if (!map.has(k)) map.set(k, it);
  });
  return Array.from(map.values());
}

function getFilteredCards(state) {
  let cards = state.tarjetasAll || [];
  const f = state.filters;
  if (f.monedaId) cards = cards.filter((t) => t.moneda_id === f.monedaId);
  if (f.bancoId) cards = cards.filter((t) => t.banco_id === f.bancoId);
  if (f.tarjetaId) cards = cards.filter((t) => t.id === f.tarjetaId);
  return cards;
}

/* ───────── vistas ───────── */
async function showAgentes(ctx) {
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
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  const text = '👤 <b>Selecciona el agente</b>';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'AGENTS';
  ctx.wizard.state.tmpAgents = rows;
}

async function showMonedas(ctx) {
  ctx.wizard.state.filters.monedaId = 0;
  ctx.wizard.state.filters.monedaNombre = null;
  ctx.wizard.state.filters.bancoId = 0;
  ctx.wizard.state.filters.bancoNombre = null;
  ctx.wizard.state.filters.tarjetaId = 0;
  ctx.wizard.state.filters.tarjetaNumero = null;
  const cards = getFilteredCards(ctx.wizard.state);
  const monedas = uniqueBy(cards, 'moneda_id');
  const buttons = [
    Markup.button.callback('Todas', 'MO_0'),
    ...monedas.map((m) =>
      Markup.button.callback(
        `${m.moneda_emoji ? m.moneda_emoji + ' ' : ''}${escapeHtml(m.moneda)}`,
        `MO_${m.moneda_id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  await editIfChanged(ctx, '💱 <b>Selecciona la moneda</b>', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'MONEDAS';
}

async function showBancos(ctx) {
  ctx.wizard.state.filters.bancoId = 0;
  ctx.wizard.state.filters.bancoNombre = null;
  ctx.wizard.state.filters.tarjetaId = 0;
  ctx.wizard.state.filters.tarjetaNumero = null;
  const cards = getFilteredCards(ctx.wizard.state);
  const bancos = uniqueBy(cards, 'banco_id');
  const buttons = [
    Markup.button.callback('Todos', 'BK_0'),
    ...bancos.map((b) =>
      Markup.button.callback(
        `${b.banco_emoji ? b.banco_emoji + ' ' : ''}${escapeHtml(b.banco)}`,
        `BK_${b.banco_id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  await editIfChanged(ctx, '🏦 <b>Selecciona el banco</b>', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'BANCOS';
}

async function showTarjetas(ctx) {
  ctx.wizard.state.filters.tarjetaId = 0;
  ctx.wizard.state.filters.tarjetaNumero = null;
  const cards = getFilteredCards(ctx.wizard.state);
  const buttons = [
    Markup.button.callback('Todas', 'TA_0'),
    ...cards.map((t) =>
      Markup.button.callback(
        `${t.moneda_emoji || ''}${t.banco_emoji || ''} ${escapeHtml(t.numero)}`.trim(),
        `TA_${t.id}`
      )
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  await editIfChanged(ctx, '💳 <b>Selecciona la tarjeta</b>', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'TARJETAS';
}

async function showPeriodMenu(ctx) {
  const buttons = [
    Markup.button.callback('📅 Día', 'PER_day'),
    Markup.button.callback('🗓️ Semana', 'PER_week'),
    Markup.button.callback('📆 Mes', 'PER_month'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  await editIfChanged(ctx, '⏱️ <b>Selecciona el periodo</b>', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'PERIOD';
}

async function showExtract(ctx, period) {
  const ranges = {
    day: { label: 'Último día', days: 1 },
    week: { label: 'Última semana', days: 7 },
    month: { label: 'Último mes', days: 30 },
  };
  const r = ranges[period] || ranges.day;
  const since = new Date();
  since.setDate(since.getDate() - r.days);
  const cards = getFilteredCards(ctx.wizard.state);
  const ids = cards.map((c) => c.id);
  if (!ids.length) {
    await editIfChanged(ctx, '⚠️ No hay tarjetas para estos filtros.', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]),
    });
    ctx.wizard.state.route = 'PERIOD';
    return;
  }
  const sql = `
    SELECT mv.tarjeta_id, mv.descripcion, mv.saldo_anterior, mv.importe, mv.saldo_nuevo, mv.creado_en,
           t.numero,
           COALESCE(m.codigo,'---') AS moneda, COALESCE(m.emoji,'') AS moneda_emoji,
           COALESCE(m.tasa_usd,1)  AS tasa_usd,
           COALESCE(b.codigo,'')   AS banco
      FROM movimiento mv
      JOIN tarjeta t ON t.id = mv.tarjeta_id
      LEFT JOIN moneda m ON m.id = t.moneda_id
      LEFT JOIN banco b  ON b.id = t.banco_id
     WHERE mv.tarjeta_id = ANY($1) AND mv.creado_en >= $2
     ORDER BY mv.creado_en DESC;`;
  const movs = (await pool.query(sql, [ids, since])).rows;
  const groups = {};
  movs.forEach((mv) => {
    const mon = mv.moneda;
    groups[mon] ??= {
      code: mv.moneda,
      emoji: mv.moneda_emoji,
      rate: parseFloat(mv.tasa_usd) || 1,
      body: '',
      totalIn: 0,
      totalOut: 0,
      last: {},
    };
    const g = groups[mon];
    const imp = parseFloat(mv.importe) || 0;
    if (imp >= 0) g.totalIn += imp;
    else g.totalOut += -imp;
    const sign = imp >= 0 ? '+' : '-';
    const fecha = new Date(mv.creado_en).toLocaleString();
    g.body += `${fecha} — ${escapeHtml(mv.descripcion || '')} ${sign}${fmt(Math.abs(imp))} → ${fmt(mv.saldo_nuevo)} (${escapeHtml(mv.numero)})\n`;
    if (!(mv.tarjeta_id in g.last)) g.last[mv.tarjeta_id] = parseFloat(mv.saldo_nuevo) || 0;
  });

  let body = '';
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    const saldo = Object.values(g.last).reduce((a, b) => a + b, 0);
    const usd = saldo * g.rate;
    body += `💱 <b>${g.emoji ? g.emoji + ' ' : ''}${escapeHtml(g.code)}</b>\n`;
    body += `↗️ Entradas: <b>${fmt(g.totalIn)}</b>\n`;
    body += `↘️ Salidas: <b>${fmt(g.totalOut)}</b>\n`;
    body += `Saldo actual: <b>${fmt(saldo)}</b> (${fmt(usd)} USD)\n`;
    body += g.body ? `\n${g.body}\n` : '\nSin movimientos.\n';
    body += '\n';
  }
  const f = ctx.wizard.state.filters;
  let header = '📄 <b>Extracto</b>\n';
  if (f.agenteNombre) header += `👤 Agente: <b>${escapeHtml(f.agenteNombre)}</b>\n`;
  if (f.bancoNombre) header += `🏦 Banco: <b>${escapeHtml(f.bancoNombre)}</b>\n`;
  if (f.tarjetaNumero) header += `💳 Tarjeta: <b>${escapeHtml(f.tarjetaNumero)}</b>\n`;
  header += `Periodo: <b>${r.label}</b>\n\n`;
  const pages = paginate(header + body);
  ctx.wizard.state.pages = pages;
  ctx.wizard.state.pageIndex = 0;
  ctx.wizard.state.route = 'EXTRACT';
  const txt = pages[0] + (pages.length > 1 ? `\n\nPágina 1/${pages.length}` : '');
  const nav =
    pages.length > 1
      ? buildNavKeyboard({ back: 'BACK', exit: 'EXIT' })
      : Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]);
  await editIfChanged(ctx, txt, { parse_mode: 'HTML', ...nav });
}

/* ───────── wizard ───────── */
const extractoAssist = new Scenes.WizardScene(
  'EXTRACTO_ASSIST',
  async (ctx) => {
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.filters = { period: 'day' };
    await showAgentes(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const route = ctx.wizard.state.route;
    const st = ctx.wizard.state;
    if (route === 'AGENTS') {
      if (data === 'BACK') {
        await ctx.scene.leave();
        return;
      }
      if (data.startsWith('AG_')) {
        const id = +data.split('_')[1];
        st.filters.agenteId = id || null;
        st.filters.agenteNombre = id
          ? st.tmpAgents.find((a) => a.id === id)?.nombre || ''
          : 'Todos';
        st.tarjetasAll = await loadTarjetas(st.filters);
        await showMonedas(ctx);
        return ctx.wizard.next();
      }
    } else if (route === 'MONEDAS') {
      if (data === 'BACK') {
        await showAgentes(ctx);
        return ctx.wizard.back();
      }
      if (data.startsWith('MO_')) {
        const id = +data.split('_')[1];
        st.filters.monedaId = id || null;
        const cards = st.tarjetasAll.find((c) => c.moneda_id === id);
        st.filters.monedaNombre = id ? cards?.moneda || '' : 'Todas';
        await showBancos(ctx);
        return ctx.wizard.next();
      }
    } else if (route === 'BANCOS') {
      if (data === 'BACK') {
        await showMonedas(ctx);
        return ctx.wizard.back();
      }
      if (data.startsWith('BK_')) {
        const id = +data.split('_')[1];
        st.filters.bancoId = id || null;
        const card = st.tarjetasAll.find((c) => c.banco_id === id);
        st.filters.bancoNombre = id ? card?.banco || '' : 'Todos';
        await showTarjetas(ctx);
        return ctx.wizard.next();
      }
    } else if (route === 'TARJETAS') {
      if (data === 'BACK') {
        await showBancos(ctx);
        return ctx.wizard.back();
      }
      if (data.startsWith('TA_')) {
        const id = +data.split('_')[1];
        st.filters.tarjetaId = id || null;
        const card = st.tarjetasAll.find((c) => c.id === id);
        st.filters.tarjetaNumero = id ? card?.numero || '' : null;
        await showPeriodMenu(ctx);
        return ctx.wizard.next();
      }
    } else if (route === 'PERIOD') {
      if (data === 'BACK') {
        await showTarjetas(ctx);
        return ctx.wizard.back();
      }
      if (data.startsWith('PER_')) {
        const per = data.split('_')[1];
        st.filters.period = per;
        await showExtract(ctx, per);
        return ctx.wizard.next();
      }
    } else if (route === 'EXTRACT') {
      if (data === 'BACK') {
        await showPeriodMenu(ctx);
        return ctx.wizard.back();
      }
      const pages = st.pages || [];
      let i = st.pageIndex || 0;
      const last = pages.length - 1;
      let ni = i;
      if (data === 'FIRST') ni = 0;
      else if (data === 'PREV') ni = Math.max(0, i - 1);
      else if (data === 'NEXT') ni = Math.min(last, i + 1);
      else if (data === 'LAST') ni = last;
      if (ni === i) {
        await ctx.answerCbQuery('Ya estás en esa página').catch(() => {});
        return;
      }
      st.pageIndex = ni;
      await ctx.answerCbQuery().catch(() => {});
      const txt =
        pages[ni] + (pages.length > 1 ? `\n\nPágina ${ni + 1}/${pages.length}` : '');
      const nav =
        pages.length > 1
          ? buildNavKeyboard({ back: 'BACK', exit: 'EXIT' })
          : Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]);
      await editIfChanged(ctx, txt, { parse_mode: 'HTML', ...nav });
    }
  }
);

module.exports = extractoAssist;


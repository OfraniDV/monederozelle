/**
 * commands/extracto_assist.js – v3 (02-ago-2025)
 *
 * Asistente interactivo para generar un extracto bancario con filtros
 * Agente → Moneda → Banco → Tarjeta → Periodo.  Cada pantalla:
 *   • Muestra un encabezado con los filtros ya elegidos.
 *   • Incluye botón 📄 Generar informe.
 *   • Registra en consola la acción realizada.
 *
 * Formato HTML con escapeHtml para evitar inyección.
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

/* Config ------------------------------------------------------------------ */
const LINES_PER_PAGE = 15;

/* Helpers ----------------------------------------------------------------- */
const fmt = (v, d = 2) =>
  escapeHtml(
    (parseFloat(v) || 0).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
  );

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
  if (buf.trim()) pages.push(buf.trimEnd());
  return pages.length ? pages : ['No hay datos.'];
}

async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'EXIT') {
    await ctx.answerCbQuery().catch(() => {});
    const id = ctx.wizard.state.msgId;
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      id,
      undefined,
      '❌ Operación cancelada.',
      { parse_mode: 'HTML' },
    );
    console.log('[extracto] cancelado por el usuario');
    await ctx.scene.leave();
    return true;
  }
  return false;
}

/* ───────── DB helpers — todos con try/catch para depurar ───────── */

async function q(sql, params = []) {
  try {
    const t0 = Date.now();
    const res = await pool.query(sql, params);
    console.log(
      `[extracto] query ok (${Date.now() - t0} ms) → ${sql.split('\n')[0]} …`,
      params,
    );
    return res.rows;
  } catch (e) {
    console.error('[extracto] ERROR SQL:', e);
    throw e;
  }
}

async function loadAgentes() {
  return q('SELECT id,nombre,emoji FROM agente ORDER BY nombre');
}

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
           COALESCE(ag.emoji,'')  AS agente_emoji,
           COALESCE(b.id,0)       AS banco_id,
           COALESCE(b.codigo,'Sin banco') AS banco,
           COALESCE(b.emoji,'')   AS banco_emoji,
           COALESCE(m.id,0)       AS moneda_id,
           COALESCE(m.codigo,'---') AS moneda,
           COALESCE(m.emoji,'')   AS moneda_emoji,
           COALESCE(m.tasa_usd,1) AS tasa_usd
      FROM tarjeta t
      LEFT JOIN agente ag ON ag.id = t.agente_id
      LEFT JOIN banco  b ON b.id = t.banco_id
      LEFT JOIN moneda m ON m.id = t.moneda_id
     WHERE ${where}
     ORDER BY t.numero`;
  return q(sql, params);
}

/* State helpers ----------------------------------------------------------- */
function uniqBy(arr, key) {
  const m = new Map();
  arr.forEach((o) => {
    if (!m.has(o[key])) m.set(o[key], o);
  });
  return [...m.values()];
}

function filterCards(st) {
  let cards = st.tarjetasAll || [];
  const f = st.filters;
  if (f.monedaId) cards = cards.filter((c) => c.moneda_id === f.monedaId);
  if (f.bancoId) cards = cards.filter((c) => c.banco_id === f.bancoId);
  if (f.tarjetaId) cards = cards.filter((c) => c.id === f.tarjetaId);
  return cards;
}

/* Visual helpers ---------------------------------------------------------- */
function header(f) {
  return (
    '📄 <b>Extracto</b>\n' +
    `👤 Agente: <b>${escapeHtml(f.agenteNombre || 'Todos')}</b>\n` +
    `💱 Moneda: <b>${escapeHtml(f.monedaNombre || 'Todas')}</b>\n` +
    `🏦 Banco: <b>${escapeHtml(f.bancoNombre || 'Todos')}</b>\n` +
    `💳 Tarjeta: <b>${escapeHtml(f.tarjetaNumero || 'Todas')}</b>\n` +
    `Periodo: <b>${f.period || 'día'}</b>\n\n`
  );
}

function addRunAndExit(kb) {
  kb.push([Markup.button.callback('📄 Generar informe', 'RUN')]);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  return kb;
}

/* ─────────── Vistas ─────────── */

async function showAgents(ctx) {
  const rows = await loadAgentes();
  const buttons = [
    Markup.button.callback('Todos', 'AG_0'),
    ...rows.map((a) =>
      Markup.button.callback(
        `${a.emoji ? a.emoji + ' ' : ''}${escapeHtml(a.nombre)}`,
        `AG_${a.id}`,
      ),
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  addRunAndExit(kb);
  await editIfChanged(ctx, header(ctx.wizard.state.filters) + '👤 Elige agente:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'AGENTS';
  ctx.wizard.state.tmpAgents = rows;
}

async function showMonedas(ctx) {
  const st = ctx.wizard.state;
  st.filters.monedaId = 0;
  st.filters.monedaNombre = null;
  st.filters.bancoId = 0;
  st.filters.bancoNombre = null;
  st.filters.tarjetaId = 0;
  st.filters.tarjetaNumero = null;

  const mons = uniqBy(filterCards(st), 'moneda_id');
  const buttons = [
    Markup.button.callback('Todas', 'MO_0'),
    ...mons.map((m) =>
      Markup.button.callback(
        `${m.moneda_emoji ? m.moneda_emoji + ' ' : ''}${escapeHtml(m.moneda)}`,
        `MO_${m.moneda_id}`,
      ),
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  addRunAndExit(kb);
  await editIfChanged(ctx, header(st.filters) + '💱 Elige moneda:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  st.route = 'MONEDAS';
}

async function showBancos(ctx) {
  const st = ctx.wizard.state;
  st.filters.bancoId = 0;
  st.filters.bancoNombre = null;
  st.filters.tarjetaId = 0;
  st.filters.tarjetaNumero = null;

  const banks = uniqBy(filterCards(st), 'banco_id');
  const buttons = [
    Markup.button.callback('Todos', 'BK_0'),
    ...banks.map((b) =>
      Markup.button.callback(
        `${b.banco_emoji ? b.banco_emoji + ' ' : ''}${escapeHtml(b.banco)}`,
        `BK_${b.banco_id}`,
      ),
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  addRunAndExit(kb);
  await editIfChanged(ctx, header(st.filters) + '🏦 Elige banco:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  st.route = 'BANCOS';
}

async function showTarjetas(ctx) {
  const st = ctx.wizard.state;
  st.filters.tarjetaId = 0;
  st.filters.tarjetaNumero = null;

  const cards = filterCards(st);
  const buttons = [
    Markup.button.callback('Todas', 'TA_0'),
    ...cards.map((t) =>
      Markup.button.callback(
        `${t.moneda_emoji || ''}${t.banco_emoji || ''} ${escapeHtml(t.numero)}`,
        `TA_${t.id}`,
      ),
    ),
  ];
  const kb = arrangeInlineButtons(buttons);
  addRunAndExit(kb);
  await editIfChanged(ctx, header(st.filters) + '💳 Elige tarjeta:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  st.route = 'TARJETAS';
}

async function showPeriod(ctx) {
  const buttons = [
    Markup.button.callback('📅 Día', 'PER_day'),
    Markup.button.callback('🗓 Semana', 'PER_week'),
    Markup.button.callback('📆 Mes', 'PER_month'),
  ];
  const kb = arrangeInlineButtons(buttons);
  addRunAndExit(kb);
  await editIfChanged(ctx, header(ctx.wizard.state.filters) + '⏱ Elige periodo:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'PERIOD';
}

/* ───────── Reporte final ───────── */

async function showExtract(ctx) {
  const st = ctx.wizard.state;
  const period = st.filters.period || 'day';

  /* rango */
  const ranges = { day: 1, week: 7, month: 30 };
  const days = ranges[period] || 1;
  const since = new Date(Date.now() - days * 864e5);

  const ids = filterCards(st).map((c) => c.id);
  if (!ids.length) {
    await ctx.reply('⚠️ No hay tarjetas con esos filtros.');
    return;
  }

  const movs = await q(
    `SELECT mv.tarjeta_id, mv.descripcion, mv.importe, mv.saldo_nuevo, mv.creado_en,
            t.numero,
            COALESCE(m.codigo,'---') AS moneda, COALESCE(m.emoji,'') AS mon_emoji,
            COALESCE(m.tasa_usd,1)  AS tasa
       FROM movimiento mv
       JOIN tarjeta t ON t.id = mv.tarjeta_id
       JOIN moneda  m ON m.id = t.moneda_id
      WHERE mv.tarjeta_id = ANY($1) AND mv.creado_en >= $2
      ORDER BY mv.creado_en DESC`,
    [ids, since],
  );

  const groups = {};
  movs.forEach((mv) => {
    const g = (groups[mv.moneda] ??= {
      emoji: mv.mon_emoji,
      in: 0,
      out: 0,
      rate: parseFloat(mv.tasa) || 1,
      lines: [],
      last: {},
    });
    const imp = parseFloat(mv.importe) || 0;
    if (imp >= 0) g.in += imp;
    else g.out += -imp;
    const sign = imp >= 0 ? '+' : '-';
    g.lines.push(
      `${new Date(mv.creado_en).toLocaleString()} — ${escapeHtml(
        mv.descripcion || '',
      )} ${sign}${fmt(Math.abs(imp))} → ${fmt(mv.saldo_nuevo)} (${mv.numero})`,
    );
    if (!(mv.tarjeta_id in g.last)) g.last[mv.tarjeta_id] = mv.saldo_nuevo;
  });

  let body = '';
  Object.entries(groups).forEach(([code, g]) => {
    const saldo = Object.values(g.last).reduce((a, b) => a + parseFloat(b || 0), 0);
    const net = g.in - g.out;
    body += `💱 <b>${g.emoji ? g.emoji + ' ' : ''}${escapeHtml(code)}</b>\n`;
    body += `↗️ Entradas: <b>${fmt(g.in)}</b>\n`;
    body += `↘️ Salidas: <b>${fmt(g.out)}</b>\n`;
    body += `${net >= 0 ? '📈' : '📉'} Variación neta: <b>${fmt(net)}</b>\n`;
    body += `Saldo actual: <b>${fmt(saldo)}</b> (${fmt(saldo * g.rate)} USD)\n\n`;
    body += g.lines.join('\n') + '\n\n';
  });

  const pages = paginate(header(st.filters) + body);
  st.pages = pages;
  st.pageIndex = 0;
  st.route = 'EXTRACT';

  const nav =
    pages.length > 1
      ? buildNavKeyboard({ back: 'BACK', exit: 'EXIT' })
      : Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]);

  await editIfChanged(ctx, pages[0] + (pages.length > 1 ? '\n\nPágina 1/' + pages.length : ''), {
    parse_mode: 'HTML',
    ...nav,
  });
}

/* ───────── Wizard ───────── */
const extractoAssist = new Scenes.WizardScene(
  'EXTRACTO_ASSIST',
  /* paso 0: inicio */
  async (ctx) => {
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.filters = { period: 'day' };
    await showAgents(ctx);
    return ctx.wizard.next();
  },
  /* pasos dinámicos */
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    console.log('[extracto] click', ctx.wizard.state.route, data);

    const st = ctx.wizard.state;

    /* navegación */
    if (data === 'BACK') {
      switch (st.route) {
        case 'MONEDAS':
          return showAgents(ctx);
        case 'BANCOS':
          return showMonedas(ctx);
        case 'TARJETAS':
          return showBancos(ctx);
        case 'PERIOD':
          return showTarjetas(ctx);
        case 'EXTRACT':
          return showPeriod(ctx);
        default:
          return showAgents(ctx);
      }
    }

    /* botón RUN */
    if (data === 'RUN') {
      if (st.route === 'EXTRACT') return; // ya estamos
      if (!st.filters.period) return showPeriod(ctx);
      return showExtract(ctx);
    }

    /* callbacks específicos */
    switch (st.route) {
      case 'AGENTS':
        if (data.startsWith('AG_')) {
          const id = +data.split('_')[1];
          st.filters.agenteId = id || null;
          st.filters.agenteNombre =
            id === 0 ? 'Todos' : st.tmpAgents.find((a) => a.id === id)?.nombre || '';
          st.tarjetasAll = await loadTarjetas(st.filters);
          return showMonedas(ctx);
        }
        break;
      case 'MONEDAS':
        if (data.startsWith('MO_')) {
          const id = +data.split('_')[1];
          st.filters.monedaId = id || null;
          const card = st.tarjetasAll.find((c) => c.moneda_id === id);
          st.filters.monedaNombre = id === 0 ? 'Todas' : card?.moneda || '';
          return showBancos(ctx);
        }
        break;
      case 'BANCOS':
        if (data.startsWith('BK_')) {
          const id = +data.split('_')[1];
          st.filters.bancoId = id || null;
          const card = st.tarjetasAll.find((c) => c.banco_id === id);
          st.filters.bancoNombre = id === 0 ? 'Todos' : card?.banco || '';
          return showTarjetas(ctx);
        }
        break;
      case 'TARJETAS':
        if (data.startsWith('TA_')) {
          const id = +data.split('_')[1];
          st.filters.tarjetaId = id || null;
          const card = st.tarjetasAll.find((c) => c.id === id);
          st.filters.tarjetaNumero = id === 0 ? null : card?.numero || '';
          return showPeriod(ctx);
        }
        break;
      case 'PERIOD':
        if (data.startsWith('PER_')) {
          st.filters.period = data.split('_')[1];
          return showExtract(ctx);
        }
        break;
      case 'EXTRACT': {
        const pages = st.pages || [];
        let idx = st.pageIndex || 0;
        const last = pages.length - 1;
        if (data === 'FIRST') idx = 0;
        else if (data === 'PREV') idx = Math.max(0, idx - 1);
        else if (data === 'NEXT') idx = Math.min(last, idx + 1);
        else if (data === 'LAST') idx = last;
        st.pageIndex = idx;
        const nav =
          pages.length > 1
            ? buildNavKeyboard({ back: 'BACK', exit: 'EXIT' })
            : Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]);
        await editIfChanged(ctx, pages[idx] + `\n\nPágina ${idx + 1}/${pages.length}`, {
          parse_mode: 'HTML',
          ...nav,
        });
        return;
      }
    }
  },
);

module.exports = extractoAssist;

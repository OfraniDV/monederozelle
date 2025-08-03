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
const { buildEntityFilter } = require('../helpers/filters');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
} = require('../helpers/ui');
const pool = require('../psql/db.js');

/* Helpers ----------------------------------------------------------------- */
const fmt = (v, d = 2) =>
  escapeHtml(
    (parseFloat(v) || 0).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
  );

function smartPaginate(text) {
  if (text.length <= 4000) return [text];
  const lines = text.split('\n');
  const pages = [];
  let buf = '';
  for (const line of lines) {
    const nl = line + '\n';
    if (buf.length + nl.length > 4000) {
      pages.push(buf.trimEnd());
      buf = '';
    }
    if (nl.length > 4000) {
      // línea extremadamente larga: forzar corte
      let start = 0;
      while (start < nl.length) {
        pages.push(nl.slice(start, start + 4000).trimEnd());
        start += 4000;
      }
      buf = '';
      continue;
    }
    buf += nl;
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
  const conds = [];
  const agVal =
    filters.agenteId ||
    (filters.agenteNombre && filters.agenteNombre !== 'Todos'
      ? filters.agenteNombre
      : null) ||
    filters.agente;
  const bVal =
    filters.bancoId ||
    (filters.bancoNombre && filters.bancoNombre !== 'Todos'
      ? filters.bancoNombre
      : null) ||
    filters.banco;
  const mVal =
    filters.monedaId ||
    (filters.monedaNombre && filters.monedaNombre !== 'Todas'
      ? filters.monedaNombre
      : null) ||
    filters.moneda;
  const cAg = await buildEntityFilter('ag', agVal, params);
  if (cAg) conds.push(cAg);
  const cBk = await buildEntityFilter('b', bVal, params, 'id', ['codigo', 'nombre']);
  if (cBk) conds.push(cBk);
  const cMon = await buildEntityFilter('m', mVal, params, 'id', ['codigo', 'nombre']);
  if (cMon) conds.push(cMon);
  const where = conds.length ? conds.join(' AND ') : '1=1';
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
    console.warn('[extracto] filtros sin tarjetas', st.filters);
    await ctx.reply('⚠️ No hay tarjetas con esos filtros.');
    return;
  }

  // coherencia: agenteId vs agenteNombre
  if (st.filters.agenteId && st.filters.agenteNombre && st.filters.agenteNombre !== 'Todos') {
    const byId = await loadTarjetas({ agenteId: st.filters.agenteId });
    const byName = await loadTarjetas({ agente: st.filters.agenteNombre });
    const idsId = byId.map((c) => c.id).sort().join(',');
    const idsName = byName.map((c) => c.id).sort().join(',');
    if (idsId !== idsName) {
      console.warn('[extracto] discrepancia agenteId vs nombre', idsId, idsName);
    }
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

  if (!movs.length) {
    const diag = {};
    if (st.filters.agenteId || st.filters.agenteNombre) {
      diag.tarjetasAgente = (
        await loadTarjetas({
          agenteId: st.filters.agenteId,
          agente: st.filters.agenteNombre,
        })
      ).length;
    }
    if (st.filters.bancoId || st.filters.bancoNombre) {
      diag.tarjetasAgenteBanco = (
        await loadTarjetas({
          agenteId: st.filters.agenteId,
          agente: st.filters.agenteNombre,
          bancoId: st.filters.bancoId,
          banco: st.filters.bancoNombre,
        })
      ).length;
    }
    if (st.filters.monedaId || st.filters.monedaNombre) {
      diag.tarjetasAgenteBancoMoneda = (
        await loadTarjetas({
          agenteId: st.filters.agenteId,
          agente: st.filters.agenteNombre,
          bancoId: st.filters.bancoId,
          banco: st.filters.bancoNombre,
          monedaId: st.filters.monedaId,
          moneda: st.filters.monedaNombre,
        })
      ).length;
    }
    console.warn('[extracto] sin movimientos', { filtros: st.filters, diag });
  }

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

  const text = header(st.filters) + body;
  const pages = smartPaginate(text);
  st.route = 'EXTRACT';

  for (let i = 0; i < pages.length; i++) {
    const prefix = pages.length > 1 ? `<b>(${i + 1}/${pages.length})</b>\n` : '';
    const extra =
      i === pages.length - 1
        ? { reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'EXIT')] } }
        : {};
    const msg = await ctx.reply(prefix + pages[i], { parse_mode: 'HTML', ...extra });
    if (i === pages.length - 1) st.msgId = msg.message_id;
  }
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
    }
  },
);

module.exports = extractoAssist;

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
const moment = require('moment-timezone');
const { escapeHtml, fmtMoney } = require('../helpers/format');
const { getDefaultPeriod } = require('../helpers/period');
const { sendAndLog } = require('../helpers/reportSender');
const { flushOnExit } = require('../helpers/sessionSummary');
const { buildEntityFilter } = require('../helpers/filters');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
} = require('../helpers/ui');
const pool = require('../psql/db.js');

/* Helpers ----------------------------------------------------------------- */

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
    await ctx.reply('❌ Operación cancelada.', { parse_mode: 'HTML' });
    console.log('[extracto] cancelado por el usuario');
    await flushOnExit(ctx);
    if (ctx.scene?.current) await ctx.scene.leave();
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
    Markup.button.callback('📊 Día', 'PER_dia'),
    Markup.button.callback('🗓 Semana', 'PER_semana'),
    Markup.button.callback('📆 Mes', 'PER_mes'),
    Markup.button.callback('📅 Año', 'PER_ano'),
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
  try {
    const st = ctx.wizard.state;
    const period = st.filters.period || getDefaultPeriod();

  /* rango */
  const now = new Date();
  let since;
  if (period === 'semana') since = new Date(now.getTime() - 7 * 864e5);
  else if (period === 'mes') since = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'ano') since = new Date(now.getFullYear(), 0, 1);
  else since = new Date(now.getTime() - 864e5);

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
            COALESCE(b.codigo,'Sin banco') AS banco, COALESCE(b.emoji,'') AS banco_emoji,
            COALESCE(m.codigo,'---') AS moneda, COALESCE(m.emoji,'') AS mon_emoji,
            COALESCE(m.tasa_usd,1)  AS tasa
       FROM movimiento mv
       JOIN tarjeta t ON t.id = mv.tarjeta_id
       LEFT JOIN banco  b ON b.id = t.banco_id
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
      rate: parseFloat(mv.tasa) || 1,
      in: 0,
      out: 0,
      cards: new Map(),
    });
    const card = g.cards.get(mv.tarjeta_id) || {
      numero: mv.numero,
      banco: mv.banco,
      bancoEmoji: mv.banco_emoji,
      lines: [],
      in: 0,
      out: 0,
      saldo: null,
    };
    const imp = parseFloat(mv.importe) || 0;
    if (imp >= 0) {
      g.in += imp;
      card.in += imp;
    } else {
      g.out += -imp;
      card.out += -imp;
    }
    const dateStr = moment(mv.creado_en)
      .tz('America/Havana')
      .format('D/M/YYYY, h:mm A');
    const emoji = imp >= 0 ? '🔼' : '🔽';
    card.lines.push(
      `• ${dateStr} — ${escapeHtml(mv.descripcion || '')} ${emoji}<code>${fmtMoney(
        Math.abs(imp),
      )}</code> → <code>${fmtMoney(mv.saldo_nuevo)}</code>`,
    );
    if (card.saldo === null) card.saldo = parseFloat(mv.saldo_nuevo) || 0;
    g.cards.set(mv.tarjeta_id, card);
  });

  let body = '';
  for (const [code, g] of Object.entries(groups)) {
    if (body) body += '\n\n';
    body += `💱 <b>${g.emoji ? g.emoji + ' ' : ''}${escapeHtml(code)}</b>\n\n`;
    for (const card of g.cards.values()) {
      body += `🏦 Banco: ${card.bancoEmoji ? card.bancoEmoji + ' ' : ''}${escapeHtml(
        card.banco,
      )} 💳 Tarjeta: ${escapeHtml(card.numero)}\n`;
      body += `Subtotal: 💰 <code>${fmtMoney(card.saldo)}</code> 🔼 Entrada: <code>${fmtMoney(
        card.in,
      )}</code> 🔽 Salida: <code>${fmtMoney(card.out)}</code>\n`;
      body += `Historial:\n${card.lines.join('\n')}\n\n`;
    }
    const totalSaldo = Array.from(g.cards.values()).reduce((a, c) => a + c.saldo, 0);
    const net = g.in - g.out;
    body += `↗️ Entradas: <code>${fmtMoney(g.in)}</code>\n`;
    body += `↘️ Salidas: <code>${fmtMoney(g.out)}</code>\n`;
    body += `${net >= 0 ? '📈' : '📉'} Variación neta: <code>${fmtMoney(net)}</code>\n`;
    body += `Saldo actual: <code>${fmtMoney(totalSaldo)}</code> (<code>${fmtMoney(
      totalSaldo * g.rate,
    )}</code> USD)\n`;
  }

    const text = header(st.filters) + body + '\n\n';
    const pages = smartPaginate(text);
    st.lastReport = pages;
    for (let i = 0; i < pages.length; i++) {
      const prefix = pages.length > 1 ? `<b>(${i + 1}/${pages.length})</b>\n` : '';
      await ctx.reply(prefix + pages[i], { parse_mode: 'HTML' });
    }
    const kb = [
      [Markup.button.callback('💾 Salvar', 'SAVE')],
      [Markup.button.callback('❌ Salir', 'EXIT')],
    ];
    await ctx.reply('Reporte generado.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: kb },
    });
    st.route = 'AFTER_RUN';
  } catch (err) {
    console.error('[extracto] showExtract error', err);
    await ctx.reply('⚠️ Error generando extracto.', { parse_mode: 'HTML' });
  }
}

/* ───────── Wizard ───────── */
const extractoAssist = new Scenes.WizardScene(
  'EXTRACTO_ASSIST',
  /* paso 0: inicio */
  async (ctx) => {
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.filters = { period: getDefaultPeriod() };
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
      case 'AFTER_RUN':
        if (data === 'SAVE') {
          const reps = st.lastReport || [];
          for (const m of reps) {
            await sendAndLog(ctx, m);
          }
          const kb = [
            [Markup.button.callback('Sí', 'AGAIN')],
            [Markup.button.callback('No', 'EXIT')],
          ];
          await ctx.editMessageText('¿Otro extracto?', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb },
          });
          console.log('[extracto] preguntar otro', ctx.from.id, ctx.callbackQuery?.data);
          st.route = 'ASK_AGAIN';
          return;
        }
        break;
      case 'ASK_AGAIN':
        console.log(
          '[extracto] respuesta otro',
          ctx.from.id,
          ctx.callbackQuery?.data,
        );
        if (data === 'AGAIN') {
          await ctx.editMessageText('🔁 Nuevo extracto', { parse_mode: 'HTML' });
          st.filters = { period: getDefaultPeriod() };
          st.tarjetasAll = [];
          st.lastReport = [];
          return showAgents(ctx);
        }
        break;
    }
  },
);

module.exports = extractoAssist;

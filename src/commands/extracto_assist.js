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
const { escapeHtml, fmtMoney, boldHeader, chunkHtml } = require('../helpers/format');
const { getDefaultPeriod } = require('../helpers/period');
const { sendAndLog } = require('../helpers/reportSender');
const { buildEntityFilter } = require('../helpers/filters');
const {
  editIfChanged,
  buildNavRow,
  arrangeInlineButtons,
  buildSaveExitRow,
  sendReportWithKb,
} = require('../helpers/ui');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');
const pool = require('../psql/db.js');
const { handleError } = require('../controllers/errorController');

/* Helpers ----------------------------------------------------------------- */

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

async function filterCards(st) {
  if (!st.tarjetasAll || !st.tarjetasAll.length) {
    st.tarjetasAll = await loadTarjetas(st.filters);
  }
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
    `${boldHeader('📄', 'Extracto')}\n` +
    `👤 Agente: <b>${escapeHtml(f.agenteNombre || 'Todos')}</b>\n` +
    `💱 Moneda: <b>${escapeHtml(f.monedaNombre || 'Todas')}</b>\n` +
    `🏦 Banco: <b>${escapeHtml(f.bancoNombre || 'Todos')}</b>\n` +
    `💳 Tarjeta: <b>${escapeHtml(f.tarjetaNumero || 'Todas')}</b>\n` +
    `Periodo: <b>${escapeHtml(f.fecha || f.mes || f.period || 'día')}</b>\n\n`
  );
}

function addRunAndExit(kb) {
  kb.push([Markup.button.callback('📄 Generar informe', 'RUN')]);
  kb.push([
    Markup.button.callback('⬅️ Anterior', 'BACK_TO_FILTER'),
    Markup.button.callback('🏠 Menú Inicial', 'GO_HOME'),
  ]);
  kb.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
  return kb;
}

/* ─────────── Vistas ─────────── */

async function showFilterMenu(ctx) {
  const buttons = [
    Markup.button.callback('📤 Agente', 'FIL_AGENT'),
    Markup.button.callback('💱 Moneda', 'FIL_MONEDA'),
    Markup.button.callback('🏦 Banco', 'FIL_BANCO'),
    Markup.button.callback('💳 Tarjeta', 'FIL_TARJETA'),
    Markup.button.callback('⏱ Periodo', 'FIL_PERIOD'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push([Markup.button.callback('📄 Generar informe', 'RUN')]);
  kb.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
  await editIfChanged(ctx, header(ctx.wizard.state.filters) + 'Elige filtro:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'FILTER';
}

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

  const mons = uniqBy(await filterCards(st), 'moneda_id');
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

  const banks = uniqBy(await filterCards(st), 'banco_id');
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

  const cards = await filterCards(st);
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
  kb.push([
    Markup.button.callback('⬅️ Anterior', 'BACK_TO_FILTER'),
    Markup.button.callback('🏠 Menú Inicial', 'GO_HOME'),
  ]);
  kb.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
  await editIfChanged(ctx, header(ctx.wizard.state.filters) + 'Elige día:', {
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
  kb.push([
    Markup.button.callback('⬅️ Anterior', 'BACK_TO_FILTER'),
    Markup.button.callback('🏠 Menú Inicial', 'GO_HOME'),
  ]);
  kb.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
  await editIfChanged(ctx, header(ctx.wizard.state.filters) + 'Elige mes:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'MONTH';
}

/* ───────── Reporte final ───────── */

async function showExtract(ctx) {
  try {
    const st = ctx.wizard.state;
    const f = st.filters;
    const now = moment.tz('America/Havana');
    let since;
    let until;
    if (f.fecha) {
      const d = moment.tz(f.fecha, 'YYYY-MM-DD', 'America/Havana');
      since = d.clone().startOf('day');
      until = d.clone().endOf('day');
    } else if (f.mes) {
      const m = moment.tz(f.mes, 'YYYY-MM', 'America/Havana');
      since = m.clone().startOf('month');
      until = m.clone().endOf('month');
    } else {
      const period = f.period || getDefaultPeriod();
      if (period === 'semana') since = now.clone().subtract(7, 'days');
      else if (period === 'mes') since = now.clone().startOf('month');
      else if (period === 'ano') since = now.clone().startOf('year');
      else since = now.clone().subtract(1, 'day');
      until = now;
    }

    // Asegura que las tarjetas se carguen según los filtros actuales
    await filterCards(st);

    const params = [since.toDate(), until.toDate()];
    const conds = ['mv.creado_en >= $1', 'mv.creado_en <= $2'];
    let idx = 3;
    if (f.agenteId) {
      params.push(f.agenteId);
      conds.push(`t.agente_id = $${idx++}`);
    }
    if (f.bancoId) {
      params.push(f.bancoId);
      conds.push(`t.banco_id = $${idx++}`);
    }
    if (f.monedaId) {
      params.push(f.monedaId);
      conds.push(`t.moneda_id = $${idx++}`);
    }
    if (f.tarjetaId) {
      params.push(f.tarjetaId);
      conds.push(`t.id = $${idx++}`);
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
            COALESCE(ag.nombre,'Sin agente') AS agente, COALESCE(ag.emoji,'') AS agente_emoji,
            COALESCE(b.codigo,'Sin banco') AS banco, COALESCE(b.emoji,'') AS banco_emoji,
            COALESCE(m.codigo,'---') AS moneda, COALESCE(m.emoji,'') AS mon_emoji,
            COALESCE(m.tasa_usd,1)  AS tasa
       FROM movimiento mv
       JOIN tarjeta t ON t.id = mv.tarjeta_id
       LEFT JOIN agente ag ON ag.id = t.agente_id
       LEFT JOIN banco  b ON b.id = t.banco_id
       JOIN moneda  m ON m.id = t.moneda_id
      WHERE ${conds.join(' AND ')}
      ORDER BY mv.creado_en ASC`,
    params,
  );

  const cardIds = [...new Set(movs.map((m) => m.tarjeta_id))];

  /* Saldo inicial histórico (primer movimiento) */
  const iniRows = cardIds.length
    ? await q(
        `SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo
           FROM movimiento
          WHERE tarjeta_id = ANY($1)
          ORDER BY tarjeta_id, creado_en ASC`,
        [cardIds],
      )
    : [];
  const iniMap = new Map();
  iniRows.forEach((r) =>
    iniMap.set(r.tarjeta_id, parseFloat(r.saldo_nuevo) || 0),
  );

  /* Saldo inmediatamente ANTES del período → inicio del período */
  const preRows = cardIds.length
    ? await q(
        `SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo
           FROM movimiento
          WHERE tarjeta_id = ANY($1) AND creado_en < $2
          ORDER BY tarjeta_id, creado_en DESC`,
        [cardIds, since.toDate()],
      )
    : [];
  const preMap = new Map();
  preRows.forEach((r) =>
    preMap.set(r.tarjeta_id, parseFloat(r.saldo_nuevo) || 0),
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

  const byAgent = {};
  movs.forEach((mv) => {
    const ag = (byAgent[mv.agente] ??= {
      emoji: mv.agente_emoji,
      cards: new Map(),
    });
    const card = ag.cards.get(mv.tarjeta_id) || {
      numero: mv.numero,
      banco: mv.banco,
      bancoEmoji: mv.banco_emoji,
      moneda: mv.moneda,
      monEmoji: mv.mon_emoji,
      movs: [],
      days: new Set(),
      in: 0,
      out: 0,
      saldoIniHist: iniMap.get(mv.tarjeta_id) ?? 0,
      saldoIniPer: preMap.get(mv.tarjeta_id) ?? (iniMap.get(mv.tarjeta_id) ?? 0),
      saldoFinPer: preMap.get(mv.tarjeta_id) ?? (iniMap.get(mv.tarjeta_id) ?? 0),
      saldoFinHist: iniMap.get(mv.tarjeta_id) ?? 0,
      initPrinted: false,
    };
    const imp = parseFloat(mv.importe) || 0;
    if (imp >= 0) card.in += imp;
    else card.out += -imp;
    const fecha = moment(mv.creado_en).tz('America/Havana');
    card.movs.push({
      fecha,
      imp,
      saldo: parseFloat(mv.saldo_nuevo) || 0,
      desc: mv.descripcion || '',
    });
    card.days.add(fecha.format('YYYY-MM-DD'));
    card.saldoFinPer = parseFloat(mv.saldo_nuevo) || card.saldoFinPer;
    card.saldoFinHist = card.saldoFinPer;
    ag.cards.set(mv.tarjeta_id, card);
  });

  let body = '';
  for (const [agName, ag] of Object.entries(byAgent)) {
    if (body) body += '\n';
    body += `👤 <b>${ag.emoji ? ag.emoji + ' ' : ''}${escapeHtml(agName)}</b>\n`;
    for (const card of ag.cards.values()) {
      const deltaPer = card.saldoFinPer - card.saldoIniPer;
      const deltaHist = card.saldoFinHist - card.saldoIniHist;
      const emojiPer = deltaPer > 0 ? '📈' : deltaPer < 0 ? '📉' : '➖';

      // Construir líneas compactas siguiendo el estilo de saldo.js
      // Ejemplo:
      // • 01/08 01:53 ➖ 9086.00 → 9086.00 (inicio)
      // • 03/08 19:48 📉 -346.31 → 8339.69
      const multiDay = card.days.size > 1;
      const lines = [];
      for (const mv of card.movs) {
        const fechaFmt = multiDay
          ? mv.fecha.format('DD/MM HH:mm')
          : mv.fecha.format('HH:mm');
        const e = mv.imp > 0 ? '📈' : mv.imp < 0 ? '📉' : '➖';
        const sign = mv.imp > 0 ? '+' : mv.imp < 0 ? '-' : '';
        let line = `• ${fechaFmt} ${e} <code>${sign}${fmtMoney(Math.abs(mv.imp))}</code> → <code>${fmtMoney(
          mv.saldo,
        )}</code>`;
        const isInit = mv.desc.toLowerCase().includes('saldo inicial');
        if (isInit) {
          if (card.initPrinted) continue; // colapsar duplicados
          line += ' (inicio)';
          card.initPrinted = true;
        }
        lines.push(line);
      }

      body += `\n🏦 ${card.bancoEmoji ? card.bancoEmoji + ' ' : ''}${escapeHtml(
        card.banco,
      )} / 💳 ${escapeHtml(card.numero)} (${card.monEmoji ? card.monEmoji + ' ' : ''}${escapeHtml(card.moneda)})\n`;
      body +=
        `Saldo inicio (período): <code>${fmtMoney(card.saldoIniPer)}</code> → Saldo fin (período): <code>${fmtMoney(
          card.saldoFinPer,
        )}</code> (Δ <code>${(deltaPer >= 0 ? '+' : '') + fmtMoney(deltaPer)}</code>) ${emojiPer}\n`;

      body +=
        `Saldo inicio (histórico): <code>${fmtMoney(card.saldoIniHist)}</code> → Saldo actual: <code>${fmtMoney(
          card.saldoFinHist,
        )}</code> (Δ <code>${(deltaHist >= 0 ? '+' : '') + fmtMoney(deltaHist)}</code>) ${emojiPer}\n`;
      body += `↗️ <code>${fmtMoney(card.in)}</code>  ↘️ <code>${fmtMoney(card.out)}</code>\n`;
      body += `Historial:\n${lines.join('\n')}\n`;
    }

  }

    const text = header(st.filters) + body + '\n\n';
    const pages = chunkHtml(text).filter((p) => p.trim());
    st.lastReport = pages.length ? pages : ['No hay datos.'];
    const kb = Markup.inlineKeyboard([buildSaveExitRow()]).reply_markup; // UX-2025
    await sendReportWithKb(ctx, pages, kb); // UX-2025
    st.route = 'AFTER_RUN';
  } catch (err) {
    await handleError(err, ctx, 'extracto_showExtract');
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
    ctx.wizard.state.filters = { period: getDefaultPeriod(), fecha: null, mes: null };
    registerCancelHooks(ctx, { afterLeave: enterAssistMenu });
    await showFilterMenu(ctx);
    return ctx.wizard.next();
  },
  /* pasos dinámicos */
  handleAction,
);

async function handleAction(ctx) {
  if (await handleGlobalCancel(ctx)) return;
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCbQuery().catch(() => {});
  console.log('[extracto] click', ctx.wizard.state.route, data);

  const st = ctx.wizard.state;

  /* navegación principal */
  if (data === 'GO_HOME') {
    return showFilterMenu(ctx);
  }

  if (data === 'BACK_TO_FILTER') {
    switch (st.route) {
      case 'MONEDAS':
        return showAgents(ctx);
      case 'BANCOS':
        return showMonedas(ctx);
      case 'TARJETAS':
        return showBancos(ctx);
      case 'PERIOD':
        return showTarjetas(ctx);
      case 'DAY':
      case 'MONTH':
      case 'EXTRACT':
        return showPeriod(ctx);
      default:
        return showFilterMenu(ctx);
    }
  }

  /* navegación previa */
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
      case 'DAY':
      case 'MONTH':
      case 'EXTRACT':
        return showPeriod(ctx);
      default:
        return showFilterMenu(ctx);
    }
  }

  /* botón RUN */
  if (data === 'RUN') {
    if (st.route === 'EXTRACT') return; // ya estamos
    if (!st.filters.period) return showPeriod(ctx);
    return showExtract(ctx);
  }

  if (st.route === 'FILTER') {
    if (data === 'FIL_AGENT') return showAgents(ctx);
    if (data === 'FIL_MONEDA') return showMonedas(ctx);
    if (data === 'FIL_BANCO') return showBancos(ctx);
    if (data === 'FIL_TARJETA') return showTarjetas(ctx);
    if (data === 'FIL_PERIOD') return showPeriod(ctx);
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
        if (data === 'PER_dia') return showDayMenu(ctx);
        if (data === 'PER_mes') return showMonthMenu(ctx);
        if (data.startsWith('PER_')) {
          st.filters.period = data.split('_')[1];
          st.filters.fecha = null;
          st.filters.mes = null;
          return showExtract(ctx);
        }
        break;
      case 'DAY':
        if (data === 'BACK') return showPeriod(ctx);
        if (data === 'LOCKED') return ctx.answerCbQuery('No disponible');
        if (data.startsWith('DAY_')) {
          const d = data.split('_')[1];
          const now = moment();
          st.filters.period = 'dia';
          st.filters.fecha = `${now.format('YYYY-MM')}-${String(d).padStart(2, '0')}`;
          st.filters.mes = null;
          return showExtract(ctx);
        }
        break;
      case 'MONTH':
        if (data === 'BACK') return showPeriod(ctx);
        if (data === 'LOCKED') return ctx.answerCbQuery('No disponible');
        if (data.startsWith('MES_')) {
          const m = data.split('_')[1];
          const year = moment().format('YYYY');
          st.filters.period = 'mes';
          st.filters.mes = `${year}-${String(m).padStart(2, '0')}`;
          st.filters.fecha = null;
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
            [Markup.button.callback('No', 'GLOBAL_CANCEL')],
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
          st.filters = { period: getDefaultPeriod(), fecha: null, mes: null };
          st.tarjetasAll = [];
          st.lastReport = [];
          return showAgents(ctx);
        }
        break;
    }
}

module.exports = extractoAssist;
module.exports.showExtract = showExtract;
module.exports.showFilterMenu = showFilterMenu;
module.exports.handleAction = handleAction;

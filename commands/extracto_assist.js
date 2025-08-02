/**
 * commands/extracto_assist.js
 *
 * Asistente para consultar extractos bancarios por tarjeta.
 * Permite seleccionar por agente o por banco, elegir tarjeta y
 * mostrar los movimientos del último día, semana o mes con paginación.
 */

const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const {
  editIfChanged,
  buildBackExitRow,
  buildNavKeyboard,
  arrangeInlineButtons,
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

async function showMain(ctx) {
  const text = '📄 <b>Extracto bancario</b>\nElige un método de búsqueda:';
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('👥 Por agente', 'MODE_AGENT'),
      Markup.button.callback('🏦 Por banco', 'MODE_BANK'),
    ],
    [Markup.button.callback('❌ Salir', 'EXIT')],
  ]);
  await editIfChanged(ctx, text, { parse_mode: 'HTML', ...kb });
  ctx.wizard.state.route = 'MAIN';
}

async function showAgentes(ctx) {
  const agentes = (
    await pool.query('SELECT id,nombre,emoji FROM agente ORDER BY nombre')
  ).rows;
  if (!agentes.length) {
    await editIfChanged(ctx, '⚠️ No hay agentes registrados.', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]),
    });
    ctx.wizard.state.route = 'MAIN';
    return;
  }
  const buttons = agentes.map((a) =>
    Markup.button.callback(
      `${a.emoji ? a.emoji + ' ' : ''}${escapeHtml(a.nombre)}`,
      `AG_${a.id}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  const text = '👥 <b>Selecciona un agente</b>';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'AGENTS';
  ctx.wizard.state.agentes = agentes;
}

async function showBancos(ctx) {
  const bancos = (
    await pool.query('SELECT id,codigo,emoji FROM banco ORDER BY codigo')
  ).rows;
  if (!bancos.length) {
    await editIfChanged(ctx, '⚠️ No hay bancos registrados.', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]),
    });
    ctx.wizard.state.route = 'MAIN';
    return;
  }
  const buttons = bancos.map((b) =>
    Markup.button.callback(
      `${b.emoji ? b.emoji + ' ' : ''}${escapeHtml(b.codigo)}`,
      `BK_${b.id}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  const text = '🏦 <b>Selecciona un banco</b>';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'BANKS';
  ctx.wizard.state.bancos = bancos;
}

async function showTarjetasByAgente(ctx, agenteId) {
  const tarjetas = (
    await pool.query(
      `SELECT t.id, t.numero, COALESCE(b.nombre,'') AS banco, COALESCE(b.emoji,'') AS banco_emoji,
              COALESCE(m.codigo,'') AS moneda, COALESCE(m.emoji,'') AS moneda_emoji
         FROM tarjeta t
         LEFT JOIN banco b ON b.id = t.banco_id
         LEFT JOIN moneda m ON m.id = t.moneda_id
        WHERE t.agente_id = $1
        ORDER BY t.numero;`,
      [agenteId]
    )
  ).rows;
  if (!tarjetas.length) {
    await editIfChanged(ctx, '⚠️ Este agente no tiene tarjetas.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'EXIT')] },
    });
    ctx.wizard.state.route = 'AGENTS';
    return;
  }
  const buttons = tarjetas.map((t) =>
    Markup.button.callback(
      `${t.moneda_emoji || ''}${t.banco_emoji || ''} ${escapeHtml(t.numero)}`.trim(),
      `TA_${t.id}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  const agente = ctx.wizard.state.agentes.find((a) => a.id === agenteId);
  const text = `💳 <b>Tarjetas de ${escapeHtml(agente?.nombre || '')}</b>`;
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'CARDS';
  ctx.wizard.state.tarjetas = tarjetas;
  ctx.wizard.state.agente_id = agenteId;
  ctx.wizard.state.agente_nombre = agente?.nombre || '';
}

async function showTarjetasByBanco(ctx, bancoId) {
  const tarjetas = (
    await pool.query(
      `SELECT t.id, t.numero, COALESCE(a.nombre,'') AS agente, COALESCE(a.emoji,'') AS agente_emoji,
              COALESCE(m.codigo,'') AS moneda, COALESCE(m.emoji,'') AS moneda_emoji
         FROM tarjeta t
         LEFT JOIN agente a ON a.id = t.agente_id
         LEFT JOIN moneda m ON m.id = t.moneda_id
        WHERE t.banco_id = $1
        ORDER BY t.numero;`,
      [bancoId]
    )
  ).rows;
  if (!tarjetas.length) {
    await editIfChanged(ctx, '⚠️ Este banco no tiene tarjetas.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'EXIT')] },
    });
    ctx.wizard.state.route = 'BANKS';
    return;
  }
  const buttons = tarjetas.map((t) =>
    Markup.button.callback(
      `${t.moneda_emoji || ''}${t.agente_emoji || ''} ${escapeHtml(t.numero)}`.trim(),
      `TA_${t.id}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow('BACK', 'EXIT'));
  const banco = ctx.wizard.state.bancos.find((b) => b.id === bancoId);
  const text = `💳 <b>Tarjetas en ${escapeHtml(banco?.codigo || '')}</b>`;
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'CARDS';
  ctx.wizard.state.tarjetas = tarjetas;
  ctx.wizard.state.banco_id = bancoId;
  ctx.wizard.state.banco_nombre = banco?.codigo || '';
}

async function showPeriodMenu(ctx) {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📅 Día', 'PER_day')],
    [Markup.button.callback('🗓️ Semana', 'PER_week')],
    [Markup.button.callback('📆 Mes', 'PER_month')],
    buildBackExitRow('BACK', 'EXIT'),
  ]);
  await editIfChanged(ctx, '⏱️ <b>Selecciona el periodo</b>', {
    parse_mode: 'HTML',
    ...kb,
  });
  ctx.wizard.state.route = 'PERIOD';
}

async function showExtract(ctx, period) {
  const tarjeta = ctx.wizard.state.tarjeta;
  const ranges = {
    day: { label: 'Último día', days: 1 },
    week: { label: 'Última semana', days: 7 },
    month: { label: 'Último mes', days: 30 },
  };
  const r = ranges[period] || ranges.day;
  const since = new Date();
  since.setDate(since.getDate() - r.days);
  const movimientos = (
    await pool.query(
      `SELECT descripcion, saldo_anterior, importe, saldo_nuevo, creado_en
         FROM movimiento
        WHERE tarjeta_id = $1 AND creado_en >= $2
        ORDER BY creado_en DESC`,
      [tarjeta.id, since]
    )
  ).rows;
  let body = '';
  for (const mv of movimientos) {
    const f = new Date(mv.creado_en);
    body += `${f.toLocaleString()} — ${escapeHtml(mv.descripcion || '')} `;
    const imp = parseFloat(mv.importe) || 0;
    const sign = imp >= 0 ? '+' : '-';
    body += `${sign}${fmt(Math.abs(imp))} → ${fmt(mv.saldo_nuevo)}\n`;
  }
  if (!body) body = 'Sin movimientos.';
  const header =
    `📄 <b>Extracto ${escapeHtml(tarjeta.numero)}</b>\n` +
    `👤 Propietario: <b>${escapeHtml(tarjeta.agente || ctx.wizard.state.agente_nombre || '')}</b>\n` +
    (ctx.wizard.state.banco_nombre
      ? `🏦 Banco: <b>${escapeHtml(ctx.wizard.state.banco_nombre)}</b>\n`
      : tarjeta.banco
      ? `🏦 Banco: <b>${escapeHtml(tarjeta.banco)}</b>\n`
      : '') +
    `Periodo: <b>${r.label}</b>\n\n`;
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

/* ───────── Wizard ───────── */
const extractoAssist = new Scenes.WizardScene(
  'EXTRACTO_ASSIST',
  async (ctx) => {
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    await showMain(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const route = ctx.wizard.state.route;
    if (route === 'MAIN') {
      if (data === 'MODE_AGENT') return showAgentes(ctx);
      if (data === 'MODE_BANK') return showBancos(ctx);
    } else if (route === 'AGENTS') {
      if (data === 'BACK') return showMain(ctx);
      if (data.startsWith('AG_')) {
        const id = +data.split('_')[1];
        ctx.wizard.state.mode = 'AGENT';
        return showTarjetasByAgente(ctx, id);
      }
    } else if (route === 'BANKS') {
      if (data === 'BACK') return showMain(ctx);
      if (data.startsWith('BK_')) {
        const id = +data.split('_')[1];
        ctx.wizard.state.mode = 'BANK';
        return showTarjetasByBanco(ctx, id);
      }
    }
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'BACK') {
      if (ctx.wizard.state.mode === 'AGENT') return showAgentes(ctx);
      if (ctx.wizard.state.mode === 'BANK') return showBancos(ctx);
    }
    if (!data.startsWith('TA_')) return ctx.reply('Usa los botones para elegir la tarjeta.');
    const id = +data.split('_')[1];
    const tarjeta = ctx.wizard.state.tarjetas.find((t) => t.id === id);
    ctx.wizard.state.tarjeta = tarjeta;
    return showPeriodMenu(ctx);
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'BACK') {
      if (ctx.wizard.state.mode === 'AGENT')
        return showTarjetasByAgente(ctx, ctx.wizard.state.agente_id);
      return showTarjetasByBanco(ctx, ctx.wizard.state.banco_id);
    }
    if (data.startsWith('PER_')) {
      const period = data.split('_')[1];
      await showExtract(ctx, period);
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'BACK') return showPeriodMenu(ctx);
    const pages = ctx.wizard.state.pages || [];
    let i = ctx.wizard.state.pageIndex || 0;
    const last = pages.length - 1;
    let ni = i;
    if (data === 'FIRST') ni = 0;
    else if (data === 'PREV') ni = Math.max(0, i - 1);
    else if (data === 'NEXT') ni = Math.min(last, i + 1);
    else if (data === 'LAST') ni = last;
    if (ni === i) return;
    ctx.wizard.state.pageIndex = ni;
    const txt = pages[ni] + `\n\nPágina ${ni + 1}/${pages.length}`;
    const nav =
      pages.length > 1
        ? buildNavKeyboard({ back: 'BACK', exit: 'EXIT' })
        : Markup.inlineKeyboard([buildBackExitRow('BACK', 'EXIT')]);
    await editIfChanged(ctx, txt, { parse_mode: 'HTML', ...nav });
  }
);

module.exports = extractoAssist;

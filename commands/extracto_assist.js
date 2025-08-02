/**
 * commands/extracto_assist.js
 *
 * Asistente para consultar extractos bancarios por tarjeta.
 * Todas las respuestas se envían en modo HTML y los datos dinámicos se
 * sanitizan con `escapeHtml` para evitar inyecciones.
 *
 * Se usa `editIfChanged(ctx, newText, options)` para mantener un único
 * mensaje editable. Este helper compara el texto y el teclado previo
 * (`ctx.wizard.state.lastRender`) y solo edita si hay cambios, evitando
 * el error "message is not modified" y el spam.
 *
 * Modo rápido: establecer `FAST_MODE` en `true` para que, al elegir una
 * tarjeta, se muestre directamente el extracto del último día sin pedir
 * periodo. Para agregar nuevos periodos, ampliar el objeto `ranges` en
 * `showExtract` y el menú generado en `showPeriodMenu`.
 */

/* Casos de prueba manuales:
 *  - /extracto → “Por agente” → seleccionar un agente → elegir tarjeta → ver extracto del día.
 *  - Desde extracto, usar “🔙” para volver a periodo y luego a tarjetas.
 *  - Usar “❌ Salir” en cualquier punto y verificar mensaje de cancelación.
 *  - Presionar “Siguiente” en la última página y recibir aviso sin re-editar.
 *  - Forzar selección de tarjeta inexistente y comprobar retorno a la lista.
 *  - Activar FAST_MODE=true para obtener extracto directo sin seleccionar periodo.
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
// Cambiar a true para activar el modo rápido (sin selección de periodo)
const FAST_MODE = false;

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
    console.log('[EXTRACTO_ASSIST] exit');
    await editIfChanged(ctx, '❌ Operación cancelada.', { parse_mode: 'HTML' });
    await ctx.scene.leave();
    return true;
  }
  return false;
}

async function showMain(ctx) {
  console.log('[EXTRACTO_ASSIST] view MAIN');
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
  console.log('[EXTRACTO_ASSIST] view AGENTS');
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
  console.log('[EXTRACTO_ASSIST] view BANKS');
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
  console.log('[EXTRACTO_ASSIST] view CARDS agente', agenteId);
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
  console.log('[EXTRACTO_ASSIST] view CARDS banco', bancoId);
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
  console.log('[EXTRACTO_ASSIST] view PERIOD');
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
  console.log('[EXTRACTO_ASSIST] view EXTRACT', period);
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
  let totalIn = 0;
  let totalOut = 0;
  for (const mv of movimientos) {
    const f = new Date(mv.creado_en);
    body += `${f.toLocaleString()} — ${escapeHtml(mv.descripcion || '')} `;
    const imp = parseFloat(mv.importe) || 0;
    if (imp >= 0) totalIn += imp; else totalOut += -imp;
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
    `Periodo: <b>${r.label}</b>\n` +
    `↗️ Entradas: <b>${fmt(totalIn)}</b>\n` +
    `↘️ Salidas: <b>${fmt(totalOut)}</b>\n\n`;
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
    console.log('[EXTRACTO_ASSIST] init');
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.fastMode = FAST_MODE;
    await showMain(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const route = ctx.wizard.state.route;
    console.log('[EXTRACTO_ASSIST] callback', route, data);
    if (route === 'MAIN') {
      if (data === 'MODE_AGENT') return showAgentes(ctx);
      if (data === 'MODE_BANK') return showBancos(ctx);
    } else if (route === 'AGENTS') {
      if (data === 'BACK') {
        console.log('[EXTRACTO_ASSIST] back to MAIN');
        return showMain(ctx);
      }
      if (data.startsWith('AG_')) {
        const id = +data.split('_')[1];
        ctx.wizard.state.mode = 'AGENT';
        await showTarjetasByAgente(ctx, id);
        return ctx.wizard.next();
      }
    } else if (route === 'BANKS') {
      if (data === 'BACK') {
        console.log('[EXTRACTO_ASSIST] back to MAIN');
        return showMain(ctx);
      }
      if (data.startsWith('BK_')) {
        const id = +data.split('_')[1];
        ctx.wizard.state.mode = 'BANK';
        await showTarjetasByBanco(ctx, id);
        return ctx.wizard.next();
      }
    }
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    const route = ctx.wizard.state.route;
    console.log('[EXTRACTO_ASSIST] callback', route, data);
    if (data === 'BACK') {
      await ctx.answerCbQuery().catch(() => {});
      console.log('[EXTRACTO_ASSIST] back to', ctx.wizard.state.mode === 'AGENT' ? 'AGENTS' : 'BANKS');
      if (ctx.wizard.state.mode === 'AGENT') await showAgentes(ctx);
      else await showBancos(ctx);
      return ctx.wizard.back();
    }
    if (!data.startsWith('TA_')) {
      return ctx.answerCbQuery('Usa los botones').catch(() => {});
    }
    const id = +data.split('_')[1];
    const tarjeta = ctx.wizard.state.tarjetas?.find((t) => t.id === id);
    if (!tarjeta) {
      console.error('[EXTRACTO_ASSIST] tarjeta no encontrada', id);
      await ctx.answerCbQuery('Tarjeta desconocida').catch(() => {});
      if (ctx.wizard.state.mode === 'AGENT') await showTarjetasByAgente(ctx, ctx.wizard.state.agente_id);
      else await showTarjetasByBanco(ctx, ctx.wizard.state.banco_id);
      return;
    }
    ctx.wizard.state.tarjeta = tarjeta;
    console.log('[EXTRACTO_ASSIST] tarjeta seleccionada', id);
    if (ctx.wizard.state.fastMode) {
      await ctx.answerCbQuery().catch(() => {});
      await showExtract(ctx, 'day');
      return ctx.wizard.selectStep(4);
    }
    await ctx.answerCbQuery().catch(() => {});
    await showPeriodMenu(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    console.log('[EXTRACTO_ASSIST] callback', ctx.wizard.state.route, data);
    if (data === 'BACK') {
      console.log('[EXTRACTO_ASSIST] back to CARDS');
      if (ctx.wizard.state.mode === 'AGENT') await showTarjetasByAgente(ctx, ctx.wizard.state.agente_id);
      else await showTarjetasByBanco(ctx, ctx.wizard.state.banco_id);
      return ctx.wizard.back();
    }
    if (data.startsWith('PER_')) {
      const period = data.split('_')[1];
      console.log('[EXTRACTO_ASSIST] periodo', period);
      await showExtract(ctx, period);
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    const route = ctx.wizard.state.route;
    console.log('[EXTRACTO_ASSIST] callback', route, data);
    if (data === 'BACK') {
      console.log('[EXTRACTO_ASSIST] back to PERIOD');
      await ctx.answerCbQuery().catch(() => {});
      await showPeriodMenu(ctx);
      return ctx.wizard.back();
    }
    const pages = ctx.wizard.state.pages || [];
    let i = ctx.wizard.state.pageIndex || 0;
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
    await ctx.answerCbQuery().catch(() => {});
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

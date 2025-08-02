/**
 * commands/tarjetas_assist.js
 *
 * Asistente interactivo para listar tarjetas sin generar mensajes nuevos.
 *
 * Correcciones principales:
 * - Se añadió editIfChanged para evitar "400: message is not modified".
 * - Separación de bloques por agente y por combinación moneda+banco.
 * - Navegación jerárquica con botones Volver/Salir y paginación por entidad.
 * - Menús principales en filas de dos y paginación mostrada solo cuando hay más de una página.
 *
 * Todo usa parse mode HTML y escapeHtml para sanear entradas dinámicas.
 * Las vistas se pueden extender añadiendo nuevas rutas en showMenu/builders.
 *
 * Casos de prueba manuales:
 * - `/tarjetas` → "Por agente" → elegir un agente → validar que solo se
 *   muestran sus monedas y tarjetas.
 * - "Por moneda y banco" → elegir moneda → banco → detalle sin mezclar otras
 *   combinaciones.
 * - Navegar con Siguiente/Anterior sin provocar "message is not modified".
 */

const { Scenes, Markup, Telegram } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const {
  editIfChanged,
  buildNavKeyboard,
  buildBackExitRow,
  arrangeInlineButtons,
} = require('../helpers/ui');
const pool = require('../psql/db.js');

/* Configuración */
const LINES_PER_PAGE = 12; // Líneas máximas por página para detalles largos
const MAX_LEN = Telegram.MAX_MESSAGE_LENGTH;

/* ───────── helpers ───────── */
const fmt = (v, d = 2) =>
  escapeHtml(
    Number(v || 0).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );

function paginate(text, linesPerPage = LINES_PER_PAGE) {
  const lines = text.split('\n');
  const pages = [];
  let buf = '';
  let count = 0;
  for (const line of lines) {
    const nl = line + '\n';
    if (count >= linesPerPage || (buf + nl).length > MAX_LEN) {
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
  if (ctx.message?.text) {
    const t = ctx.message.text.trim().toLowerCase();
    if (['/cancel', '/salir', 'salir'].includes(t) && ctx.scene?.current) {
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
  }
  return false;
}

async function loadData() {
  const sql = `
    SELECT t.id, t.numero, t.agente_id,
           COALESCE(ag.nombre,'—') AS agente,
           COALESCE(ag.emoji,'')   AS agente_emoji,
           COALESCE(b.id,0)        AS banco_id,
           COALESCE(b.codigo,'Sin banco') AS banco,
           COALESCE(b.emoji,'')    AS banco_emoji,
           COALESCE(m.codigo,'—')  AS moneda,
           COALESCE(m.emoji,'')    AS moneda_emoji,
           COALESCE(m.tasa_usd,1)  AS tasa_usd,
           COALESCE(mv.saldo_nuevo,0) AS saldo
      FROM tarjeta t
      LEFT JOIN agente ag ON ag.id = t.agente_id
      LEFT JOIN banco  b  ON b.id = t.banco_id
      LEFT JOIN moneda m  ON m.id = t.moneda_id
      LEFT JOIN LATERAL (
        SELECT saldo_nuevo
          FROM movimiento
          WHERE tarjeta_id = t.id
          ORDER BY creado_en DESC
          LIMIT 1
      ) mv ON TRUE;`;
  const rows = (await pool.query(sql)).rows;
  const byAgent = {};
  const byMon = {};
  const bankUsd = {};
  let globalUsd = 0;

  rows.forEach((r) => {
    const usd = r.saldo * r.tasa_usd;
    globalUsd += usd;
    bankUsd[r.banco] = (bankUsd[r.banco] || 0) + usd;

    byAgent[r.agente_id] ??= {
      id: r.agente_id,
      nombre: r.agente,
      emoji: r.agente_emoji,
      totalUsd: 0,
      perMon: {},
    };
    const ag = byAgent[r.agente_id];
    ag.totalUsd += usd;
    ag.perMon[r.moneda] ??= {
      code: r.moneda,
      emoji: r.moneda_emoji,
      rate: r.tasa_usd,
      tarjetas: [],
      total: 0,
    };
    ag.perMon[r.moneda].tarjetas.push({
      numero: r.numero,
      saldo: r.saldo,
      banco: r.banco,
      banco_emoji: r.banco_emoji,
    });
    ag.perMon[r.moneda].total += r.saldo;

    byMon[r.moneda] ??= {
      code: r.moneda,
      emoji: r.moneda_emoji,
      rate: r.tasa_usd,
      banks: {},
    };
    const mon = byMon[r.moneda];
    mon.banks[r.banco] ??= {
      code: r.banco,
      emoji: r.banco_emoji,
      tarjetas: [],
      pos: 0,
      neg: 0,
    };
    const bk = mon.banks[r.banco];
    bk.tarjetas.push({
      numero: r.numero,
      saldo: r.saldo,
      agente: r.agente,
      agente_emoji: r.agente_emoji,
    });
    if (r.saldo >= 0) bk.pos += r.saldo;
    else bk.neg += r.saldo;
  });

  return { byAgent, byMon, bankUsd, globalUsd };
}

/* ───────── renderizadores ───────── */
async function showMenu(ctx) {
  // Menú principal con dos botones por fila
  const buttons = [
    Markup.button.callback('📊 Por moneda y banco', 'VIEW_MON'),
    Markup.button.callback('👤 Por agente', 'VIEW_AGENT'),
    Markup.button.callback('🧮 Resumen USD global', 'VIEW_SUM'),
    Markup.button.callback('❌ Salir', 'EXIT'),
  ];
  const kb = Markup.inlineKeyboard(arrangeInlineButtons(buttons));
  const text = '💳 <b>Tarjetas</b>\nElige la vista deseada:';
  await editIfChanged(ctx, text, { parse_mode: 'HTML', ...kb });
  ctx.wizard.state.route = { view: 'MENU' };
}

async function showAgentList(ctx) {
  const agents = Object.values(ctx.wizard.state.data.byAgent)
    .filter((a) => a.totalUsd !== 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const buttons = agents.map((a) =>
    Markup.button.callback(
      `${a.emoji ? a.emoji + ' ' : ''}${escapeHtml(a.nombre)}`,
      `AG_${a.id}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = '👤 <b>Agentes</b>\nSelecciona un agente:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'AGENT_LIST' };
}

function buildAgentPages(agent) {
  const pages = [];
  Object.values(agent.perMon)
    .filter((m) => m.total !== 0)
    .forEach((m) => {
      let msg = `👤 <b>${agent.emoji ? agent.emoji + ' ' : ''}${escapeHtml(
        agent.nombre
      )}</b>\n`;
      msg += `${m.emoji} <b>${escapeHtml(m.code)}</b>\n`;
      m.tarjetas
        .filter((t) => t.saldo !== 0)
        .forEach((t) => {
          msg += `• ${escapeHtml(t.numero)} – ${escapeHtml(
            t.banco
          )} ⇒ ${fmt(t.saldo)}\n`;
        });
      msg += `\n<b>Total:</b> ${fmt(m.total)} ${escapeHtml(m.code)}\n`;
      msg += `<b>Equiv. USD:</b> ${fmt(m.total * m.rate)}\n`;
      pages.push(msg);
    });
  return pages.length ? pages : ['No hay datos.'];
}

async function showAgentDetail(ctx, agentId, page = 0) {
  const agent = ctx.wizard.state.data.byAgent[agentId];
  const pages = buildAgentPages(agent);
  const idx = Math.max(0, Math.min(page, pages.length - 1));
  ctx.wizard.state.pages = pages;
  ctx.wizard.state.pageIndex = idx;
  ctx.wizard.state.route = { view: 'AGENT_DETAIL', agentId };
  const text = pages[idx] + `\n\nPágina ${idx + 1}/${pages.length}`;
  const nav =
    pages.length > 1
      ? buildNavKeyboard()
      : Markup.inlineKeyboard([buildBackExitRow()]);
  await editIfChanged(ctx, text, { parse_mode: 'HTML', ...nav });
}

async function showMonList(ctx) {
  const mons = Object.values(ctx.wizard.state.data.byMon)
    .filter((m) => Object.values(m.banks).some((b) => b.pos + b.neg !== 0))
    .sort((a, b) => a.code.localeCompare(b.code));
  const buttons = mons.map((m) =>
    Markup.button.callback(
      `${m.emoji ? m.emoji + ' ' : ''}${escapeHtml(m.code)}`,
      `MON_${m.code}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = '💱 <b>Monedas</b>\nSelecciona una moneda:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'MON_LIST' };
}

async function showBankList(ctx, monCode) {
  const mon = ctx.wizard.state.data.byMon[monCode];
  const banks = Object.values(mon.banks)
    .filter((b) => b.pos + b.neg !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const buttons = banks.map((b) =>
    Markup.button.callback(
      `${b.emoji ? b.emoji + ' ' : ''}${escapeHtml(b.code)}`,
      `BK_${mon.code}_${b.code}`
    )
  );
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  const text = `${mon.emoji} <b>${escapeHtml(
    mon.code
  )}</b>\nSelecciona banco:`;
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'MON_BANKS', monCode };
}

function buildMonBankPages(mon, bank) {
  let msg = `${mon.emoji} <b>${escapeHtml(mon.code)}</b> - ${bank.emoji} <b>${escapeHtml(
    bank.code
  )}</b>\n\n`;
  bank.tarjetas
    .filter((t) => t.saldo !== 0)
    .forEach((t) => {
      const agTxt = `${t.agente_emoji ? t.agente_emoji + ' ' : ''}${escapeHtml(
        t.agente
      )}`;
      msg += `• ${escapeHtml(t.numero)} – ${agTxt} ⇒ ${fmt(t.saldo)}\n`;
    });
  const total = bank.pos + bank.neg;
  msg += `\n<b>Total activo:</b> ${fmt(bank.pos)} ${escapeHtml(mon.code)}\n`;
  if (bank.neg)
    msg += `<b>Total deuda:</b> ${fmt(bank.neg)} ${escapeHtml(mon.code)}\n`;
  msg += `<b>Neto:</b> ${fmt(total)} ${escapeHtml(mon.code)}\n`;
  msg += `<b>Equiv. neto USD:</b> ${fmt(total * mon.rate)}\n`;
  return paginate(msg);
}

async function showMonBankDetail(ctx, monCode, bankCode, page = 0) {
  const mon = ctx.wizard.state.data.byMon[monCode];
  const bank = mon.banks[bankCode];
  const pages = buildMonBankPages(mon, bank);
  const idx = Math.max(0, Math.min(page, pages.length - 1));
  ctx.wizard.state.pages = pages;
  ctx.wizard.state.pageIndex = idx;
  ctx.wizard.state.route = { view: 'MON_DETAIL', monCode, bankCode };
  const text = pages[idx] + `\n\nPágina ${idx + 1}/${pages.length}`;
  const nav =
    pages.length > 1
      ? buildNavKeyboard()
      : Markup.inlineKeyboard([buildBackExitRow()]);
  await editIfChanged(ctx, text, { parse_mode: 'HTML', ...nav });
}

async function showSummary(ctx) {
  const { bankUsd, globalUsd } = ctx.wizard.state.data;
  let resumen = '🧮 <b>Resumen general en USD</b>\n';
  Object.entries(bankUsd)
    .filter(([, usd]) => usd !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([bank, usd]) => {
      resumen += `• <b>${escapeHtml(bank)}</b>: ${fmt(usd)} USD\n`;
    });
  resumen += `\n<b>Total general:</b> ${fmt(globalUsd)} USD`;
  const buttons = [
    Markup.button.callback('👤 Por agente', 'VIEW_AGENT'),
    Markup.button.callback('📊 Por moneda y banco', 'VIEW_MON'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  await editIfChanged(ctx, resumen, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'SUMMARY' };
}

/* ───────── Wizard ───────── */
const tarjetasAssist = new Scenes.WizardScene(
  'TARJETAS_ASSIST',
  async (ctx) => {
    console.log('[TARJETAS_ASSIST] inicio menú');
    const buttons = [
      Markup.button.callback('📊 Por moneda y banco', 'VIEW_MON'),
      Markup.button.callback('👤 Por agente', 'VIEW_AGENT'),
      Markup.button.callback('🧮 Resumen USD global', 'VIEW_SUM'),
      Markup.button.callback('❌ Salir', 'EXIT'),
    ];
    const kb = Markup.inlineKeyboard(arrangeInlineButtons(buttons));
    const text = '💳 <b>Tarjetas</b>\nElige la vista deseada:';
    const msg = await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.lastRender = { text, reply_markup: kb.reply_markup };
    ctx.wizard.state.route = { view: 'MENU' };
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const route = ctx.wizard.state.route?.view || 'MENU';

    if (!ctx.wizard.state.data) {
      ctx.wizard.state.data = await loadData();
    }

    switch (route) {
      case 'MENU':
        if (data === 'VIEW_AGENT') return showAgentList(ctx);
        if (data === 'VIEW_MON') return showMonList(ctx);
        if (data === 'VIEW_SUM') return showSummary(ctx);
        break;
      case 'AGENT_LIST':
        if (data === 'BACK') return showMenu(ctx);
        if (data.startsWith('AG_')) {
          const id = data.split('_')[1];
          console.log('[TARJETAS_ASSIST] cambio a vista AGENTE detalle', id);
          return showAgentDetail(ctx, id, 0);
        }
        break;
      case 'AGENT_DETAIL':
        if (data === 'BACK') return showAgentList(ctx);
        {
          const pages = ctx.wizard.state.pages || [];
          let i = ctx.wizard.state.pageIndex || 0;
          const last = pages.length - 1;
          let ni = i;
          if (data === 'FIRST') ni = 0;
          else if (data === 'PREV') ni = Math.max(0, i - 1);
          else if (data === 'NEXT') ni = Math.min(last, i + 1);
          else if (data === 'LAST') ni = last;
          if (ni === i) return ctx.answerCbQuery('Sin más páginas').catch(() => {});
          ctx.wizard.state.pageIndex = ni;
          const txt =
            pages[ni] + `\n\nPágina ${ni + 1}/${pages.length}`;
          const nav =
            pages.length > 1
              ? buildNavKeyboard()
              : Markup.inlineKeyboard([buildBackExitRow()]);
          await editIfChanged(ctx, txt, { parse_mode: 'HTML', ...nav });
        }
        break;
      case 'MON_LIST':
        if (data === 'BACK') return showMenu(ctx);
        if (data.startsWith('MON_')) {
          const mon = data.split('_')[1];
          console.log('[TARJETAS_ASSIST] cambio a vista MONEDA', mon);
          return showBankList(ctx, mon);
        }
        break;
      case 'MON_BANKS':
        if (data === 'BACK') return showMonList(ctx);
        if (data.startsWith('BK_')) {
          const [, mon, bank] = data.split('_');
          console.log(
            '[TARJETAS_ASSIST] cambio a vista MONEDA+BANK detalle',
            mon,
            bank
          );
          return showMonBankDetail(ctx, mon, bank, 0);
        }
        break;
      case 'MON_DETAIL':
        if (data === 'BACK') {
          const { monCode } = ctx.wizard.state.route;
          return showBankList(ctx, monCode);
        }
        {
          const pages = ctx.wizard.state.pages || [];
          let i = ctx.wizard.state.pageIndex || 0;
          const last = pages.length - 1;
          let ni = i;
          if (data === 'FIRST') ni = 0;
          else if (data === 'PREV') ni = Math.max(0, i - 1);
          else if (data === 'NEXT') ni = Math.min(last, i + 1);
          else if (data === 'LAST') ni = last;
          if (ni === i) return ctx.answerCbQuery('Sin más páginas').catch(() => {});
          ctx.wizard.state.pageIndex = ni;
          const txt =
            pages[ni] + `\n\nPágina ${ni + 1}/${pages.length}`;
          const nav =
            pages.length > 1
              ? buildNavKeyboard()
              : Markup.inlineKeyboard([buildBackExitRow()]);
          await editIfChanged(ctx, txt, { parse_mode: 'HTML', ...nav });
        }
        break;
      case 'SUMMARY':
        if (data === 'BACK') return showMenu(ctx);
        if (data === 'VIEW_AGENT') return showAgentList(ctx);
        if (data === 'VIEW_MON') return showMonList(ctx);
        break;
      default:
        break;
    }
  }
);

module.exports = tarjetasAssist;

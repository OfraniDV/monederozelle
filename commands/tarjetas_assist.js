/**
 * commands/tarjetas_assist.js
 *
 * Asistente interactivo para listar tarjetas sin generar mensajes nuevos.
 *
 * Correcciones principales:
 * - Se añadió editIfChanged para evitar "400: message is not modified".
 * - Separación de bloques por agente y por combinación moneda+banco.
 * - Navegación jerárquica con botones Volver/Salir y envío de bloques con
 *   sendLargeMessage evitando paginación manual.
 * - Menús principales en filas de dos.
 *
 * Todo usa parse mode HTML y escapeHtml para sanear entradas dinámicas.
 * Las vistas se pueden extender añadiendo nuevas rutas en showMenu/builders.
 *
 * Casos de prueba manuales:
 * - `/tarjetas` → "Por agente" → elegir un agente → validar que solo se
 *   muestran sus monedas y tarjetas.
 * - "Por moneda y banco" → elegir moneda → banco → detalle sin mezclar otras
 *   combinaciones.
 * - Envíos largos divididos automáticamente respetando 4096 caracteres.
 */

const { Scenes, Markup } = require('telegraf');
const { escapeHtml, boldHeader, chunkHtml } = require('../helpers/format');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');
const { sendAndLog } = require('../helpers/reportSender');
const {
  editIfChanged,
  buildBackExitRow,
  arrangeInlineButtons,
  buildSaveExitRow,
  buildSaveBackExitKeyboard,
  sendReportWithKb,
  withExitHint,
} = require('../helpers/ui');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');
const pool = require('../psql/db.js');

/* ───────── helpers ───────── */
const fmt = (v, d = 2) => {
  const num = parseFloat(v);
  const val = Number.isNaN(num) ? 0 : num;
  return escapeHtml(
    val.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );
};

function normalizeBlocks(blocks = []) {
  const arr = Array.isArray(blocks) ? blocks : [blocks];
  const chunked = arr.flatMap((block) => {
    if (block === undefined || block === null) return [];
    const str = String(block);
    if (!str.trim()) return [];
    return chunkHtml(str);
  });
  return chunked.length ? chunked : ['No hay datos.'];
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
    const saldo = parseFloat(r.saldo) || 0;
    const tasa = parseFloat(r.tasa_usd) || 0;
    const usd = saldo * tasa;
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
      rate: tasa,
      tarjetas: [],
      total: 0,
    };
    ag.perMon[r.moneda].tarjetas.push({
      numero: r.numero,
      saldo,
      banco: r.banco,
      banco_emoji: r.banco_emoji,
    });
    ag.perMon[r.moneda].total += saldo;

    byMon[r.moneda] ??= {
      code: r.moneda,
      emoji: r.moneda_emoji,
      rate: tasa,
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
      saldo,
      agente: r.agente,
      agente_emoji: r.agente_emoji,
    });
    if (saldo >= 0) bk.pos += saldo;
    else bk.neg += saldo;
  });

  return { byAgent, byMon, bankUsd, globalUsd };
}

/* ───────── renderizadores ───────── */
async function showMenu(ctx) {
  // Menú principal en formato de lista (una opción por fila)
  const buttons = [
    Markup.button.callback('📊 Por moneda y banco', 'VIEW_MON'),
    Markup.button.callback('👤 Por agente', 'VIEW_AGENT'),
    Markup.button.callback('🧮 Resumen USD global', 'VIEW_SUM'),
    Markup.button.callback('📋 Ver todas', 'VIEW_ALL'),
    Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'),
  ];
  const kb = Markup.inlineKeyboard(buttons.map((b) => [b]));
  const text = withExitHint('💳 <b>Tarjetas</b>\nElige la vista deseada:');
  await editIfChanged(ctx, text, { parse_mode: 'HTML', reply_markup: kb.reply_markup });
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
  const text = withExitHint('👤 <b>Agentes</b>\nSelecciona un agente:');
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'AGENT_LIST' };
}

function buildAgentBlocks(agent) {
  const parts = [`👤 <b>${agent.emoji ? agent.emoji + ' ' : ''}${escapeHtml(agent.nombre)}</b>`];
  Object.values(agent.perMon)
    .filter((m) => m.total !== 0)
    .forEach((m) => {
      let msg = `${m.emoji} <b>${escapeHtml(m.code)}</b>\n`;
      m.tarjetas
        .filter((t) => t.saldo !== 0)
        .forEach((t) => {
          msg += `• ${escapeHtml(t.numero)} – ${escapeHtml(t.banco)} ⇒ ${fmt(t.saldo)}\n`;
        });
      msg += `\n<b>Total:</b> ${fmt(m.total)} ${escapeHtml(m.code)}\n`;
      msg += `<b>Equiv. USD:</b> ${fmt(m.total * m.rate)}`;
      parts.push(msg);
    });
  const text = parts.join('\n\n');
  return text.trim() ? [text] : ['No hay datos.'];
}

async function showAgentDetail(ctx, agentId) {
  const agent = ctx.wizard.state.data.byAgent[agentId];
  const blocks = normalizeBlocks(buildAgentBlocks(agent));
  ctx.wizard.state.lastReport = blocks; // UX-2025
  await sendLargeMessage(ctx, blocks); // UX-2025
  const kb = Markup.inlineKeyboard([buildSaveExitRow()]).reply_markup; // UX-2025
  await sendReportWithKb(ctx, [], kb); // UX-2025
  ctx.wizard.state.lastRender = {};
  ctx.wizard.state.route = { view: 'AFTER_REPORT' }; // UX-2025
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
  const text = withExitHint('💱 <b>Monedas</b>\nSelecciona una moneda:');
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
  const text = withExitHint(`${mon.emoji} <b>${escapeHtml(
    mon.code
  )}</b>\nSelecciona banco:`);
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = { view: 'MON_BANKS', monCode };
}

function buildMonBankBlocks(mon, bank) {
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
  return [msg];
}

async function showMonBankDetail(ctx, monCode, bankCode) {
  const mon = ctx.wizard.state.data.byMon[monCode];
  const bank = mon.banks[bankCode];
  const blocks = normalizeBlocks(buildMonBankBlocks(mon, bank));
  ctx.wizard.state.lastReport = blocks; // UX-2025
  await sendLargeMessage(ctx, blocks); // UX-2025
  const kb = Markup.inlineKeyboard([buildSaveExitRow()]).reply_markup; // UX-2025
  await sendReportWithKb(ctx, [], kb); // UX-2025
  ctx.wizard.state.lastRender = {};
  ctx.wizard.state.route = { view: 'AFTER_REPORT' }; // UX-2025
}

function buildAllBlocks(data) {
  let text = '💳 <b>Todas las tarjetas</b>';
  const monTotals = [];
  Object.values(data.byMon)
    .sort((a, b) => a.code.localeCompare(b.code))
    .forEach((mon) => {
      let monPos = 0;
      let monNeg = 0;
      Object.values(mon.banks)
        .sort((a, b) => a.code.localeCompare(b.code))
        .forEach((bank) => {
          text += `\n\n${mon.emoji} <b>${escapeHtml(mon.code)}</b> - ${bank.emoji} <b>${escapeHtml(
            bank.code
          )}</b>\n`;
          bank.tarjetas
            .filter((t) => t.saldo !== 0)
            .forEach((t) => {
              const agTxt = `${t.agente_emoji ? t.agente_emoji + ' ' : ''}${escapeHtml(t.agente)}`;
              text += `• ${escapeHtml(t.numero)} – ${agTxt} ⇒ ${fmt(t.saldo)}\n`;
            });
          const total = bank.pos + bank.neg;
          monPos += bank.pos;
          monNeg += bank.neg;
          text += `<b>Total activo:</b> ${fmt(bank.pos)} ${escapeHtml(mon.code)}\n`;
          if (bank.neg)
            text += `<b>Total deuda:</b> ${fmt(bank.neg)} ${escapeHtml(mon.code)}\n`;
          text += `<b>Neto:</b> ${fmt(total)} ${escapeHtml(mon.code)}\n`;
          text += `<b>Equiv. neto USD:</b> ${fmt(total * mon.rate)}\n`;
        });
      const monTotal = monPos + monNeg;
      monTotals.push({
        code: mon.code,
        emoji: mon.emoji,
        rate: mon.rate,
        pos: monPos,
        neg: monNeg,
        total: monTotal,
      });
    });
  if (monTotals.some((m) => m.pos !== 0 || m.neg !== 0)) {
    text += '\n\n<b>Totales por moneda</b>';
    monTotals
      .filter((m) => m.pos !== 0 || m.neg !== 0)
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((m) => {
        text += `\n${m.emoji} <b>${escapeHtml(m.code)}</b>\n`;
        text += `<b>Total activo:</b> ${fmt(m.pos)} ${escapeHtml(m.code)}\n`;
        if (m.neg)
          text += `<b>Total deuda:</b> ${fmt(m.neg)} ${escapeHtml(m.code)}\n`;
        text += `<b>Neto:</b> ${fmt(m.total)} ${escapeHtml(m.code)}\n`;
        text += `<b>Equiv. neto USD:</b> ${fmt(m.total * m.rate)}\n`;
      });
  }
  return text.trim() ? [text] : ['No hay datos.'];
}

async function showAll(ctx) {
  const blocks = normalizeBlocks(buildAllBlocks(ctx.wizard.state.data));
  ctx.wizard.state.lastReport = blocks; // UX-2025
  await sendLargeMessage(ctx, blocks); // UX-2025
  const kb = buildSaveBackExitKeyboard({ back: 'BACK_TO_MENU' }); // UX-2025
  await sendReportWithKb(ctx, [], kb); // UX-2025
  ctx.wizard.state.lastRender = {};
  ctx.wizard.state.route = { view: 'AFTER_REPORT' }; // UX-2025
}

async function showSummary(ctx) {
  const { bankUsd, globalUsd } = ctx.wizard.state.data;
  let resumen = boldHeader('🧮', 'Resumen general en USD') + '\n';
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
    Markup.button.callback('📋 Ver todas', 'VIEW_ALL'),
  ];
  const kb = arrangeInlineButtons(buttons);
  kb.push(buildBackExitRow());
  await editIfChanged(ctx, withExitHint(resumen), {
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
      Markup.button.callback('📋 Ver todas', 'VIEW_ALL'),
      Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'),
    ];
    const kb = Markup.inlineKeyboard(buttons.map((b) => [b]));
    const text = withExitHint(`${boldHeader('💳', 'Tarjetas')}\nElige la vista deseada:`);
    const msg = await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb.reply_markup });
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.lastRender = { text, reply_markup: kb.reply_markup };
    ctx.wizard.state.route = { view: 'MENU' };
    registerCancelHooks(ctx, {
      beforeLeave: async (innerCtx) => {
        const messageId = innerCtx.wizard?.state?.msgId;
        if (!messageId || !innerCtx.chat) return;
        await innerCtx.telegram
          .editMessageText(innerCtx.chat.id, messageId, undefined, '❌ Operación cancelada.', {
            parse_mode: 'HTML',
          })
          .catch(() => {});
      },
      afterLeave: enterAssistMenu,
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.callbackQuery?.message?.message_id) {
      ctx.wizard.state.msgId = ctx.callbackQuery.message.message_id;
    }
    const route = ctx.wizard.state.route?.view || 'MENU';

    if (!ctx.wizard.state.data) {
      ctx.wizard.state.data = await loadData();
    }

    switch (route) {
      case 'MENU':
        if (data === 'VIEW_AGENT') return showAgentList(ctx);
        if (data === 'VIEW_MON') return showMonList(ctx);
        if (data === 'VIEW_SUM') return showSummary(ctx);
        if (data === 'VIEW_ALL') return showAll(ctx);
        break;
      case 'AGENT_LIST':
        if (data === 'BACK') return showMenu(ctx);
        if (data.startsWith('AG_')) {
          const id = data.split('_')[1];
          console.log('[TARJETAS_ASSIST] cambio a vista AGENTE detalle', id);
          return showAgentDetail(ctx, id);
        }
        break;
      case 'AGENT_DETAIL':
        if (data === 'BACK') return showAgentList(ctx);
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
          return showMonBankDetail(ctx, mon, bank);
        }
        break;
      case 'MON_DETAIL':
        if (data === 'BACK') {
          const { monCode } = ctx.wizard.state.route;
          return showBankList(ctx, monCode);
        }
        break;
      case 'SUMMARY':
        if (data === 'BACK') return showMenu(ctx);
        if (data === 'VIEW_AGENT') return showAgentList(ctx);
        if (data === 'VIEW_MON') return showMonList(ctx);
        if (data === 'VIEW_ALL') return showAll(ctx);
        break;
      case 'ALL':
        if (data === 'BACK') return showMenu(ctx);
        break;
      case 'AFTER_REPORT':
        if (data === 'SAVE') {
          const reps = ctx.wizard.state.lastReport || [];
          for (const m of reps) {
            await sendAndLog(ctx, m);
          }
          return;
        }
        if (data === 'BACK_TO_MENU') {
          return showMenu(ctx);
        }
        break; // UX-2025
      default:
        break;
    }
  }
);

module.exports = tarjetasAssist;

/**
 * commands/tarjetas_assist.js
 *
 * Asistente interactivo para listar tarjetas en un solo mensaje.
 *
 * Migrado a parse mode HTML. El helper escapeHtml se encarga de sanear los
 * valores dinámicos para evitar errores de parseo e inyecciones. Si se
 * necesitara volver a Markdown, ajustar los textos y parse_mode.
 *
 * README: Ajusta `LINES_PER_PAGE` para cambiar cuántas líneas se muestran
 * por página. Para añadir nuevas vistas al menú principal, agrega una
 * opción en `showMenu` y maneja su lógica en `buildView`.
 */

const { Scenes, Markup, Telegram } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const pool = require('../psql/db.js');

/* Configuración */
const LINES_PER_PAGE = 12; // Líneas máximas por página
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
    if (
      count >= linesPerPage ||
      (buf + nl).length > MAX_LEN
    ) {
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
    if (msgId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msgId,
        undefined,
        '❌ Operación cancelada.',
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('❌ Operación cancelada.');
    }
    await ctx.scene.leave();
    return true;
  }
  if (ctx.message?.text) {
    const t = ctx.message.text.trim().toLowerCase();
    if (['/cancel', '/salir', 'salir'].includes(t) && ctx.scene?.current) {
      const msgId = ctx.wizard.state.msgId;
      if (msgId) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          msgId,
          undefined,
          '❌ Operación cancelada.',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply('❌ Operación cancelada.');
      }
      await ctx.scene.leave();
      return true;
    }
  }
  return false;
}

function navKeyboard(total) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⏮️', 'FIRST'),
      Markup.button.callback('◀️', 'PREV'),
      Markup.button.callback('▶️', 'NEXT'),
      Markup.button.callback('⏭️', 'LAST'),
    ],
    [
      Markup.button.callback('🔙 Volver', 'BACK'),
      Markup.button.callback('❌ Salir', 'EXIT'),
    ],
  ]);
}

async function showMenu(ctx) {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Por moneda y banco', 'VIEW_MON_BANK')],
    [Markup.button.callback('👤 Por agente', 'VIEW_AGENT')],
    [Markup.button.callback('🧮 Resumen USD global', 'VIEW_SUM')],
    [Markup.button.callback('❌ Salir', 'EXIT')],
  ]);
  const text = '💳 <b>Tarjetas</b>\nElige la vista deseada:';
  const extra = { parse_mode: 'HTML', ...kb };
  const msgId = ctx.wizard.state.msgId;
  if (msgId) {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, text, extra);
  } else {
    const msg = await ctx.reply(text, extra);
    ctx.wizard.state.msgId = msg.message_id;
  }
}

function renderPage(ctx) {
  const pages = ctx.wizard.state.pages || [];
  const i = ctx.wizard.state.pageIndex || 0;
  const text = (pages[i] || '—') + `\n\nPágina ${i + 1}/${pages.length}`;
  return ctx.telegram.editMessageText(
    ctx.chat.id,
    ctx.wizard.state.msgId,
    undefined,
    text,
    { parse_mode: 'HTML', ...navKeyboard(pages.length) }
  );
}

async function buildView(view) {
  console.log('[TARJETAS_ASSIST]', 'generando vista', view);
  const sql = `
    SELECT t.id, t.numero,
           COALESCE(ag.nombre,'—')  AS agente,
           COALESCE(ag.emoji,'')    AS agente_emoji,
           COALESCE(b.codigo,'Sin banco') AS banco,
           COALESCE(b.emoji,'')     AS banco_emoji,
           COALESCE(m.codigo,'—')   AS moneda,
           COALESCE(m.emoji,'')     AS moneda_emoji,
           COALESCE(m.tasa_usd,1)   AS tasa_usd,
           COALESCE(mv.saldo_nuevo,0) AS saldo
    FROM tarjeta t
    LEFT JOIN agente  ag ON ag.id = t.agente_id
    LEFT JOIN banco   b  ON b.id = t.banco_id
    LEFT JOIN moneda  m  ON m.id = t.moneda_id
    LEFT JOIN LATERAL (
      SELECT saldo_nuevo
      FROM movimiento
      WHERE tarjeta_id = t.id
      ORDER BY creado_en DESC
      LIMIT 1
    ) mv ON TRUE;`;

  const rows = (await pool.query(sql)).rows;
  if (!rows.length) {
    return ['No hay tarjetas registradas todavía.'];
  }

  const byMon = {};
  const bankUsd = {};
  const agentMap = {};
  let globalUsd = 0;

  rows.forEach((r) => {
    byMon[r.moneda] ??= {
      emoji: r.moneda_emoji,
      rate: +r.tasa_usd,
      banks: {},
      totalPos: 0,
      totalNeg: 0,
    };
    const mon = byMon[r.moneda];
    mon.banks[r.banco] ??= { emoji: r.banco_emoji, filas: [], pos: 0, neg: 0 };
    const bank = mon.banks[r.banco];
    bank.filas.push(r);

    if (r.saldo >= 0) {
      bank.pos += +r.saldo;
      mon.totalPos += +r.saldo;
    } else {
      bank.neg += +r.saldo;
      mon.totalNeg += +r.saldo;
    }

    const usd = +r.saldo * mon.rate;
    bankUsd[r.banco] = (bankUsd[r.banco] || 0) + usd;
    globalUsd += usd;

    agentMap[r.agente] ??= { emoji: r.agente_emoji, totalUsd: 0, perMon: {} };
    const ag = agentMap[r.agente];
    ag.totalUsd += usd;
    ag.perMon[r.moneda] ??= {
      total: 0,
      filas: [],
      emoji: mon.emoji,
      rate: mon.rate,
    };
    ag.perMon[r.moneda].total += +r.saldo;
    ag.perMon[r.moneda].filas.push(r);
  });

  if (view === 'VIEW_MON_BANK') {
    const blocks = [];
    for (const [monCode, info] of Object.entries(byMon)) {
      const neto = info.totalPos + info.totalNeg;
      if (neto === 0) continue;
      let msg = `💱 <b>Moneda:</b> ${info.emoji} ${escapeHtml(monCode)}\n\n`;
      msg += `📊 <b>Subtotales por banco:</b>\n`;
      Object.entries(info.banks)
        .filter(([, d]) => d.pos + d.neg !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([bankCode, data]) => {
          msg += `\n${data.emoji} <b>${escapeHtml(bankCode)}</b>\n`;
          data.filas
            .filter((f) => f.saldo !== 0)
            .forEach((r) => {
              const agTxt = `${r.agente_emoji ? r.agente_emoji + ' ' : ''}${escapeHtml(r.agente)}`;
              const monTx = `${r.moneda_emoji ? r.moneda_emoji + ' ' : ''}${escapeHtml(r.moneda)}`;
              msg += `• ${escapeHtml(r.numero)} – ${agTxt} – ${monTx} ⇒ ${fmt(r.saldo)}\n`;
            });
          if (data.pos)
            msg += `  <i>Subtotal ${escapeHtml(bankCode)} (activo):</i> ${fmt(data.pos)} ${escapeHtml(monCode)}\n`;
          if (data.neg)
            msg += `  <i>Subtotal ${escapeHtml(bankCode)} (deuda):</i> ${fmt(data.neg)} ${escapeHtml(monCode)}\n`;
        });
      const rateToUsd = fmt(info.rate, 6);
      const rateFromUsd = fmt(1 / info.rate, 2);
      const activeUsd = info.totalPos * info.rate;
      const debtUsd = info.totalNeg * info.rate;
      const netoUsd = activeUsd + debtUsd;
      msg += `\n<b>Total activo:</b> ${fmt(info.totalPos)}\n`;
      if (info.totalNeg) msg += `<b>Total deuda:</b> ${fmt(info.totalNeg)}\n`;
      msg += `<b>Neto:</b> ${fmt(neto)}\n`;
      msg += `\n<b>Equivalente activo en USD:</b> ${fmt(activeUsd)}\n`;
      if (info.totalNeg) msg += `<b>Equivalente deuda en USD:</b> ${fmt(debtUsd)}\n`;
      msg += `<b>Equivalente neto en USD:</b> ${fmt(netoUsd)}\n`;
      msg += `\n<i>Tasa usada:</i>\n`;
      msg += `  • 1 ${escapeHtml(monCode)} = ${rateToUsd} USD\n`;
      msg += `  • 1 USD ≈ ${rateFromUsd} ${escapeHtml(monCode)}`;
      blocks.push(msg);
    }
    const body = blocks.join('\n\n');
    const text = body
      ? `📊 <b>Por moneda y banco</b>\n\n${body}`
      : 'No hay tarjetas registradas todavía.';
    return paginate(text);
  }

  if (view === 'VIEW_AGENT') {
    const blocks = [];
    const today = new Date().toLocaleDateString('es-CU', {
      timeZone: 'America/Havana',
    });
    for (const [agName, agData] of Object.entries(agentMap)) {
      if (agData.totalUsd === 0) continue;
      let agMsg = `📅 <b>${escapeHtml(today)}</b>\n`;
      agMsg += `👤 <b>Resumen de ${agData.emoji ? agData.emoji + ' ' : ''}${escapeHtml(agName)}</b>\n\n`;
      Object.entries(agData.perMon)
        .filter(([, m]) => m.total !== 0)
        .forEach(([monCode, mData]) => {
          const line =
            `${mData.emoji} <b>${escapeHtml(monCode)}</b>: ${fmt(mData.total)} ` +
            `(≈ ${fmt(mData.total * mData.rate)} USD)`;
          agMsg += line + '\n';
          mData.filas
            .filter((f) => f.saldo !== 0)
            .forEach((r) => {
              const deuda = r.saldo < 0 ? ' (deuda)' : '';
              agMsg += `   • ${escapeHtml(r.numero)} ⇒ ${fmt(r.saldo)}${deuda}\n`;
            });
          agMsg += '\n';
        });
      agMsg += `<b>Total en USD:</b> ${fmt(agData.totalUsd)}`;
      blocks.push(agMsg);
    }
    const body = blocks.join('\n\n');
    const text = body
      ? `👤 <b>Por agente</b>\n\n${body}`
      : 'No hay tarjetas registradas todavía.';
    return paginate(text);
  }

  if (view === 'VIEW_SUM') {
    let resumen = '🧮 <b>Resumen general en USD</b>\n';
    Object.entries(bankUsd)
      .filter(([, usd]) => usd !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([bank, usd]) => {
        resumen += `• <b>${escapeHtml(bank)}</b>: ${fmt(usd)} USD\n`;
      });
    resumen += `\n<b>Total general:</b> ${fmt(globalUsd)} USD`;
    return paginate(resumen);
  }

  return ['Vista no soportada'];
}

/* ───────── Wizard ───────── */
const tarjetasAssist = new Scenes.WizardScene(
  'TARJETAS_ASSIST',

  /* Paso 0 – menú inicial */
  async (ctx) => {
    console.log('[TARJETAS_ASSIST] paso 0: menú inicial');
    await showMenu(ctx);
    return ctx.wizard.next();
  },

  /* Paso 1 – elegir vista y mostrar página 0 */
  async (ctx) => {
    console.log('[TARJETAS_ASSIST] paso 1: elegir vista');
    if (await wantExit(ctx)) return;
    const choice = ctx.callbackQuery?.data;
    if (!choice?.startsWith('VIEW_')) return ctx.reply('Usa los botones.');
    await ctx.answerCbQuery().catch(() => {});
    const pages = await buildView(choice);
    ctx.wizard.state.currentView = choice;
    ctx.wizard.state.pages = pages;
    ctx.wizard.state.pageIndex = 0;
    await renderPage(ctx);
    return ctx.wizard.next();
  },

  /* Paso 2 – navegación */
  async (ctx) => {
    console.log('[TARJETAS_ASSIST] paso 2: navegación');
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    const pages = ctx.wizard.state.pages || [];
    let i = ctx.wizard.state.pageIndex || 0;
    switch (data) {
      case 'FIRST':
        i = 0;
        break;
      case 'PREV':
        i = Math.max(0, i - 1);
        break;
      case 'NEXT':
        i = Math.min(pages.length - 1, i + 1);
        break;
      case 'LAST':
        i = pages.length - 1;
        break;
      case 'BACK':
        await showMenu(ctx);
        delete ctx.wizard.state.pages;
        delete ctx.wizard.state.pageIndex;
        delete ctx.wizard.state.currentView;
        return ctx.wizard.selectStep(1);
      default:
        return;
    }
    ctx.wizard.state.pageIndex = i;
    await renderPage(ctx);
  }
);

module.exports = tarjetasAssist;

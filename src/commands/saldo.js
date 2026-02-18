// commands/saldo.js
//
// Migrado a parse mode HTML. Se usa escapeHtml para sanear datos dinámicos y
// evitar errores de parseo. Si se necesitara volver a Markdown, ajustar los
// constructores de texto y parse_mode en las llamadas a Telegram.
//
// 1) El usuario elige AGENTE.
// 2) Se muestran sus tarjetas con el saldo actual  ➜ elige una.
// 3) Escribe el SALDO ACTUAL (número).            ➜ el bot calcula ↑/↓ y registra
//
// Se añade siempre un movimiento:  saldo_anterior • importe(+/-) • saldo_nuevo
// Luego se informa si “aumentó” o “disminuyó” y en cuánto.
//
// Requiere que las tablas ya existan con las columnas definidas en initWalletSchema.

const { Scenes, Markup } = require('telegraf');
const { escapeHtml, fmtMoney, boldHeader } = require('../helpers/format');
const { sendAndLog } = require('../helpers/reportSender');
const { recordChange } = require('../helpers/sessionSummary');
const { runFondo } = require('../middlewares/fondoAdvisor');
const pool = require('../psql/db.js');
const moment = require('moment-timezone');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');
const { withExitHint } = require('../helpers/ui');
const { parseUserAmount } = require('../helpers/money');
const { handleError } = require('../controllers/errorController');

const {
  buildCurrencyTotals,
  renderCurrencyTotalsHtml,
  loadCurrencyRateMap,
} = require('../helpers/saldoSummary');

/* ───────── helpers ───────── */
const kbBackOrCancel = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Volver', 'VOLVER_TA')],
  [Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]
]);

async function showAgentes(ctx) {
  let agentes = [];
  let totalsBlock = '';

  try {
    agentes = (
      await pool.query('SELECT id,nombre FROM agente ORDER BY nombre')
    ).rows;
  } catch (error) {
    await handleError(error, ctx, 'showAgentes');
    return false;
  }

  if (!agentes.length) {
    await ctx.reply(withExitHint('⚠️ No hay agentes registrados.'), kbBackOrCancel);
    return false;
  }

  // Resumen global de saldos por moneda (todas las tarjetas).
  try {
    const rateMap = ctx.wizard.state.data?.rateMap || await loadCurrencyRateMap(pool);
    ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), rateMap };

    const allBalances = (
      await pool.query(
        `
        SELECT COALESCE(mv.saldo_nuevo,0) AS saldo,
               COALESCE(m.codigo,'')       AS moneda
        FROM tarjeta t
        LEFT JOIN moneda m ON m.id = t.moneda_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
            FROM movimiento
           WHERE tarjeta_id = t.id
           ORDER BY creado_en DESC
           LIMIT 1
        ) mv ON true
        `
      )
    ).rows;

    const totals = buildCurrencyTotals(allBalances, rateMap);
    totalsBlock = renderCurrencyTotalsHtml(totals, 'Totales globales por moneda');
    if (totalsBlock) totalsBlock += '\n\n';
    console.log('[SALDO_WIZ] Totales globales por moneda =>', totals);
  } catch (error) {
    console.error('[SALDO_WIZ] Error generando totales globales:', error);
    totalsBlock = '<i>No se pudo calcular el resumen global.</i>\n\n';
  }

  const kb = [];
  for (let i = 0; i < agentes.length; i += 2) {
    const row = [Markup.button.callback(agentes[i].nombre, `AG_${agentes[i].id}`)];
    if (agentes[i + 1]) {
      row.push(
        Markup.button.callback(agentes[i + 1].nombre, `AG_${agentes[i + 1].id}`)
      );
    }
    kb.push(row);
  }
  kb.push([Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]);

  const txt = withExitHint(
    `${boldHeader('👥', 'Agentes disponibles')}\n` +
      `${totalsBlock}Seleccione uno:`
  );
  const inline = Markup.inlineKeyboard(kb);
  const extra = { parse_mode: 'HTML', reply_markup: inline.reply_markup };

  const msgId = ctx.wizard.state.data?.msgId;
  if (msgId) {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, txt, extra);
    ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), msgId, agentes };
  } else {
    const msg = await ctx.reply(txt, extra);
    ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), msgId: msg.message_id, agentes };
  }
  return true;
}

async function showTarjetas(ctx, options = {}) {
  const { sendNewMessage = false } = options;
  const { agente_id, agente_nombre } = ctx.wizard.state.data;
  let tarjetas = [];
  let totalsBlock = '';

  try {
    tarjetas = (
      await pool.query(
        `
        SELECT t.id, t.numero,
               COALESCE(mv.saldo_nuevo,0) AS saldo,
               COALESCE(m.codigo,'')       AS moneda,
               COALESCE(m.emoji,'')        AS moneda_emoji,
               COALESCE(b.nombre,'')       AS banco,
               COALESCE(b.emoji,'')        AS banco_emoji
        FROM tarjeta t
        LEFT JOIN moneda m  ON m.id = t.moneda_id
        LEFT JOIN banco  b  ON b.id = t.banco_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
            FROM movimiento
            WHERE tarjeta_id = t.id
            ORDER BY creado_en DESC
            LIMIT 1
        ) mv ON true
        WHERE t.agente_id = $1
        ORDER BY t.numero;`,
        [agente_id]
      )
    ).rows;
  } catch (error) {
    await handleError(error, ctx, 'showTarjetas');
    await ctx.scene.leave();
    return false;
  }

  if (!tarjetas.length) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      ctx.wizard.state.data.msgId,
      undefined,
      withExitHint('Este agente todavía no tiene tarjetas.'),
      { parse_mode: 'HTML', reply_markup: kbBackOrCancel.reply_markup }
    );
    await ctx.scene.leave();
    return false;
  }

  const kb = tarjetas.map(t => [
    Markup.button.callback(
      `${t.numero}  (${t.banco_emoji} ${t.banco} – ${t.moneda_emoji} ${t.moneda} – ${t.saldo})`,
      `TA_${t.id}`
    )
  ]);
  kb.push([
    Markup.button.callback('👥 Agentes', 'OTROS_AG'),
    Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')
  ]);
  // Totales por moneda para el agente seleccionado.
  try {
    const rateMap = ctx.wizard.state.data?.rateMap || await loadCurrencyRateMap(pool);
    ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), rateMap };

    const totals = buildCurrencyTotals(tarjetas, rateMap);
    totalsBlock = renderCurrencyTotalsHtml(totals, 'Totales por moneda');
    if (totalsBlock) totalsBlock += '\n\n';
    console.log(`[SALDO_WIZ] Totales por moneda (${agente_nombre}) =>`, totals);
  } catch (error) {
    console.error('[SALDO_WIZ] Error generando totales del agente:', error);
    totalsBlock = '<i>No se pudo calcular el resumen del agente.</i>\n\n';
  }

  const txt = withExitHint(
    `💳 <b>Tarjetas de ${escapeHtml(agente_nombre)}</b>\n` +
      `${totalsBlock}Selecciona una tarjeta:`
  );
  const inline = Markup.inlineKeyboard(kb);
  const extra = { parse_mode: 'HTML', reply_markup: inline.reply_markup };
  const msgId = ctx.wizard.state.data.msgId;
  if (sendNewMessage || !msgId) {
    if (sendNewMessage && msgId) {
      await ctx.telegram
        .editMessageReplyMarkup(ctx.chat.id, msgId, undefined, { inline_keyboard: [] })
        .catch(() => {});
    }
    const msg = await ctx.reply(txt, extra);
    ctx.wizard.state.data.msgId = msg.message_id;
  } else {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, txt, extra);
  }
  ctx.wizard.state.data.tarjetas = tarjetas; // caché
  return true;
}

async function askSaldo(ctx, tarjeta) {
  const txt = withExitHint(
    `✏️ <b>Introduce el saldo actual de tu tarjeta</b>\n\n` +
      `Tarjeta ${escapeHtml(tarjeta.numero)} (saldo actual: <code>${fmtMoney(tarjeta.saldo)}</code>).\n` +
      'Por favor coloca el saldo actual de tu tarjeta. No te preocupes, te diré si ha aumentado o disminuido y en cuánto.\n\n' +
      'Ejemplo: 1500.50'
  );
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    ctx.wizard.state.data.msgId,
    undefined,
    txt,
    { parse_mode: 'HTML', ...kbBackOrCancel }
  );
}

/* ───────── Wizard ───────── */
const saldoWizard = new Scenes.WizardScene(
  'SALDO_WIZ',

  /* 0 – mostrar agentes */
  async ctx => {
    console.log('[SALDO_WIZ] paso 0: mostrar agentes');
    registerCancelHooks(ctx, {
      afterLeave: enterAssistMenu,
      notify: false, // evitamos mensaje genérico: mostramos fondo y luego menú
    });
    const ok = await showAgentes(ctx);
    if (!ok) return ctx.scene.leave();
    return ctx.wizard.next();
  },

  /* 1 – elegir tarjeta del agente */
  async ctx => {
    console.log('[SALDO_WIZ] paso 1: elegir tarjeta');
    if (await handleGlobalCancel(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('AG_')) {
      return ctx.reply(withExitHint('Usa los botones para seleccionar agente.'), kbBackOrCancel);
    }
    await ctx.answerCbQuery().catch(() => {});
    const agente_id = +ctx.callbackQuery.data.split('_')[1];
    const agente = ctx.wizard.state.data.agentes.find(a => a.id === agente_id);
    ctx.wizard.state.data.agente_id = agente_id;
    ctx.wizard.state.data.agente_nombre = agente?.nombre || '';

    const ok = await showTarjetas(ctx);
    if (!ok) return; // escena ya cerrada si no hay tarjetas
    return ctx.wizard.next();
  },

  /* 2 – pedir saldo actual */
  async ctx => {
    console.log('[SALDO_WIZ] paso 2: pedir saldo actual');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      const { data } = ctx.callbackQuery;
      if (data === 'OTROS_AG') {
        await ctx.answerCbQuery().catch(() => {});
        const ok = await showAgentes(ctx);
        if (ok) return ctx.wizard.selectStep(1);
        return;
      }
      if (!data.startsWith('TA_')) {
        return ctx.reply(withExitHint('Usa los botones para elegir la tarjeta.'), kbBackOrCancel);
      }
      await ctx.answerCbQuery().catch(() => {});
      const tarjeta_id = +data.split('_')[1];
      const tarjeta = ctx.wizard.state.data.tarjetas.find(t => t.id === tarjeta_id);

      ctx.wizard.state.data.tarjeta = tarjeta;
      await askSaldo(ctx, tarjeta);
      return ctx.wizard.next();
    }
    // If it's not a callback query, it means the user sent a message, which is not expected here.
    // This case should ideally not be reached if the flow is strictly button-driven.
    // However, to be safe, we can prompt the user to use buttons or cancel.
    return ctx.reply(withExitHint('Por favor, selecciona una tarjeta usando los botones.'), kbBackOrCancel);
  },

  /* 3 – registrar movimiento y volver al menú de tarjetas */
  async ctx => {
    console.log('[SALDO_WIZ] paso 3: registrar movimiento');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      const { data } = ctx.callbackQuery;
      if (data === 'VOLVER_TA') {
        await ctx.answerCbQuery().catch(() => {});
        const ok = await showTarjetas(ctx);
        if (ok) return ctx.wizard.selectStep(2);
        return;
      }
      return ctx.reply(
        withExitHint('Usa los botones o escribe el saldo.'),
        kbBackOrCancel
      );
    }

    // 🔢 Parsear el saldo introducido por el usuario usando el helper reutilizable
    const num = parseUserAmount(ctx.message?.text);
    if (!Number.isFinite(num)) {
      return ctx.reply(
        withExitHint('Valor inválido, escribe solo el saldo numérico.'),
        kbBackOrCancel
      );
    }

    const { tarjeta } = ctx.wizard.state.data;
    const saldoNuevo = num;

    let saldoAnterior;
    let delta;
    let descripcion;

    const { rows: ult } = await pool.query(
      'SELECT saldo_nuevo FROM movimiento WHERE tarjeta_id = $1 ORDER BY creado_en DESC LIMIT 1',
      [tarjeta.id]
    );

    if (ult.length === 0) {
      saldoAnterior = saldoNuevo;
      delta = 0;
      descripcion = 'Saldo inicial';
    } else {
      saldoAnterior = parseFloat(ult[0].saldo_nuevo) || 0;
      delta = saldoNuevo - saldoAnterior;
      descripcion = delta >= 0 ? 'Actualización +' : 'Actualización –';
    }

    try {
      await pool.query(
        `
        INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, descripcion)
        VALUES (
            $1::int,
            $2::numeric,
            $3::numeric,
            $4::numeric,
            $5
        );
        `,
        [tarjeta.id, saldoAnterior, delta, saldoNuevo, descripcion]
      );

      recordChange(
        ctx.wizard.state.data.agente_id,
        tarjeta.id,
        saldoAnterior,
        saldoNuevo
      );

      // Construir historial del día para la tarjeta
      const tz = 'America/Havana';
      const start = moment.tz(tz).startOf('day');
      const end = moment.tz(tz).endOf('day');
      const histRows = (
        await pool.query(
          `SELECT creado_en, saldo_anterior, saldo_nuevo
             FROM movimiento
            WHERE tarjeta_id = $1 AND creado_en >= $2 AND creado_en <= $3
            ORDER BY creado_en ASC`,
          [tarjeta.id, start.toDate(), end.toDate()]
        )
      ).rows;

      const lines = histRows.map((r) => {
        const hora = moment(r.creado_en).tz(tz).format('HH:mm');
        const d = parseFloat(r.saldo_nuevo) - parseFloat(r.saldo_anterior);
        const e = d > 0 ? '📈' : d < 0 ? '📉' : '➖';
        return `• ${hora} ${e} <code>${(d >= 0 ? '+' : '') + fmtMoney(d)}</code> → <code>${fmtMoney(r.saldo_nuevo)}</code>`;
      });

      const saldoIniDia = histRows.length
        ? parseFloat(histRows[0].saldo_anterior)
        : saldoAnterior;
      const saldoFinDia = histRows.length
        ? parseFloat(histRows[histRows.length - 1].saldo_nuevo)
        : saldoNuevo;
      const deltaDia = saldoFinDia - saldoIniDia;
      const emojiDia = deltaDia > 0 ? '📈' : deltaDia < 0 ? '📉' : '➖';

      lines.push(
        `Saldo inicial del día: <code>${fmtMoney(saldoIniDia)}</code> → Saldo final del día: <code>${fmtMoney(saldoFinDia)}</code> (Δ <code>${(deltaDia >= 0 ? '+' : '') + fmtMoney(deltaDia)}</code>) ${emojiDia}`,
      );

      const emojiDelta = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
      const signo = delta > 0 ? 'Aumentó' : delta < 0 ? 'Disminuyó' : 'Sin cambio';
      const header = `${boldHeader('💰', 'Saldo actualizado')}\n`;

      const txt = withExitHint(
        header +
          `Saldo anterior: <code>${fmtMoney(saldoAnterior)}</code>\n` +
          `Saldo informado: <code>${fmtMoney(saldoNuevo)}</code>\n` +
          `${emojiDelta} ${signo} <code>${fmtMoney(Math.abs(delta))}</code> ${escapeHtml(tarjeta.moneda)}\n\n` +
          '📆 Historial de hoy:\n' +
          lines.join('\n') +
          '\n\nSelecciona otra tarjeta en el menú.'
      );

      await sendAndLog(ctx, txt, { noForward: true });

      const now = new Date();
      const fecha = now.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const logTxt =
        `💳 <b>Movimiento – ${fecha}</b>\n` +
        `👤 Usuario: @${escapeHtml(ctx.from.username || ctx.from.id)} (ID: ${ctx.from.id})\n` +
        `• Tarjeta: <b>${escapeHtml(tarjeta.numero)}</b>\n` +
        `• Saldo anterior → Saldo informado: <code>${fmtMoney(saldoAnterior)}</code> → <code>${fmtMoney(saldoNuevo)}</code> (Δ <code>${(delta >= 0 ? '+' : '') + fmtMoney(delta)}</code>) ${emojiDelta}`;

      await sendAndLog(ctx, logTxt);

    } catch (e) {
      await handleError(e, ctx, 'saldo_insert_movimiento');
      return ctx.scene.leave();
    }

    const ok = await showTarjetas(ctx, { sendNewMessage: true });
    if (ok) return ctx.wizard.selectStep(2);
    return;
  }
);

// ✔ probado con tarjeta 5278
module.exports = saldoWizard;

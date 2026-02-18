// commands/saldo.js
//
// Migrado a parse mode HTML. Se usa escapeHtml para sanear datos dinámicos y
// evitar errores de parseo. Si se necesitara volver a Markdown, ajustar los
// constructores de texto y parse_mode en las llamadas a Telegram.
//
// 1) El usuario elige AGENTE.
// 2) Se muestran sus tarjetas con el saldo actual ➜ elige una.
// 3) Selecciona operación: saldo actual / aumentar / retirar.
// 4) Escribe el monto o saldo final (según operación) ➜ el bot calcula y registra.
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
const { withExitHint, editIfChanged } = require('../helpers/ui');
const { parseUserAmount } = require('../helpers/money');
const { handleError } = require('../controllers/errorController');

const {
  buildCurrencyTotals,
  renderCurrencyTotalsHtml,
  loadCurrencyRateMap,
} = require('../helpers/saldoSummary');

/* ───────── helpers ───────── */
const OPERATIONS = {
  SET: {
    callback: 'OP_SET',
    button: '🟣💎 Saldo actual',
    title: '🟣 <b>Actualizar saldo actual</b>',
    prompt: 'Ingresa el saldo final actual de la tarjeta.',
    example: 'Ejemplo: 1500.50',
    description: 'Saldo informado',
  },
  ADD: {
    callback: 'OP_ADD',
    button: '🟢✨ Aumentar saldo',
    title: '🟢 <b>Agregar saldo</b>',
    prompt: 'Ingresa cuánto deseas sumar al saldo actual.',
    example: 'Ejemplo: 250',
    description: 'Monto agregado',
  },
  SUB: {
    callback: 'OP_SUB',
    button: '🔴🔥 Retirar saldo',
    title: '🔴 <b>Retirar saldo</b>',
    prompt: 'Ingresa cuánto deseas retirar del saldo actual.',
    example: 'Ejemplo: 100',
    description: 'Monto retirado',
  },
};

function buildBackCancelKeyboard(backCb = 'VOLVER_TA') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver', backCb)],
    [Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')],
  ]);
}

const kbBackTarjetasOrCancel = buildBackCancelKeyboard('VOLVER_TA');
const kbBackModeOrCancel = buildBackCancelKeyboard('VOLVER_OP');

function resolveOperationByCallback(data = '') {
  return Object.values(OPERATIONS).find((op) => op.callback === data) || null;
}

function buildMovement({
  operation = OPERATIONS.SET,
  amount,
  saldoAnterior,
  hadPreviousBalance,
}) {
  if (operation === OPERATIONS.SET) {
    if (!hadPreviousBalance) {
      return {
        saldoNuevo: amount,
        delta: 0,
        descripcion: 'Saldo inicial',
      };
    }
    const delta = amount - saldoAnterior;
    return {
      saldoNuevo: amount,
      delta,
      descripcion: delta >= 0 ? 'Actualización +' : 'Actualización –',
    };
  }

  if (operation === OPERATIONS.ADD) {
    const delta = Math.abs(amount);
    return {
      saldoNuevo: saldoAnterior + delta,
      delta,
      descripcion: 'Aumento +',
    };
  }

  const delta = -Math.abs(amount);
  return {
    saldoNuevo: saldoAnterior + delta,
    delta,
    descripcion: 'Retiro –',
  };
}

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
    console.warn('[SALDO_WIZ] Sin agentes configurados para /saldo', {
      userId: ctx.from?.id || null,
      chatId: ctx.chat?.id || null,
    });
    const txt = withExitHint('⚠️ No hay agentes registrados.');
    const extra = { parse_mode: 'HTML', reply_markup: kbBackTarjetasOrCancel.reply_markup };
    const msgId = ctx.wizard.state.msgId || ctx.wizard.state.data?.msgId;
    if (msgId) {
      ctx.wizard.state.msgId = msgId;
      await editIfChanged(ctx, txt, extra);
    } else {
      const msg = await ctx.reply(txt, extra);
      ctx.wizard.state.msgId = msg.message_id;
      ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), msgId: msg.message_id };
    }
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
    await handleError(error, ctx, 'saldo_totales_globales');
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

  const msgId = ctx.wizard.state.msgId || ctx.wizard.state.data?.msgId;
  if (msgId) {
    ctx.wizard.state.msgId = msgId;
    await editIfChanged(ctx, txt, extra);
    ctx.wizard.state.data = { ...(ctx.wizard.state.data || {}), msgId, agentes };
  } else {
    const msg = await ctx.reply(txt, extra);
    ctx.wizard.state.msgId = msg.message_id;
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
               mv.saldo_nuevo IS NOT NULL AS has_previous_balance,
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
    console.warn('[SALDO_WIZ] Agente sin tarjetas configuradas', {
      userId: ctx.from?.id || null,
      chatId: ctx.chat?.id || null,
      agenteId: agente_id || null,
      agenteNombre: agente_nombre || '',
    });
    const txt = withExitHint('Este agente todavía no tiene tarjetas.');
    const extra = { parse_mode: 'HTML', reply_markup: kbBackTarjetasOrCancel.reply_markup };
    const msgId = ctx.wizard.state.msgId || ctx.wizard.state.data?.msgId;
    if (msgId) {
      ctx.wizard.state.msgId = msgId;
      await editIfChanged(ctx, txt, extra);
    } else {
      const msg = await ctx.reply(txt, extra);
      ctx.wizard.state.msgId = msg.message_id;
      ctx.wizard.state.data.msgId = msg.message_id;
    }
    return false;
  }

  const noBalanceCount = tarjetas.filter((t) => !t.has_previous_balance).length;
  if (noBalanceCount > 0) {
    console.info('[SALDO_WIZ] Tarjetas sin saldo previo detectadas', {
      userId: ctx.from?.id || null,
      chatId: ctx.chat?.id || null,
      agenteId: agente_id || null,
      agenteNombre: agente_nombre || '',
      tarjetasSinSaldo: noBalanceCount,
      totalTarjetas: tarjetas.length,
    });
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
    await handleError(error, ctx, 'saldo_totales_agente');
    totalsBlock = '<i>No se pudo calcular el resumen del agente.</i>\n\n';
  }

  const txt = withExitHint(
    `💳 <b>Tarjetas de ${escapeHtml(agente_nombre)}</b>\n` +
      `${totalsBlock}Selecciona una tarjeta:`
  );
  const inline = Markup.inlineKeyboard(kb);
  const extra = { parse_mode: 'HTML', reply_markup: inline.reply_markup };
  const msgId = ctx.wizard.state.msgId || ctx.wizard.state.data.msgId;
  if (sendNewMessage || !msgId) {
    if (sendNewMessage && msgId) {
      await ctx.telegram
        .editMessageReplyMarkup(ctx.chat.id, msgId, undefined, { inline_keyboard: [] })
        .catch(() => {});
    }
    const msg = await ctx.reply(txt, extra);
    ctx.wizard.state.msgId = msg.message_id;
    ctx.wizard.state.data.msgId = msg.message_id;
  } else {
    ctx.wizard.state.msgId = msgId;
    await editIfChanged(ctx, txt, extra);
  }
  ctx.wizard.state.data.tarjetas = tarjetas; // caché
  return true;
}

async function askSaldo(ctx, tarjeta) {
  const op = OPERATIONS.SET;
  const txt = withExitHint(
    `${op.title}\n\n` +
      `Tarjeta ${escapeHtml(tarjeta.numero)} (saldo actual: <code>${fmtMoney(tarjeta.saldo)}</code>).\n` +
      `${op.prompt}\n\n` +
      `${op.example}`
  );
  const extra = { parse_mode: 'HTML', ...kbBackModeOrCancel };
  await editIfChanged(ctx, txt, extra);
}

async function askOperationAmount(ctx, tarjeta, operation) {
  const txt = withExitHint(
    `${operation.title}\n\n` +
      `Tarjeta ${escapeHtml(tarjeta.numero)} (saldo actual: <code>${fmtMoney(tarjeta.saldo)}</code>).\n` +
      `${operation.prompt}\n\n` +
      `${operation.example}`
  );
  const extra = { parse_mode: 'HTML', ...kbBackModeOrCancel };
  await editIfChanged(ctx, txt, extra);
}

async function showOperationMenu(ctx, tarjeta) {
  const kb = [
    [Markup.button.callback(OPERATIONS.SET.button, OPERATIONS.SET.callback)],
    [Markup.button.callback(OPERATIONS.ADD.button, OPERATIONS.ADD.callback)],
    [Markup.button.callback(OPERATIONS.SUB.button, OPERATIONS.SUB.callback)],
    [
      Markup.button.callback('🔙 Volver', 'VOLVER_TA'),
      Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL'),
    ],
  ];
  const txt = withExitHint(
    `🧭 <b>Selecciona tipo de operación</b>\n\n` +
      `Tarjeta ${escapeHtml(tarjeta.numero)}\n` +
      `Saldo actual: <code>${fmtMoney(tarjeta.saldo)}</code>\n\n` +
      'Puedes actualizar el saldo final o aplicar un aumento/retiro directo.'
  );
  await editIfChanged(ctx, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function handleSaldoLeave(ctx) {
  const chatType = ctx?.chat?.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  try {
    if (isGroup) {
      await runFondo(ctx, {
        send: async (text) => {
          const userId = ctx?.from?.id;
          const telegram = ctx?.telegram;
          if (!userId || !telegram?.sendMessage) {
            return;
          }
          try {
            await telegram.sendMessage(userId, text, { parse_mode: 'HTML' });
            console.log('[SALDO_WIZ] fondoAdvisor enviado por DM a', userId);
          } catch (err) {
            console.log('[SALDO_WIZ] No se pudo enviar DM del fondoAdvisor:', err?.message || err);
          }
        },
      });
    } else {
      await runFondo(ctx);
    }
  } catch (error) {
    await handleError(error, ctx, 'saldo_leave_fondo');
  } finally {
    if (ctx?.wizard) {
      ctx.wizard.state = {};
    }
  }
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
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => {});
    }
    const ok = await showAgentes(ctx);
    if (!ok) return;
    return ctx.wizard.next();
  },

  /* 1 – elegir tarjeta del agente */
  async ctx => {
    console.log('[SALDO_WIZ] paso 1: elegir tarjeta');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery?.data === 'VOLVER_TA') {
      await ctx.answerCbQuery().catch(() => {});
      await showAgentes(ctx);
      return;
    }
    if (!ctx.callbackQuery?.data.startsWith('AG_')) {
      return ctx.reply(withExitHint('Usa los botones para seleccionar agente.'), kbBackTarjetasOrCancel);
    }
    await ctx.answerCbQuery().catch(() => {});
    const agente_id = +ctx.callbackQuery.data.split('_')[1];
    const agente = ctx.wizard.state.data.agentes.find(a => a.id === agente_id);
    ctx.wizard.state.data.agente_id = agente_id;
    ctx.wizard.state.data.agente_nombre = agente?.nombre || '';

    const ok = await showTarjetas(ctx);
    if (!ok) return;
    return ctx.wizard.next();
  },

  /* 2 – elegir tarjeta y mostrar operaciones */
  async ctx => {
    console.log('[SALDO_WIZ] paso 2: seleccionar tarjeta');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      const { data } = ctx.callbackQuery;
      if (data === 'VOLVER_TA') {
        await ctx.answerCbQuery().catch(() => {});
        await showTarjetas(ctx);
        return;
      }
      if (data === 'OTROS_AG') {
        await ctx.answerCbQuery().catch(() => {});
        const ok = await showAgentes(ctx);
        if (ok) return ctx.wizard.selectStep(1);
        return;
      }
      if (!data.startsWith('TA_')) {
        return ctx.reply(withExitHint('Usa los botones para elegir la tarjeta.'), kbBackTarjetasOrCancel);
      }
      await ctx.answerCbQuery().catch(() => {});
      const tarjeta_id = +data.split('_')[1];
      const tarjeta = ctx.wizard.state.data.tarjetas.find(t => t.id === tarjeta_id);

      ctx.wizard.state.data.tarjeta = tarjeta;
      ctx.wizard.state.data.operation = null;
      await showOperationMenu(ctx, tarjeta);
      return ctx.wizard.next();
    }
    // If it's not a callback query, it means the user sent a message, which is not expected here.
    // This case should ideally not be reached if the flow is strictly button-driven.
    // However, to be safe, we can prompt the user to use buttons or cancel.
    return ctx.reply(withExitHint('Por favor, selecciona una tarjeta usando los botones.'), kbBackTarjetasOrCancel);
  },

  /* 3 – elegir tipo de operación */
  async ctx => {
    console.log('[SALDO_WIZ] paso 3: elegir operación');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      const { data } = ctx.callbackQuery;
      if (data === 'VOLVER_TA') {
        await ctx.answerCbQuery().catch(() => {});
        const ok = await showTarjetas(ctx);
        if (ok) return ctx.wizard.selectStep(2);
        return;
      }
      const operation = resolveOperationByCallback(data);
      if (!operation) {
        return ctx.reply(
          withExitHint('Usa los botones para elegir tipo de operación.'),
          kbBackTarjetasOrCancel
        );
      }
      await ctx.answerCbQuery().catch(() => {});
      ctx.wizard.state.data.operation = operation.callback;
      if (operation === OPERATIONS.SET) {
        await askSaldo(ctx, ctx.wizard.state.data.tarjeta);
      } else {
        await askOperationAmount(ctx, ctx.wizard.state.data.tarjeta, operation);
      }
      return ctx.wizard.next();
    }
    return ctx.reply(
      withExitHint('Selecciona primero el tipo de operación con los botones.'),
      kbBackTarjetasOrCancel
    );
  },

  /* 4 – registrar movimiento y volver al menú de tarjetas */
  async ctx => {
    console.log('[SALDO_WIZ] paso 4: registrar movimiento');
    if (await handleGlobalCancel(ctx)) return;
    if (ctx.callbackQuery) {
      const { data } = ctx.callbackQuery;
      if (data === 'VOLVER_OP') {
        await ctx.answerCbQuery().catch(() => {});
        await showOperationMenu(ctx, ctx.wizard.state.data.tarjeta);
        return ctx.wizard.selectStep(3);
      }
      if (data === 'VOLVER_TA') {
        await ctx.answerCbQuery().catch(() => {});
        const ok = await showTarjetas(ctx);
        if (ok) return ctx.wizard.selectStep(2);
        return;
      }
      return ctx.reply(
        withExitHint('Usa los botones o escribe el monto/saldo.'),
        kbBackModeOrCancel
      );
    }

    const selectedOperation =
      resolveOperationByCallback(ctx.wizard.state.data.operation) || OPERATIONS.SET;
    const inputName = selectedOperation === OPERATIONS.SET ? 'saldo' : 'monto';

    // 🔢 Parsear el saldo introducido por el usuario usando el helper reutilizable
    const num = parseUserAmount(ctx.message?.text);
    if (!Number.isFinite(num)) {
      return ctx.reply(
        withExitHint(`Valor inválido, escribe solo el ${inputName} numérico.`),
        kbBackModeOrCancel
      );
    }

    const { tarjeta } = ctx.wizard.state.data;

    try {
      const { rows: ult } = await pool.query(
        'SELECT saldo_nuevo FROM movimiento WHERE tarjeta_id = $1 ORDER BY creado_en DESC LIMIT 1',
        [tarjeta.id]
      );
      const hadPreviousBalance = ult.length > 0;
      if (!hadPreviousBalance) {
        console.info('[SALDO_WIZ] Tarjeta sin saldo previo: se registrará saldo inicial', {
          userId: ctx.from?.id || null,
          chatId: ctx.chat?.id || null,
          agenteId: ctx.wizard.state.data.agente_id || null,
          tarjetaId: tarjeta.id,
          tarjetaNumero: tarjeta.numero,
        });
      }
      const saldoAnterior = hadPreviousBalance ? (parseFloat(ult[0].saldo_nuevo) || 0) : 0;
      const { saldoNuevo, delta, descripcion } = buildMovement({
        operation: selectedOperation,
        amount: num,
        saldoAnterior,
        hadPreviousBalance,
      });

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
          `Operación: <b>${escapeHtml(selectedOperation.button)}</b>\n` +
          `Saldo anterior: <code>${fmtMoney(saldoAnterior)}</code>\n` +
          `${escapeHtml(selectedOperation.description)}: <code>${fmtMoney(selectedOperation === OPERATIONS.SET ? saldoNuevo : Math.abs(delta))}</code>\n` +
          `Saldo final: <code>${fmtMoney(saldoNuevo)}</code>\n` +
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
        `• Operación: <b>${escapeHtml(selectedOperation.button)}</b>\n` +
        `• Tarjeta: <b>${escapeHtml(tarjeta.numero)}</b>\n` +
        `• Saldo anterior → Saldo final: <code>${fmtMoney(saldoAnterior)}</code> → <code>${fmtMoney(saldoNuevo)}</code> (Δ <code>${(delta >= 0 ? '+' : '') + fmtMoney(delta)}</code>) ${emojiDelta}`;

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

saldoWizard.leave(async (ctx, next) => {
  await handleSaldoLeave(ctx);
  return next();
});
saldoWizard.handleSaldoLeave = handleSaldoLeave;

// ✔ probado con tarjeta 5278
module.exports = saldoWizard;

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

/* ───────── helpers ───────── */
const kbBackOrCancel = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Volver', 'VOLVER_TA')],
  [Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')]
]);

const kbContinue = Markup.inlineKeyboard([
  [Markup.button.callback('🔄 Otra tarjeta', 'OTRA_TA')],
  [Markup.button.callback('👥 Otros agentes', 'OTROS_AG')],
  [Markup.button.callback('❌ Finalizar', 'GLOBAL_CANCEL')]
]);

async function showAgentes(ctx) {
  const agentes = (
    await pool.query('SELECT id,nombre FROM agente ORDER BY nombre')
  ).rows;
  if (!agentes.length) {
    await ctx.reply('⚠️ No hay agentes registrados.');
    return false;
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
  kb.push([Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')]);

  const txt = `${boldHeader('👥', 'Agentes disponibles')}\nSeleccione uno:`;
  const extra = { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) };

  const msgId = ctx.wizard.state.data?.msgId;
  if (msgId) {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, txt, extra);
    ctx.wizard.state.data = { msgId, agentes };
  } else {
    const msg = await ctx.reply(txt, extra);
    ctx.wizard.state.data = { msgId: msg.message_id, agentes };
  }
  return true;
}

async function showTarjetas(ctx) {
  const { agente_id, agente_nombre } = ctx.wizard.state.data;
  const tarjetas = (
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

  if (!tarjetas.length) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      ctx.wizard.state.data.msgId,
      undefined,
      'Este agente todavía no tiene tarjetas.',
      { parse_mode: 'HTML' }
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
    Markup.button.callback('🚪 Salir', 'GLOBAL_CANCEL')
  ]);
  const txt = `💳 <b>Tarjetas de ${escapeHtml(agente_nombre)}</b>`;
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    ctx.wizard.state.data.msgId,
    undefined,
    txt,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) }
  );
  ctx.wizard.state.data.tarjetas = tarjetas; // caché
  return true;
}

async function askSaldo(ctx, tarjeta) {
  const txt =
    `✏️ <b>Introduce el saldo actual de tu tarjeta</b>\n\n` +
    `Tarjeta ${escapeHtml(tarjeta.numero)} (saldo actual: <code>${fmtMoney(tarjeta.saldo)}</code>).\n` +
    'Por favor coloca el saldo actual de tu tarjeta. No te preocupes, te diré si ha aumentado o disminuido y en cuánto.\n\n' +
    'Ejemplo: 1500.50';
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
      return ctx.reply('Usa los botones para seleccionar agente.');
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
    if (!ctx.callbackQuery) return;
    const { data } = ctx.callbackQuery;
    if (data === 'OTROS_AG') {
      await ctx.answerCbQuery().catch(() => {});
      const ok = await showAgentes(ctx);
      if (ok) return ctx.wizard.selectStep(1);
      return;
    }
    if (!data.startsWith('TA_')) {
      return ctx.reply('Usa los botones para elegir la tarjeta.');
    }
    await ctx.answerCbQuery().catch(() => {});
    const tarjeta_id = +data.split('_')[1];
    const tarjeta = ctx.wizard.state.data.tarjetas.find(t => t.id === tarjeta_id);

    ctx.wizard.state.data.tarjeta = tarjeta;
    await askSaldo(ctx, tarjeta);
    return ctx.wizard.next();
  },

  /* 3 – registrar movimiento y preguntar continuación */
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
      return ctx.reply('Usa los botones o escribe el saldo.');
    }
    const num = parseFloat((ctx.message?.text || '').replace(',', '.'));
    if (isNaN(num)) {
      return ctx.reply('Valor inválido, escribe solo el saldo numérico.');
    }

    const { tarjeta } = ctx.wizard.state.data;
    const saldoNuevo = parseFloat(num);

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

      recordChange(ctx.wizard.state.data.agente_id, tarjeta.id, saldoAnterior, saldoNuevo);

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
      const txt =
        header +
        `Saldo anterior: <code>${fmtMoney(saldoAnterior)}</code>\n` +
        `Saldo informado: <code>${fmtMoney(saldoNuevo)}</code>\n` +
        `${emojiDelta} ${signo} <code>${fmtMoney(Math.abs(delta))}</code> ${escapeHtml(tarjeta.moneda)}\n\n` +
        '📆 Historial de hoy:\n' +
        lines.join('\n') +
        '\n\n¿Deseas actualizar otra tarjeta?';
      // ⚙️  DEPURACIÓN: muestra exactamente qué opciones se envían
      console.log('[SALDO_WIZ] sendAndLog extra →', kbContinue);

      // Markup.inlineKeyboard() **ya** devuelve { reply_markup: { … } }.
      // No hay que volver a envolverlo en otra clave reply_markup
      // o Telegram descarta el teclado.
      // ⒈ mensaje interactivo SOLO en el chat actual
      const sent = await sendAndLog(ctx, txt, { ...kbContinue, noForward: true });

      // ⒉ mensaje de registro para los grupos (sin teclado)
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

      await sendAndLog(ctx, logTxt); // se reenvía a stats / comerciales

      // Actualizamos el mensaje que se editará en los siguientes pasos
      if (sent?.message_id) {
        ctx.wizard.state.data.msgId = sent.message_id;
      }
    } catch (e) {
      console.error('[SALDO_WIZ] error insert movimiento:', e);
      await ctx.reply('❌ No se pudo registrar el movimiento.');
      return ctx.scene.leave();
    }

    return ctx.wizard.next();
  },

  /* 4 – decidir si continuar o salir */
  async ctx => {
    console.log('[SALDO_WIZ] paso 4: continuar o salir');
    if (await handleGlobalCancel(ctx)) return;
    if (!ctx.callbackQuery) return;
    const { data } = ctx.callbackQuery;
    await ctx.answerCbQuery().catch(() => {});

    if (data === 'OTRA_TA') {
      const ok = await showTarjetas(ctx);
      if (ok) return ctx.wizard.selectStep(2);
      return;
    }

    if (data === 'OTROS_AG') {
      const ok = await showAgentes(ctx);
      if (ok) return ctx.wizard.selectStep(1);
      return;
    }

    return ctx.reply('Usa los botones para continuar.');
  }
);

async function handleSaldoLeave(ctx) {
  if (ctx.wizard) {
    ctx.wizard.state = {};
  }

  try {
    const chatType = ctx.chat?.type;
    const isGroup = chatType === 'group' || chatType === 'supergroup';

    if (isGroup) {
      await runFondo(ctx, {
        send: async (text) => {
          const userId = ctx.from?.id;
          if (!userId) {
            console.log('[SALDO_WIZ] No hay ctx.from.id; se omite envío en grupo.');
            return;
          }
          if (!ctx.telegram?.sendMessage) {
            console.log('[SALDO_WIZ] ctx.telegram.sendMessage no disponible; se omite envío en grupo.');
            return;
          }
          try {
            await ctx.telegram.sendMessage(userId, text, { parse_mode: 'HTML' });
            console.log('[SALDO_WIZ] fondoAdvisor enviado por DM a', userId);
          } catch (e) {
            console.log('[SALDO_WIZ] No se pudo enviar DM del fondoAdvisor:', e.message);
          }
        },
      });
    } else {
      await runFondo(ctx);
    }
  } catch (err) {
    console.error('[SALDO_WIZ] error al generar análisis de fondo:', err);
  }
}

saldoWizard.leave(handleSaldoLeave);
saldoWizard.handleSaldoLeave = handleSaldoLeave;

module.exports = saldoWizard;

// ✔ probado con tarjeta 5278

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
const { escapeHtml, fmtMoney } = require('../helpers/format');
const { sendAndLog } = require('../helpers/reportSender');
const { recordChange, flushOnExit } = require('../helpers/sessionSummary');
const pool = require('../psql/db.js');

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

async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'GLOBAL_CANCEL') {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.scene?.current) {
      await flushOnExit(ctx);
      await ctx.scene.leave();
      await ctx.reply('❌ Operación cancelada.');
      return true;
    }
  }
  if (ctx.message?.text) {
    const t = ctx.message.text.trim().toLowerCase();
    if (['/cancel', '/salir', 'salir'].includes(t) && ctx.scene?.current) {
      await flushOnExit(ctx);
      await ctx.scene.leave();
      await ctx.reply('❌ Operación cancelada.');
      return true;
    }
  }
  return false;
}

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

  const txt = '👥 <b>Seleccione uno de los Agentes disponibles</b>';
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
    const ok = await showAgentes(ctx);
    if (!ok) return ctx.scene.leave();
    return ctx.wizard.next();
  },

  /* 1 – elegir tarjeta del agente */
  async ctx => {
    console.log('[SALDO_WIZ] paso 1: elegir tarjeta');
    if (await wantExit(ctx)) return;
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
    if (await wantExit(ctx)) return;
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
    if (await wantExit(ctx)) return;
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
    const saldoAnterior = parseFloat(tarjeta.saldo) || 0;
    const saldoNuevo = parseFloat(num);
    const delta = saldoNuevo - saldoAnterior;

    try {
      await pool.query(
        `
        INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, descripcion)
        VALUES (
            $1::int,
            $2::numeric,
            $3::numeric,
            $4::numeric,
            CASE WHEN $3 >= 0 THEN 'Actualización +' ELSE 'Actualización –' END
        );
        `,
        [tarjeta.id, saldoAnterior, delta, saldoNuevo]
      );

      recordChange(ctx.wizard.state.data.agente_id, tarjeta.id, saldoAnterior, saldoNuevo);
      const signo =
        delta > 0 ? '📈 Aumentó' : delta < 0 ? '📉 Disminuyó' : '➖ Sin cambio';
      const txt =
        `${signo} <code>${fmtMoney(Math.abs(delta))}</code> ${escapeHtml(tarjeta.moneda)}.\n` +
        `Saldo nuevo de <b>${escapeHtml(tarjeta.numero)}</b>: <code>${fmtMoney(saldoNuevo)}</code> ${escapeHtml(tarjeta.moneda)}.\n\n` +
        '¿Deseas actualizar otra tarjeta?';
      // ⚙️  DEPURACIÓN: muestra exactamente qué opciones se envían
      console.log('[SALDO_WIZ] sendAndLog extra →', kbContinue);
      
      // Markup.inlineKeyboard() **ya** devuelve { reply_markup: { … } }.
      // No hay que volver a envolverlo en otra clave reply_markup
      // o Telegram descarta el teclado.
      // ⒈ mensaje interactivo SOLO en el chat actual
      const sent = await sendAndLog(ctx, txt, { ...kbContinue, noForward:true });

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
     `• Saldo anterior: <code>${fmtMoney(saldoAnterior)}</code>\n` +
     `• Saldo informado : <code>${fmtMoney(saldoNuevo)}</code>\n` +
     `• Variación      : <code>${(delta>=0?'+':'') + fmtMoney(delta)}</code> ${delta>0?'📈':delta<0?'📉':'➖'}`;

   await sendAndLog(ctx, logTxt);   // se reenvía a stats / comerciales

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
    if (await wantExit(ctx)) return;
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

module.exports = saldoWizard;

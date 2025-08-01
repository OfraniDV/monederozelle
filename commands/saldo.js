// commands/saldo.js
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
const pool = require('../psql/db.js');

/* ───────── helpers ───────── */
const kbCancel = Markup.inlineKeyboard([
  Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')
]);

async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'GLOBAL_CANCEL') {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.scene?.current) {
      await ctx.scene.leave();
      await ctx.reply('❌ Operación cancelada.');
      return true;
    }
  }
  if (ctx.message?.text) {
    const t = ctx.message.text.trim().toLowerCase();
    if (['/cancel', '/salir', 'salir'].includes(t) && ctx.scene?.current) {
      await ctx.scene.leave();
      await ctx.reply('❌ Operación cancelada.');
      return true;
    }
  }
  return false;
}

/* ───────── Wizard ───────── */
const saldoWizard = new Scenes.WizardScene(
  'SALDO_WIZ',

  /* 0 – elegir agente */
  async ctx => {
    const agentes = (
      await pool.query('SELECT id,nombre FROM agente ORDER BY nombre')
    ).rows;
    if (!agentes.length) {
      await ctx.reply('⚠️ No hay agentes registrados.');
      return ctx.scene.leave();
    }
    const kb = agentes.map(a => [Markup.button.callback(a.nombre, `AG_${a.id}`)]);
    await ctx.reply('👤 Selecciona un agente:', Markup.inlineKeyboard(kb));
    return ctx.wizard.next();
  },

  /* 1 – elegir tarjeta del agente */
  async ctx => {
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('AG_')) {
      return ctx.reply('Usa los botones para seleccionar agente.');
    }
    await ctx.answerCbQuery().catch(() => {});
    const agente_id = +ctx.callbackQuery.data.split('_')[1];
    ctx.wizard.state.data = { agente_id };

    const tarjetas = (
      await pool.query(
        `
        SELECT t.id, t.numero,
               COALESCE(mv.saldo_nuevo,0) AS saldo,
               COALESCE(m.codigo,'')       AS moneda,
               COALESCE(m.emoji,'')        AS moneda_emoji
        FROM tarjeta t
        LEFT JOIN moneda m  ON m.id = t.moneda_id
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
      await ctx.reply('Este agente todavía no tiene tarjetas.');
      return ctx.scene.leave();
    }

    // mostrar lista y botones
    const kb = tarjetas.map(t => [
      Markup.button.callback(
        `${t.numero}  (${t.moneda_emoji} ${t.moneda} – ${t.saldo})`,
        `TA_${t.id}`
      )
    ]);
    ctx.wizard.state.data.tarjetas = tarjetas; // caché
    await ctx.reply('💳 Selecciona la tarjeta a actualizar:', Markup.inlineKeyboard(kb));
    return ctx.wizard.next();
  },

  /* 2 – pedir saldo actual */
  async ctx => {
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('TA_')) {
      return ctx.reply('Usa los botones para elegir la tarjeta.');
    }
    await ctx.answerCbQuery().catch(() => {});
    const tarjeta_id = +ctx.callbackQuery.data.split('_')[1];
    const tarjeta = ctx.wizard.state.data.tarjetas.find(t => t.id === tarjeta_id);

    ctx.wizard.state.data.tarjeta = tarjeta;
    await ctx.reply(
      `✏️ Saldo actual para ${tarjeta.numero} (antes ${tarjeta.saldo}):`,
      kbCancel
    );
    return ctx.wizard.next();
  },

  /* 3 – registrar movimiento */
  async ctx => {
    if (await wantExit(ctx)) return;
    const num = parseFloat((ctx.message?.text || '').replace(',', '.'));
    if (isNaN(num)) {
      return ctx.reply('Valor inválido, escribe solo el saldo numérico.');
    }

    const { tarjeta } = ctx.wizard.state.data;
    const saldoAnterior = Number(tarjeta.saldo || 0);
    const saldoNuevo = Number(num);
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

      const signo = delta > 0 ? '📈 Aumentó' : delta < 0 ? '📉 Disminuyó' : '➖ Sin cambio';
      await ctx.reply(
        `${signo} ${Math.abs(delta).toFixed(2)}.\n` +
          `Saldo nuevo de *${tarjeta.numero}*: ${saldoNuevo.toFixed(2)} ${tarjeta.moneda}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('[SALDO_WIZ] error insert movimiento:', e);
      await ctx.reply('❌ No se pudo registrar el movimiento.');
    }
    return ctx.scene.leave();
  }
);

module.exports = saldoWizard;

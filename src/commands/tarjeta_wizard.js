// commands/tarjeta_wizard.js
// Migrado a parse mode HTML con escapeHtml para sanear datos dinámicos.
// Ajustar textos y parse_mode si se requiere volver a Markdown.
// Los teclados dinámicos usan arrangeInlineButtons para máximo dos botones por fila.
const { Scenes, Markup } = require('telegraf');
const { escapeHtml, fmtMoney } = require('../helpers/format');
const { recordChange, flushOnExit } = require('../helpers/sessionSummary');
const {
  arrangeInlineButtons,
  editIfChanged,
  buildBackExitRow,
  withExitHint,
} = require('../helpers/ui');
const { handleGlobalCancel } = require('../helpers/wizardCancel');
const pool = require('../psql/db.js');

/* Botones comunes */
const kbCancel = Markup.inlineKeyboard([
  Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')
]);
const kbSaldo = Markup.inlineKeyboard([
  Markup.button.callback('0 ↩️ Iniciar en 0', 'SALDO_0'),
  Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')
]);

/* Helpers */
async function getBancoKb() {
  const bancos = (
    await pool.query('SELECT id, codigo, emoji FROM banco ORDER BY codigo')
  ).rows;
  if (!bancos.length) return null;
  const buttons = bancos.map(b =>
    Markup.button.callback(
      `${b.emoji ? b.emoji + ' ' : ''}${b.codigo}`,
      `BN_${b.id}`
    )
  );
  const kb = arrangeInlineButtons([
    Markup.button.callback('Sin banco', 'BN_NONE'),
    ...buttons,
  ]);
  return Markup.inlineKeyboard(kb);
}

async function getMonedaKb() {
  const monedas = (
    await pool.query('SELECT id, codigo, emoji FROM moneda ORDER BY codigo')
  ).rows;
  if (!monedas.length) return null;
  const buttons = monedas.map(m =>
    Markup.button.callback(
      `${m.emoji ? m.emoji + ' ' : ''}${m.codigo}`,
      `MO_${m.id}`
    )
  );
  return Markup.inlineKeyboard(arrangeInlineButtons(buttons));
}

async function showAgentes(ctx) {
  const agents = (
    await pool.query('SELECT id, nombre FROM agente ORDER BY nombre')
  ).rows;
  if (!agents.length) {
    await editIfChanged(
      ctx,
      withExitHint('⚠️ No hay agentes. Crea uno con /agentes y vuelve a /tarjeta.'),
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'GLOBAL_CANCEL')] },
      }
    );
    ctx.wizard.state.route = 'AGENTS';
    ctx.wizard.state.agentes = [];
    return;
  }
  const buttons = agents.map((a) => Markup.button.callback(a.nombre, `AG_${a.id}`));
  const kb = arrangeInlineButtons(buttons);
  kb.push([Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]);
  await editIfChanged(ctx, withExitHint('👤 Elige agente:'), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
  ctx.wizard.state.route = 'AGENTS';
  ctx.wizard.state.agentes = agents;
}

function getEditKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Número', 'EDIT_NUM')],
    [
      Markup.button.callback('🏦 Banco', 'EDIT_BANK'),
      Markup.button.callback('💱 Moneda', 'EDIT_CURR'),
    ],
    [Markup.button.callback('✅ Guardar', 'CANCEL_EDIT')],
    buildBackExitRow('BACK', 'GLOBAL_CANCEL'),
  ]);
}

async function showTarjetasMenu(ctx) {
  const { agente_id } = ctx.wizard.state.data;
  const tarjetas = (
    await pool.query(
      'SELECT id, numero FROM tarjeta WHERE agente_id=$1 ORDER BY numero',
      [agente_id]
    )
  ).rows;
  const kb = tarjetas.map((t) => [
    Markup.button.callback(t.numero, `TA_NOP_${t.id}`),
    Markup.button.callback('✏️', `TA_EDIT_${t.id}`),
    Markup.button.callback('🗑️', `TA_DEL_${t.id}`),
  ]);
  kb.push([Markup.button.callback('➕ Añadir nueva tarjeta', 'TA_ADD')]);
  kb.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
  const textoBase = tarjetas.length
    ? '💳 Tarjetas existentes:'
    : '💳 Este agente aún no tiene tarjetas.';
  const texto = withExitHint(textoBase);
  const extra = { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } };
  if (ctx.wizard.state.msgId) {
    await editIfChanged(ctx, texto, extra);
  } else {
    const msg = await ctx.reply(texto, extra);
    ctx.wizard.state.msgId = msg.message_id;
  }
  ctx.wizard.state.route = 'CARD_MENU';
}

async function renderEditMenu(ctx) {
  const e = ctx.wizard.state.edit;
  const text = withExitHint(
    `Tarjeta existente:\n` +
      `<b>Número:</b> ${escapeHtml(e.numero)}\n` +
      `<b>Banco:</b> ${escapeHtml(e.banco || '—')}\n` +
      `<b>Moneda:</b> ${escapeHtml(e.moneda || '—')}\n` +
      `<b>Saldo:</b> ${escapeHtml(e.saldo || 0)}\n\n` +
      '¿Qué deseas actualizar?'
  );
  await editIfChanged(ctx, text, { parse_mode: 'HTML', ...getEditKb() });
  ctx.wizard.state.route = 'EDIT_MENU';
}

/* ─── Wizard ─── */
const tarjetaWizard = new Scenes.WizardScene(
  'TARJETA_WIZ',

  /* Paso 0 – Agente -------------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 0: agente');
    if (await handleGlobalCancel(ctx)) return;
    const msg = await ctx.reply(withExitHint('Cargando…'));
    ctx.wizard.state.msgId = msg.message_id;
    await showAgentes(ctx);
    return ctx.wizard.next();
  },

  /* Paso 1 – Seleccionar agente y mostrar tarjetas ------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 1: tarjetas del agente');
    if (await handleGlobalCancel(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('AG_')) {
      return ctx.reply(withExitHint('Usa los botones para elegir agente.'), kbCancel);
    }
    await ctx.answerCbQuery().catch(() => {});
    const agente_id = +ctx.callbackQuery.data.split('_')[1];
    ctx.wizard.state.data = { agente_id };
    await showTarjetasMenu(ctx);
    return ctx.wizard.next();
  },

  /* Paso 2 – Acciones sobre tarjetas o añadir nueva ----------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 2: menú tarjetas');
    if (await handleGlobalCancel(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'BACK') {
      await showAgentes(ctx);
      return ctx.wizard.selectStep(1);
    }
    if (data.startsWith('TA_EDIT_')) {
      const id = +data.split('_')[2];
      const existing = (
        await pool.query(
          `
          SELECT t.id, t.numero, t.banco_id, t.moneda_id,
                 COALESCE(b.codigo, '—') AS banco,
                 COALESCE(m.codigo, '—') AS moneda,
                 COALESCE(mv.saldo_nuevo, 0) AS saldo
          FROM   tarjeta t
          LEFT JOIN banco   b ON b.id = t.banco_id
          LEFT JOIN moneda  m ON m.id = t.moneda_id
          LEFT JOIN LATERAL (
            SELECT saldo_nuevo
            FROM   movimiento
            WHERE  tarjeta_id = t.id
            ORDER BY creado_en DESC
            LIMIT 1
          ) mv ON true
          WHERE  t.id = $1;
        `,
          [id]
        )
      ).rows[0];
      if (!existing) {
        await editIfChanged(ctx, 'Tarjeta no encontrada.', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'GLOBAL_CANCEL')] },
        });
        return;
      }
      ctx.wizard.state.edit = {
        tarjeta_id: existing.id,
        numero: existing.numero,
        banco_id: existing.banco_id,
        banco: existing.banco,
        moneda_id: existing.moneda_id,
        moneda: existing.moneda,
        saldo: existing.saldo,
      };
      await renderEditMenu(ctx);
      return ctx.wizard.selectStep(7);
    }
    if (data.startsWith('TA_DEL_CONF_')) {
      const id = +data.split('_')[3];
      try {
        await pool.query('DELETE FROM tarjeta WHERE id=$1', [id]);
        await ctx.reply(withExitHint('🗑️ Tarjeta eliminada.'));
      } catch (e) {
        console.error('[TARJETA_DEL] Error:', e);
        await ctx.reply(withExitHint('❌ No se pudo eliminar la tarjeta.'));
      }
      return showTarjetasMenu(ctx);
    }
    if (data.startsWith('TA_DEL_')) {
      const id = +data.split('_')[2];
      try {
        const res = await pool.query(
          'SELECT COUNT(*) FROM movimiento WHERE tarjeta_id=$1',
          [id]
        );
        const movimientos = +res.rows[0].count;
        let msg = '¿Eliminar esta tarjeta?';
        if (movimientos > 0) {
          msg = `⚠️ Esta tarjeta tiene ${movimientos} movimiento(s). ` +
                'Si la eliminas, se perderán. ¿Continuar?';
        }
        await ctx.reply(
          msg,
          Markup.inlineKeyboard([
            [Markup.button.callback('Eliminar', `TA_DEL_CONF_${id}`)],
            [Markup.button.callback('Cancelar', 'DEL_CANCEL')]
          ])
        );
      } catch (e) {
        console.error('[TARJETA_DEL] check error:', e);
      await ctx.reply(withExitHint('❌ Error verificando la tarjeta.'));
      }
      return;
    }
    if (data === 'DEL_CANCEL') {
      return showTarjetasMenu(ctx);
    }
    if (data === 'TA_ADD') {
      await ctx.reply(withExitHint('🔢 Número o alias de la tarjeta:'), kbCancel);
      return ctx.wizard.next();
    }
    // no-op
  },

  /* Paso 3 – Banco o edición ---------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 3: seleccionar banco');
    if (await handleGlobalCancel(ctx)) return;
    const numero = (ctx.message?.text || '').trim();
    if (!numero) return ctx.reply(withExitHint('Número inválido.'), kbCancel);

    ctx.wizard.state.data.numero = numero;

    /* comprobar tarjeta existente */
    const existing = (
      await pool.query(
        `
        SELECT t.id,
               t.numero,
               t.banco_id,
               t.moneda_id,
               COALESCE(b.codigo, '—') AS banco,
               COALESCE(m.codigo, '—') AS moneda,
               COALESCE(mv.saldo_nuevo, 0) AS saldo
        FROM   tarjeta t
        LEFT JOIN banco   b ON b.id = t.banco_id
        LEFT JOIN moneda  m ON m.id = t.moneda_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
          FROM   movimiento
          WHERE  tarjeta_id = t.id
          ORDER BY creado_en DESC
          LIMIT 1
        ) mv ON true
        WHERE  t.numero = $1;
      `,
        [numero]
      )
    ).rows[0];

    if (existing) {
      console.log('[TARJETA_EDIT] tarjeta existente detectada');
      ctx.wizard.state.edit = {
        tarjeta_id: existing.id,
        numero: existing.numero,
        banco_id: existing.banco_id,
        moneda_id: existing.moneda_id
      };
      await ctx.reply(
        `Tarjeta existente:\n<b>Banco:</b> ${existing.banco}\n<b>Moneda:</b> ${existing.moneda}\n<b>Saldo:</b> ${existing.saldo}`,
        { parse_mode: 'HTML' }
      );
      await ctx.reply(
        '¿Qué deseas actualizar? 🏦 Banco, 💱 Moneda, o ✅ Nada',
        { parse_mode: 'HTML', ...getEditKb() }
      );
      return ctx.wizard.selectStep(7);
    }

    const kb = await getBancoKb();
    if (!kb) {
      await ctx.reply(withExitHint('⚠️ No hay bancos. Crea uno con /bancos y vuelve.'), kbCancel);
      return ctx.scene.leave();
    }
    await ctx.reply(withExitHint('🏦 Elige banco:'), { parse_mode: 'HTML', ...kb });
    return ctx.wizard.next();
  },

  /* Paso 4 – Moneda ------------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 4: seleccionar moneda');
    if (await handleGlobalCancel(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('BN_')) {
      return ctx.reply(withExitHint('Usa los botones para elegir banco.'), kbCancel);
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.data.banco_id =
      ctx.callbackQuery.data === 'BN_NONE' ? null : +ctx.callbackQuery.data.split('_')[1];

    const kb = await getMonedaKb();
    if (!kb) {
      await ctx.reply(withExitHint('⚠️ No hay monedas. Crea una con /monedas y vuelve.'), kbCancel);
      return ctx.scene.leave();
    }
    await ctx.reply(withExitHint('💱 Elige moneda:'), { parse_mode: 'HTML', ...kb });
    return ctx.wizard.next();
  },

  /* Paso 5 – Saldo inicial ------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 5: saldo inicial');
    if (await handleGlobalCancel(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('MO_')) {
      return ctx.reply(withExitHint('Usa los botones para elegir moneda.'), kbCancel);
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.data.moneda_id = +ctx.callbackQuery.data.split('_')[1];

    await ctx.reply(withExitHint('💰 Saldo inicial (escribe cantidad o pulsa «0»):'), kbSaldo);
    return ctx.wizard.next();
  },

  /* Paso 6 – Guardar tarjeta + primer movimiento -------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 6: guardar tarjeta');
    if (await handleGlobalCancel(ctx)) return;

    let saldo = 0;
    if (ctx.callbackQuery?.data === 'SALDO_0') {
      await ctx.answerCbQuery().catch(() => {});
      saldo = 0;
    } else {
      saldo = parseFloat((ctx.message?.text || '0').replace(',', '.')) || 0;
    }

    const { numero, agente_id, banco_id, moneda_id } = ctx.wizard.state.data;

    try {
      const { rows } = await pool.query(
        `
        INSERT INTO tarjeta (numero, agente_id, banco_id, moneda_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (numero) DO UPDATE
          SET agente_id = EXCLUDED.agente_id,
              banco_id  = EXCLUDED.banco_id,
              moneda_id = EXCLUDED.moneda_id
        RETURNING id;
      `,
        [numero, agente_id, banco_id, moneda_id]
      );
      const tarjeta_id = rows[0].id;

      await pool.query(
        `
        INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, descripcion)
        VALUES ($1, 0, $2, $2, 'Saldo inicial');
      `,
        [tarjeta_id, saldo]
      );
      recordChange(agente_id, tarjeta_id, 0, saldo);
      await ctx.reply(
        `✅ Tarjeta creada y saldo inicial registrado. Saldo: <code>${fmtMoney(saldo)}</code>`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('[TARJETA_WIZ] Error final:', e);
      await ctx.reply('❌ Error al crear la tarjeta.');
    }
    await flushOnExit(ctx);
    return ctx.scene.leave();
  },

  /* Paso 7 – Edición interactiva ----------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 7: edición interactiva');
    if (await handleGlobalCancel(ctx)) return;

    const route = ctx.wizard.state.route;
    const data = ctx.callbackQuery?.data;

    if (route === 'EDIT_MENU') {
      if (!data) return;
      await ctx.answerCbQuery().catch(() => {});
      if (data === 'EDIT_BANK') {
        const kb = await getBancoKb();
        if (!kb) {
          await editIfChanged(ctx, withExitHint('⚠️ No hay bancos. Crea uno con /bancos y vuelve.'), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'GLOBAL_CANCEL')] },
          });
          return;
        }
        const rows = kb.reply_markup.inline_keyboard;
        rows.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
        await editIfChanged(ctx, withExitHint('🏦 Elige banco:'), {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
        ctx.wizard.state.route = 'SELECT_BANK';
        return;
      }
      if (data === 'EDIT_CURR') {
        const kb = await getMonedaKb();
        if (!kb) {
          await editIfChanged(ctx, withExitHint('⚠️ No hay monedas. Crea una con /monedas y vuelve.'), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'GLOBAL_CANCEL')] },
          });
          return;
        }
        const rows = kb.reply_markup.inline_keyboard;
        rows.push(buildBackExitRow('BACK', 'GLOBAL_CANCEL'));
        await editIfChanged(ctx, withExitHint('💱 Elige moneda:'), {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
        ctx.wizard.state.route = 'SELECT_CURR';
        return;
      }
      if (data === 'EDIT_NUM') {
        await editIfChanged(ctx, withExitHint('🔢 Nuevo número de la tarjeta:'), {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [buildBackExitRow('BACK', 'GLOBAL_CANCEL')] },
        });
        ctx.wizard.state.route = 'ASK_NUM';
        return;
      }
      if (data === 'CANCEL_EDIT') {
        const { tarjeta_id, banco_id, moneda_id, numero } = ctx.wizard.state.edit;
        try {
          await pool.query(
            'UPDATE tarjeta SET numero=$1, banco_id=$2, moneda_id=$3 WHERE id=$4',
            [numero, banco_id, moneda_id, tarjeta_id]
          );
          await editIfChanged(ctx, '✅ Tarjeta actualizada.', { parse_mode: 'HTML' });
        } catch (e) {
          console.error('[TARJETA_EDIT] Error al actualizar:', e);
          await editIfChanged(ctx, '❌ Error al actualizar la tarjeta.', { parse_mode: 'HTML' });
        }
        return ctx.scene.leave();
      }
      if (data === 'BACK') {
        await showTarjetasMenu(ctx);
        return ctx.wizard.selectStep(2);
      }
    } else if (route === 'SELECT_BANK') {
      if (!data) return;
      await ctx.answerCbQuery().catch(() => {});
      if (data === 'BACK') return renderEditMenu(ctx);
      if (!data.startsWith('BN_')) return;
      ctx.wizard.state.edit.banco_id =
        data === 'BN_NONE' ? null : +data.split('_')[1];
      const binfo = ctx.wizard.state.edit.banco_id
        ? (await pool.query('SELECT codigo FROM banco WHERE id=$1', [ctx.wizard.state.edit.banco_id])).rows[0]
        : { codigo: 'Sin banco' };
      ctx.wizard.state.edit.banco = binfo.codigo;
      return renderEditMenu(ctx);
    } else if (route === 'SELECT_CURR') {
      if (!data) return;
      await ctx.answerCbQuery().catch(() => {});
      if (data === 'BACK') return renderEditMenu(ctx);
      if (!data.startsWith('MO_')) return;
      ctx.wizard.state.edit.moneda_id = +data.split('_')[1];
      const minfo = (
        await pool.query('SELECT codigo FROM moneda WHERE id=$1', [ctx.wizard.state.edit.moneda_id])
      ).rows[0];
      ctx.wizard.state.edit.moneda = minfo.codigo;
      return renderEditMenu(ctx);
    } else if (route === 'ASK_NUM') {
      if (data === 'BACK') {
        await ctx.answerCbQuery().catch(() => {});
        return renderEditMenu(ctx);
      }
      const numero = (ctx.message?.text || '').trim();
      if (!numero) return;
      ctx.wizard.state.edit.numero = numero;
      return renderEditMenu(ctx);
    }
  }
);

module.exports = tarjetaWizard;

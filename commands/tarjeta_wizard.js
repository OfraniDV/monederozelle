// commands/tarjeta_wizard.js
// Migrado a parse mode HTML con escapeHtml para sanear datos dinámicos.
// Ajustar textos y parse_mode si se requiere volver a Markdown.
const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const pool = require('../psql/db.js');

/* Botones comunes */
const kbCancel = Markup.inlineKeyboard([
  Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')
]);
const kbSaldo = Markup.inlineKeyboard([
  Markup.button.callback('0 ↩️ Iniciar en 0', 'SALDO_0'),
  Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')
]);

/* Helpers */
async function getBancoKb() {
  const bancos = (
    await pool.query('SELECT id, codigo, emoji FROM banco ORDER BY codigo')
  ).rows;
  if (!bancos.length) return null;
  const kb = [
    [Markup.button.callback('Sin banco', 'BN_NONE')],
    ...bancos.map(b => [
      Markup.button.callback(
        `${b.emoji ? b.emoji + ' ' : ''}${b.codigo}`,
        `BN_${b.id}`
      )
    ])
  ];
  return Markup.inlineKeyboard(kb);
}

async function getMonedaKb() {
  const monedas = (
    await pool.query('SELECT id, codigo, emoji FROM moneda ORDER BY codigo')
  ).rows;
  if (!monedas.length) return null;
  const kb = monedas.map(m => [
    Markup.button.callback(
      `${m.emoji ? m.emoji + ' ' : ''}${m.codigo}`,
      `MO_${m.id}`
    )
  ]);
  return Markup.inlineKeyboard(kb);
}

function getEditKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Número', 'EDIT_NUM')],
    [
      Markup.button.callback('🏦 Banco', 'EDIT_BANK'),
      Markup.button.callback('💱 Moneda', 'EDIT_CURR')
    ],
    [Markup.button.callback('✅ Nada', 'CANCEL_EDIT')],
    [Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')]
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
  const kb = tarjetas.map(t => [
    Markup.button.callback(t.numero, `TA_NOP_${t.id}`),
    Markup.button.callback('✏️', `TA_EDIT_${t.id}`),
    Markup.button.callback('🗑️', `TA_DEL_${t.id}`)
  ]);
  kb.push([Markup.button.callback('➕ Añadir nueva tarjeta', 'TA_ADD')]);
  kb.push([Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')]);
  const texto = tarjetas.length
    ? '💳 Tarjetas existentes:'
    : '💳 Este agente aún no tiene tarjetas.';
  await ctx.reply(texto, Markup.inlineKeyboard(kb));
}

/* ─── salir / cancelar ─── */
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

/* ─── Wizard ─── */
const tarjetaWizard = new Scenes.WizardScene(
  'TARJETA_WIZ',

  /* Paso 0 – Agente -------------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 0: agente');
    if (await wantExit(ctx)) return;
    const agents = (
      await pool.query('SELECT id, nombre FROM agente ORDER BY nombre')
    ).rows;
    if (!agents.length) {
      await ctx.reply('⚠️ No hay agentes. Crea uno con /agentes y vuelve a /tarjeta.');
      return ctx.scene.leave();
    }
    const kb = [];
    for (let i = 0; i < agents.length; i += 2) {
      const row = [
        Markup.button.callback(agents[i].nombre, `AG_${agents[i].id}`)
      ];
      if (agents[i + 1]) {
        row.push(
          Markup.button.callback(agents[i + 1].nombre, `AG_${agents[i + 1].id}`)
        );
      }
      kb.push(row);
    }
    kb.push([Markup.button.callback('❌ Cancelar', 'GLOBAL_CANCEL')]);
    await ctx.reply('👤 Elige agente:', Markup.inlineKeyboard(kb));
    return ctx.wizard.next();
  },

  /* Paso 1 – Seleccionar agente y mostrar tarjetas ------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 1: tarjetas del agente');
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('AG_')) {
      return ctx.reply('Usa los botones para elegir agente.');
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
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
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
        await ctx.reply('Tarjeta no encontrada.');
        return showTarjetasMenu(ctx);
      }
      ctx.wizard.state.edit = {
        tarjeta_id: existing.id,
        numero: existing.numero,
        banco_id: existing.banco_id,
        moneda_id: existing.moneda_id
      };
      await ctx.reply(
        `Tarjeta existente:\n<b>Banco:</b> ${escapeHtml(existing.banco)}\n<b>Moneda:</b> ${escapeHtml(existing.moneda)}\n<b>Saldo:</b> ${escapeHtml(existing.saldo)}`,
        { parse_mode: 'HTML' }
      );
      await ctx.reply(
        '¿Qué deseas actualizar? 🏦 Banco, 💱 Moneda, o ✅ Nada',
        { parse_mode: 'HTML', ...getEditKb() }
      );
      return ctx.wizard.selectStep(7);
    }
    if (data.startsWith('TA_DEL_CONF_')) {
      const id = +data.split('_')[3];
      try {
        await pool.query('DELETE FROM tarjeta WHERE id=$1', [id]);
        await ctx.reply('🗑️ Tarjeta eliminada.');
      } catch (e) {
        console.error('[TARJETA_DEL] Error:', e);
        await ctx.reply('❌ No se pudo eliminar la tarjeta.');
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
        await ctx.reply('❌ Error verificando la tarjeta.');
      }
      return;
    }
    if (data === 'DEL_CANCEL') {
      return showTarjetasMenu(ctx);
    }
    if (data === 'TA_ADD') {
      await ctx.reply('🔢 Número o alias de la tarjeta:', kbCancel);
      return ctx.wizard.next();
    }
    // no-op
  },

  /* Paso 3 – Banco o edición ---------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 3: seleccionar banco');
    if (await wantExit(ctx)) return;
    const numero = (ctx.message?.text || '').trim();
    if (!numero) return ctx.reply('Número inválido.');

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
      await ctx.reply('⚠️ No hay bancos. Crea uno con /bancos y vuelve.');
      return ctx.scene.leave();
    }
    await ctx.reply('🏦 Elige banco:', { parse_mode: 'HTML', ...kb });
    return ctx.wizard.next();
  },

  /* Paso 4 – Moneda ------------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 4: seleccionar moneda');
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('BN_')) {
      return ctx.reply('Usa los botones para elegir banco.');
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.data.banco_id =
      ctx.callbackQuery.data === 'BN_NONE' ? null : +ctx.callbackQuery.data.split('_')[1];

    const kb = await getMonedaKb();
    if (!kb) {
      await ctx.reply('⚠️ No hay monedas. Crea una con /monedas y vuelve.');
      return ctx.scene.leave();
    }
    await ctx.reply('💱 Elige moneda:', { parse_mode: 'HTML', ...kb });
    return ctx.wizard.next();
  },

  /* Paso 5 – Saldo inicial ------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 5: saldo inicial');
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('MO_')) {
      return ctx.reply('Usa los botones para elegir moneda.');
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.data.moneda_id = +ctx.callbackQuery.data.split('_')[1];

    await ctx.reply('💰 Saldo inicial (escribe cantidad o pulsa «0»):', kbSaldo);
    return ctx.wizard.next();
  },

  /* Paso 6 – Guardar tarjeta + primer movimiento -------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 6: guardar tarjeta');
    if (await wantExit(ctx)) return;

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

      await ctx.reply('✅ Tarjeta creada y saldo inicial registrado.');
    } catch (e) {
      console.error('[TARJETA_WIZ] Error final:', e);
      await ctx.reply('❌ Error al crear la tarjeta.');
    }
    return ctx.scene.leave();
  },

  /* Paso 7 – Menú de edición ---------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 7: menú edición');
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    await ctx.answerCbQuery().catch(() => {});
    console.log('[TARJETA_EDIT] opción elegida', data);
    if (data === 'EDIT_BANK') {
      const kb = await getBancoKb();
      if (!kb) {
        await ctx.reply('⚠️ No hay bancos. Crea uno con /bancos y vuelve.');
        return ctx.scene.leave();
      }
      await ctx.reply('🏦 Elige banco:', { parse_mode: 'HTML', ...kb });
      return ctx.wizard.selectStep(8);
    }
    if (data === 'EDIT_CURR') {
      const kb = await getMonedaKb();
      if (!kb) {
        await ctx.reply('⚠️ No hay monedas. Crea una con /monedas y vuelve.');
        return ctx.scene.leave();
      }
      await ctx.reply('💱 Elige moneda:', { parse_mode: 'HTML', ...kb });
      return ctx.wizard.selectStep(9);
    }
    if (data === 'EDIT_NUM') {
      await ctx.reply('🔢 Nuevo número de la tarjeta:', kbCancel);
      return ctx.wizard.selectStep(10);
    }
    if (data === 'CANCEL_EDIT') {
      const { tarjeta_id, banco_id, moneda_id, numero } = ctx.wizard.state.edit;
      try {
        await pool.query(
          'UPDATE tarjeta SET numero=$1, banco_id=$2, moneda_id=$3 WHERE id=$4',
          [numero, banco_id, moneda_id, tarjeta_id]
        );
        console.log('[TARJETA_EDIT] tarjeta actualizada', tarjeta_id);
        await ctx.reply('✅ Tarjeta actualizada.', { parse_mode: 'HTML' });
      } catch (e) {
        console.error('[TARJETA_EDIT] Error al actualizar:', e);
        await ctx.reply('❌ Error al actualizar la tarjeta.', { parse_mode: 'HTML' });
      }
      return ctx.scene.leave();
    }
  },

  /* Paso 8 – Editar banco ------------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 8: editar banco');
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('BN_')) {
      return ctx.reply('Usa los botones para elegir banco.');
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.edit.banco_id =
      ctx.callbackQuery.data === 'BN_NONE' ? null : +ctx.callbackQuery.data.split('_')[1];
    console.log('[TARJETA_EDIT] banco seleccionado', ctx.wizard.state.edit.banco_id);
    await ctx.reply('🏦 Banco actualizado.', { parse_mode: 'HTML' });
    await ctx.reply(
      '¿Qué deseas actualizar? 🏦 Banco, 💱 Moneda, o ✅ Nada',
      { parse_mode: 'HTML', ...getEditKb() }
    );
    return ctx.wizard.selectStep(7);
  },

  /* Paso 9 – Editar moneda ------------------------------------------------ */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 9: editar moneda');
    if (await wantExit(ctx)) return;
    if (!ctx.callbackQuery?.data.startsWith('MO_')) {
      return ctx.reply('Usa los botones para elegir moneda.');
    }
    await ctx.answerCbQuery().catch(() => {});
    ctx.wizard.state.edit.moneda_id = +ctx.callbackQuery.data.split('_')[1];
    console.log('[TARJETA_EDIT] moneda seleccionada', ctx.wizard.state.edit.moneda_id);
    await ctx.reply('💱 Moneda actualizada.', { parse_mode: 'HTML' });
    await ctx.reply(
      '¿Qué deseas actualizar? 🏦 Banco, 💱 Moneda, o ✅ Nada',
      { parse_mode: 'HTML', ...getEditKb() }
    );
    return ctx.wizard.selectStep(7);
  },

  /* Paso 10 – Editar número ----------------------------------------------- */
  async ctx => {
    console.log('[TARJETA_WIZ] paso 10: editar número');
    if (await wantExit(ctx)) return;
    const numero = (ctx.message?.text || '').trim();
    if (!numero) return ctx.reply('Número inválido.');
    ctx.wizard.state.edit.numero = numero;
    await ctx.reply('🔢 Número actualizado.', { parse_mode: 'HTML' });
    await ctx.reply(
      '¿Qué deseas actualizar? 🏦 Banco, 💱 Moneda, o ✅ Nada',
      { parse_mode: 'HTML', ...getEditKb() }
    );
    return ctx.wizard.selectStep(7);
  }
);

module.exports = tarjetaWizard;

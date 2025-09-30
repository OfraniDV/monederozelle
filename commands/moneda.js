// commands/moneda.js
const { Scenes, Markup } = require('telegraf');
const pool = require('../psql/db.js'); // tu Pool de PostgreSQL
const { handleGlobalCancel } = require('../helpers/wizardCancel');

/* Botón cancelar / salir */
const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('↩️ Cancelar', 'GLOBAL_CANCEL')]]);

/* ------------------------------------------------------------------ *
 *  WIZARD 1 : CREAR MONEDA                                           *
 * ------------------------------------------------------------------ */
const crearMonedaWizard = new Scenes.WizardScene(
  'MONEDA_CREATE_WIZ',
  async (ctx) => {
    console.log('[MONEDA_CREATE_WIZ] Paso 0: pedir código');
    await ctx.reply(
      '🪙 Código de la nueva moneda (ej: USD, CUP, SM):\n(Escribe "salir" o "/cancel" para cancelar)',
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_CREATE_WIZ] Paso 1: recibí código:', ctx.message?.text);
    const codigo = (ctx.message?.text || '').trim().toUpperCase();
    if (!codigo) {
      await ctx.reply('Código inválido. Escribe "salir" para cancelar.');
      return; // se queda en el mismo paso
    }
    ctx.wizard.state.data = { codigo };
    await ctx.reply('📛 Nombre descriptivo (ej: Dólar estadounidense):', cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_CREATE_WIZ] Paso 2: recibí nombre:', ctx.message?.text);
    const nombre = (ctx.message?.text || '').trim();
    if (!nombre) {
      await ctx.reply('Nombre inválido. Escribe "salir" para cancelar.');
      return;
    }
    ctx.wizard.state.data.nombre = nombre;
    await ctx.reply(
      '💱 ¿Cuántas unidades equivalen a 1 USD? (ej: 420 para CUP, 1 para USD)',
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_CREATE_WIZ] Paso 3: recibí unidades por USD:', ctx.message?.text);
    const num = parseFloat((ctx.message?.text || '').replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      await ctx.reply('Número inválido. Escribe "salir" para cancelar.');
      return;
    }
    ctx.wizard.state.data.tasa_usd = 1 / num; // guardamos “1 unidad en USD”
    await ctx.reply('😀 Emoji representativo (opcional, envía vacío si no):', cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_CREATE_WIZ] Paso 4: recibí emoji:', ctx.message?.text);
    const emoji = (ctx.message?.text || '').trim();
    const { codigo, nombre, tasa_usd } = ctx.wizard.state.data;
    try {
      await pool.query(
        'INSERT INTO moneda(codigo,nombre,tasa_usd,emoji) VALUES($1,$2,$3,$4)',
        [codigo, nombre, tasa_usd, emoji]
      );
      await ctx.reply(`✅ Creada: ${emoji ? emoji + ' ' : ''}${codigo} — ${nombre}`);
    } catch (e) {
      console.error('Error creando moneda:', e);
      await ctx.reply('❌ Error: tal vez ese código ya existe.');
    }
    return ctx.scene.leave();
  }
);

/* ------------------------------------------------------------------ *
 *  WIZARD 2 : EDITAR MONEDA                                          *
 * ------------------------------------------------------------------ */
const editarMonedaWizard = new Scenes.WizardScene(
  'MONEDA_EDIT_WIZ',
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_EDIT_WIZ] Paso 0: iniciar edición');
    const m = ctx.scene.state.edit;
    if (!m) return ctx.scene.leave();
    ctx.wizard.state.data = { ...m }; // id, codigo, nombre, tasa_usd, emoji
    await ctx.reply(`✏️ Código (actual: ${m.codigo}):`, cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_EDIT_WIZ] Paso 1: posible código nuevo:', ctx.message?.text);
    const codigo = (ctx.message?.text || '').trim().toUpperCase();
    if (codigo) ctx.wizard.state.data.codigo = codigo;
    await ctx.reply(`📛 Nombre (actual: ${ctx.wizard.state.data.nombre}):`, cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_EDIT_WIZ] Paso 2: posible nombre nuevo:', ctx.message?.text);
    const nombre = (ctx.message?.text || '').trim();
    if (nombre) ctx.wizard.state.data.nombre = nombre;
    const unidades = (1 / ctx.wizard.state.data.tasa_usd).toFixed(2);
    await ctx.reply(
      `💱 Unidades que equivalen a 1 USD (actual: ${unidades}):`,
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_EDIT_WIZ] Paso 3: recibir unidades por USD:', ctx.message?.text);
    const num = parseFloat((ctx.message?.text || '').replace(',', '.'));
    if (!isNaN(num) && num > 0) ctx.wizard.state.data.tasa_usd = 1 / num;
    await ctx.reply(
      `😀 Emoji (actual: ${ctx.wizard.state.data.emoji || '(ninguno)'}):`,
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[MONEDA_EDIT_WIZ] Paso 4: recibir emoji final:', ctx.message?.text);
    const emoji = (ctx.message?.text || '').trim();
    if (emoji !== '') ctx.wizard.state.data.emoji = emoji;
    const { id, codigo, nombre, tasa_usd, emoji: em } = ctx.wizard.state.data;
    try {
      await pool.query(
        'UPDATE moneda SET codigo=$1,nombre=$2,tasa_usd=$3,emoji=$4 WHERE id=$5',
        [codigo, nombre, tasa_usd, em, id]
      );
      await ctx.reply(`✅ Actualizada: ${em ? em + ' ' : ''}${codigo} — ${nombre}`);
    } catch (e) {
      console.error('Error actualizando moneda:', e);
      await ctx.reply('❌ Error al actualizar.');
    }
    return ctx.scene.leave();
  }
);

/* ------------------------------------------------------------------ *
 *  REGISTRO DE COMANDOS Y ACCIONES                                   *
 * ------------------------------------------------------------------ */
const registerMoneda = (bot, stage) => {
  stage.register(crearMonedaWizard);
  stage.register(editarMonedaWizard);

  bot.command('monedas', async (ctx) => {
    console.log('[monedas] listado solicitado');
    const rows = (await pool.query('SELECT id,codigo,nombre,emoji FROM moneda ORDER BY codigo')).rows;

    if (!rows.length) {
      return ctx.reply(
        'No hay monedas aún.',
        Markup.inlineKeyboard([[Markup.button.callback('➕ Añadir moneda', 'MONEDA_CREATE')]])
      );
    }

    const listado = rows
      .map((r) => `${r.emoji ? r.emoji + ' ' : ''}${r.codigo} — ${r.nombre}`)
      .join('\n');

    const kb = rows.map((r) => [
      Markup.button.callback(`✏️ ${r.codigo}`, `MONEDA_EDIT_${r.id}`),
      Markup.button.callback('🗑️', `MONEDA_DEL_${r.id}`)
    ]);
    kb.push([Markup.button.callback('➕ Añadir moneda', 'MONEDA_CREATE')]);

    await ctx.reply(`Monedas:\n${listado}`, Markup.inlineKeyboard(kb));
  });

  bot.action('MONEDA_CREATE', (ctx) => {
    console.log('[action] MONEDA_CREATE');
    ctx.answerCbQuery().catch(() => {});
    ctx.scene.enter('MONEDA_CREATE_WIZ');
  });

  bot.action(/^MONEDA_EDIT_(\d+)$/, async (ctx) => {
    console.log('[action] MONEDA_EDIT', ctx.match);
    ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    const res = await pool.query('SELECT * FROM moneda WHERE id=$1', [id]);
    if (!res.rows.length) return ctx.reply('No encontrada.');
    ctx.scene.enter('MONEDA_EDIT_WIZ', { edit: res.rows[0] });
  });

  bot.action(/^MONEDA_DEL_(\d+)$/, async (ctx) => {
    console.log('[action] MONEDA_DEL', ctx.match);
    ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    let msg = `¿Eliminar moneda ID ${id}?`;
    try {
      const dep = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM tarjeta WHERE moneda_id=$1) AS tarjetas,
           (SELECT COUNT(*) FROM movimiento m
              JOIN tarjeta t ON m.tarjeta_id=t.id
            WHERE t.moneda_id=$1) AS movimientos`,
        [id]
      );
      const { tarjetas, movimientos } = dep.rows[0];
      if (tarjetas > 0 || movimientos > 0) {
        msg = `⚠️ Esta moneda está asociada a ${tarjetas} tarjeta(s) y ${movimientos} movimiento(s). ` +
              'Si la eliminas, se borrarán estas informaciones. ¿Continuar?';
      }
    } catch (e) {
      console.error('[action] MONEDA_DEL dependency check error:', e);
    }
    ctx.reply(
      msg,
      Markup.inlineKeyboard([
        Markup.button.callback('Sí', `MONEDA_DEL_OK_${id}`),
        Markup.button.callback('Salir', 'GLOBAL_CANCEL')
      ])
    );
  });

  bot.action(/^MONEDA_DEL_OK_(\d+)$/, async (ctx) => {
    console.log('[action] MONEDA_DEL_OK', ctx.match);
    ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    try {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM tarjeta WHERE moneda_id=$1', [id]);
      await pool.query('DELETE FROM moneda WHERE id=$1', [id]);
      await pool.query('COMMIT');
      await ctx.reply('✅ Moneda eliminada.');
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('Error eliminando moneda:', e);
      await ctx.reply('❌ No se pudo eliminar.');
    }
  });

};

module.exports = registerMoneda;

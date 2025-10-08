// commands/banco.js
const { Scenes, Markup } = require('telegraf');
const pool = require('../psql/db.js'); // asegúrate de que psql/db.js exporte el Pool
const { handleGlobalCancel } = require('../helpers/wizardCancel');
const { withExitHint } = require('../helpers/ui');

/* Tecla de cancelar / salir */
const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]]);

// ---------------------- WIZARD: crear banco ----------------------
const crearBancoWizard = new Scenes.WizardScene(
  'BANCO_CREATE_WIZ',
  // Paso 0: pedir código
  async (ctx) => {
    console.log('[BANCO_CREATE_WIZ] Paso 0: pedir código');
    await ctx.reply(
      withExitHint(
        '🏦 Ingresa el código identificador del banco (ej: BANDEC, BPA):\n(Escribe "salir" o "/cancel" para cancelar)'
      ),
      cancelKb
    );
    return ctx.wizard.next();
  },
  // Paso 1: recibir código
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_CREATE_WIZ] Paso 1: recibí código:', ctx.message?.text);
    const codigo = (ctx.message?.text || '').trim().toUpperCase();
    if (!codigo) {
      await ctx.reply('Código inválido. Intenta de nuevo o escribe "salir" para cancelar.');
      return;
    }
    ctx.wizard.state.data = { codigo };
    await ctx.reply(withExitHint('📛 Nombre legible del banco (ej: BANDEC Oficial):'), cancelKb);
    return ctx.wizard.next();
  },
  // Paso 2: recibir nombre
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_CREATE_WIZ] Paso 2: recibí nombre:', ctx.message?.text);
    const nombre = (ctx.message?.text || '').trim();
    if (!nombre) {
      await ctx.reply('Nombre inválido. Intenta de nuevo o escribe "salir" para cancelar.');
      return;
    }
    ctx.wizard.state.data.nombre = nombre;
    await ctx.reply(withExitHint('😀 Emoji representativo del banco (puedes dejarlo vacío):'), cancelKb);
    return ctx.wizard.next();
  },
  // Paso 3: recibir emoji y crear
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_CREATE_WIZ] Paso 3: recibí emoji:', ctx.message?.text);
    const emoji = (ctx.message?.text || '').trim();
    const { codigo, nombre } = ctx.wizard.state.data;
    try {
      await pool.query(
        `INSERT INTO banco(codigo, nombre, emoji)
         VALUES($1,$2,$3)
         ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre, emoji=EXCLUDED.emoji`,
        [codigo, nombre, emoji]
      );
      console.log('[BANCO_CREATE_WIZ] Banco creado/actualizado en DB:', codigo, nombre, emoji);
      await ctx.reply(`✅ Banco creado/actualizado: ${emoji ? emoji + ' ' : ''}${codigo} — ${nombre}`);
    } catch (e) {
      console.error('[BANCO_CREATE_WIZ] Error creando banco:', e);
      await ctx.reply('❌ Error al crear el banco.');
    }
    return ctx.scene.leave();
  }
);

// ---------------------- WIZARD: editar banco ----------------------
const editarBancoWizard = new Scenes.WizardScene(
  'BANCO_EDIT_WIZ',
  // Paso 0: iniciar edición mostrando actual
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_EDIT_WIZ] Paso 0: iniciar edición');
    const edit = ctx.scene.state?.edit;
    if (!edit) {
      console.error('[BANCO_EDIT_WIZ] No se proporcionó banco para editar');
      await ctx.reply('Error interno: no se recibió el banco a editar.');
      return ctx.scene.leave();
    }
    ctx.wizard.state.data = {
      id: edit.id,
      codigo: edit.codigo,
      nombre: edit.nombre,
      emoji: edit.emoji || '',
    };
    await ctx.reply(withExitHint(`✏️ Código del banco (actual: ${edit.codigo}):`), cancelKb);
    return ctx.wizard.next();
  },
  // Paso 1: nuevo código
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_EDIT_WIZ] Paso 1: recibí nuevo código:', ctx.message?.text);
    const input = (ctx.message?.text || '').trim().toUpperCase();
    if (input) ctx.wizard.state.data.newCodigo = input;
    await ctx.reply(
      withExitHint(`📛 Nombre del banco (actual: ${ctx.wizard.state.data.nombre}):`),
      cancelKb
    );
    return ctx.wizard.next();
  },
  // Paso 2: nuevo nombre
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_EDIT_WIZ] Paso 2: recibí nuevo nombre:', ctx.message?.text);
    const input = (ctx.message?.text || '').trim();
    if (input) ctx.wizard.state.data.newNombre = input;
    await ctx.reply(
      withExitHint(`😀 Emoji del banco (actual: ${ctx.wizard.state.data.emoji || '(ninguno)'}):`),
      cancelKb
    );
    return ctx.wizard.next();
  },
  // Paso 3: emoji y aplicar actualización
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    console.log('[BANCO_EDIT_WIZ] Paso 3: recibí emoji:', ctx.message?.text);
    const emojiInput = (ctx.message?.text || '').trim();
    const state = ctx.wizard.state.data;

    const finalCodigo = state.newCodigo || state.codigo;
    const finalNombre = state.newNombre || state.nombre;
    const finalEmoji = emojiInput !== '' ? emojiInput : state.emoji;

    try {
      await pool.query(
        `UPDATE banco SET codigo=$1, nombre=$2, emoji=$3 WHERE id=$4`,
        [finalCodigo, finalNombre, finalEmoji, state.id]
      );
      console.log('[BANCO_EDIT_WIZ] Banco actualizado en DB:', finalCodigo, finalNombre, finalEmoji);
      await ctx.reply(
        `✅ Banco actualizado: ${finalEmoji ? finalEmoji + ' ' : ''}${finalCodigo} — ${finalNombre}`
      );
    } catch (e) {
      console.error('[BANCO_EDIT_WIZ] Error actualizando banco:', e);
      await ctx.reply('❌ Error al actualizar el banco.');
    }
    return ctx.scene.leave();
  }
);

// ---------------------- Registro y manejo de comandos ----------------------
const registerBanco = (bot, stage) => {
  console.log('[registerBanco] Registrando wizards y comandos para banco');
  stage.register(crearBancoWizard);
  stage.register(editarBancoWizard);

  bot.command('bancos', async (ctx) => {
    console.log('[bancos] Comando recibido');
    try {
      const rows = (await pool.query('SELECT id, codigo, nombre, emoji FROM banco ORDER BY codigo')).rows;
      console.log('[bancos] Filas obtenidas:', rows.length);
      if (!rows.length) {
        await ctx.reply(
          withExitHint('No hay bancos registrados aún.'),
          Markup.inlineKeyboard([
            [Markup.button.callback('➕ Añadir banco', 'BANCO_CREATE')],
            [Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')],
          ])
        );
        return;
      }

      const listado = rows
        .map((b) => {
          const em = b.emoji ? `${b.emoji} ` : '';
          return `• ${em}${b.codigo} — ${b.nombre}`;
        })
        .join('\n');

      const keyboard = rows.map((b) => [
        Markup.button.callback(`✏️ ${b.codigo}`, `BANCO_EDIT_${b.id}`),
        Markup.button.callback('🗑️', `BANCO_DEL_${b.id}`),
      ]);
      keyboard.push([Markup.button.callback('➕ Añadir banco', 'BANCO_CREATE')]);
      keyboard.push([Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]);

      await ctx.reply(withExitHint(`Bancos:\n${listado}`), Markup.inlineKeyboard(keyboard));
    } catch (e) {
      console.error('[bancos] Error listando bancos:', e);
      await ctx.reply('❌ Ocurrió un error al listar los bancos.');
    }
  });

  // acciones (no usar bot.on)
  bot.action('BANCO_CREATE', async (ctx) => {
    console.log('[action] BANCO_CREATE recibido');
    await ctx.answerCbQuery().catch(() => {});
    return ctx.scene.enter('BANCO_CREATE_WIZ');
  });

  bot.action(/^BANCO_EDIT_(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    console.log('[action] BANCO_EDIT recibido para id=', id);
    await ctx.answerCbQuery().catch(() => {});
    try {
      const res = await pool.query('SELECT * FROM banco WHERE id=$1', [id]);
      if (!res.rows.length) {
        await ctx.reply('No se encontró ese banco.');
        return;
      }
      return ctx.scene.enter('BANCO_EDIT_WIZ', { edit: res.rows[0] });
    } catch (e) {
      console.error('[action] Error obteniendo banco para editar:', e);
      await ctx.reply('❌ Error al obtener el banco.');
    }
  });

  bot.action(/^BANCO_DEL_(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    console.log('[action] BANCO_DEL solicitud para id=', id);
    await ctx.answerCbQuery().catch(() => {});
    let msg = `¿Eliminar el banco con ID ${id}?`;
    try {
      const dep = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM tarjeta WHERE banco_id=$1) AS tarjetas,
           (SELECT COUNT(*) FROM movimiento m
              JOIN tarjeta t ON m.tarjeta_id=t.id
            WHERE t.banco_id=$1) AS movimientos`,
        [id]
      );
      const { tarjetas, movimientos } = dep.rows[0];
      if (tarjetas > 0 || movimientos > 0) {
        msg = `⚠️ Este banco tiene ${tarjetas} tarjeta(s) y ${movimientos} movimiento(s) asociados. ` +
              'Si lo eliminas, se borrarán estas informaciones. ¿Continuar?';
      }
    } catch (e) {
      console.error('[action] BANCO_DEL dependency check error:', e);
    }
    await ctx.reply(
      msg,
      Markup.inlineKeyboard([
        Markup.button.callback('Sí, eliminar', `BANCO_DEL_CONF_${id}`),
        Markup.button.callback('Cancelar', 'BANCO_CANCEL'),
      ])
    );
  });

  bot.action(/^BANCO_DEL_CONF_(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    console.log('[action] BANCO_DEL_CONF para id=', id);
    await ctx.answerCbQuery().catch(() => {});
    try {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM tarjeta WHERE banco_id=$1', [id]);
      await pool.query('DELETE FROM banco WHERE id=$1', [id]);
      await pool.query('COMMIT');
      await ctx.reply('✅ Banco eliminado.');
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('[action] Error eliminando banco:', e);
      await ctx.reply('❌ No se pudo eliminar el banco.');
    }
  });

  bot.action('BANCO_CANCEL', async (ctx) => {
    console.log('[action] BANCO_CANCEL recibido');
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.scene?.current) {
      await ctx.scene.leave();
    }
    await ctx.reply('Operación cancelada.');
  });

  // soporte global de salir para wizards si alguien escribe /cancel o salir
  bot.use(async (ctx, next) => {
    if (ctx.message?.text) {
      const t = ctx.message.text.trim().toLowerCase();
      if ((t === '/cancel' || t === 'salir' || t === '/salir') && ctx.scene?.current) {
        console.log('[global exit] saliendo de wizard por texto:', t);
        await ctx.reply('❌ Operación cancelada.');
        return ctx.scene.leave();
      }
    }
    return next();
  });
};

module.exports = registerBanco;

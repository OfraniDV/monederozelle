// commands/agente.js
const { Scenes, Markup } = require('telegraf');
const pool = require('../psql/db.js'); // tu Pool de PostgreSQL

/* Tecla de cancelar / salir para wizards */
const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('↩️ Cancelar', 'GLOBAL_CANCEL')]]);

/**
 * Revisa si el usuario quiere salir (/cancel, salir, /salir) o pulsó el botón.
 * Si es así, abandona la escena y responde.
 * @returns {Promise<boolean>} true si se salió y no debe continuar.
 */
async function checkExit(ctx) {
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
    if (t === '/cancel' || t === 'salir' || t === '/salir') {
      if (ctx.scene?.current) {
        await ctx.scene.leave();
        await ctx.reply('❌ Operación cancelada.');
        return true;
      }
    }
  }
  return false;
}

// ---------------------- WIZARD: crear agente ----------------------
const crearAgenteWizard = new Scenes.WizardScene(
  'AGENTE_CREATE_WIZ',
  async (ctx) => {
    console.log('[AGENTE_CREATE_WIZ] Paso 0: pedir nombre');
    await ctx.reply(
      'Nombre del agente:\n(Escribe "salir" o "/cancel" para cancelar)',
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await checkExit(ctx)) return;
    console.log('[AGENTE_CREATE_WIZ] Paso 1: recibí nombre:', ctx.message?.text);
    const nombre = (ctx.message?.text || '').trim();
    if (!nombre) {
      await ctx.reply('Nombre inválido. Cancelado.');
      return ctx.scene.leave();
    }
    try {
      const res = await pool.query(
        'INSERT INTO agente(nombre) VALUES($1) ON CONFLICT (nombre) DO NOTHING RETURNING id',
        [nombre]
      );
      if (res.rows.length) {
        await ctx.reply('✅ Agente creado.');
      } else {
        await ctx.reply('✅ El agente ya existía (no se duplicó).');
      }
    } catch (e) {
      console.error('[AGENTE_CREATE_WIZ] Error creando agente:', e);
      await ctx.reply('❌ Error al crear el agente.');
    }
    return ctx.scene.leave();
  }
);

// ---------------------- WIZARD: editar agente ----------------------
const editarAgenteWizard = new Scenes.WizardScene(
  'AGENTE_EDIT_WIZ',
  async (ctx) => {
    if (await checkExit(ctx)) return;
    console.log('[AGENTE_EDIT_WIZ] Paso 0: iniciar edición');
    const edit = ctx.scene.state?.edit;
    if (!edit) {
      await ctx.reply('Error interno: no se recibió el agente a editar.');
      return ctx.scene.leave();
    }
    ctx.wizard.state.data = {
      id: edit.id,
      nombre: edit.nombre,
    };
    await ctx.reply(`✏️ Nombre del agente (actual: ${edit.nombre}):`, cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await checkExit(ctx)) return;
    console.log('[AGENTE_EDIT_WIZ] Paso 1: nuevo nombre:', ctx.message?.text);
    const nuevo = (ctx.message?.text || '').trim();
    if (!nuevo) {
      await ctx.reply('Nombre inválido. Cancelado.');
      return ctx.scene.leave();
    }
    const { id } = ctx.wizard.state.data;
    try {
      await pool.query('UPDATE agente SET nombre=$1 WHERE id=$2', [nuevo, id]);
      await ctx.reply('✅ Agente actualizado.');
    } catch (e) {
      if (e.code === '23505') {
        await ctx.reply('❌ Ese nombre ya está en uso.');
      } else {
        console.error('[AGENTE_EDIT_WIZ] Error actualizando agente:', e);
        await ctx.reply('❌ Error al actualizar el agente.');
      }
    }
    return ctx.scene.leave();
  }
);

// ---------------------- Registro y manejo de comandos ----------------------
const registerAgente = (bot, stage) => {
  stage.register(crearAgenteWizard);
  stage.register(editarAgenteWizard);

  bot.command('agentes', async (ctx) => {
    console.log('[agentes] listado solicitado');
    try {
      const rows = (await pool.query('SELECT id, nombre FROM agente ORDER BY nombre')).rows;
      const txt = rows.length ? rows.map(a => `• ${a.nombre}`).join('\n') : 'No hay agentes registrados aún.';
      const kb = rows.map(a => [
        Markup.button.callback(`✏️ ${a.nombre}`, `AGENTE_EDIT_${a.id}`),
        Markup.button.callback('🗑️', `AGENTE_DEL_${a.id}`)
      ]);
      kb.push([Markup.button.callback('➕ Añadir', 'AGENTE_ADD')]);
      await ctx.reply(txt, Markup.inlineKeyboard(kb));
    } catch (e) {
      console.error('[agentes] Error listando agentes:', e);
      await ctx.reply('❌ Ocurrió un error al listar los agentes.');
    }
  });

  // acciones
  bot.action('AGENTE_ADD', async (ctx) => {
    console.log('[action] AGENTE_ADD');
    await ctx.answerCbQuery().catch(() => {});
    return ctx.scene.enter('AGENTE_CREATE_WIZ');
  });

  bot.action(/^AGENTE_EDIT_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_EDIT', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    try {
      const res = await pool.query('SELECT * FROM agente WHERE id=$1', [id]);
      if (!res.rows.length) {
        await ctx.reply('No se encontró ese agente.');
        return;
      }
      return ctx.scene.enter('AGENTE_EDIT_WIZ', { edit: res.rows[0] });
    } catch (e) {
      console.error('[action] AGENTE_EDIT error fetching:', e);
      await ctx.reply('❌ Error al obtener el agente.');
    }
  });

  bot.action(/^AGENTE_DEL_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_DEL', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    await ctx.reply(
      `¿Eliminar el agente con ID ${id}?`,
      Markup.inlineKeyboard([
        Markup.button.callback('Sí, eliminar', `AGENTE_DEL_CONF_${id}`),
        Markup.button.callback('Cancelar', 'AGENTE_CANCEL')
      ])
    );
  });

  bot.action(/^AGENTE_DEL_CONF_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_DEL_CONF', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    try {
      await pool.query('DELETE FROM agente WHERE id=$1', [id]);
      await ctx.reply('✅ Agente eliminado.');
    } catch (e) {
      console.error('[action] AGENTE_DEL_CONF error:', e);
      await ctx.reply('❌ No se pudo eliminar el agente.');
    }
  });

  bot.action('AGENTE_CANCEL', async (ctx) => {
    console.log('[action] AGENTE_CANCEL');
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.scene?.current) await ctx.scene.leave();
    await ctx.reply('Operación cancelada.');
  });

  // soporte global para salir de cualquier wizard de agente escribiendo salir o /cancel
  bot.use(async (ctx, next) => {
    if (ctx.message?.text) {
      const t = ctx.message.text.trim().toLowerCase();
      if ((t === '/cancel' || t === 'salir' || t === '/salir') && ctx.scene?.current) {
        console.log('[global exit agente] saliendo de wizard por texto:', t);
        await ctx.reply('❌ Operación cancelada.');
        return ctx.scene.leave();
      }
    }
    return next();
  });
};

module.exports = registerAgente;

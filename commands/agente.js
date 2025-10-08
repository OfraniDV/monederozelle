// commands/agente.js
const { Scenes, Markup } = require('telegraf');
const pool = require('../psql/db.js'); // tu Pool de PostgreSQL
const { escapeHtml } = require('../helpers/format');
const { renderWizardMenu, clearWizardMenu, withExitHint } = require('../helpers/ui');
const { handleGlobalCancel, registerCancelHooks } = require('../helpers/wizardCancel');
const { enterAssistMenu } = require('../helpers/assistMenu');

/* Tecla de cancelar / salir para wizards */
const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]]);

async function fetchAgentsList() {
  const res = await pool.query('SELECT id,nombre,emoji FROM agente ORDER BY nombre');
  return res.rows;
}

function buildAgentsText(rows = []) {
  if (!rows.length) {
    return 'No hay agentes registrados aún.';
  }
  return rows
    .map((a) => `• ${a.emoji ? `${escapeHtml(a.emoji)} ` : ''}${escapeHtml(a.nombre)}`)
    .join('\n');
}

function buildAgentsKeyboard(rows = [], { includeExit = false, includeRefresh = false } = {}) {
  const kb = rows.map((a) => [
    Markup.button.callback(`✏️ ${a.nombre}`, `AGENTE_EDIT_${a.id}`),
    Markup.button.callback('🗑️', `AGENTE_DEL_${a.id}`),
  ]);
  kb.push([Markup.button.callback('➕ Añadir', 'AGENTE_ADD')]);
  if (includeRefresh) {
    kb.push([Markup.button.callback('🔄 Actualizar', 'AGENTE_REFRESH')]);
  }
  if (includeExit) {
    kb.push([Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]);
  }
  return kb;
}

async function renderAgentWizardMenu(ctx, { pushHistory = true } = {}) {
  const rows = await fetchAgentsList();
  const text = withExitHint(
    '🧑‍💼 <b>Gestor de agentes</b>\n\n' +
      buildAgentsText(rows) +
      '\n\nPulsa un agente para editar o eliminar.'
  );
  await renderWizardMenu(ctx, {
    route: 'LIST',
    text,
    extra: { reply_markup: { inline_keyboard: buildAgentsKeyboard(rows, { includeExit: true, includeRefresh: true }) } },
    pushHistory,
  });
}

async function handleAgentEdit(ctx, id) {
  try {
    const res = await pool.query('SELECT * FROM agente WHERE id=$1', [id]);
    if (!res.rows.length) {
      await ctx.reply('No se encontró ese agente.');
      return;
    }
    await clearWizardMenu(ctx);
    return ctx.scene.enter('AGENTE_EDIT_WIZ', { edit: res.rows[0] });
  } catch (e) {
    console.error('[agente] Error obteniendo agente para edición:', e);
    await ctx.reply('❌ Error al obtener el agente.');
  }
}

async function handleAgentDeletePrompt(ctx, id) {
  let msg = `¿Eliminar el agente con ID ${id}?`;
  try {
    const dep = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tarjeta WHERE agente_id=$1) AS tarjetas,
         (SELECT COUNT(*) FROM movimiento m
            JOIN tarjeta t ON m.tarjeta_id=t.id
          WHERE t.agente_id=$1) AS movimientos`,
      [id],
    );
    const { tarjetas, movimientos } = dep.rows[0];
    if (tarjetas > 0 || movimientos > 0) {
      msg =
        `⚠️ Este agente tiene ${tarjetas} tarjeta(s) y ${movimientos} movimiento(s) asociados. ` +
        'Si lo eliminas, se borrarán esas informaciones. ¿Continuar?';
    }
  } catch (e) {
    console.error('[agente] Error verificando dependencias:', e);
  }
  await ctx.reply(
    msg,
    Markup.inlineKeyboard([
      Markup.button.callback('Sí, eliminar', `AGENTE_DEL_CONF_${id}`),
      Markup.button.callback('Cancelar', 'AGENTE_CANCEL'),
    ]),
  );
}

async function handleAgentDeleteConfirm(ctx, id) {
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM tarjeta WHERE agente_id=$1', [id]);
    await pool.query('DELETE FROM agente WHERE id=$1', [id]);
    await pool.query('COMMIT');
    await ctx.reply('✅ Agente eliminado.');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('[agente] Error eliminando agente:', e);
    await ctx.reply('❌ No se pudo eliminar el agente.');
    return;
  }
  if (ctx.scene?.current?.id === 'AGENTE_WIZ') {
    await renderAgentWizardMenu(ctx, { pushHistory: false });
  }
}

async function handleAgentCancel(ctx) {
  if (ctx.scene?.current?.id === 'AGENTE_WIZ') {
    await clearWizardMenu(ctx);
    ctx.wizard.state.nav = { stack: [] };
    await ctx.reply('Operación cancelada.');
    await renderAgentWizardMenu(ctx, { pushHistory: false });
    return;
  }
  if (ctx.scene?.current) await ctx.scene.leave();
  await ctx.reply('Operación cancelada.');
}

const agenteWizard = new Scenes.WizardScene(
  'AGENTE_WIZ',
  async (ctx) => {
    ctx.wizard.state.nav = { stack: [] };
    await renderAgentWizardMenu(ctx, { pushHistory: false });
    registerCancelHooks(ctx, {
      beforeLeave: clearWizardMenu,
      afterLeave: enterAssistMenu,
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    if (data === 'AGENTE_REFRESH') {
      await ctx.answerCbQuery().catch(() => {});
      return renderAgentWizardMenu(ctx, { pushHistory: false });
    }
    if (data === 'AGENTE_ADD') {
      await ctx.answerCbQuery().catch(() => {});
      await clearWizardMenu(ctx);
      return ctx.scene.enter('AGENTE_CREATE_WIZ');
    }
    const editMatch = data.match(/^AGENTE_EDIT_(\d+)$/);
    if (editMatch) {
      await ctx.answerCbQuery().catch(() => {});
      return handleAgentEdit(ctx, Number(editMatch[1]));
    }
    const delMatch = data.match(/^AGENTE_DEL_(\d+)$/);
    if (delMatch) {
      await ctx.answerCbQuery().catch(() => {});
      return handleAgentDeletePrompt(ctx, Number(delMatch[1]));
    }
    const delConfMatch = data.match(/^AGENTE_DEL_CONF_(\d+)$/);
    if (delConfMatch) {
      await ctx.answerCbQuery().catch(() => {});
      return handleAgentDeleteConfirm(ctx, Number(delConfMatch[1]));
    }
  },
);

// ---------------------- WIZARD: crear agente ----------------------
const crearAgenteWizard = new Scenes.WizardScene(
  'AGENTE_CREATE_WIZ',
  async (ctx) => {
    console.log('[AGENTE_CREATE_WIZ] Paso 0: pedir nombre');
    await ctx.reply(
      withExitHint('Nombre del agente:\n(Escribe "salir" o "/cancel" para cancelar)'),
      cancelKb
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
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
    if (await handleGlobalCancel(ctx)) return;
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
    await ctx.reply(withExitHint(`✏️ Nombre del agente (actual: ${edit.nombre}):`), cancelKb);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await handleGlobalCancel(ctx)) return;
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
  stage.register(agenteWizard);
  stage.register(crearAgenteWizard);
  stage.register(editarAgenteWizard);

  bot.command('agentes', async (ctx) => {
    console.log('[agentes] listado solicitado');
    try {
      const rows = await fetchAgentsList();
      const text = '🧑‍💼 <b>Agentes</b>\n\n' + buildAgentsText(rows);
      const kb = buildAgentsKeyboard(rows);
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: kb },
      });
    } catch (e) {
      console.error('[agentes] Error listando agentes:', e);
      await ctx.reply('❌ Ocurrió un error al listar los agentes.');
    }
  });

  // acciones
  bot.action('AGENTE_ADD', async (ctx) => {
    console.log('[action] AGENTE_ADD');
    await ctx.answerCbQuery().catch(() => {});
    await clearWizardMenu(ctx);
    return ctx.scene.enter('AGENTE_CREATE_WIZ');
  });

  bot.action(/^AGENTE_EDIT_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_EDIT', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    return handleAgentEdit(ctx, id);
  });

  bot.action(/^AGENTE_DEL_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_DEL', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    return handleAgentDeletePrompt(ctx, id);
  });

  bot.action(/^AGENTE_DEL_CONF_(\d+)$/, async (ctx) => {
    console.log('[action] AGENTE_DEL_CONF', ctx.match);
    await ctx.answerCbQuery().catch(() => {});
    const id = +ctx.match[1];
    return handleAgentDeleteConfirm(ctx, id);
  });

  bot.action('AGENTE_CANCEL', async (ctx) => {
    console.log('[action] AGENTE_CANCEL');
    await ctx.answerCbQuery().catch(() => {});
    await handleAgentCancel(ctx);
  });
};

module.exports = registerAgente;

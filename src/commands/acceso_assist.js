/**
 * commands/acceso_assist.js
 *
 * Asistente para gestionar usuarios con acceso al bot.
 * Usa parse_mode HTML y sanitiza todo contenido dinámico con escapeHtml.
 * editIfChanged evita ediciones redundantes del mensaje.
 *
 * Flujo:
 * 1. Muestra listado de usuarios con opción para eliminar y añadir.
 * 2. Al seleccionar "Añadir" pide el ID del usuario y lo registra.
 * 3. El botón de salir está siempre disponible.
 */
const { Scenes, Markup } = require('telegraf');
const { escapeHtml } = require('../helpers/format');
const { editIfChanged } = require('../helpers/ui');
const {
  agregarUsuario,
  eliminarUsuario,
  usuarioExiste,
  listarUsuarios,
} = require('./usuariosconacceso');

/**
 * Maneja la salida universal del asistente.
 * @param {object} ctx Contexto de Telegraf.
 * @returns {Promise<boolean>} true si se salió del asistente.
 */
async function wantExit(ctx) {
  if (ctx.callbackQuery?.data === 'EXIT') {
    await ctx.answerCbQuery().catch(() => {});
    const msgId = ctx.wizard.state.msgId;
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msgId,
      undefined,
      '❌ Operación cancelada.',
      { parse_mode: 'HTML' }
    );
    await ctx.scene.leave();
    return true;
  }
  return false;
}

/**
 * Obtiene el nombre del usuario desde Telegram.
 * @param {object} ctx Contexto.
 * @param {string} id Telegram user id.
 * @returns {Promise<string>} Nombre amigable o el ID si no disponible.
 */
async function resolveName(ctx, id) {
  try {
    const chat = await ctx.telegram.getChat(id);
    return chat.first_name || chat.username || String(id);
  } catch (e) {
    return String(id);
  }
}

/**
 * Renderiza la lista de usuarios con acceso.
 * @param {object} ctx Contexto.
 */
async function showList(ctx) {
  const rows = await listarUsuarios();
  const names = await Promise.all(rows.map((r) => resolveName(ctx, r.user_id)));
  const keyboard = rows.map((r, i) => [
    Markup.button.callback(`👤 ${escapeHtml(names[i])} (${r.user_id})`, 'NOOP'),
    Markup.button.callback('🗑️', `DEL_${r.user_id}`),
  ]);
  const addLabel = rows.length ? '➕ Añadir' : '➕ Agregar';
  keyboard.push([Markup.button.callback(addLabel, 'ADD')]);
  keyboard.push([Markup.button.callback('❌ Salir', 'EXIT')]);
  const text = '🛂 <b>Usuarios con acceso</b>:';
  await editIfChanged(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
  ctx.wizard.state.route = 'LIST';
}

const accesoAssist = new Scenes.WizardScene(
  'ACCESO_ASSIST',
  async (ctx) => {
    const msg = await ctx.reply('Cargando…', { parse_mode: 'HTML' });
    ctx.wizard.state.msgId = msg.message_id;
    await showList(ctx);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (await wantExit(ctx)) return;
    const data = ctx.callbackQuery?.data;
    if (data) {
      await ctx.answerCbQuery().catch(() => {});
      if (data === 'ADD') {
        ctx.wizard.state.route = 'ADD';
        await editIfChanged(ctx, '🔑 Ingresa el <b>ID</b> del usuario:', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[Markup.button.callback('❌ Salir', 'EXIT')]] },
        });
        return;
      }
      if (data.startsWith('DEL_')) {
        const id = data.split('_')[1];
        await eliminarUsuario(id);
        await ctx.answerCbQuery('Eliminado').catch(() => {});
        return showList(ctx);
      }
      return;
    }
    if (ctx.message?.text && ctx.wizard.state.route === 'ADD') {
      const id = ctx.message.text.trim();
      if (!id) return;
      if (await usuarioExiste(id)) {
        await ctx.reply('ℹ️ Ese usuario ya tenía acceso.');
      } else {
        await agregarUsuario(id);
        await ctx.reply('✅ Acceso otorgado.');
      }
      return showList(ctx);
    }
  }
);

module.exports = accesoAssist;

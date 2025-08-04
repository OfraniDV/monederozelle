require('dotenv').config();
const { Telegraf } = require('telegraf');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('FATAL: BOT_TOKEN no está definido en .env. Abortando.');
  process.exit(1);
}

const bot = new Telegraf(token);

// Middleware: logging detallado + timing con alta resolución
bot.use(async (ctx, next) => {
  const start = process.hrtime.bigint();
  const userInfo = ctx.from
    ? `${ctx.from.id}${ctx.from.username ? `(@${ctx.from.username})` : ''}`
    : 'unknown_user';
  const chatInfo = ctx.chat ? `${ctx.chat.id}/${ctx.chat.type}` : 'unknown_chat';
  const payload =
    ctx.message?.text ??
    ctx.callbackQuery?.data ??
    (ctx.updateType ? `[${ctx.updateType}]` : '');

  try {
    await next();
  } finally {
    const diffMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `[${new Date().toISOString()}] ${userInfo} in ${chatInfo} "${payload}" → ${diffMs.toFixed(
        1
      )}ms`
    );
  }
});

// Controlador de errores global
bot.catch(async (err, ctx) => {
  // Log completo para diagnóstico
  console.error(
    `[${new Date().toISOString()}] Error en el bot (updateType=${ctx.updateType}):`,
    {
      error: err?.stack || err,
      user: ctx.from ? { id: ctx.from.id, username: ctx.from.username } : null,
      chat: ctx.chat ? { id: ctx.chat.id, type: ctx.chat.type } : null,
      update: ctx.update,
    }
  );

  // Intentar notificar al usuario, pero no fallar si no se puede
  try {
    await ctx.reply('⚠️ Ocurrió un error interno. Por favor inténtalo de nuevo más tarde.');
  } catch (e) {
    console.warn('No se pudo enviar el mensaje de error al usuario:', e);
  }
});

// Comando auxiliar de salud/respuesta rápida
bot.command('ping', async (ctx) => {
  const t0 = Date.now();
  try {
    await ctx.reply('pong');
    const latency = Date.now() - t0;
    // opcionalmente editar o enviar otro mensaje con la latencia
    await ctx.reply(`🏓 Latencia: ${latency}ms`);
  } catch (e) {
    console.error('Error en /ping:', e);
  }
});

module.exports = bot;

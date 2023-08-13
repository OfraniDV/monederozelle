require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware
bot.use(async (ctx, next) => {
  const startTime = new Date();
  await next();
  const responseTime = new Date() - startTime;
  console.log(`Tiempo de respuesta: ${responseTime}ms`);
});

// Controlador de errores
bot.catch((err, ctx) => {
  console.error(`Error en el bot: ${err}`);
  ctx.reply('Ocurrió un error, por favor inténtalo de nuevo.');
});

module.exports = bot;
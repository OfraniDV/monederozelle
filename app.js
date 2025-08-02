/****************************************************************************************
 * app.js — bot completo con control de acceso y manejo de errores en **TODOS** los
 *          comandos (legacy + nuevos asistentes).
 *---------------------------------------------------------------------------------------
 *  Requiere:
 *   - ./bot.js        → instancia de Telegraf( token )
 *   - ./psql/*        → pool de PostgreSQL y esquema
 *   - ./commands/*    → todos los módulos de comandos y wizards
 ****************************************************************************************/
require('dotenv').config();
const { Scenes, session } = require('telegraf');

/* ───────── 1. Bot base ───────── */
const bot = require('./bot');

/* ───────── 2. Base de datos (tablas) ───────── */
const crearTablaUsuarios = require('./psql/tablausuarios');
const initWalletSchema   = require('./psql/initWalletSchema');

/* ───────── 3. Legacy commands (monotabla) ───────── */
const crearCuenta    = require('./commands/crearcuenta');
const listarCuentas  = require('./commands/cuentas');
const eliminarCuenta = require('./commands/eliminarcuentas');
const agregarCredito = require('./commands/credito');
const agregarDebito  = require('./commands/debito');
const resumirCuenta  = require('./commands/resumen');
const resumenTotal   = require('./commands/resumentotal');
const comandosMeta   = require('./commands/comandos');

/* ───────── 4. Control de accesos ───────── */
const {
  agregarUsuario,
  eliminarUsuario,
  usuarioExiste,
} = require('./commands/usuariosconacceso');

/* ───────── 5. Nuevo sistema (wizards) ───────── */
const registerMoneda  = require('./commands/moneda');
const registerBanco   = require('./commands/banco');
const registerAgente  = require('./commands/agente');
const tarjetaWizard   = require('./commands/tarjeta_wizard');
const listarTarjetas  = require('./commands/tarjetas');
const saldoWizard     = require('./commands/saldo');
const { registerMonitor } = require('./commands/monitor');

/* ───────── 6. Inicializar BD (idempotente) ───────── */
(async () => {
  await crearTablaUsuarios();
  await initWalletSchema();
})();

/* ───────── 7. Scenes / Stage ───────── */
const stage = new Scenes.Stage([tarjetaWizard, saldoWizard], { ttl: 300 });
bot.use(session());
bot.use(stage.middleware());

/* Wizards que se auto-registran en el stage */
registerMoneda(bot, stage);
registerBanco(bot, stage);
registerAgente(bot, stage);
registerMonitor(bot);  

/* ───────── 8. Middleware de verificación de acceso ───────── */
const verificarAcceso = async (ctx, next) => {
  /* /start siempre disponible                                                    */
  if (ctx.updateType === 'message' && ctx.message.text?.startsWith('/start')) {
    return next();
  }

  const uid = ctx.from?.id?.toString() || '0';
  const esOwner  = uid === process.env.OWNER_ID;
  const permitido = esOwner || (await usuarioExiste(uid));

  console.log(`🛂 acceso uid:${uid} permitido:${permitido}`);
  if (!permitido) return ctx.reply('🚫 No tienes permiso para usar el bot.');

  return next();
};

/* EL ORDEN IMPORTA: todo lo que viene después requerirá permiso */
bot.use(verificarAcceso);

/* ───────── 9. Helpers para envolver comandos con try/catch ───────── */
const safe = (fn) => async (ctx) => {
  try { await fn(ctx); } catch (e) {
    console.error('[ERROR]', e);
    ctx.reply('⚠️ Ocurrió un error, intenta de nuevo.');
  }
};

/* ───────── 10. Comando /start ───────── */
bot.command('start', (ctx) => {
  const nombre = ctx.from.first_name || 'Usuario';
  ctx.reply(`¡Hola, ${nombre}! 🤖`);
});

/* ───────── 11. Legacy commands (protegidos) ───────── */
bot.command('comandos',      safe((ctx) => {
  let msg = '📜 *Comandos disponibles*\n\n';
  comandosMeta.forEach(c => {
    msg += `• *${c.nombre}* — ${c.descripcion}\n  _${c.uso}_\n\n`;
  });
  ctx.reply(msg, { parse_mode: 'Markdown' });
}));
bot.command('crearcuenta',    safe(crearCuenta));
bot.command('miscuentas',     safe(listarCuentas));
bot.command('eliminarcuenta', safe(eliminarCuenta));
bot.command('credito',        safe(agregarCredito));
bot.command('debito',         safe(agregarDebito));
bot.command('resumen',        safe(resumirCuenta));
bot.command('resumentotal',   safe(resumenTotal));

/* ───────── 12. Nuevos comandos (wizards) ───────── */
bot.command('monedas',  (ctx) => ctx.scene.enter('MONEDA_WIZ'));   // protegido por middleware
bot.command('bancos',   (ctx) => ctx.scene.enter('BANCO_CREATE_WIZ'));
bot.command('agentes',  (ctx) => ctx.scene.enter('AGENTE_WIZ'));
bot.command('tarjeta',  (ctx) => ctx.scene.enter('TARJETA_WIZ'));
bot.command('saldo',    (ctx) => ctx.scene.enter('SALDO_WIZ'));
listarTarjetas(bot); // /tarjetas

/* ───────── 13. Gestión de accesos (solo OWNER) ───────── */
bot.command('daracceso', safe(async (ctx) => {
  if (ctx.from.id.toString() !== process.env.OWNER_ID) return ctx.reply('Solo propietario.');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('Indica el ID.');
  if (await usuarioExiste(id)) return ctx.reply('Ya tenía acceso.');
  await agregarUsuario(id);
  ctx.reply(`✅ Acceso otorgado a ${id}.`);
}));

bot.command('denegaracceso', safe(async (ctx) => {
  if (ctx.from.id.toString() !== process.env.OWNER_ID) return ctx.reply('Solo propietario.');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('Indica el ID.');
  if (!(await usuarioExiste(id))) return ctx.reply('No estaba registrado.');
  await eliminarUsuario(id);
  ctx.reply(`⛔ Acceso revocado a ${id}.`);
}));

/* ───────── arranque robusto y cierre limpio ───────── */

const MAX_LAUNCH_ATTEMPTS = 6; // después de esto se detiene y se espera a un supervisor externo
let launchAttempt = 0;
let botRunning = false;

const startBot = async () => {
  launchAttempt++;
  try {
    await bot.launch();
    botRunning = true;
    console.log(`[${new Date().toISOString()}] 🤖 Bot en línea. (intento ${launchAttempt})`);
  } catch (err) {
    botRunning = false;
    console.error(
      `[${new Date().toISOString()}] ❌ Error al lanzar bot (intento ${launchAttempt}):`,
      err
    );
    if (launchAttempt >= MAX_LAUNCH_ATTEMPTS) {
      console.error(
        `[${new Date().toISOString()}] Se alcanzó el máximo de reintentos (${MAX_LAUNCH_ATTEMPTS}). ` +
          `Deja que un supervisor externo (PM2 / systemd) lo reinicie.`
      );
      return;
    }
    // backoff exponencial con tope en 60s
    const delayMs = Math.min(60000, 1000 * Math.pow(2, launchAttempt));
    console.log(`[${new Date().toISOString()}] Reintentando en ${Math.round(delayMs / 1000)}s...`);
    setTimeout(startBot, delayMs);
  }
};

/* capturar errores globales para no morir silenciosamente */
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] Rechazo no manejado:`, reason);
});

process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Excepción no capturada:`, err);
  // opcional: decidir si se quiere salir para que el supervisor externo reinicie
  // process.exit(1);
});

/* limpieza y apagado ordenado */
const cleanExit = async (signal) => {
  console.log(`[${new Date().toISOString()}] Recibido ${signal}, deteniendo bot...`);
  try {
    if (botRunning) {
      await bot.stop('SIGTERM');
      console.log(`[${new Date().toISOString()}] Bot detenido correctamente.`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Error al detener bot:`, e);
  }
  process.exit(0);
};

/* señales */
process.once('SIGINT', () => cleanExit('SIGINT'));
process.once('SIGTERM', () => cleanExit('SIGTERM'));

/* arrancar */
startBot();

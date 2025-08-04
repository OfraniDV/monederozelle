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
// Migrated responses to HTML parse mode; escapeHtml centralizes sanitization
// to prevent markup breakage when interpolating dynamic content.
const { escapeHtml } = require('./helpers/format');
const { ownerIds } = require('./config');

/* ───────── 1. Bot base ───────── */
const bot = require('./bot');

/* ───────── 2. Bootstrap de base de datos ───────── */
const { bootstrap: dbBootstrap } = require('./psql/ensureIndexesAndExtensions');

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
const { usuarioExiste } = require('./commands/usuariosconacceso');

/* ───────── 5. Nuevo sistema (wizards) ───────── */
const registerMoneda  = require('./commands/moneda');
const registerBanco   = require('./commands/banco');
const registerAgente  = require('./commands/agente');
const tarjetaWizard   = require('./commands/tarjeta_wizard');
const saldoWizard     = require('./commands/saldo');
const tarjetasAssist  = require('./commands/tarjetas_assist');
const monitorAssist   = require('./commands/monitor_assist');
const accesoAssist    = require('./commands/acceso_assist');
const extractoAssist  = require('./commands/extracto_assist');

/* ───────── 6. Inicializar BD (idempotente) ───────── */
async function initDatabase() {
  console.log('🛠️ Verificando base de datos...');
  try {
    await dbBootstrap();
    console.log('✅ Base de datos preparada.');
  } catch (e) {
    console.error('❌ Error preparando la base de datos:', e.message);
  }
}

/* ───────── 7. Scenes / Stage ───────── */
const stage = new Scenes.Stage([tarjetaWizard, saldoWizard, tarjetasAssist, monitorAssist, accesoAssist, extractoAssist], { ttl: 300 });
bot.use(session());
bot.use(stage.middleware());

/* Wizards que se auto-registran en el stage */
registerMoneda(bot, stage);
registerBanco(bot, stage);
registerAgente(bot, stage);

/* ───────── 8. Middleware de verificación de acceso ───────── */
const verificarAcceso = async (ctx, next) => {
  /* /start siempre disponible                                                    */
  if (ctx.updateType === 'message' && ctx.message.text?.startsWith('/start')) {
    return next();
  }

  const uid = ctx.from?.id?.toString() || '0';
  const esOwner  = ownerIds.includes(Number(uid));
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
  let msg = '📜 <b>Comandos disponibles</b>\n\n';
  comandosMeta.forEach(c => {
    msg += `• <b>${escapeHtml(c.nombre)}</b> — ${escapeHtml(c.descripcion)}\n  <i>${escapeHtml(c.uso)}</i>\n\n`;
  });
  ctx.reply(msg, { parse_mode: 'HTML' });
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
bot.command('tarjetas', (ctx) => ctx.scene.enter('TARJETAS_ASSIST'));
bot.command('monitor',  (ctx) => ctx.scene.enter('MONITOR_ASSIST'));
bot.command('acceso',   (ctx) => ctx.scene.enter('ACCESO_ASSIST'));
bot.command('extracto', (ctx) => ctx.scene.enter('EXTRACTO_ASSIST'));

/* ───────── 13. Gestión de accesos (solo OWNER) ───────── */

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

/* arrancar todo el sistema */
const bootstrapApp = async () => {
  console.log('🚀 Iniciando el sistema...');
  await initDatabase();
  console.log('🤖 Encendiendo bot de Telegram...');
  await startBot();
  console.log('✅ Inicio completo.');
};

bootstrapApp();

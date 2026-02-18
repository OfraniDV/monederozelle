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
const { flushOnExit } = require('./helpers/sessionSummary');
const { handleGlobalCancel } = require('./helpers/wizardCancel');
const { handleError } = require('./controllers/errorController');

/* ───────── 1. Bot base ───────── */
const bot = require('./bot');

/* ───────── 2. Bootstrap de base de datos ───────── */
const { bootstrap: dbBootstrap } = require('./scripts/ensureIndexesAndExtensions');

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
const fondoConfigAssist = require('./commands/fondo_config_assist');
const assistMenu      = require('./commands/assist_menu');
const {
  buildStartMainKeyboard,
  buildStartHelpKeyboard,
  buildCategoryMenuKeyboard,
  resolveStartSceneFromCallback,
  getMenuItems,
  START_CALLBACKS,
  CATEGORY_CALLBACK_PREFIX,
} = require('./helpers/assistMenu');
const { registerFondoAdvisor, runFondo } = require('./middlewares/fondoAdvisor');

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
const stage = new Scenes.Stage(
  [
    tarjetaWizard,
    saldoWizard,
    tarjetasAssist,
    monitorAssist,
    accesoAssist,
    extractoAssist,
    fondoConfigAssist,
    assistMenu,
  ]
);
bot.use(session());

registerFondoAdvisor({
  bot,
  stage,
  scenes: { saldoWizard, tarjetasAssist, monitorAssist, extractoAssist },
});

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
/* La Stage debe ir después del guard para que hears/leave no lo evadan */
const stageMiddleware = stage.middleware();
bot.use(async (ctx, next) => {
  try {
    await stageMiddleware(ctx, next);
  } catch (e) {
    const sceneId = ctx?.scene?.current?.id || 'unknown_scene';
    await handleError(e, ctx, `stage_${sceneId}`);
    if (ctx?.scene?.current) {
      await ctx.scene.leave().catch(() => {});
    }
  }
});

/* Wizards que se auto-registran en el stage (requieren ctx.scene listo) */
registerMoneda(bot, stage);
registerBanco(bot, stage);
registerAgente(bot, stage);

/* Cancelación global disponible una vez que la escena está inicializada */
bot.action('GLOBAL_CANCEL', handleGlobalCancel);
bot.hears([/^(\/cancel|\/salir|salir)$/i], handleGlobalCancel);

/* ───────── 9. Helpers para envolver comandos con try/catch ───────── */
const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    await handleError(e, ctx, fn.name || 'safe_wrapper');
  }
};

/* Guard que restringe comandos a los OWNER_IDs */
const ownerOnly = (fn) => async (ctx) => {
  const uid = ctx.from?.id ? Number(ctx.from.id) : 0;
  if (!ownerIds.includes(uid)) {
    return ctx.reply('🚫 No tienes permisos para ejecutar ese comando.');
  }
  return fn(ctx);
};

/* ───────── 10. Comando /start ───────── */
function buildComandosHtml() {
  let msg = '📜 <b>Comandos disponibles</b>\n\n';
  comandosMeta.forEach((c) => {
    msg += `• <b>${escapeHtml(c.nombre)}</b> — ${escapeHtml(c.descripcion)}\n  <i>${escapeHtml(c.uso)}</i>\n\n`;
  });
  return msg;
}

const recentStartUpdates = [];

function isDuplicateStartUpdate(ctx) {
  const updateId = ctx?.update?.update_id;
  if (typeof updateId !== 'number') return false;
  if (recentStartUpdates.includes(updateId)) return true;
  recentStartUpdates.push(updateId);
  if (recentStartUpdates.length > 120) {
    recentStartUpdates.shift();
  }
  return false;
}

function buildStartHomeHtml(ctx) {
  const nombre = escapeHtml(ctx.from?.first_name || 'Usuario');
  const totalAsistentes = getMenuItems(ctx).length;
  const esOwner = ownerIds.includes(Number(ctx.from?.id || 0));
  const ownerHint = esOwner
    ? '\n🔐 <b>Modo owner:</b> asistentes avanzados habilitados.'
    : '';
  return (
    `✨ <b>Hola, ${nombre}</b>\n` +
    'Bienvenido al <b>Monedero Zelle Bot</b>.\n\n' +
    `🎛️ Tienes <b>${totalAsistentes}</b> asistentes disponibles, organizados por categorías.\n` +
    'Usa el menú inline para entrar directo al asistente que necesites.' +
    ownerHint
  );
}

function isMessageNotModified(err) {
  const msg =
    err?.response?.description ||
    err?.description ||
    err?.message ||
    '';
  return /message is not modified/i.test(msg);
}

async function editStartMessage(ctx, text, extra) {
  if (!ctx.callbackQuery?.message?.message_id) return false;
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      ctx.callbackQuery.message.message_id,
      undefined,
      text,
      extra,
    );
    return true;
  } catch (err) {
    if (isMessageNotModified(err)) return true;
    throw err;
  }
}

async function renderStartHome(ctx, { asEdit = false } = {}) {
  const text = buildStartHomeHtml(ctx);
  const extra = {
    parse_mode: 'HTML',
    reply_markup: buildStartMainKeyboard(ctx).reply_markup,
  };
  if (asEdit) {
    const edited = await editStartMessage(ctx, text, extra);
    if (edited) return;
  }
  return ctx.reply(text, extra);
}

async function renderStartHelp(ctx, { asEdit = false } = {}) {
  const text = buildComandosHtml();
  const extra = {
    parse_mode: 'HTML',
    reply_markup: buildStartHelpKeyboard().reply_markup,
  };
  if (asEdit) {
    const edited = await editStartMessage(ctx, text, extra);
    if (edited) return;
  }
  return ctx.reply(text, extra);
}

bot.command('start', safe(async (ctx) => {
  if (isDuplicateStartUpdate(ctx)) return;

  const previousMenuId = Number(ctx.session?.startMenuMessageId || 0);
  if (previousMenuId && ctx.chat?.id) {
    await ctx.telegram.deleteMessage(ctx.chat.id, previousMenuId).catch(() => {});
  }

  const sent = await renderStartHome(ctx);
  if (ctx.session && sent?.message_id) {
    ctx.session.startMenuMessageId = sent.message_id;
  }
}));

bot.action(/^NOOP:CATEGORY:/, safe(async (ctx) => {
  await ctx.answerCbQuery('Elige un botón del bloque para continuar.').catch(() => {});
}));

bot.action(new RegExp(`^${CATEGORY_CALLBACK_PREFIX}`), safe(async (ctx) => {
  const categoryId = ctx.callbackQuery.data.slice(CATEGORY_CALLBACK_PREFIX.length);
  await ctx.answerCbQuery().catch(() => {});
  const text = buildStartHomeHtml(ctx) + `\n\n📂 <b>Categoría:</b> ${categoryId}`;
  const keyboard = buildCategoryMenuKeyboard(ctx, categoryId);
  await editStartMessage(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
}));

bot.action(/^START:(?:SCENE:|HOME|HELP|MENU|CLOSE)/, safe(async (ctx) => {
  const data = ctx.callbackQuery?.data || '';
  await ctx.answerCbQuery().catch(() => {});

  if (data === START_CALLBACKS.home) {
    if (ctx.scene?.current) {
      await ctx.scene.leave();
    }
    await renderStartHome(ctx, { asEdit: true });
    return;
  }
  if (data === START_CALLBACKS.help) {
    await renderStartHelp(ctx, { asEdit: true });
    return;
  }
  if (data === START_CALLBACKS.fullMenu) {
    if (ctx.callbackQuery?.message?.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id).catch(() => {});
    }
    if (ctx.session) {
      delete ctx.session.startMenuMessageId;
    }
    await ctx.scene.enter('ASSISTANT_MENU');
    return;
  }
  if (data === START_CALLBACKS.close) {
    await editStartMessage(
      ctx,
      '✅ Menú cerrado. Usa /start cuando quieras volver.',
      { parse_mode: 'HTML' },
    );
    if (ctx.session) {
      delete ctx.session.startMenuMessageId;
    }
    return;
  }

  const targetScene = resolveStartSceneFromCallback(data);
  if (!targetScene) return;
  const allowedItems = getMenuItems(ctx);
  const allowed = allowedItems.some((item) => item.scene === targetScene);
  if (!allowed) {
    await ctx.reply('🚫 No tienes permisos para abrir ese asistente.');
    return;
  }
  if (ctx.callbackQuery?.message?.message_id) {
    await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id).catch(() => {});
  }
  if (ctx.session) {
    delete ctx.session.startMenuMessageId;
  }
  await ctx.scene.enter(targetScene);
}));

/* ───────── 11. Legacy commands (protegidos) ───────── */
bot.command('comandos',      safe((ctx) => {
  ctx.reply(buildComandosHtml(), { parse_mode: 'HTML' });
}));
bot.command('crearcuenta',    safe(crearCuenta));
bot.command('miscuentas',     safe(listarCuentas));
bot.command('eliminarcuenta', safe(eliminarCuenta));
bot.command('credito',        safe(agregarCredito));
bot.command('debito',         safe(agregarDebito));
bot.command('resumen',        safe(resumirCuenta));
bot.command('resumentotal',   safe(resumenTotal));

/* ───────── 12. Nuevos comandos (wizards) ───────── */
bot.command('monedas',  ownerOnly((ctx) => ctx.scene.enter('MONEDA_CREATE_WIZ')));
bot.command('bancos',   ownerOnly((ctx) => ctx.scene.enter('BANCO_CREATE_WIZ')));
bot.command('agentes',  ownerOnly((ctx) => ctx.scene.enter('AGENTE_WIZ')));
bot.command('tarjeta',  ownerOnly((ctx) => ctx.scene.enter('TARJETA_WIZ')));
bot.command('saldo',    (ctx) => ctx.scene.enter('SALDO_WIZ'));
bot.command('tarjetas', (ctx) => ctx.scene.enter('TARJETAS_ASSIST'));
bot.command('monitor',  (ctx) => ctx.scene.enter('MONITOR_ASSIST'));
bot.command('acceso',   ownerOnly((ctx) => ctx.scene.enter('ACCESO_ASSIST')));
bot.command('configfondo', ownerOnly((ctx) => ctx.scene.enter('FONDO_CONFIG_ASSIST')));
bot.command('extracto', (ctx) => ctx.scene.enter('EXTRACTO_ASSIST'));
bot.command('menu',     (ctx) => ctx.scene.enter('ASSISTANT_MENU'));
bot.command('fondo',    safe(require('./commands/fondo')));

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
  handleError(reason instanceof Error ? reason : new Error(String(reason)), null, 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  handleError(err, null, 'uncaughtException');
  // En excepciones no capturadas a veces es mejor salir para que PM2 reinicie
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

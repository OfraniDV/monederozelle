const { Markup } = require('telegraf');
const { arrangeInlineButtons, withExitHint } = require('./ui');
const { ownerIds } = require('../config');

const CATEGORY_CALLBACK_PREFIX = 'NOOP:CATEGORY:';

const MENU_ITEMS = [
  { scene: 'SALDO_WIZ', label: '💰 Saldo', category: 'OPERACION', ownerOnly: false },
  { scene: 'TARJETAS_ASSIST', label: '💳 Tarjetas', category: 'OPERACION', ownerOnly: false },
  { scene: 'MONITOR_ASSIST', label: '📈 Monitor', category: 'ANALISIS', ownerOnly: false },
  { scene: 'EXTRACTO_ASSIST', label: '📄 Extracto', category: 'ANALISIS', ownerOnly: false },
  { scene: 'ACCESO_ASSIST', label: '🔐 Accesos', category: 'ADMIN', ownerOnly: true },
  { scene: 'FONDO_CONFIG_ASSIST', label: '⚙️ Config Fondo', category: 'ADMIN', ownerOnly: true },
  { scene: 'TARJETA_WIZ', label: '➕ Tarjeta', category: 'ADMIN', ownerOnly: true },
  { scene: 'AGENTE_WIZ', label: '🧑‍💼 Agentes', category: 'ADMIN', ownerOnly: true },
  { scene: 'BANCO_CREATE_WIZ', label: '🏦 Bancos', category: 'ADMIN', ownerOnly: true },
  { scene: 'MONEDA_CREATE_WIZ', label: '💱 Monedas', category: 'ADMIN', ownerOnly: true },
];

const MENU_CATEGORIES = [
  { id: 'OPERACION', header: '💼 Operación diaria', ownerOnly: false },
  { id: 'ANALISIS', header: '📊 Análisis y reportes', ownerOnly: false },
  { id: 'ADMIN', header: '🛠 Administración', ownerOnly: true },
];

const START_CALLBACKS = {
  scenePrefix: 'START:SCENE:',
  home: 'START:HOME',
  help: 'START:HELP',
  fullMenu: 'START:MENU',
  close: 'START:CLOSE',
};

const START_BASE_SCENES = [
  'SALDO_WIZ',
  'TARJETAS_ASSIST',
  'MONITOR_ASSIST',
  'EXTRACTO_ASSIST',
];
const START_OWNER_EXTRA_SCENES = ['TARJETA_WIZ', 'ACCESO_ASSIST', 'FONDO_CONFIG_ASSIST'];

function isOwner(ctx) {
  const uid = Number(ctx.from?.id || 0);
  return ownerIds.includes(uid);
}

function getMenuItems(ctx, extraItems = []) {
  const allowOwner = isOwner(ctx);
  return [...MENU_ITEMS, ...extraItems].filter((item) => (
    allowOwner ? true : !item.ownerOnly
  ));
}

function buildCategoryRows(ctx, {
  items,
  scenePrefix,
  includeHeaders = true,
  allowedScenes = null,
} = {}) {
  const index = new Map(items.map((item) => [item.scene, item]));
  const allowOwner = isOwner(ctx);
  const rows = [];
  const allowSet = allowedScenes && allowedScenes.size ? allowedScenes : null;

  MENU_CATEGORIES.forEach((category) => {
    if (category.ownerOnly && !allowOwner) return;
    const categoryItems = items
      .filter((item) => item.category === category.id)
      .filter((item) => !allowSet || allowSet.has(item.scene))
      .map((item) => index.get(item.scene))
      .filter(Boolean);

    if (!categoryItems.length) return;
    if (includeHeaders) {
      rows.push([Markup.button.callback(category.header, `${CATEGORY_CALLBACK_PREFIX}${category.id}`)]);
    }

    const buttons = categoryItems.map((item) =>
      Markup.button.callback(item.label, `${scenePrefix}${item.scene}`)
    );
    rows.push(...arrangeInlineButtons(buttons));
  });

  return rows;
}

function buildMenuKeyboard(ctx, { includeExit = true, extraItems = [] } = {}) {
  const items = getMenuItems(ctx, extraItems);
  const rows = buildCategoryRows(ctx, {
    items,
    scenePrefix: 'ASSIST:',
    includeHeaders: true,
  });
  if (includeExit) {
    rows.push([Markup.button.callback('❌ Salir', 'GLOBAL_CANCEL')]);
  }
  return Markup.inlineKeyboard(rows);
}

function buildStartMainKeyboard(ctx) {
  const items = getMenuItems(ctx);
  const allowedScenes = isOwner(ctx)
    ? new Set([...START_BASE_SCENES, ...START_OWNER_EXTRA_SCENES])
    : new Set(START_BASE_SCENES);

  const rows = buildCategoryRows(ctx, {
    items,
    scenePrefix: START_CALLBACKS.scenePrefix,
    includeHeaders: true,
    allowedScenes,
  });

  rows.push([
    Markup.button.callback('🧭 Menú completo', START_CALLBACKS.fullMenu),
    Markup.button.callback('📜 Comandos', START_CALLBACKS.help),
  ]);
  rows.push([Markup.button.callback('❌ Cerrar', START_CALLBACKS.close)]);

  return Markup.inlineKeyboard(rows);
}

function buildStartHelpKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏠 Inicio', START_CALLBACKS.home),
      Markup.button.callback('🧭 Menú completo', START_CALLBACKS.fullMenu),
    ],
    [Markup.button.callback('❌ Cerrar', START_CALLBACKS.close)],
  ]);
}

function resolveStartSceneFromCallback(data = '') {
  if (!String(data).startsWith(START_CALLBACKS.scenePrefix)) return null;
  return String(data).slice(START_CALLBACKS.scenePrefix.length).trim() || null;
}

async function sendAssistMenu(ctx, { text = 'Elige un asistente por categoría:', includeExit = true, extraItems = [] } = {}) {
  const keyboard = buildMenuKeyboard(ctx, { includeExit, extraItems });
  return ctx.reply(withExitHint(text), { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
}

async function enterAssistMenu(ctx, opts = {}) {
  if (!ctx?.scene) return;
  try {
    await ctx.scene.enter('ASSISTANT_MENU', opts);
  } catch (err) {
    console.error('[assistMenu] No se pudo entrar al menú de asistentes:', err);
  }
}

module.exports = {
  buildMenuKeyboard,
  sendAssistMenu,
  enterAssistMenu,
  getMenuItems,
  buildStartMainKeyboard,
  buildStartHelpKeyboard,
  resolveStartSceneFromCallback,
  START_CALLBACKS,
  CATEGORY_CALLBACK_PREFIX,
};

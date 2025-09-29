const { Markup } = require('telegraf');
const { arrangeInlineButtons } = require('./ui');
const { ownerIds } = require('../config');

const MENU_ITEMS = [
  { scene: 'MONITOR_ASSIST', label: '📈 Monitor', ownerOnly: false },
  { scene: 'SALDO_WIZ', label: '💰 Saldo', ownerOnly: false },
  { scene: 'TARJETAS_ASSIST', label: '💳 Tarjetas', ownerOnly: false },
  { scene: 'EXTRACTO_ASSIST', label: '📄 Extracto', ownerOnly: false },
  { scene: 'ACCESO_ASSIST', label: '🔐 Accesos', ownerOnly: true },
  { scene: 'TARJETA_WIZ', label: '➕ Tarjeta', ownerOnly: true },
  { scene: 'AGENTE_WIZ', label: '🧑‍💼 Agentes', ownerOnly: true },
  { scene: 'BANCO_CREATE_WIZ', label: '🏦 Bancos', ownerOnly: true },
  { scene: 'MONEDA_WIZ', label: '💱 Monedas', ownerOnly: true },
];

function isOwner(ctx) {
  const uid = Number(ctx.from?.id || 0);
  return ownerIds.includes(uid);
}

function getMenuItems(ctx, extraItems = []) {
  const allowOwner = isOwner(ctx);
  return [...MENU_ITEMS, ...extraItems].filter((item) =>
    allowOwner ? true : !item.ownerOnly
  );
}

function buildMenuKeyboard(ctx, { includeExit = true, extraItems = [] } = {}) {
  const items = getMenuItems(ctx, extraItems);
  const buttons = items.map((item) =>
    Markup.button.callback(item.label, `ASSIST:${item.scene}`)
  );
  const rows = arrangeInlineButtons(buttons);
  if (includeExit) {
    rows.push([Markup.button.callback('❌ Cerrar', 'EXIT')]);
  }
  return Markup.inlineKeyboard(rows);
}

async function sendAssistMenu(ctx, { text = 'Elige un asistente para continuar:', includeExit = true, extraItems = [] } = {}) {
  const keyboard = buildMenuKeyboard(ctx, { includeExit, extraItems });
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
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
};

'use strict';

const PREMIUM_EMOJIS = require('./premiumEmojis');

// NOTE:
// `<tg-emoji emoji-id="...">` only works if the custom emoji id is valid for the Bot API.
const PREMIUM_TEXT_EMOJI_ENABLED = !/^(0|false|no|off)$/i.test(String(
  process.env.PREMIUM_TEXT_EMOJI_ENABLED
  ?? process.env.PREMIUM_EMOJI_TEXT_ENABLED
  ?? 'true'
).trim());

console.log(`[PREMIUM_EMOJI_TEXT] Enabled: ${PREMIUM_TEXT_EMOJI_ENABLED}`);

// Mapeo central Unicode -> custom_emoji_id para renderizar <tg-emoji ...> en textos HTML.
// Regla: el código usa Unicode; este diccionario define qué Unicode se convierte a premium.
const UNICODE_TO_PREMIUM_ID = Object.freeze({
  // Sistema y Navegación
  '⬅️': PREMIUM_EMOJIS.VOLVER,
  '⬅': PREMIUM_EMOJIS.VOLVER,
  '🙂': PREMIUM_EMOJIS.VOLVER_ALT,
  '🚪': PREMIUM_EMOJIS.CERRAR,
  '🔙': PREMIUM_EMOJIS.VOLVER_ATRAS,
  '🏠': PREMIUM_EMOJIS.VOLVER,
  '➡️': PREMIUM_EMOJIS.FLECHA_DERECHA,
  '➡': PREMIUM_EMOJIS.FLECHA_DERECHA,
  '▶️': PREMIUM_EMOJIS.NEXT,
  '▶': PREMIUM_EMOJIS.NEXT,
  '⏩': PREMIUM_EMOJIS.NEXT,
  '🧭': PREMIUM_EMOJIS.SOPORTE || PREMIUM_EMOJIS.CONFIG,

  // Acciones
  '❌': PREMIUM_EMOJIS.BORRAR_ALT || PREMIUM_EMOJIS.ERROR,
  '✅': PREMIUM_EMOJIS.CONFIRMAR,
  '🗑️': PREMIUM_EMOJIS.BORRAR,
  '🗑': PREMIUM_EMOJIS.BORRAR,
  '✏️': PREMIUM_EMOJIS.EDITAR,
  '✏': PREMIUM_EMOJIS.EDITAR,
  '➕': PREMIUM_EMOJIS.NUEVO,
  '📤': PREMIUM_EMOJIS.ENVIAR,
  '🔄': PREMIUM_EMOJIS.RELOAD,
  '🔁': PREMIUM_EMOJIS.RELOAD,
  '🛠': PREMIUM_EMOJIS.CONFIG,
  '⚙️': PREMIUM_EMOJIS.SISTEMA,
  '⚙': PREMIUM_EMOJIS.SISTEMA,
  '🧹': PREMIUM_EMOJIS.RECICLAJE || PREMIUM_EMOJIS.BORRAR,

  // Finanzas
  '🤑': PREMIUM_EMOJIS.FINANZAS,
  '💰': PREMIUM_EMOJIS.DINERO,
  '🏦': PREMIUM_EMOJIS.BANCA,
  '💵': PREMIUM_EMOJIS.EFECTIVO_USD,
  '💶': PREMIUM_EMOJIS.RETIROS,
  '💳': PREMIUM_EMOJIS.TARJETA,
  '🪙': PREMIUM_EMOJIS.MONEDA,
  '💸': PREMIUM_EMOJIS.DINERO_VOLANDO,
  '💲': PREMIUM_EMOJIS.DOLARES,
  '💱': PREMIUM_EMOJIS.CAMBIO,
  '💹': PREMIUM_EMOJIS.FX,

  // Monedas y Bancos
  '🇨🇺': PREMIUM_EMOJIS.CUP,
  '🇺🇸': PREMIUM_EMOJIS.MLC,
  '🇧🇷': PREMIUM_EMOJIS.BRL,
  'Ⓜ️': PREMIUM_EMOJIS.METROPOLITANO,
  'Ⓜ': PREMIUM_EMOJIS.METROPOLITANO,
  '🅱️': PREMIUM_EMOJIS.BANDEC,
  '🅱': PREMIUM_EMOJIS.BANDEC,
  '🅿️': PREMIUM_EMOJIS.BPA,
  '🅿': PREMIUM_EMOJIS.BPA,

  // Juegos y Loterías
  '🎮': PREMIUM_EMOJIS.JUEGO,
  '🎰': PREMIUM_EMOJIS.SLOT || PREMIUM_EMOJIS.JUEGO_PICK4,
  '🎲': PREMIUM_EMOJIS.DADO,
  '🎯': PREMIUM_EMOJIS.DIANA || PREMIUM_EMOJIS.JUEGO_FIJO,
  '🎱': PREMIUM_EMOJIS.BILLAR,
  '🎖️': PREMIUM_EMOJIS.TICKET,
  '🎖': PREMIUM_EMOJIS.TICKET,
  '🎰': PREMIUM_EMOJIS.LOTERIA || PREMIUM_EMOJIS.SLOT,
  '🎰️': PREMIUM_EMOJIS.LOTERIA || PREMIUM_EMOJIS.SLOT,
  '🍀': PREMIUM_EMOJIS.TREBOL,
  '🔥': PREMIUM_EMOJIS.FUEGO || PREMIUM_EMOJIS.JUEGO_TRIPLETA,
  '💥': PREMIUM_EMOJIS.BOOM,
  '✨': PREMIUM_EMOJIS.SPARKLES,
  '✨️': PREMIUM_EMOJIS.SPARKLES,
  '\u2728': PREMIUM_EMOJIS.SPARKLES,
  '\u2728\uFE0F': PREMIUM_EMOJIS.SPARKLES,
  '🔆': PREMIUM_EMOJIS.ESTRELLA_SOL,
  '🌟': PREMIUM_EMOJIS.ESTRELLA_BRILLO,
  '⭐️': PREMIUM_EMOJIS.SPARKLES_ALT_1,
  '⭐️️': PREMIUM_EMOJIS.SPARKLES_ALT_1,
  '⭐': PREMIUM_EMOJIS.SPARKLES_ALT_1,
  '🔐': PREMIUM_EMOJIS.CANDADO || PREMIUM_EMOJIS.JUEGO_CANDADO,
  '🔒': PREMIUM_EMOJIS.CANDADO || PREMIUM_EMOJIS.JUEGO_CANDADO,
  '🔗': PREMIUM_EMOJIS.ENLACE || PREMIUM_EMOJIS.JUEGO_PARLES,
  '🎴': PREMIUM_EMOJIS.JUEGO,

  // Ranking y Premios
  '🥇': PREMIUM_EMOJIS.COPA || '6269400956387987689',
  '🥈': PREMIUM_EMOJIS.PLATA || '5447203607294265305',
  '🥉': PREMIUM_EMOJIS.BRONCE || '5453902265922376865',
  '🏆': PREMIUM_EMOJIS.COPA || '6269400956387987689',
  '💯': PREMIUM_EMOJIS.CIEN,

  // Usuarios y Grupos
  '👤': PREMIUM_EMOJIS.USUARIO,
  '👥': PREMIUM_EMOJIS.GRUPO,
  '🤝': PREMIUM_EMOJIS.APRETON_MANOS,
  '👋': PREMIUM_EMOJIS.HOLA,

  // Alertas e Información
  '⚠️': PREMIUM_EMOJIS.WARNING,
  '⚠': PREMIUM_EMOJIS.WARNING,
  '🚨': PREMIUM_EMOJIS.ALERTA,
  '📢': PREMIUM_EMOJIS.AVISO || PREMIUM_EMOJIS.DIFUSION,
  'ℹ️': PREMIUM_EMOJIS.ALERT,
  'ℹ': PREMIUM_EMOJIS.ALERT,
  '❗': PREMIUM_EMOJIS.EXCLAMACION,
  '❗️': PREMIUM_EMOJIS.EXCLAMACION,
  '⛔': PREMIUM_EMOJIS.PROHIBIDO,
  '⛔️': PREMIUM_EMOJIS.PROHIBIDO,
  '🚫': PREMIUM_EMOJIS.CANCELAR,
  '🛑': PREMIUM_EMOJIS.STOP,
  '❓': PREMIUM_EMOJIS.PREGUNTA,
  '🤔': PREMIUM_EMOJIS.ALERT,
  '🔎': PREMIUM_EMOJIS.VISTA_PREVIA,

  // Calendario y Tiempo
  '📅': PREMIUM_EMOJIS.CALENDARIO,
  '📆': PREMIUM_EMOJIS.CALENDARIO_ALT,
  '🗓️': PREMIUM_EMOJIS.CALENDARIO_ESPIRAL,
  '🗓': PREMIUM_EMOJIS.CALENDARIO_ESPIRAL,
  '⏰': PREMIUM_EMOJIS.RELOJ_ALARMA,
  '🕒': PREMIUM_EMOJIS.RELOJ || PREMIUM_EMOJIS.VISTA_PREVIA,
  '⏳': PREMIUM_EMOJIS.VISTA_PREVIA,

  // Otros
  '🚀': PREMIUM_EMOJIS.FIESTA || PREMIUM_EMOJIS.BIENVENIDA,
  '🥳': PREMIUM_EMOJIS.BIENVENIDA || PREMIUM_EMOJIS.FIESTA,
  '🎉': PREMIUM_EMOJIS.FIESTA_CONFETI || PREMIUM_EMOJIS.BIENVENIDA,
  '🏷': PREMIUM_EMOJIS.ETIQUETA,
  '🏷️': PREMIUM_EMOJIS.ETIQUETA,
  '📌': PREMIUM_EMOJIS.VISTA_PREVIA,
  '📍': PREMIUM_EMOJIS.VISTA_PREVIA,
  '📊': PREMIUM_EMOJIS.VISTA_PREVIA,
  '📈': PREMIUM_EMOJIS.VISTA_PREVIA,
  '📉': PREMIUM_EMOJIS.VISTA_PREVIA,
  '📋': PREMIUM_EMOJIS.LISTADO || PREMIUM_EMOJIS.VISTA_PREVIA,
  '🔸': PREMIUM_EMOJIS.ROMBO_NARANJA,
  '•': PREMIUM_EMOJIS.BULLET,
  '💬': PREMIUM_EMOJIS.CHAT,
  '🔔': PREMIUM_EMOJIS.CAMPANA,
  '💎': PREMIUM_EMOJIS.DIAMANTE,
  '💼': PREMIUM_EMOJIS.MALETIN,
  '🏬': PREMIUM_EMOJIS.MALETIN,
  '🎁': PREMIUM_EMOJIS.REGALO,
  '✉️': PREMIUM_EMOJIS.SOBRE,
  '✉': PREMIUM_EMOJIS.SOBRE,
  '📩': PREMIUM_EMOJIS.SOBRE,
  '📨': PREMIUM_EMOJIS.SOBRE,
  '📤': PREMIUM_EMOJIS.ENVIAR,
  '📸': PREMIUM_EMOJIS.FOTO,
  '🖼': PREMIUM_EMOJIS.IMAGEN,
  '📚': PREMIUM_EMOJIS.LIBROS,
  '🤖': PREMIUM_EMOJIS.AI,
  '🤖️': PREMIUM_EMOJIS.AI,
  '🧠': PREMIUM_EMOJIS.AI,
  '🌴': PREMIUM_EMOJIS.PALMERA,
  '🍑': PREMIUM_EMOJIS.PEACH,
  '🗽': PREMIUM_EMOJIS.ESTATUA_LIBERTAD,
  '🦆': PREMIUM_EMOJIS.FLAMENCO,
  '🦩': PREMIUM_EMOJIS.FLAMINGO_PREMIUM,
  '🟢': PREMIUM_EMOJIS.CIRCLE_GREEN,
  '🟢️': PREMIUM_EMOJIS.CIRCLE_GREEN,
  '🔴': PREMIUM_EMOJIS.CIRCLE_RED,
  '🔴️': PREMIUM_EMOJIS.CIRCLE_RED,
  '🟡': PREMIUM_EMOJIS.CIRCLE_YELLOW,
  '🟡️': PREMIUM_EMOJIS.CIRCLE_YELLOW,
  '🟠': PREMIUM_EMOJIS.CIRCLE_ORANGE,
  '🟠️': PREMIUM_EMOJIS.CIRCLE_ORANGE,
  '🏃': PREMIUM_EMOJIS.CORRER,
  '🕺': PREMIUM_EMOJIS.DANCE,
  '🕺️': PREMIUM_EMOJIS.DANCE,
  '👇': PREMIUM_EMOJIS.FINGER_DOWN,
  '👉': PREMIUM_EMOJIS.FINGER_RIGHT,
  '🕸': PREMIUM_EMOJIS.SPIDER_WEB,
  '⚡': PREMIUM_EMOJIS.RAYO,
  '⚡️': PREMIUM_EMOJIS.RAYO,
  '♻️': PREMIUM_EMOJIS.RECICLAJE,
  '♻': PREMIUM_EMOJIS.RECICLAJE,
  '🟰': PREMIUM_EMOJIS.IGUAL,
  '#️⃣': PREMIUM_EMOJIS.NUMERO,
  '🔢': PREMIUM_EMOJIS.VISTA_PREVIA,
  '✍️': PREMIUM_EMOJIS.ESCRIBIR || PREMIUM_EMOJIS.EDITAR,
  '✍': PREMIUM_EMOJIS.ESCRIBIR || PREMIUM_EMOJIS.EDITAR,
  '🐸': PREMIUM_EMOJIS.FROG,
  '🐸️': PREMIUM_EMOJIS.FROG,
  '📲': PREMIUM_EMOJIS.SMARTPHONE_SEND,
  '📲️': PREMIUM_EMOJIS.SMARTPHONE_SEND,
  '📱': PREMIUM_EMOJIS.SMARTPHONE || PREMIUM_EMOJIS.SMARTPHONE_ALT,
  '📱️': PREMIUM_EMOJIS.SMARTPHONE || PREMIUM_EMOJIS.SMARTPHONE_ALT,
  '🎰': PREMIUM_EMOJIS.SLOT || PREMIUM_EMOJIS.JUEGO_PICK4,
  '🎰️': PREMIUM_EMOJIS.SLOT || PREMIUM_EMOJIS.JUEGO_PICK4,
  '⚙️': PREMIUM_EMOJIS.SISTEMA,
  '⚙': PREMIUM_EMOJIS.SISTEMA,
  '🙂': PREMIUM_EMOJIS.VOLVER_ALT,
  '🙂️': PREMIUM_EMOJIS.VOLVER_ALT,
  '🤖': PREMIUM_EMOJIS.AI,
  '🤖️': PREMIUM_EMOJIS.AI,
  '✨': PREMIUM_EMOJIS.SPARKLES,
  '✨️': PREMIUM_EMOJIS.SPARKLES,
  '🤖': PREMIUM_EMOJIS.AI,
  '🤖️': PREMIUM_EMOJIS.AI,

  // Números con keycap
  '1️⃣': '5433604060048731551',
  '2️⃣': '5433989354451314352',
  '3️⃣': '5433842187799564072',
  '4️⃣': '5433804369018686646'
});

/**
 * FirewallIDs Token to ID Mapping (Legacy support for :TOKEN: format)
 */
const TOKEN_TO_PREMIUM_ID = Object.freeze({
  ESCRIBIR: PREMIUM_EMOJIS.ESCRIBIR || '5192825506239616944',
  IMAGEN: PREMIUM_EMOJIS.IMAGEN || PREMIUM_EMOJIS.FOTO || '5334673106202010226',
  ENLACE: PREMIUM_EMOJIS.ENLACE || '5438258245788701620',
  RELOAD: PREMIUM_EMOJIS.RELOAD || '5192591781258077533',
  STOP: PREMIUM_EMOJIS.STOP || '5472149463956986566',
  PLAY: PREMIUM_EMOJIS.PLAY || '5471965313501239103',
  CALENDARIO: PREMIUM_EMOJIS.CALENDARIO || '5470125743432276510',
  VISTA_PREVIA: PREMIUM_EMOJIS.VISTA_PREVIA || '5472283995335041935',
  VOLVER: PREMIUM_EMOJIS.VOLVER || '5469956461993921949',
  CANCELAR: PREMIUM_EMOJIS.CANCELAR || '5467657900790915152',
  CONFIRMAR: PREMIUM_EMOJIS.CONFIRMAR || '5467727144186552554',
  USUARIO: PREMIUM_EMOJIS.USUARIO || '5192825500856069125',
  DIFUSION: PREMIUM_EMOJIS.DIFUSION || '5433722002132383713',
  HOLA: PREMIUM_EMOJIS.HOLA || '5418181678228250268',
  ALERTA_CRITICA: PREMIUM_EMOJIS.ALERTA_CRITICA || '5418181678228250268',
});

const UNICODE_KEYS_DESC = Object.keys(UNICODE_TO_PREMIUM_ID).sort((a, b) => b.length - a.length);

// Mapeo inverso ID -> Unicode para fallback correcto dentro de <tg-emoji>
// Esto evita ENTITY_TEXT_INVALID cuando se usa un texto como ":KEY:" dentro del tag.
const PREMIUM_ID_TO_UNICODE = new Map();
// Inicializamos el mapa inverso
for (const [unicode, id] of Object.entries(UNICODE_TO_PREMIUM_ID)) {
  if (id && !PREMIUM_ID_TO_UNICODE.has(String(id))) {
    PREMIUM_ID_TO_UNICODE.set(String(id), unicode);
  }
}
// También del mapeo de tokens
for (const id of Object.values(TOKEN_TO_PREMIUM_ID)) {
  if (id && !PREMIUM_ID_TO_UNICODE.has(String(id))) {
    PREMIUM_ID_TO_UNICODE.set(String(id), '💎');
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EMOJI_PATTERN = new RegExp(
  Object.keys(UNICODE_TO_PREMIUM_ID)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|'),
  'g'
);

const PROTECTED_HTML_BLOCK_PATTERN = /<(tg-emoji|pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TG_EMOJI_TAG_PATTERN = /<tg-emoji\b[^>]*>(.*?)<\/tg-emoji>/gi;
const PREMIUM_CONTENT_FALLBACK_BY_SOURCE = Object.freeze({
  '•': '🔸'
});

function normalizeParseMode(parseMode) {
  const mode = String(parseMode || '').trim().toUpperCase();
  if (!mode) return null;
  return mode;
}

function replaceKnownPremiumEmojisInHtml(text, options = {}) {
  const { usePremium = PREMIUM_TEXT_EMOJI_ENABLED } = options;
  const rawInput = String(text ?? '');

  // 1. Reemplazamos patrones tipo :CLAVE: (Legacy/FirewallIDs format)
  const legacyEmojiRegex = /:([A-Z0-9_]+):/g;
  let processedInput = rawInput.replace(legacyEmojiRegex, (match, key) => {
    const id = TOKEN_TO_PREMIUM_ID[key] || PREMIUM_EMOJIS[key];
    if (id && /^\d+$/.test(String(id))) {
      if (usePremium) {
        const content = PREMIUM_ID_TO_UNICODE.get(String(id)) || '💎';
        return `<tg-emoji emoji-id="${id}">${content}</tg-emoji>`;
      }
      return match;
    }
    return match;
  });

  // 1.1 Limpieza de tags legacy <premium>...</premium>
  processedInput = processedInput.replace(/<premium>(.*?)<\/premium>/gi, '$1');

  // 2. Reemplazamos emojis Unicode (Bolitero format)
  // Nota: sanitizeTelegramText se aplica DESPUÉS si es necesario, pero aquí procesamos el HTML
  const input = processedInput;
  if (!usePremium || !EMOJI_PATTERN.source) return input;

  const replaceChunk = (chunk) => chunk.replace(EMOJI_PATTERN, (emoji) => {
    const id = UNICODE_TO_PREMIUM_ID[emoji];
    if (!id || !/^\d+$/.test(String(id))) return emoji;
    const canonicalEmoji = PREMIUM_CONTENT_FALLBACK_BY_SOURCE[emoji]
      || PREMIUM_ID_TO_UNICODE.get(String(id))
      || emoji;
    return `<tg-emoji emoji-id="${id}">${canonicalEmoji}</tg-emoji>`;
  });

  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = PROTECTED_HTML_BLOCK_PATTERN.exec(input)) !== null) {
    const protectedStart = match.index;
    const protectedEnd = protectedStart + match[0].length;
    result += replaceChunk(input.slice(lastIndex, protectedStart));
    result += match[0];
    lastIndex = protectedEnd;
  }

  result += replaceChunk(input.slice(lastIndex));
  return result;
}

function replaceKnownPremiumEmojis(text, options = {}) {
  const { parseMode, force = false } = options;
  const mode = normalizeParseMode(parseMode);
  if (!force && mode !== 'HTML') return String(text ?? '');
  return replaceKnownPremiumEmojisInHtml(text, options);
}

function stripPremiumEmojiTags(text) {
  return String(text ?? '').replace(TG_EMOJI_TAG_PATTERN, '$1');
}

function resolvePremiumIconIdFromText(text) {
  const normalized = stripPremiumEmojiTags(text);
  if (!normalized) return null;

  for (const emoji of UNICODE_KEYS_DESC) {
    if (normalized.includes(emoji)) return UNICODE_TO_PREMIUM_ID[emoji] || null;
  }
  return null;
}

module.exports = {
  UNICODE_TO_PREMIUM_ID,
  replaceKnownPremiumEmojisInHtml,
  replaceKnownPremiumEmojis,
  stripPremiumEmojiTags,
  resolvePremiumIconIdFromText
};

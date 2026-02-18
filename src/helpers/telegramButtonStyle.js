'use strict';

const {
  normalizeButtonStyle,
  normalizeIconCustomEmojiId
} = require('./buttonInputParser');
const PREMIUM_EMOJIS = require('./premiumEmojis');
const { stripPremiumEmojiTags } = require('./premiumEmojiText');

const BUTTON_STYLE_DANGER = 'danger';
const BUTTON_STYLE_SUCCESS = 'success';
const BUTTON_STYLE_PRIMARY = 'primary';

const CANCEL_TOKENS = [
  'cancel',
  'cancelar',
  'cancelado',
  'salir',
  'exit',
  'abort',
  'abortar',
  'cerrar',
  'close'
];

const SUCCESS_TOKENS = [
  'pagar',
  'pago',
  'pay',
  'confirm',
  'valid',
  'guardar',
  'save',
  'aumentar',
  'agregar',
  'sumar'
];

const SEND_TOKENS = [
  'enviar',
  'send',
  'notificar'
];

const CANCEL_ICON_TOKENS = [
  'cancel',
  'cancelar',
  'cancelado',
  'abort',
  'abortar',
  'salir',
  'exit'
];

const DELETE_TOKENS = [
  'borrar',
  'eliminar',
  'delete',
  'remove',
  'limpiar',
  'reset',
  'retirar',
  'restar',
  'quitar'
];

const BACK_TOKENS = [
  'volver',
  'atras',
  'regresar',
  'back',
  'anterior',
  'prev',
  'previous'
];

const EXIT_TOKENS = [
  'salir',
  'exit',
  'cerrar',
  'close',
  'terminar',
  'finish'
];

const NEXT_TOKENS = [
  'siguiente',
  'next',
  'continuar',
  'continue'
];

const EDIT_TOKENS = [
  'editar',
  'edit',
  'modificar',
  'update'
];

const NEW_TOKENS = [
  'nuevo',
  'agregar',
  'add',
  'crear',
  'new'
];

const PREVIEW_TOKENS = [
  'vista previa',
  'preview',
  'ver',
  'mostrar'
];

const RETIROS_TOKENS = [
  'retiro',
  'retirar',
  'withdraw'
];

const FINANZAS_TOKENS = [
  'finanzas',
  'saldo',
  'banca',
  'fondo',
  'dinero',
  'monitor',
  'tarjeta',
  'tarjetas',
  'extracto',
  'reporte',
  'informe',
  'consultar',
  'periodo',
  'banco',
  'agente',
  'moneda',
  'usd',
  'mlc',
  'cup'
];

const SISTEMA_TOKENS = [
  'config',
  'sistema',
  'setting',
  'menu'
];

const JUEGO_TOKENS = [
  'juego',
  'premio',
  'limite',
  'loteria',
  'apuesta'
];

const MENU_TOKENS = [
  'inicio',
  'comandos',
  'menu',
  'categoria',
  'categorias',
  'asistente',
  'asistentes'
];

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function isButtonStyleEnabled() {
  const envFlag = parseBooleanFlag(process.env.TELEGRAM_BUTTON_STYLES_ENABLED);
  if (envFlag !== null) {
    return envFlag;
  }
  return process.env.NODE_ENV !== 'test';
}

function isButtonAutoStyleEnabled() {
  const envFlag = parseBooleanFlag(process.env.TELEGRAM_BUTTON_AUTO_STYLE_ENABLED);
  if (envFlag !== null) {
    return envFlag;
  }
  return isButtonStyleEnabled();
}

function isButtonAutoPremiumEmojiEnabled() {
  const envFlag = parseBooleanFlag(process.env.TELEGRAM_BUTTON_AUTO_PREMIUM_EMOJI_ENABLED);
  if (envFlag !== null) {
    return envFlag;
  }
  return process.env.NODE_ENV !== 'test';
}

function normalizeComparable(value) {
  return stripPremiumEmojiTags(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasAnyToken(input, tokens = []) {
  if (!input) return false;
  return tokens.some((token) => input.includes(token));
}

function isDecorativeEmojiToken(token) {
  const value = String(token || '').trim();
  if (!value) return false;
  const hasLetterOrNumber = /[\p{L}\p{N}]/u.test(value);
  const hasEmoji = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}]/u.test(value);
  return hasEmoji && !hasLetterOrNumber;
}

function stripDecorativeEdgeEmojis(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (!tokens.length) return raw;

  while (tokens.length > 1 && isDecorativeEmojiToken(tokens[0])) {
    tokens.shift();
  }

  while (tokens.length > 1 && isDecorativeEmojiToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ').trim() || raw;
}

function resolveAutomaticStyle(button = {}) {
  const rawText = normalizeComparable(button?.text);
  const rawCallback = normalizeComparable(button?.callback_data);

  const hayCancelar = hasAnyToken(rawText, CANCEL_TOKENS) || hasAnyToken(rawCallback, CANCEL_TOKENS);
  if (hayCancelar) return BUTTON_STYLE_DANGER;

  const hayExito = hasAnyToken(rawText, SUCCESS_TOKENS) || hasAnyToken(rawCallback, SUCCESS_TOKENS);
  if (hayExito) return BUTTON_STYLE_SUCCESS;

  const hayEnviar = hasAnyToken(rawText, SEND_TOKENS) || hasAnyToken(rawCallback, SEND_TOKENS);
  if (hayEnviar) return BUTTON_STYLE_PRIMARY;

  const haySiguiente = hasAnyToken(rawText, NEXT_TOKENS) || hasAnyToken(rawCallback, NEXT_TOKENS);
  if (haySiguiente) return BUTTON_STYLE_PRIMARY;

  return null;
}

function resolveAutomaticPremiumEmoji(button = {}) {
  const rawText = normalizeComparable(button?.text);
  const rawCallback = normalizeComparable(button?.callback_data);
  const callback = String(rawCallback || '');
  const callbackStarts = (prefix) => callback.startsWith(prefix);

  const hasToken = (tokens) => hasAnyToken(rawText, tokens) || hasAnyToken(rawCallback, tokens);

  if (callbackStarts('assist:saldo_wiz') || callbackStarts('start:scene:saldo_wiz')) {
    return PREMIUM_EMOJIS.DINERO || PREMIUM_EMOJIS.FINANZAS || null;
  }
  if (callbackStarts('assist:tarjetas_assist') || callbackStarts('start:scene:tarjetas_assist')) {
    return PREMIUM_EMOJIS.TARJETA || PREMIUM_EMOJIS.FINANZAS || null;
  }
  if (callbackStarts('assist:monitor_assist') || callbackStarts('start:scene:monitor_assist')) {
    return PREMIUM_EMOJIS.FINANZAS || PREMIUM_EMOJIS.DIANA || null;
  }
  if (callbackStarts('assist:extracto_assist') || callbackStarts('start:scene:extracto_assist')) {
    return PREMIUM_EMOJIS.DOCUMENTO || PREMIUM_EMOJIS.RECIBO || null;
  }
  if (callbackStarts('assist:acceso_assist') || callbackStarts('start:scene:acceso_assist')) {
    return PREMIUM_EMOJIS.CANDADO || PREMIUM_EMOJIS.LOCK || null;
  }
  if (callbackStarts('assist:tarjeta_wiz') || callbackStarts('start:scene:tarjeta_wiz')) {
    return PREMIUM_EMOJIS.TARJETA || PREMIUM_EMOJIS.CARD || null;
  }
  if (callbackStarts('assist:agente_wiz')) {
    return PREMIUM_EMOJIS.USUARIO || PREMIUM_EMOJIS.USER || null;
  }
  if (callbackStarts('assist:banco_create_wiz')) {
    return PREMIUM_EMOJIS.BANCA || PREMIUM_EMOJIS.BANK || null;
  }
  if (callbackStarts('assist:moneda_create_wiz')) {
    return PREMIUM_EMOJIS.CAMBIO || PREMIUM_EMOJIS.MONEDA || null;
  }

  if (callbackStarts('ag_')) return PREMIUM_EMOJIS.USUARIO || PREMIUM_EMOJIS.USER || null;
  if (callbackStarts('bk_')) return PREMIUM_EMOJIS.BANCA || PREMIUM_EMOJIS.BANK || null;
  if (callbackStarts('mo_')) return PREMIUM_EMOJIS.CAMBIO || PREMIUM_EMOJIS.MONEDA || null;
  if (callbackStarts('ta_')) return PREMIUM_EMOJIS.TARJETA || PREMIUM_EMOJIS.CARD || null;
  if (callbackStarts('per_') || callbackStarts('day_') || callbackStarts('month_')) {
    return PREMIUM_EMOJIS.CALENDARIO || PREMIUM_EMOJIS.CALENDARIO_ALT || null;
  }
  if (callbackStarts('view_')) return PREMIUM_EMOJIS.LISTADO || PREMIUM_EMOJIS.FINANZAS || null;
  if (callbackStarts('run')) return PREMIUM_EMOJIS.DIANA || PREMIUM_EMOJIS.TARGET || null;
  if (callbackStarts('private')) return PREMIUM_EMOJIS.SMARTPHONE || PREMIUM_EMOJIS.CHAT || null;
  if (callbackStarts('start:menu') || callbackStarts('start:home') || callbackStarts('start:help')) {
    return PREMIUM_EMOJIS.MENU || PREMIUM_EMOJIS.SISTEMA || null;
  }
  if (callbackStarts('start:close') || callbackStarts('global_cancel')) {
    return PREMIUM_EMOJIS.CERRAR || PREMIUM_EMOJIS.SALIR || null;
  }
  if (callbackStarts('noop:category:')) return PREMIUM_EMOJIS.ETIQUETA || PREMIUM_EMOJIS.MENU || null;
  if (callbackStarts('first') || callbackStarts('last')) return PREMIUM_EMOJIS.LISTADO || PREMIUM_EMOJIS.NEXT || null;

  if (hasToken(DELETE_TOKENS)) return PREMIUM_EMOJIS.BORRAR || PREMIUM_EMOJIS.CANCELAR || null;
  if (hasToken(CANCEL_ICON_TOKENS)) return PREMIUM_EMOJIS.CANCELAR || PREMIUM_EMOJIS.BORRAR || null;
  if (hasToken(BACK_TOKENS)) return PREMIUM_EMOJIS.VOLVER || PREMIUM_EMOJIS.BACK || null;
  if (hasToken(EXIT_TOKENS)) return PREMIUM_EMOJIS.CERRAR || PREMIUM_EMOJIS.SALIR || null;
  if (hasToken(NEXT_TOKENS)) return PREMIUM_EMOJIS.NEXT || PREMIUM_EMOJIS.FLECHA_DERECHA || null;
  if (hasToken(EDIT_TOKENS)) return PREMIUM_EMOJIS.EDITAR || null;
  if (hasToken(NEW_TOKENS)) return PREMIUM_EMOJIS.NUEVO || null;
  if (hasToken(PREVIEW_TOKENS)) return PREMIUM_EMOJIS.VISTA_PREVIA || null;
  if (hasToken(RETIROS_TOKENS)) return PREMIUM_EMOJIS.RETIROS || null;
  if (hasToken(FINANZAS_TOKENS)) return PREMIUM_EMOJIS.FINANZAS || null;
  if (hasToken(MENU_TOKENS)) return PREMIUM_EMOJIS.MENU || PREMIUM_EMOJIS.SISTEMA || null;
  if (hasToken(SISTEMA_TOKENS)) return PREMIUM_EMOJIS.MENU || PREMIUM_EMOJIS.SISTEMA || null;
  if (hasToken(JUEGO_TOKENS)) return PREMIUM_EMOJIS.JUEGO || null;
  if (hasToken(SUCCESS_TOKENS) || hasToken(SEND_TOKENS)) return PREMIUM_EMOJIS.ENVIAR || PREMIUM_EMOJIS.CONFIRMAR || null;
  if (callback) return PREMIUM_EMOJIS.ETIQUETA || PREMIUM_EMOJIS.SPARKLES || null;

  return null;
}

function applyAutoButtonStyle(button, options = {}) {
  if (!button || typeof button !== 'object') {
    return button;
  }

  const autoStyleEnabled = isButtonAutoStyleEnabled();
  const autoPremiumEmojiEnabled = isButtonAutoPremiumEmojiEnabled();

  if (!autoStyleEnabled && !autoPremiumEmojiEnabled) {
    return button;
  }

  const currentStyle = normalizeButtonStyle(button.style);
  const currentIconCustomEmojiId = normalizeIconCustomEmojiId(button.icon_custom_emoji_id);

  let style = null;
  if (!currentStyle && autoStyleEnabled) {
    style = normalizeButtonStyle(options.style) || resolveAutomaticStyle(button);
  }

  let iconCustomEmojiId = null;
  if (!currentIconCustomEmojiId && autoPremiumEmojiEnabled) {
    iconCustomEmojiId = normalizeIconCustomEmojiId(
      options.icon_custom_emoji_id || options.iconCustomEmojiId
    ) || resolveAutomaticPremiumEmoji(button);
  }

  const effectiveIconCustomEmojiId = currentIconCustomEmojiId || iconCustomEmojiId;
  const plainText = typeof button.text === 'string'
    ? stripPremiumEmojiTags(button.text)
    : button.text;

  // Solo alteramos el texto si tenemos un ícono custom resuelto.
  // De lo contrario, mantenemos el texto original (con sus posibles tags <tg-emoji>).
  const normalizedText = (effectiveIconCustomEmojiId && typeof plainText === 'string')
    ? plainText
    : button.text;

  const textChanged = typeof button.text === 'string' && normalizedText !== button.text;

  if (!style && !iconCustomEmojiId && !textChanged) {
    return button;
  }

  return {
    ...button,
    ...(textChanged ? { text: normalizedText } : {}),
    ...(style ? { style } : {}),
    ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {})
  };
};

function withButtonStyle(button, options = {}) {
  if (!button || typeof button !== 'object') {
    return button;
  }

  if (!isButtonStyleEnabled()) {
    return button;
  }

  const style = normalizeButtonStyle(options.style);
  const iconCustomEmojiId = normalizeIconCustomEmojiId(
    options.icon_custom_emoji_id || options.iconCustomEmojiId
  );

  const effectiveIconCustomEmojiId = normalizeIconCustomEmojiId(button.icon_custom_emoji_id) || iconCustomEmojiId;
  const plainText = typeof button.text === 'string'
    ? stripPremiumEmojiTags(button.text)
    : button.text;
  const normalizedText = (effectiveIconCustomEmojiId && typeof plainText === 'string')
    ? stripDecorativeEdgeEmojis(plainText)
    : plainText;
  const textChanged = typeof button.text === 'string' && normalizedText !== button.text;

  if (!style && !iconCustomEmojiId && !textChanged) {
    return button;
  }

  return {
    ...button,
    ...(textChanged ? { text: normalizedText } : {}),
    ...(style ? { style } : {}),
    ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {})
  };
}

module.exports = {
  isButtonStyleEnabled,
  isButtonAutoStyleEnabled,
  isButtonAutoPremiumEmojiEnabled,
  resolveAutomaticStyle,
  resolveAutomaticPremiumEmoji,
  applyAutoButtonStyle,
  withButtonStyle
};

'use strict';

const { URL } = require('url');

const VALID_BUTTON_STYLES = new Set([
  'primary',
  'success',
  'danger'
]);

function normalizeUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) {
    return null;
  }

  if (!/^https?:\/\//i.test(url) && !/^tg:\/\//i.test(url)) {
    if (!url.includes('.')) {
      return null;
    }
    url = `https://${url}`;
  }

  if (/^tg:\/\//i.test(url)) {
    return /^tg:\/\/\S+$/i.test(url) ? url : null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeButtonStyle(rawStyle) {
  const style = String(rawStyle || '').trim().toLowerCase();
  if (!style) {
    return null;
  }
  return VALID_BUTTON_STYLES.has(style) ? style : null;
}

function normalizeIconCustomEmojiId(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return null;
  }
  return /^\d+$/.test(value) ? value : null;
}

function parseJsonButtons(rawText) {
  const parsed = [];
  if (!rawText.startsWith('[')) {
    return parsed;
  }

  try {
    const asJson = JSON.parse(rawText);
    if (!Array.isArray(asJson)) {
      return parsed;
    }

    for (const button of asJson) {
      const text = String(button?.text || '').trim();
      const normalizedUrl = normalizeUrl(button?.url);
      const style = normalizeButtonStyle(button?.style);
      const iconCustomEmojiId = normalizeIconCustomEmojiId(button?.icon_custom_emoji_id);
      if (!text || !normalizedUrl) {
        continue;
      }
      parsed.push({
        text,
        url: normalizedUrl,
        ...(style ? { style } : {}),
        ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {})
      });
    }
  } catch {
    // Continua con parsing por líneas.
  }

  return parsed;
}

function splitButtonLine(line) {
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine) {
    return null;
  }

  // Soporte para flags con pipes: "Texto - URL | style:success | emoji:123"
  const parts = normalizedLine.split('|').map((p) => p.trim());
  const mainPart = parts[0];
  const flags = parts.slice(1);

  let text, url;
  const dashSeparator = mainPart.indexOf(' - ');
  if (dashSeparator > 0) {
    text = mainPart.slice(0, dashSeparator).trim();
    url = mainPart.slice(dashSeparator + 3).trim();
  } else {
    const pipeSeparator = mainPart.indexOf('|'); // Esto no debería ocurrir por el split inicial, pero por consistencia:
    if (pipeSeparator > 0) {
      text = mainPart.slice(0, pipeSeparator).trim();
      url = mainPart.slice(pipeSeparator + 1).trim();
    } else {
      return null;
    }
  }

  const result = { text, url };

  // Parsear flags adicionales
  for (const flag of flags) {
    const [key, ...valueParts] = flag.split(':');
    const value = valueParts.join(':').trim();
    if (!key || !value) continue;

    const lowerKey = key.toLowerCase();
    if (lowerKey === 'style') {
      const style = normalizeButtonStyle(value);
      if (style) result.style = style;
    } else if (lowerKey === 'emoji') {
      const emojiId = normalizeIconCustomEmojiId(value);
      if (emojiId) result.icon_custom_emoji_id = emojiId;
    }
  }

  return result;
}

function normalizeButtonsInput(input) {
  const text = String(input || '').trim();
  if (!text) {
    return [];
  }

  const fromJson = parseJsonButtons(text);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const parsed = [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const button = splitButtonLine(line);
    if (!button || !button.text) {
      continue;
    }
    const normalizedUrl = normalizeUrl(button.url);
    if (!normalizedUrl) {
      continue;
    }
    parsed.push({
      text: button.text,
      url: normalizedUrl,
      ...(button.style ? { style: button.style } : {}),
      ...(button.icon_custom_emoji_id ? { icon_custom_emoji_id: button.icon_custom_emoji_id } : {})
    });
  }

  return parsed;
}

module.exports = {
  normalizeUrl,
  normalizeButtonsInput,
  normalizeButtonStyle,
  normalizeIconCustomEmojiId
};

'use strict';

const { query } = require('../psql/db');
const { parseNumberFromEnv, parseUserAmount } = require('./money');

const ADVISOR_SETTING_KEYS = [
  'ADVISOR_CUSHION_CUP',
  'ADVISOR_SELL_RATE_CUP_PER_USD',
  'ADVISOR_MIN_SELL_USD',
  'LIMIT_MONTHLY_DEFAULT_CUP',
  'LIMIT_MONTHLY_BPA_CUP',
  'LIMIT_EXTENDABLE_BANKS',
];

const ADVISOR_SETTING_META = {
  ADVISOR_CUSHION_CUP: {
    label: 'Colchón objetivo (CUP)',
    configKey: 'cushion',
    type: 'int',
    min: 0,
    defaultValue: 150000,
  },
  ADVISOR_SELL_RATE_CUP_PER_USD: {
    label: 'Tasa de venta (CUP/USD)',
    configKey: 'sellRate',
    type: 'int',
    min: 1,
    defaultValue: 452,
  },
  ADVISOR_MIN_SELL_USD: {
    label: 'Venta mínima (USD)',
    configKey: 'minSellUsd',
    type: 'int',
    min: 0,
    defaultValue: 40,
  },
  LIMIT_MONTHLY_DEFAULT_CUP: {
    label: 'Límite mensual por banco (CUP)',
    configKey: 'limitMonthlyDefaultCup',
    type: 'int',
    min: 0,
    defaultValue: 120000,
  },
  LIMIT_MONTHLY_BPA_CUP: {
    label: 'Límite mensual BPA (CUP)',
    configKey: 'limitMonthlyBpaCup',
    type: 'int',
    min: 0,
    defaultValue: 120000,
  },
  LIMIT_EXTENDABLE_BANKS: {
    label: 'Bancos ampliables (CSV)',
    configKey: 'extendableBanks',
    type: 'csv',
    defaultValue: 'BPA',
  },
};

function isKnownAdvisorSettingKey(key = '') {
  return Object.prototype.hasOwnProperty.call(ADVISOR_SETTING_META, key);
}

function normalizeCsv(raw = '') {
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function normalizeSettingValue(key, raw) {
  const meta = ADVISOR_SETTING_META[key];
  if (!meta) {
    return { ok: false, error: 'Clave de configuración no soportada.' };
  }

  if (meta.type === 'csv') {
    const list = normalizeCsv(raw);
    return { ok: true, normalized: list.join(','), parsed: list };
  }

  const num = parseUserAmount(raw);
  if (!Number.isFinite(num)) {
    return { ok: false, error: 'Valor inválido. Debe ser numérico.' };
  }
  const rounded = Math.round(num);
  if (rounded < (meta.min ?? 0)) {
    return { ok: false, error: `Valor inválido. Debe ser >= ${meta.min}.` };
  }
  return { ok: true, normalized: String(rounded), parsed: rounded };
}

function getEnvNormalizedValue(key, env = process.env) {
  const meta = ADVISOR_SETTING_META[key];
  if (!meta) return '';
  if (meta.type === 'csv') {
    const envRaw = env[key];
    const defaultList = normalizeCsv(meta.defaultValue || '');
    const list = envRaw == null || String(envRaw).trim() === ''
      ? defaultList
      : normalizeCsv(envRaw);
    return list.join(',');
  }
  const num = parseNumberFromEnv(env[key], meta.defaultValue);
  return String(Math.round(num));
}

function getDbFallbackSafeRows(rows = []) {
  return Array.isArray(rows) ? rows.filter((r) => isKnownAdvisorSettingKey(r?.key)) : [];
}

async function loadAdvisorDbRows({ queryFn = query } = {}) {
  try {
    const { rows } = await queryFn(
      `
      SELECT key, value, updated_by, updated_at
      FROM advisor_setting
      WHERE key = ANY($1::text[])
      ORDER BY key
      `,
      [ADVISOR_SETTING_KEYS]
    );
    return getDbFallbackSafeRows(rows);
  } catch (err) {
    if (err?.code === '42P01') {
      console.warn('[advisorSettings] tabla advisor_setting no existe; se usará .env.');
      return [];
    }
    throw err;
  }
}

async function getAdvisorSettingsSnapshot({ env = process.env, queryFn = query } = {}) {
  const dbRows = await loadAdvisorDbRows({ queryFn });
  const dbMap = new Map(dbRows.map((r) => [r.key, r]));

  return ADVISOR_SETTING_KEYS.map((key) => {
    const envValue = getEnvNormalizedValue(key, env);
    const dbRow = dbMap.get(key) || null;
    let dbValue = null;
    let effectiveValue = envValue;
    let source = 'env';

    if (dbRow) {
      const parsedDb = normalizeSettingValue(key, dbRow.value);
      if (parsedDb.ok) {
        dbValue = parsedDb.normalized;
        effectiveValue = parsedDb.normalized;
        source = 'db';
      } else {
        dbValue = String(dbRow.value || '');
      }
    }

    return {
      key,
      label: ADVISOR_SETTING_META[key].label,
      source,
      effectiveValue,
      envValue,
      dbValue,
      updatedAt: dbRow?.updated_at || null,
      updatedBy: dbRow?.updated_by || null,
    };
  });
}

async function loadAdvisorConfigOverrides({ queryFn = query } = {}) {
  const dbRows = await loadAdvisorDbRows({ queryFn });
  const overrides = {};
  const sources = {};

  dbRows.forEach((row) => {
    const parsed = normalizeSettingValue(row.key, row.value);
    if (!parsed.ok) return;
    const meta = ADVISOR_SETTING_META[row.key];
    overrides[meta.configKey] = parsed.parsed;
    sources[meta.configKey] = 'db';
  });

  return { overrides, sources };
}

async function saveAdvisorSetting(key, rawValue, { queryFn = query, userId = null } = {}) {
  if (!isKnownAdvisorSettingKey(key)) {
    throw new Error('Clave de configuración inválida.');
  }
  const parsed = normalizeSettingValue(key, rawValue);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  await queryFn(
    `
    INSERT INTO advisor_setting (key, value, updated_by, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
    `,
    [key, parsed.normalized, userId]
  );
  return parsed.normalized;
}

async function deleteAdvisorSetting(key, { queryFn = query } = {}) {
  if (!isKnownAdvisorSettingKey(key)) {
    throw new Error('Clave de configuración inválida.');
  }
  await queryFn('DELETE FROM advisor_setting WHERE key = $1', [key]);
}

module.exports = {
  ADVISOR_SETTING_KEYS,
  ADVISOR_SETTING_META,
  isKnownAdvisorSettingKey,
  normalizeSettingValue,
  getAdvisorSettingsSnapshot,
  loadAdvisorConfigOverrides,
  saveAdvisorSetting,
  deleteAdvisorSetting,
};


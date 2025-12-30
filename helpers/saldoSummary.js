'use strict';

const { escapeHtml, fmtMoney } = require('./format');

/**
 * Helpers centralizados para resumir saldos por moneda dentro del flujo /saldo.
 *
 * Objetivo:
 * - Evitar DRY al formatear totales por moneda con equivalencia en USD.
 * - Unificar el formato HTML: <code>monto</code><b>MONEDA</b>.
 */

function formatAmountWithCurrency(amount, currency) {
  return `<code>${fmtMoney(amount)}</code><b>${escapeHtml(currency)}</b>`;
}

function resolveUsdRate(currency, rateMap) {
  const upper = String(currency || '').toUpperCase();
  if (rateMap[upper] !== undefined) {
    return Number(rateMap[upper]) || 0;
  }

  // Para casos tipo BOLSA/MITRANSFER, usamos la tasa CUP como equivalente.
  if ((/BOLSA|TRANSFER/.test(upper) || upper === 'MITRANSFER') && rateMap.CUP !== undefined) {
    return Number(rateMap.CUP) || 0;
  }

  return 0;
}

function buildCurrencyTotals(rows = [], rateMap = {}) {
  const totalsMap = new Map();

  rows.forEach((row) => {
    const currency = String(row.moneda || '—').toUpperCase();
    const amount = Number(row.saldo) || 0;

    if (!totalsMap.has(currency)) {
      totalsMap.set(currency, { currency, total: 0, usd: 0, rate: 0 });
    }

    const entry = totalsMap.get(currency);
    const rate = resolveUsdRate(currency, rateMap);
    entry.total += amount;
    entry.usd += amount * rate;
    entry.rate = rate;
  });

  return [...totalsMap.values()].filter((item) => item.total !== 0 || item.usd !== 0);
}

function renderCurrencyTotalsHtml(totals = [], title) {
  if (!totals.length) return '';

  const lines = totals
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((item) => {
      const totalLabel = formatAmountWithCurrency(item.total, item.currency);
      const usdLabel = item.rate
        ? ` (≈ ${formatAmountWithCurrency(item.usd, 'USD')})`
        : '';
      return `• ${totalLabel}${usdLabel}`;
    });

  return `${title ? `<b>${escapeHtml(title)}</b>\n` : ''}${lines.join('\n')}`;
}

async function loadCurrencyRateMap(pool) {
  const { rows } = await pool.query('SELECT UPPER(codigo) AS codigo, tasa_usd FROM moneda');
  const map = {};
  rows.forEach((row) => {
    map[row.codigo] = Number(row.tasa_usd) || 0;
  });
  console.log('[saldoSummary] tasas cargadas =>', map);
  return map;
}

module.exports = {
  formatAmountWithCurrency,
  resolveUsdRate,
  buildCurrencyTotals,
  renderCurrencyTotalsHtml,
  loadCurrencyRateMap,
};

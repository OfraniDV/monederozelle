'use strict';

const path = require('path');
const { escapeHtml } = require('../helpers/format');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');
const { safeSendMessage, safeReply } = require('../helpers/telegram');

// Escapa TODO texto dinámico para HTML
function h(text = '') {
  return escapeHtml(String(text));
}

// Envuelve líneas en <pre> escapando su contenido (para no romper parse_mode)
function pre(lines = []) {
  const safe = lines.map((l) => escapeHtml(String(l))).join('\n');
  return `<pre>${safe}</pre>`;
}

// Reemplaza comparaciones que puedan meter '<' o '>' en texto fuera de <pre>
function cmp(txt = '') {
  return String(txt).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const BANK_W = 6; // Banco
const CARD_W = 6; // Tarjeta (#1234)
const VAL_W = 8;  // Números (SAL, SALDO, LIBRE, CAP)
const ASSIGN_W = 7; // ↦ CUP en distribución
const CAP_W = VAL_W * 2 + 1; // "antes→desp"

// Fees constantes de BOLSA (no vienen de .env)
const BOLSA_TO_BOLSA_FEE_CUP = 1;     // mover de bolsa a bolsa
const BOLSA_TO_BANK_FEE_PCT  = 0.05;  // mover de bolsa a tarjeta banco

let db;
try {
  db = require(path.join(__dirname, '..', 'psql', 'db.js'));
} catch (err) {
  console.error('[fondoAdvisor] Error cargando db:', err.message);
  throw err;
}

const { query } = db;

const BANK_SYNONYMS = new Map([
  ['TRANSFERMOVIL', 'MITRANSFER'],
  ['METROPOLITANO', 'METRO'],
  ['BANCOMETROPOLITANO', 'METRO'],
  ['BANCOMETROPOLITANOSA', 'METRO'],
  ['BANCOPOPULARDEAHORRO', 'BPA'],
  ['BANCOPOPULARDEAHORROSA', 'BPA'],
  ['BANCODECREDITOYCOMERCIO', 'BANDEC'],
  ['BANCODECREDITOYCOMERCIOSA', 'BANDEC'],
]);

function normalizeBankCode(raw = '') {
  if (raw == null) return '';
  const upper = String(raw).trim().toUpperCase();
  if (!upper) return '';
  const normalized = upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, '');
  const compact = normalized.replace(/\s+/g, '');
  if (!compact) return '';
  if (BANK_SYNONYMS.has(compact)) return BANK_SYNONYMS.get(compact);
  return compact;
}

function normalizeBankList(list = []) {
  const seen = new Set();
  const out = [];
  list.forEach((bank) => {
    const normalized = normalizeBankCode(bank);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  });
  return out;
}

const DEFAULT_CONFIG = {
  cushion: 150000,
  sellRate: 452,
  minSellUsd: 40,
  liquidityBanks: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
  sellFeePct: 0,
  fxMarginPct: 0,
  sellRoundToUsd: 1,
  minKeepUsd: 0,
  limitMonthlyDefaultCup: 120000,
  limitMonthlyBpaCup: 120000,
  extendableBanks: ['BPA'],
  allocationBankOrder: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
  assessableBanks: ['BANDEC', 'BPA', 'METRO', 'MITRANSFER'],
};

const USD_CODES = new Set(['USD', 'MLC']);
const RECEIVABLE_REGEX = /(debe|deuda|deudas|deudor)/i;

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseList(value, fallback) {
  if (!value) return fallback.slice();
  return value
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  return {
    cushion: Math.round(parseNumber(env.ADVISOR_CUSHION_CUP, DEFAULT_CONFIG.cushion)),
    sellRate: parseNumber(env.ADVISOR_SELL_RATE_CUP_PER_USD, DEFAULT_CONFIG.sellRate),
    minSellUsd: Math.ceil(parseNumber(env.ADVISOR_MIN_SELL_USD, DEFAULT_CONFIG.minSellUsd)),
    liquidityBanks: normalizeBankList(
      parseList(env.ADVISOR_BANKS_LIQUIDOS, DEFAULT_CONFIG.liquidityBanks)
    ),
    sellFeePct: parseNumber(env.ADVISOR_SELL_FEE_PCT, DEFAULT_CONFIG.sellFeePct),
    fxMarginPct: parseNumber(env.ADVISOR_FX_MARGIN_PCT, DEFAULT_CONFIG.fxMarginPct),
    sellRoundToUsd: Math.max(1, Math.round(parseNumber(env.ADVISOR_SELL_ROUND_TO_USD, DEFAULT_CONFIG.sellRoundToUsd))),
    minKeepUsd: Math.max(0, Math.round(parseNumber(env.ADVISOR_MIN_KEEP_USD, DEFAULT_CONFIG.minKeepUsd))),
    limitMonthlyDefaultCup: Math.round(
      parseNumber(env.LIMIT_MONTHLY_DEFAULT_CUP, DEFAULT_CONFIG.limitMonthlyDefaultCup)
    ),
    limitMonthlyBpaCup: Math.round(
      parseNumber(env.LIMIT_MONTHLY_BPA_CUP, DEFAULT_CONFIG.limitMonthlyBpaCup)
    ),
    extendableBanks: normalizeBankList(
      parseList(env.LIMIT_EXTENDABLE_BANKS, DEFAULT_CONFIG.extendableBanks)
    ),
    assessableBanks: normalizeBankList(
      parseList(env.LIMIT_ASSESSABLE_BANKS, DEFAULT_CONFIG.assessableBanks)
    ),
    allocationBankOrder: normalizeBankList(
      parseList(env.ADVISOR_ALLOCATION_BANK_ORDER, DEFAULT_CONFIG.allocationBankOrder)
    ),
  };
}

function maskCardNumber(numero) {
  // Compacto y sin “****”: solo últimos 4 como #1234
  const raw = typeof numero === 'string' ? numero.replace(/\s+/g, '') : `${numero || ''}`;
  const last4 = raw.slice(-4);
  return `#${last4 || '—'}`;
}

async function getMonthlyOutflowsByCard(config = {}) {
  const assessableBanks = normalizeBankList(
    (config.assessableBanks && config.assessableBanks.length
      ? config.assessableBanks
      : DEFAULT_CONFIG.assessableBanks) || []
  );

  if (!assessableBanks.length) {
    console.log('[fondoAdvisor] Sin bancos evaluables para límites mensuales.');
    return [];
  }

  const buildSql = (withSchema = false) => {
    const prefix = withSchema ? 'chema.' : '';
    return `
    SELECT t.id,
           t.numero,
           UPPER(b.codigo) AS banco,
           UPPER(m.codigo) AS moneda,
           UPPER(a.nombre) AS agente,
           COALESCE(SUM(CASE WHEN mv.importe < 0 THEN -mv.importe ELSE 0 END), 0) AS used_out,
           COALESCE(lastmv.saldo_nuevo, 0) AS saldo_actual
      FROM ${prefix}tarjeta t
      JOIN ${prefix}banco  b ON b.id = t.banco_id
      JOIN ${prefix}moneda m ON m.id = t.moneda_id
     LEFT JOIN ${prefix}agente a ON a.id = t.agente_id
     LEFT JOIN ${prefix}movimiento mv
        ON mv.tarjeta_id = t.id
       AND mv.creado_en >= date_trunc('month', (now() at time zone 'America/Havana'))
       AND mv.creado_en <  (date_trunc('month', (now() at time zone 'America/Havana')) + interval '1 month')
     LEFT JOIN LATERAL (
        SELECT saldo_nuevo
          FROM ${prefix}movimiento
         WHERE tarjeta_id = t.id
         ORDER BY creado_en DESC
         LIMIT 1
     ) lastmv ON TRUE
     WHERE UPPER(m.codigo) = 'CUP'
       AND UPPER(b.codigo) = ANY($1::text[])
     GROUP BY t.id, t.numero, b.codigo, m.codigo, a.nombre, lastmv.saldo_nuevo
  `;
  };

  const params = [assessableBanks];
  let res;
  let schemaSource = 'chema';
  try {
    res = await query(buildSql(true), params);
  } catch (err) {
    const isMissingSchema = err?.code === '42P01' || /chema\./i.test(err?.message || '');
    if (!isMissingSchema) throw err;
    console.warn('[fondoAdvisor] Fallback consulta límites sin esquema (chema ausente).');
    res = await query(buildSql(false), params);
    schemaSource = 'public';
  }

  if (((res?.rows) || []).length === 0 && schemaSource === 'chema') {
    console.warn(
      "[fondoAdvisor] Consulta límites en esquema 'chema' vacía; intentando esquema público."
    );
    try {
      const fallbackRes = await query(buildSql(false), params);
      if (fallbackRes?.rows?.length) {
        res = fallbackRes;
        schemaSource = 'public';
      }
    } catch (err) {
      console.error('[fondoAdvisor] Error al consultar esquema público:', err.message);
    }
  }
  console.log(
    `[fondoAdvisor] Límites mensuales obtenidos desde esquema=${schemaSource}; filas=${
      res?.rows?.length || 0
    }.`
  );
  const allowedBanks = new Set(assessableBanks);

  const normalizedRows = (res?.rows || []).map((row) => {
    const moneda = (row.moneda || '').toUpperCase();
    const bancoRaw = (row.banco || '').toUpperCase();
    const banco = normalizeBankCode(bancoRaw);
    return {
      id: row.id,
      numero: row.numero,
      banco,
      bancoRaw,
      moneda,
      agente: (row.agente || '').toUpperCase(),
      used_out: Math.round(Number(row.used_out) || 0),
      saldo_actual: Math.round(Number(row.saldo_actual) || 0),
    };
  });

  const filtered = [];
  normalizedRows.forEach((row) => {
    if (row.moneda !== 'CUP') {
      console.log(
        `[fondoAdvisor] Excluida tarjeta ${cmp(row.numero)} del cálculo mensual por moneda=${cmp(
          row.moneda
        )}.`
      );
      return;
    }
    if (!allowedBanks.has(row.banco)) {
      console.log(
        `[fondoAdvisor] Excluida tarjeta ${cmp(row.numero)} banco=${cmp(row.bancoRaw)} (normalizado=${cmp(
          row.banco
        )}) no reconocido.`
      );
      return;
    }
    filtered.push({
      id: row.id,
      numero: row.numero,
      banco: row.banco,
      moneda: row.moneda,
      agente: row.agente,
      used_out: row.used_out,
      saldo_actual: row.saldo_actual,
    });
  });

  return filtered;
}

function classifyMonthlyUsage(rows = [], config = {}) {
  const defaultLimit = Math.max(0, Math.round(config.limitMonthlyDefaultCup || 0));
  const bpaLimit = Math.max(0, Math.round(config.limitMonthlyBpaCup || defaultLimit));
  const extendableSet = new Set(
    normalizeBankList(
      (config.extendableBanks && config.extendableBanks.length
        ? config.extendableBanks
        : DEFAULT_CONFIG.extendableBanks) || []
    )
  );

  const cards = rows.map((row) => {
    const normalizedBank = row.banco ? normalizeBankCode(row.banco) : '';
    const bank = normalizedBank || 'SIN BANCO';
    const usedOut = Math.round(Number(row.used_out) || 0);
    const saldoActualRaw = Math.round(Number(row.saldo_actual) || 0);
    const limit = bank === 'BPA' ? bpaLimit : defaultLimit;
    const remainingRaw = limit - usedOut;
    const remaining = remainingRaw > 0 ? remainingRaw : 0;
    const balancePos = saldoActualRaw > 0 ? saldoActualRaw : 0;
    const depositCapRaw = remaining - balancePos;
    const depositCap = depositCapRaw > 0 ? depositCapRaw : 0;
    // Detectar BOLSA:
    //  • Todo MITRANSFER se considera BOLSA
    //  • Además, si agente o número contienen "BOLSA"
    const isBolsa = bank === 'MITRANSFER'
      || /BOLSA/.test(row.agente || '')
      || /BOLSA/.test(row.numero || '');
    const status = remaining === 0
      ? extendableSet.has(bank)
        ? 'EXTENDABLE'
        : 'BLOCKED'
      : 'OK';
    return {
      id: row.id,
      bank,
      numero: row.numero || 'SIN NUMERO',
      mask: maskCardNumber(row.numero || ''),
      usedOut,
      limit,
      remaining,
      status,
      extendable: status === 'EXTENDABLE',
      isBolsa,
      saldoActual: saldoActualRaw,
      balancePos,
      depositCap,
    };
  });

  const totals = cards.reduce(
    (acc, card) => {
      acc.totalRemaining += card.remaining;
      if (card.status === 'BLOCKED') acc.blocked += 1;
      if (card.status === 'EXTENDABLE') acc.extendable += 1;
      return acc;
    },
    { totalRemaining: 0, blocked: 0, extendable: 0 }
  );

  return { cards, totals };
}

function sortCardsByPreference(cards = [], bankOrder = []) {
  const orderMap = new Map();
  bankOrder.forEach((bank, idx) => {
    const normalized = normalizeBankCode(bank);
    if (normalized && !orderMap.has(normalized)) {
      orderMap.set(normalized, idx);
    }
  });
  const maxOrder = bankOrder.length + 1;
  return [...cards].sort((a, b) => {
    const orderA = orderMap.has(a.bank) ? orderMap.get(a.bank) : maxOrder;
    const orderB = orderMap.has(b.bank) ? orderMap.get(b.bank) : maxOrder;
    if (orderA !== orderB) return orderA - orderB;
    const capA = Math.round(a.depositCap || 0);
    const capB = Math.round(b.depositCap || 0);
    if (capA !== capB) return capB - capA;
    if (a.remaining !== b.remaining) return b.remaining - a.remaining;
    return (a.mask || '').localeCompare(b.mask || '');
  });
}

async function loadMonthlyUsage(config = {}) {
  const rows = await getMonthlyOutflowsByCard(config);
  return classifyMonthlyUsage(rows, config);
}

function computeCupDistribution(amount, cards = [], bankOrder = []) {
  const target = Math.round(Number(amount) || 0);
  if (target <= 0) {
    return { totalAssigned: 0, leftover: 0, assignments: [] };
  }

  let remainingAmount = target;
  const assignments = [];
  const ordered = sortCardsByPreference(cards, bankOrder);

  const nonBolsaOK = ordered.filter((c) => c.status === 'OK' && !c.isBolsa);
  const nonBolsaExt = ordered.filter((c) => c.status === 'EXTENDABLE' && !c.isBolsa);
  const bolsaAny    = ordered.filter((c) => c.isBolsa); // fallback

  const pushAssign = (card, before, assign) => {
    const beforeSafe = Math.max(0, Math.round(before || 0));
    const after = Math.max(0, beforeSafe - Math.round(assign || 0));
    assignments.push({
      bank: card.bank,
      mask: card.mask,
      numero: card.numero,
      assignCup: assign,
      remainingAntes: beforeSafe,
      remainingDespues: after,
      status: card.status,
      extendable: card.extendable,
      isBolsa: !!card.isBolsa,
    });
  };

  const allocate = (candidates, allowExtendable = false) => {
    candidates.forEach((card) => {
      if (remainingAmount <= 0) return;
      const before = Math.round(card.depositCap || 0);
      if (!allowExtendable && before <= 0) return;
      let capacity = before;
      if (allowExtendable) {
        capacity = Math.max(before, remainingAmount);
      }
      const assign = Math.min(Math.round(capacity || 0), remainingAmount);
      if (assign <= 0) return;
      pushAssign(card, before, assign);
      remainingAmount -= assign;
    });
  };

  // 1) Bancos normales con capacidad
  allocate(nonBolsaOK);
  // 2) EXTENDABLE (p.ej. BPA con Multibanca)
  if (remainingAmount > 0) allocate(nonBolsaExt, true);
  // 3) Fallback: BOLSA (sin límite práctico)
  if (remainingAmount > 0 && bolsaAny.length) {
    bolsaAny.forEach((card) => {
      if (remainingAmount <= 0) return;
      const before = Math.round(card.depositCap || card.remaining || 0);
      const assign = remainingAmount; // sin límite → absorber todo
      pushAssign(card, before, assign);
      remainingAmount = 0;
    });
  }

  return {
    totalAssigned: target - remainingAmount,
    leftover: remainingAmount,
    assignments,
  };
}

function describeLimitStatus(status) {
  if (status === 'BLOCKED') return '⛔️';
  if (status === 'EXTENDABLE') return '🟡 ampliable';
  return '🟢';
}

function describeAllocationStatus(status) {
  if (status === 'EXTENDABLE') return '🟡';
  if (status === 'BLOCKED') return '⛔️';
  return '🟢';
}

function formatInteger(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ——— Severidad del encabezado (según necesidad en CUP y cobertura con USD) ———
function sumNonBolsaDepositCap(monthlyLimits) {
  const cards = (monthlyLimits?.cards || []).filter((c) => !c.isBolsa && c.bank !== 'MITRANSFER');
  return cards.reduce((acc, c) => acc + Math.max(0, Math.round(c.depositCap || 0)), 0);
}

function computeHeadlineSeverity({ needCup, sellNowCupIn, invUsableUsd, minSellUsd, capSum }) {
  // Regla:
  // - NORMAL (🟢): no hay necesidad (needCup <= 0)
  // - URGENTE (🔴): hay necesidad y la cobertura inmediata es insuficiente (sellNow < need)
  // - PRIORITARIO (🟠): hay necesidad y la cobertura inmediata alcanza (sellNow >= need),
  //                     pero requiere acción (venta/colocación); si invUsable < minSell → ATENCIÓN (🟡)
  if (needCup <= 0) return { icon: '🟢', label: 'NORMAL' };
  const coverage = sellNowCupIn > 0 ? sellNowCupIn / needCup : 0;
  if (coverage < 1) {
    return { icon: '🔴', label: 'URGENTE' };
  }
  // Cobertura >= 1 ⇒ podemos cubrir, pero NO es "normal": requiere acción
  if (invUsableUsd < (minSellUsd || 0)) {
    return { icon: '🟡', label: 'ATENCIÓN' };
  }
  // Si no hay capacidad para colocar todo lo vendido, mantenemos PRIORITARIO igualmente
  // (capSum solo se usa para matizar decisiones; no cambiamos el color en este parche)
  return { icon: '🟠', label: 'PRIORITARIO' };
}

function fmtCup(value) {
  const rounded = Math.round(value || 0);
  return h(rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
}

function fmtUsd(value) {
  const rounded = Math.round(value || 0);
  return h(rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
}

function fmtUsdDetailed(value) {
  const num = Number(value) || 0;
  const rounded = Math.round(num * 100) / 100;
  return h(
    rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

async function getLatestBalances() {
  const sql = `
    SELECT COALESCE(m.codigo,'—')  AS moneda,
           COALESCE(b.codigo,'SIN BANCO') AS banco,
           COALESCE(a.nombre,'SIN AGENTE') AS agente,
           COALESCE(t.numero,'SIN NUMERO') AS numero,
           COALESCE(m.tasa_usd,1)  AS tasa_usd,
           COALESCE(mv.saldo_nuevo,0) AS saldo
      FROM tarjeta t
      LEFT JOIN banco b ON b.id = t.banco_id
      LEFT JOIN moneda m ON m.id = t.moneda_id
      LEFT JOIN agente a ON a.id = t.agente_id
      LEFT JOIN LATERAL (
        SELECT saldo_nuevo
          FROM movimiento
         WHERE tarjeta_id = t.id
         ORDER BY creado_en DESC
         LIMIT 1
      ) mv ON TRUE;`;
  const res = await query(sql);
  return res.rows || [];
}

async function getBuyRateFromDb() {
  try {
    const { rows } = await query(
      "SELECT tasa_usd FROM moneda WHERE UPPER(codigo) = 'CUP' ORDER BY id DESC LIMIT 1"
    );
    if (rows && rows.length) {
      const tasaUsdRaw = Number(rows[0].tasa_usd);
      if (Number.isFinite(tasaUsdRaw) && tasaUsdRaw > 0) {
        // La columna moneda.tasa_usd representa USD por unidad de la moneda.
        // Para CUP, necesitamos CUP por USD (compra en CUP/USD) => invertir cuando < 1.
        const cupPerUsd =
          tasaUsdRaw < 1 ? (1 / tasaUsdRaw) : tasaUsdRaw;
        console.log(
          `[fondoAdvisor] BUY rate (CUP/USD) normalizado desde DB => ${cupPerUsd} (raw=${tasaUsdRaw})`
        );
        return cupPerUsd;
      }
    }
  } catch (err) {
    console.error('[fondoAdvisor] Error leyendo tasa BUY de DB:', err.message);
  }
  return null;
}

function aggregateBalances(rows = [], liquidityBanks = []) {
  const activos = { cup: 0, deudas: 0, neto: 0 };
  let usdInventory = 0;
  const liquidityByBank = {};
  const liquiditySet = new Set(
    normalizeBankList(
      (liquidityBanks && liquidityBanks.length ? liquidityBanks : DEFAULT_CONFIG.liquidityBanks) || []
    )
  );
  const currencyDiagnostics = {
    CUP: { count: 0, total: 0 },
    MLC: { count: 0, total: 0 },
    USD: { count: 0, total: 0 },
    OTHER: { count: 0, total: 0 },
  };

  rows.forEach((r) => {
    const saldoRaw = Number(r.saldo) || 0;
    const moneda = (r.moneda || '').toUpperCase();
    const bancoRaw = (r.banco || '').toUpperCase();
    const banco = normalizeBankCode(bancoRaw);
    const agente = (r.agente || '').toUpperCase();
    const numero = (r.numero || '').toUpperCase();
    const tasaUsd = Number(r.tasa_usd) || 0;

    const diagBucket = currencyDiagnostics[moneda] || currencyDiagnostics.OTHER;
    diagBucket.count += 1;
    diagBucket.total += saldoRaw;

    const hasReceivableKeyword = RECEIVABLE_REGEX.test(agente) ||
      RECEIVABLE_REGEX.test(bancoRaw) ||
      RECEIVABLE_REGEX.test(numero);

    if (moneda === 'CUP') {
      if (saldoRaw >= 0) {
        if (!hasReceivableKeyword) {
          activos.cup += saldoRaw;
          if (liquiditySet.has(banco)) {
            liquidityByBank[banco] = (liquidityByBank[banco] || 0) + saldoRaw;
          } else {
            console.log(
              `[fondoAdvisor] Excluida fila ${cmp(numero)} del banco ${cmp(
                bancoRaw
              )} por banco no reconocido en liquidez.`
            );
          }
        } else {
          console.log(
            `[fondoAdvisor] Excluida fila ${cmp(numero)} (${cmp(bancoRaw)}) por coincidencia con regex de deudas.`
          );
        }
      } else {
        activos.deudas += saldoRaw;
        if (liquiditySet.has(banco)) {
          liquidityByBank[banco] = (liquidityByBank[banco] || 0);
        }
      }
    } else {
      console.log(
        `[fondoAdvisor] Fila ${cmp(numero)} ignorada para liquidez CUP por moneda=${cmp(moneda)}.`
      );
    }

    if (USD_CODES.has(moneda) && saldoRaw > 0) {
      // Interpretacion correcta: moneda.tasa_usd = USD por unidad de esa moneda.
      // Para inventario en USD, multiplicamos saldo * tasa_usd.
      const usdPerUnit = Number(r.tasa_usd) > 0 ? Number(r.tasa_usd) : 1;
      const usd = saldoRaw * usdPerUnit;
      if (usd > 0) usdInventory += usd;
    }
  });

  activos.neto = activos.cup + activos.deudas;
  const liquidityTotal = Object.values(liquidityByBank).reduce((acc, v) => acc + (v || 0), 0);

  const diagParts = ['CUP', 'MLC', 'USD']
    .map((code) => {
      const bucket = currencyDiagnostics[code];
      return `${code}: ${bucket.count} filas / saldo=${Math.round(bucket.total || 0)}`;
    })
    .concat(
      currencyDiagnostics.OTHER.count
        ? [`OTRAS: ${currencyDiagnostics.OTHER.count} filas / saldo=${Math.round(currencyDiagnostics.OTHER.total || 0)}`]
        : []
    );
  console.log(`[fondoAdvisor] Saldos por moneda => ${diagParts.join(' • ')}.`);

  return {
    activosCup: activos.cup,
    deudasCup: activos.deudas,
    netoCup: activos.neto,
    usdInventory,
    liquidityByBank,
    liquidityTotal,
  };
}

function computeNeeds({ activosCup = 0, deudasCup = 0, cushionTarget = DEFAULT_CONFIG.cushion }) {
  const cushion = Math.round(cushionTarget || 0);
  const deudaAbsRaw = Math.abs(deudasCup || 0);
  const deudaAbs = Math.round(deudaAbsRaw);
  const disponibles = Math.round((activosCup || 0) - deudaAbsRaw);
  const rawNeed = deudaAbsRaw + cushion - (activosCup || 0);
  const needCup = Math.max(0, Math.round(rawNeed));
  console.log(
    `[fondoAdvisor] Necesidad calculada => deudasAbs=${deudaAbs} cushion=${cushion} activos=${Math.round(
      activosCup || 0
    )} needCup=${needCup}`
  );
  return { needCup, cushionTarget: cushion, disponibles, deudaAbs };
}

function computePlan({
  needCup = 0,
  usdInventory = 0,
  sellRate = DEFAULT_CONFIG.sellRate,
  minSellUsd = DEFAULT_CONFIG.minSellUsd,
  sellFeePct = DEFAULT_CONFIG.sellFeePct,
  fxMarginPct = DEFAULT_CONFIG.fxMarginPct,
  sellRoundToUsd = DEFAULT_CONFIG.sellRoundToUsd,
  minKeepUsd = DEFAULT_CONFIG.minKeepUsd,
  sellRateSource = 'env',
}) {
  const normalizedNeed = Math.max(0, Math.round(needCup || 0));
  const rawSellRate = sellRate > 0 ? Math.round(sellRate) : 0;
  const feePct = sellFeePct > 0 ? Number(sellFeePct) : 0;
  const fxMargin = fxMarginPct > 0 ? Number(fxMarginPct) : 0;
  const roundTo = sellRoundToUsd > 0 ? Math.max(1, Math.round(sellRoundToUsd)) : 1;
  const minUsd = minSellUsd > 0 ? Math.round(minSellUsd) : 0;
  const keepUsd = minKeepUsd > 0 ? Math.round(minKeepUsd) : 0;
  const inventoryFloor = usdInventory > 0 ? Math.floor(usdInventory) : 0;
  const usableInventory = Math.max(0, inventoryFloor - keepUsd);
  const sellNet = rawSellRate > 0 ? Math.floor(rawSellRate * (1 - feePct)) : 0;

  console.log(
    `[fondoAdvisor] Tasas venta => SELL bruto=${rawSellRate} fee=${feePct} sellNet=${sellNet} source=${sellRateSource}`
  );
  console.log(
    `[fondoAdvisor] Inventario USD => total=${inventoryFloor} reservado=${keepUsd} util=${usableInventory} minVenta=${minUsd}`
  );

  if (normalizedNeed === 0 || sellNet === 0) {
    return {
      status: 'OK',
      sellTarget: { usd: 0, cupIn: 0 },
      sellNow: { usd: 0, cupIn: 0 },
      remainingCup: 0,
      remainingUsd: 0,
      sellNet,
      usedSellSource: sellRateSource,
    };
  }

  const sellTargetUsdRaw = Math.ceil(normalizedNeed / sellNet);
  const fxMarginUsd = Math.ceil(sellTargetUsdRaw * fxMargin);
  let sellTargetUsd = sellTargetUsdRaw + fxMarginUsd;
  if (roundTo > 1) {
    sellTargetUsd = Math.ceil(sellTargetUsd / roundTo) * roundTo;
  }
  const sellTargetCupIn = sellTargetUsd * sellNet;

  console.log(
    `[fondoAdvisor] Objetivo USD => raw=${sellTargetUsdRaw} fxMargin=${fxMarginUsd} redondeo=${roundTo} objetivo=${sellTargetUsd}`
  );

  let sellNowUsd = Math.min(usableInventory, sellTargetUsd);
  let minWarning = false;
  if (sellTargetUsd > 0 && sellNowUsd < minUsd) {
    sellNowUsd = 0;
    minWarning = true;
  }

  const sellNowCupIn = sellNowUsd * sellNet;
  const remainingCup = Math.max(0, normalizedNeed - sellNowCupIn);
  const remainingUsd = sellNet > 0 ? Math.ceil(remainingCup / sellNet) : 0;

  console.log(
    `[fondoAdvisor] Venta inmediata => usd=${sellNowUsd} cup=${sellNowCupIn} remainingCup=${remainingCup} remainingUsd=${remainingUsd}`
  );
  if (minWarning) {
    console.log('[fondoAdvisor] Inventario USD por debajo del mínimo configurable para vender ahora.');
  }

  return {
    status: sellTargetUsd > 0 ? 'NEED_ACTION' : 'OK',
    sellTarget: { usd: sellTargetUsd, cupIn: sellTargetCupIn },
    sellNow: minWarning
      ? { usd: sellNowUsd, cupIn: sellNowCupIn, minWarning: true }
      : { usd: sellNowUsd, cupIn: sellNowCupIn },
    remainingCup,
    remainingUsd,
    sellNet,
    usedSellSource: sellRateSource,
  };
}

function computeProjection(activosCup = 0, deudasCup = 0, sellNowCupIn = 0) {
  const activosPost = Math.round((activosCup || 0) + (sellNowCupIn || 0));
  const deudaAbs = Math.abs(deudasCup || 0);
  const negativosPost = Math.max(deudaAbs - activosPost, 0);
  const colchonPost = Math.max(activosPost - deudaAbs, 0);
  return {
    negativosPost,
    colchonPost,
  };
}

function computeUrgency({ needCup = 0, sellNowUsd = 0, remainingCup = 0, sellTargetUsd = 0 }) {
  if (needCup > 0 && sellNowUsd === 0) return '🔴 URGENTE';
  if (needCup > 0 && sellNowUsd > 0 && sellNowUsd < sellTargetUsd) return '🟠 PRIORITARIO';
  if (remainingCup === 0) return '🟢 NORMAL';
  return '🟢 NORMAL';
}

function renderAdvice(result) {
  const {
    activosCup,
    deudasCup,
    netoCup,
    cushionTarget,
    needCup,
    disponibles,
    plan,
    projection,
    liquidityByBank,
    config,
    deudaAbs,
    urgency,
    monthlyLimits,
    distributionNow,
    distributionTarget,
    buyRateCup,
    buyRateSource,
    sellRateSource,
  } = result;

  const blocks = [];
  blocks.push('🧮 <b>Asesor de Fondo</b>');

  // Calcular severidad del encabezado según necesidad y cobertura
  const invTotalUsd   = Math.max(0, Math.floor(result.usdInventory || 0));
  const invReserveUsd = Math.max(0, Math.round(config.minKeepUsd || 0));
  const invUsableUsd  = Math.max(0, invTotalUsd - invReserveUsd);
  const sellNowCupIn  = Math.max(0, Math.round((plan?.sellNow?.cupIn) || (plan?.sellTarget?.cupIn && plan?.sellTarget?.cupIn <= invUsableUsd * (config.sellRate || 0) ? plan.sellTarget.cupIn : 0) || 0));
  const capSum        = sumNonBolsaDepositCap(monthlyLimits);
  const sev = computeHeadlineSeverity({
    needCup: Math.max(0, Math.round(needCup || 0)),
    sellNowCupIn,
    invUsableUsd,
    minSellUsd: Math.round(config.minSellUsd || 0),
    capSum,
  });
  blocks.push(`${h(sev.icon)} ${h(sev.label)}`);
  blocks.push('━━━━━━━━━━━━━━━━━━');

  const resolvedBuyRate = Number(buyRateCup || config.buyRateCup || 0);
  const hasBuyRate = Number.isFinite(resolvedBuyRate) && resolvedBuyRate > 0;
  const resolvedBuySource = (buyRateSource && buyRateSource !== 'none'
    ? buyRateSource
    : config.buyRateSource && config.buyRateSource !== 'none'
      ? config.buyRateSource
      : null) || null;
  const resolvedSellSource = (sellRateSource || plan?.usedSellSource || 'env').toUpperCase();
  const buySourceLabel = resolvedBuySource ? resolvedBuySource.toUpperCase() : 'N/D';
  const activosUsdEquiv = hasBuyRate ? (activosCup || 0) / resolvedBuyRate : null;
  const netoUsdEquiv = hasBuyRate ? (netoCup || 0) / resolvedBuyRate : null;

  console.log(
    `[fondoAdvisor] renderAdvice => tasa de compra aplicada: ${hasBuyRate ? resolvedBuyRate : 'sin dato'} (fuente ${buySourceLabel})`
  );

  const estado = [
    '📊 <b>Estado actual CUP</b>',
    hasBuyRate
      ? `• Activos: ${fmtCup(activosCup)} CUP (≈ ${fmtUsdDetailed(activosUsdEquiv)} USD)`
      : `• Activos: ${fmtCup(activosCup)} CUP`,
    `• Deudas: ${fmtCup(deudasCup)} CUP`,
    hasBuyRate
      ? `• Neto: ${fmtCup(netoCup)} CUP (≈ ${fmtUsdDetailed(netoUsdEquiv)} USD)`
      : `• Neto: ${fmtCup(netoCup)} CUP`,
    `• Libre tras deudas: ${fmtCup(disponibles)} CUP`,
  ];
  blocks.push(estado.join('\n'));

  const objetivo = [
    '🎯 <b>Objetivo</b>',
    `• Colchón objetivo: ${fmtCup(cushionTarget)} CUP`,
    `• Necesidad adicional: ${fmtCup(needCup)} CUP`,
  ];
  blocks.push(objetivo.join('\n'));

  // Bloque de inventario USD/Zelle (1x1) — total y utilizable
  try {
    const invTotal = Math.max(0, Math.floor(result.usdInventory || 0));
    const invReserve = Math.max(0, Math.round(config.minKeepUsd || 0));
    const invUsable = Math.max(0, invTotal - invReserve);
    const invLines = [
      '💵 <b>Inventario USD/Zelle</b>',
      `• Total: ${fmtUsd(invTotal)} USD`,
      `• Disponible ahora: ${fmtUsd(invUsable)} USD${
        invUsable < (config.minSellUsd || 0) ? ' (⚠️ por debajo del mínimo de venta)' : ''
      }`
    ];
    blocks.push(invLines.join('\n'));
  } catch (e) {
    console.error('[fondoAdvisor] Inventario USD render error:', e.message);
  }

  const venta = [
    '💸 <b>Venta requerida (Zelle)</b>',
    `• Objetivo: vender ${fmtUsd(plan.sellTarget.usd)} USD a ${fmtCup(plan.sellNet)} ⇒ +${fmtCup(plan.sellTarget.cupIn)} CUP`,
  ];
  const sellNowLine = `• Vende ahora: ${fmtUsd(plan.sellNow.usd)} USD ⇒ +${fmtCup(plan.sellNow.cupIn)} CUP`;
  if (plan.sellNow.usd === 0 && plan.sellNow.minWarning) {
    venta.push(
      `${sellNowLine} (⚠️ inventario menor al mínimo de ${fmtUsd(config.minSellUsd)} USD)`
    );
  } else {
    venta.push(sellNowLine);
  }
  venta.push(
    `• Faltante tras venta: ${fmtCup(plan.remainingCup)} CUP (≈ ${fmtUsd(plan.remainingUsd)} USD)`
  );
  blocks.push(venta.join('\n'));

  if (hasBuyRate) {
    const excesoCupRaw = (activosCup || 0) - Math.abs(deudasCup || 0) - (cushionTarget || 0);
    const excesoCup = Math.max(0, Math.round(excesoCupRaw));
    if (excesoCup > 0) {
      const objetivoUsd = Math.floor(excesoCup / resolvedBuyRate);
      const objetivoCup = Math.round(objetivoUsd * resolvedBuyRate);
      const compra = [
        '💠 <b>Compra sugerida (USD)</b>',
        `• Exceso sobre colchón/deudas: ${fmtCup(excesoCup)} CUP`,
        `• Objetivo: comprar ${fmtUsd(objetivoUsd)} USD a ${fmtCup(resolvedBuyRate)} ⇒ −${fmtCup(objetivoCup)} CUP`,
      ];
      if (objetivoUsd > 0) {
        compra.push(`• Compra ahora: ${fmtUsd(objetivoUsd)} USD ⇒ −${fmtCup(objetivoCup)} CUP`);
      }
      blocks.push(compra.join('\n'));
    }
  }

  const limitsData = monthlyLimits || { cards: [] };
  const orderedCards = sortCardsByPreference(limitsData.cards || [], config.allocationBankOrder || [])
    // No mostrar BOLSA (MITRANSFER y similares) en el bloque de límites
    .filter((c) => !c.isBolsa && c.bank !== 'MITRANSFER');
  const limitDefaultFmt = formatInteger(
    config.limitMonthlyDefaultCup ?? DEFAULT_CONFIG.limitMonthlyDefaultCup
  );
  const limitBpaFmt = formatInteger(
    config.limitMonthlyBpaCup ?? config.limitMonthlyDefaultCup ?? DEFAULT_CONFIG.limitMonthlyBpaCup
  );
  const limitInfoLine = `ℹ️ Límite mensual: Estándar ${h(limitDefaultFmt)} CUP • BPA ${h(limitBpaFmt)} CUP (ampliable)`;
  const limitPreLines = [];
  if (!orderedCards.length) {
    limitPreLines.push('—');
  } else {
    const headerCells = [
      'Banco'.padEnd(BANK_W),
      'Tarjeta'.padEnd(CARD_W),
      'SAL'.padStart(VAL_W),
      'SALDO'.padStart(VAL_W),
      'LIBRE'.padStart(VAL_W),
      'CAP'.padStart(VAL_W),
      'Estado',
    ];
    const header = headerCells.join(' ').trimEnd();
    const dash = '─'.repeat(header.length);
    limitPreLines.push(header, dash);
    let totalSal = 0;
    let totalSaldo = 0;
    let totalLibre = 0;
    let totalCap = 0;
    orderedCards.forEach((card) => {
      const bank = (card.bank || '').toUpperCase();
      const mask = card.mask || maskCardNumber(card.numero);
      const sal = Math.round(card.usedOut || 0);
      const saldo = Math.max(0, Math.round(card.balancePos || 0));
      const libre = Math.round(card.remaining || 0);
      const cap = Math.round(card.depositCap || 0);
      totalSal += sal;
      totalSaldo += saldo;
      totalLibre += libre;
      totalCap += cap;
      const salStr = formatInteger(sal).padStart(VAL_W);
      const saldoStr = formatInteger(saldo).padStart(VAL_W);
      const remainingStr = formatInteger(libre).padStart(VAL_W);
      const capStr = formatInteger(cap).padStart(VAL_W);
      const statusText = describeLimitStatus(card.status);
      const line = [
        bank.padEnd(BANK_W),
        mask.padEnd(CARD_W),
        salStr,
        saldoStr,
        remainingStr,
        capStr,
        statusText,
      ]
        .join(' ')
        .trimEnd();
      limitPreLines.push(line);
    });
    const salTotStr = formatInteger(totalSal).padStart(VAL_W);
    const saldoTotStr = formatInteger(totalSaldo).padStart(VAL_W);
    const libreTotStr = formatInteger(totalLibre).padStart(VAL_W);
    const capTotStr = formatInteger(totalCap).padStart(VAL_W);
    limitPreLines.push(dash);
    const totalLine = [
      'TOTAL'.padEnd(BANK_W),
      '—'.padEnd(CARD_W),
      salTotStr,
      saldoTotStr,
      libreTotStr,
      capTotStr,
    ]
      .join(' ')
      .trimEnd();
    limitPreLines.push(totalLine);
  }

  const distNow = distributionNow || { assignments: [], leftover: 0, totalAssigned: 0 };
  const distTarget = distributionTarget || { assignments: [], leftover: 0, totalAssigned: 0 };
  const suggestionPreLines = [];
  let usedBolsaInDistribution = false;

  const appendScenario = (label, amount, distribution) => {
    if (!amount || amount <= 0) return;
    suggestionPreLines.push(`${label}: ${formatInteger(amount)} CUP`);
    if (!distribution.assignments.length) {
      suggestionPreLines.push('  Sin capacidad disponible');
    } else {
      // Encabezado de columnas para filas compactas
      const indent = '  ';
      const headerCells = [
        'Banco'.padEnd(BANK_W),
        'Tarjeta'.padEnd(CARD_W),
        '↦ CUP'.padStart(ASSIGN_W),
        'cap antes→desp'.padEnd(CAP_W),
        'Estado',
      ];
      const hdr = `${indent}${headerCells.join(' ')}`.trimEnd();
      const dash = `${indent}${'─'.repeat(hdr.length - indent.length)}`;
      suggestionPreLines.push(hdr, dash);
      distribution.assignments.forEach((item) => {
        const bank = (item.bank || '').toUpperCase();
        const mask = item.mask || maskCardNumber(item.numero);
        const assignStr = formatInteger(item.assignCup).padStart(ASSIGN_W);
        const beforeStr = formatInteger(item.remainingAntes).padStart(VAL_W);
        const afterStr  = formatInteger(item.remainingDespues).padStart(VAL_W);
        const flag      = describeAllocationStatus(item.status);
        const bolsaTag  = item.isBolsa ? ' 🧳 fallback' : '';
        if (item.isBolsa) usedBolsaInDistribution = true;
        const cap = `${beforeStr}→${afterStr}`.padEnd(CAP_W);
        const line = `${indent}${[
          bank.padEnd(BANK_W),
          mask.padEnd(CARD_W),
          assignStr,
          cap,
          `${flag}${bolsaTag}`.trimEnd(),
        ]
          .join(' ')
          .trimEnd()}`;
        suggestionPreLines.push(line);
      });
    }
    if (distribution.leftover > 0) {
      suggestionPreLines.push(`  ⚠️ CUP sin destino: ${formatInteger(distribution.leftover)} CUP`);
    }
  };

  appendScenario('Venta AHORA', plan.sellNow.cupIn, distNow);
  if (plan.remainingCup > 0 && plan.sellTarget.cupIn > 0) {
    appendScenario('Objetivo total', plan.sellTarget.cupIn, distTarget);
  }

  if (!suggestionPreLines.length) {
    suggestionPreLines.push('—');
  }
  // Nota de fees si se usó BOLSA en la distribución
  if (usedBolsaInDistribution) {
    suggestionPreLines.push('');
    suggestionPreLines.push(
      `  • Nota: BOLSA usada como 2º plano. Entre bolsas: -${BOLSA_TO_BOLSA_FEE_CUP} CUP; Bolsa→Banco: neto ≈ asignado × ${(1 - BOLSA_TO_BANK_FEE_PCT).toFixed(2)}`
    );
  }

  blocks.push('────────────────────────────────');
  blocks.push('🚦 <b>Límite mensual por tarjeta</b>');
  blocks.push(limitInfoLine);
  blocks.push(pre(limitPreLines));
  blocks.push('📍 <b>Sugerencia de destino del CUP</b>');
  blocks.push(pre(suggestionPreLines));
  blocks.push('────────────────────────────────');

  const comparadorColchon = projection.colchonPost >= cushionTarget ? '≥' : '<';
  const proyeccion = [
    '🧾 <b>Proyección post-venta</b>',
    `• Negativos: ${fmtCup(projection.negativosPost)} CUP`,
    `• Colchón proyectado: ${fmtCup(projection.colchonPost)} CUP ${cmp(comparadorColchon)} ${fmtCup(cushionTarget)}`,
  ];
  blocks.push(proyeccion.join('\n'));

  const liquidityEntries = (config.liquidityBanks || [])
    .map((bank) => {
      const code = (bank || '').toUpperCase();
      return { bank: code, amount: Math.round(liquidityByBank[code] || 0) };
    })
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const liquidityBlock = ['🏦 <b>Liquidez rápida disponible</b>'];
  if (!liquidityEntries.length) {
    liquidityBlock.push('• —');
  } else {
    liquidityEntries.forEach((item) => {
      if (hasBuyRate) {
        const usdEquiv = item.amount / resolvedBuyRate;
        console.log(
          `[fondoAdvisor] Liquidez banco ${item.bank} => ${Math.round(item.amount)} CUP ≈ ${(Math.round(
            (Number(usdEquiv) || 0) * 100
          ) / 100).toFixed(2)} USD`
        );
        liquidityBlock.push(
          `• ${h(item.bank)}: ${fmtCup(item.amount)} CUP (≈ ${fmtUsdDetailed(usdEquiv)} USD)`
        );
      } else {
        console.log(
          `[fondoAdvisor] Liquidez banco ${item.bank} => ${Math.round(item.amount)} CUP (sin tasa de compra)`
        );
        liquidityBlock.push(`• ${h(item.bank)}: ${fmtCup(item.amount)} CUP`);
      }
    });
  }
  blocks.push(liquidityBlock.join('\n'));

  const explicacion = [
    '📐 <b>Explicación</b>',
    `• Fórmula: necesidad = |deudas| + colchón − activos = ${fmtCup(deudaAbs)} + ${fmtCup(
      cushionTarget
    )} − ${fmtCup(activosCup)} = ${fmtCup(needCup)} CUP`,
    `• Objetivo USD = ceil(necesidad / sellNet) (+ márgenes y redondeo)`,
    `• sellNet = floor(SELL × (1 − fee)) ⇒ SELL: ${fmtCup(config.sellRate)} (fuente ${h(
      resolvedSellSource
    )})  fee: ${(config.sellFeePct * 100).toFixed(2)}%`,
  ];
  blocks.push(explicacion.join('\n'));

  return blocks;
}

async function runFondo(ctx, opts = {}) {
  const session = ctx?.session || (ctx ? (ctx.session = {}) : {});
  if (session.__fondoAdvisorRunning) {
    console.log('[fondoAdvisor] Skip: análisis en progreso');
    return null;
  }
  session.__fondoAdvisorRunning = true;
  try {
    const baseConfig = loadConfig();
    const override = opts.config || {};
    const config = {
      ...baseConfig,
      ...override,
      liquidityBanks: Array.isArray(override.liquidityBanks)
        ? override.liquidityBanks
        : baseConfig.liquidityBanks,
    };
    console.log('[fondoAdvisor] Configuración efectiva =>', JSON.stringify(config));

    let sellSource = typeof override.sellRate === 'number' ? 'config' : 'env';
    let buyRateCup = null;
    let buyRateSource = 'none';

    if (!opts.skipSellRateFetch) {
      const buyFromDb = await getBuyRateFromDb();
      if (Number.isFinite(buyFromDb) && buyFromDb > 0) {
        buyRateCup = buyFromDb;
        buyRateSource = 'db';
      } else {
        console.log('[fondoAdvisor] BUY rate no disponible en DB, se usará override/config si existe.');
      }
    }

    if (!buyRateCup) {
      const overrideBuyRate = parseNumber(override.buyRate ?? override.buyRateCup, null);
      if (overrideBuyRate && overrideBuyRate > 0) {
        buyRateCup = overrideBuyRate;
        buyRateSource = 'config';
      }
    }

    config.buyRateCup = buyRateCup || null;
    config.buyRateSource = buyRateSource;
    config.sellRateSource = sellSource;
    console.log(
      `[fondoAdvisor] Tasas configuradas => BUY=${buyRateCup || '—'} (${buyRateSource}) SELL=${config.sellRate} (${sellSource})`
    );

    const balances = opts.balances || (await getLatestBalances());
    console.log(`[fondoAdvisor] Registros de saldo obtenidos => ${balances.length}`);
    const totals = aggregateBalances(balances, config.liquidityBanks);
    console.log(
      `[fondoAdvisor] Totales CUP => activos=${Math.round(totals.activosCup)} deudas=${Math.round(
        totals.deudasCup
      )} neto=${Math.round(totals.netoCup)} inventarioUSD=${Math.floor(totals.usdInventory)}`
    );
    console.log('[fondoAdvisor] Liquidez por banco =>', JSON.stringify(totals.liquidityByBank));
    const liquidityTotal = Object.values(totals.liquidityByBank || {}).reduce(
      (acc, v) => acc + (v > 0 ? v : 0),
      0
    );
    console.log(`[fondoAdvisor] Liquidez rápida total => ${Math.round(liquidityTotal)}`);
    const needs = computeNeeds({
      activosCup: totals.activosCup,
      deudasCup: totals.deudasCup,
      cushionTarget: config.cushion,
    });
    const plan = computePlan({
      needCup: needs.needCup,
      usdInventory: totals.usdInventory,
      sellRate: config.sellRate,
      minSellUsd: config.minSellUsd,
      sellFeePct: config.sellFeePct,
      fxMarginPct: config.fxMarginPct,
      sellRoundToUsd: config.sellRoundToUsd,
      minKeepUsd: config.minKeepUsd,
      sellRateSource: sellSource,
    });

    const monthlyLimits = await loadMonthlyUsage({
      limitMonthlyDefaultCup: config.limitMonthlyDefaultCup,
      limitMonthlyBpaCup: config.limitMonthlyBpaCup,
      extendableBanks: config.extendableBanks,
      assessableBanks: config.assessableBanks,
    });
    console.log(
      `[fondoAdvisor] Tarjetas CUP analizadas => ${monthlyLimits.cards.length} (bloqueadas=${monthlyLimits.totals.blocked} extendibles=${monthlyLimits.totals.extendable})`
    );

    const distributionNow = computeCupDistribution(
      plan.sellNow.cupIn,
      monthlyLimits.cards,
      config.allocationBankOrder
    );
    console.log(
      `[fondoAdvisor] Distribución venta AHORA => asignado=${distributionNow.totalAssigned} leftover=${distributionNow.leftover}`
    );

    let distributionTarget = null;
    if (plan.remainingCup > 0 && plan.sellTarget.cupIn > 0) {
      distributionTarget = computeCupDistribution(
        plan.sellTarget.cupIn,
        monthlyLimits.cards,
        config.allocationBankOrder
      );
      console.log(
        `[fondoAdvisor] Distribución objetivo => asignado=${distributionTarget.totalAssigned} leftover=${distributionTarget.leftover}`
      );
    }

    const projection = computeProjection(totals.activosCup, totals.deudasCup, plan.sellNow.cupIn);
    console.log(
      `[fondoAdvisor] Proyección => negativosPost=${projection.negativosPost} colchonPost=${projection.colchonPost}`
    );

    const urgency = computeUrgency({
      needCup: needs.needCup,
      sellNowUsd: plan.sellNow.usd,
      remainingCup: plan.remainingCup,
      sellTargetUsd: plan.sellTarget.usd,
    });
    console.log(`[fondoAdvisor] Urgencia calculada => ${urgency}`);

    const result = {
      ...totals,
      ...needs,
      plan,
      projection,
      config,
      urgency,
      monthlyLimits,
      distributionNow,
      distributionTarget,
      buyRateCup: buyRateCup || null,
      buyRateSource,
      sellRateSource: sellSource,
    };

    const blocks = renderAdvice(result);

    if (opts.send) {
      await opts.send(blocks.join('\n\n'));
    } else if (ctx) {
      const isGroupChat = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      const privateChatId = ctx.from?.id;

      if (isGroupChat && privateChatId && ctx.telegram?.sendMessage) {
        const privateCtx = {
          ...ctx,
          chat: { id: privateChatId, type: 'private' },
          reply: (text, extra) =>
            safeSendMessage(ctx.telegram, privateChatId, text, extra),
        };

        try {
          await sendLargeMessage(privateCtx, blocks, { parse_mode: 'HTML' });
          await safeReply(
            ctx,
            '📬 Envié el resumen del fondo por privado para evitar spam en el grupo.'
          ).catch((err) => {
            console.error('[fondoAdvisor] aviso en grupo falló:', err?.message);
          });
        } catch (err) {
          console.error('[fondoAdvisor] Fallback a grupo (privado falló):', err?.message);
          await sendLargeMessage(ctx, blocks, { parse_mode: 'HTML' });
        }
      } else {
        await sendLargeMessage(ctx, blocks, { parse_mode: 'HTML' });
      }
    }
    console.log('[fondoAdvisor] Análisis enviado');
    return result;
  } catch (err) {
    console.error('[fondoAdvisor] Error ejecutando análisis:', err);
    throw err;
  } finally {
    session.__fondoAdvisorRunning = false;
  }
}

function registerFondoAdvisor({ scenes = {} } = {}) {
  const targets = [
    scenes.tarjetasAssist,
    scenes.monitorAssist,
    scenes.extractoAssist,
  ];
  targets.forEach((scene) => {
    if (scene && typeof scene.on === 'function') {
      scene.on('leave', (ctx) => {
        const runner = module.exports.runFondo || runFondo;
        setImmediate(() => {
          Promise.resolve()
            .then(() => {
              const chatType = ctx?.chat?.type;
              const isGroup = chatType === 'group' || chatType === 'supergroup';

              if (isGroup) {
                console.log('[fondoAdvisor] leave en grupo; se intentará envío por DM.');
                return runner(ctx, {
                  send: async (text) => {
                    const userId = ctx?.from?.id;
                    if (!userId) {
                      console.log('[fondoAdvisor] No hay ctx.from.id; se omite envío en grupo.');
                      return;
                    }
                    const telegram = ctx.telegram;
                    if (!telegram?.sendMessage) {
                      console.log('[fondoAdvisor] ctx.telegram.sendMessage no disponible; se omite envío en grupo.');
                      return;
                    }
                    try {
                      await telegram.sendMessage(userId, text, { parse_mode: 'HTML' });
                      console.log('[fondoAdvisor] Análisis enviado por DM a', userId);
                    } catch (err) {
                      console.log('[fondoAdvisor] No se pudo enviar DM del fondoAdvisor:', err.message);
                    }
                  },
                });
              }

              return runner(ctx);
            })
            .catch((err) => {
              console.error('[fondoAdvisor] Error en leave handler:', err.message);
            });
        });
      });
    }
  });
}

module.exports = {
  registerFondoAdvisor,
  runFondo,
  computeNeeds,
  computePlan,
  loadConfig,
  aggregateBalances,
  renderAdvice,
  computeProjection,
  loadMonthlyUsage,
  classifyMonthlyUsage,
  computeCupDistribution,
  sortCardsByPreference,
  describeLimitStatus,
  describeAllocationStatus,
  maskCardNumber,
  getMonthlyOutflowsByCard,
  sumNonBolsaDepositCap,
  computeHeadlineSeverity,
  normalizeBankCode,
};

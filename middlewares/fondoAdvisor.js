'use strict';

const path = require('path');
const { escapeHtml } = require('../helpers/format');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');

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
    liquidityBanks: parseList(env.ADVISOR_BANKS_LIQUIDOS, DEFAULT_CONFIG.liquidityBanks),
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
    extendableBanks: parseList(env.LIMIT_EXTENDABLE_BANKS, DEFAULT_CONFIG.extendableBanks),
    assessableBanks: parseList(env.LIMIT_ASSESSABLE_BANKS, DEFAULT_CONFIG.assessableBanks),
    allocationBankOrder: parseList(
      env.ADVISOR_ALLOCATION_BANK_ORDER,
      DEFAULT_CONFIG.allocationBankOrder
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
  const assessableBanks = (config.assessableBanks || DEFAULT_CONFIG.assessableBanks || [])
    .map((bank) => (bank || '').toUpperCase())
    .filter(Boolean);

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
  try {
    res = await query(buildSql(true), params);
  } catch (err) {
    const isMissingSchema = err?.code === '42P01' || /chema\./i.test(err?.message || '');
    if (!isMissingSchema) throw err;
    console.warn('[fondoAdvisor] Fallback consulta límites sin esquema (chema ausente).');
    res = await query(buildSql(false), params);
  }
  const allowedBanks = new Set(assessableBanks);

  return (res.rows || [])
    .map((row) => ({
      id: row.id,
      numero: row.numero,
      banco: (row.banco || '').toUpperCase(),
      moneda: (row.moneda || '').toUpperCase(),
      agente: (row.agente || '').toUpperCase(),
      used_out: Math.round(Number(row.used_out) || 0),
      saldo_actual: Math.round(Number(row.saldo_actual) || 0),
    }))
    .filter((row) => row.moneda === 'CUP' && allowedBanks.has(row.banco));
}

function classifyMonthlyUsage(rows = [], config = {}) {
  const defaultLimit = Math.max(0, Math.round(config.limitMonthlyDefaultCup || 0));
  const bpaLimit = Math.max(0, Math.round(config.limitMonthlyBpaCup || defaultLimit));
  const extendableSet = new Set((config.extendableBanks || []).map((b) => (b || '').toUpperCase()));

  const cards = rows.map((row) => {
    const bank = (row.banco || 'SIN BANCO').toUpperCase();
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
    orderMap.set((bank || '').toUpperCase(), idx);
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

function fmtCup(value) {
  const rounded = Math.round(value || 0);
  return escapeHtml(
    rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  );
}

function fmtUsd(value) {
  const rounded = Math.round(value || 0);
  return escapeHtml(
    rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
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

async function getSellRateFromDb() {
  try {
    const { rows } = await query(
      "SELECT tasa_usd FROM moneda WHERE UPPER(codigo) = 'CUP' ORDER BY id DESC LIMIT 1"
    );
    if (rows && rows.length) {
      const tasaUsd = Number(rows[0].tasa_usd);
      if (tasaUsd > 0) {
        const sell = Math.round(1 / tasaUsd);
        console.log(`[fondoAdvisor] SELL rate obtenido de DB => ${sell}`);
        return sell;
      }
    }
  } catch (err) {
    console.error('[fondoAdvisor] Error leyendo tasa SELL de DB:', err.message);
  }
  return null;
}

function aggregateBalances(rows = [], liquidityBanks = []) {
  const activos = { cup: 0, deudas: 0, neto: 0 };
  let usdInventory = 0;
  const liquidityByBank = {};
  const liquiditySet = new Set(liquidityBanks.map((b) => (b || '').toUpperCase()));

  rows.forEach((r) => {
    const saldoRaw = Number(r.saldo) || 0;
    const moneda = (r.moneda || '').toUpperCase();
    const banco = (r.banco || '').toUpperCase();
    const agente = (r.agente || '').toUpperCase();
    const numero = (r.numero || '').toUpperCase();
    const tasaUsd = Number(r.tasa_usd) || 0;

    const hasReceivableKeyword = RECEIVABLE_REGEX.test(agente) ||
      RECEIVABLE_REGEX.test(banco) ||
      RECEIVABLE_REGEX.test(numero);

    if (moneda === 'CUP') {
      if (saldoRaw >= 0) {
        if (!hasReceivableKeyword) {
          activos.cup += saldoRaw;
          if (liquiditySet.has(banco)) {
            liquidityByBank[banco] = (liquidityByBank[banco] || 0) + saldoRaw;
          }
        }
      } else {
        activos.deudas += saldoRaw;
        if (liquiditySet.has(banco)) {
          liquidityByBank[banco] = (liquidityByBank[banco] || 0);
        }
      }
    }

    if (USD_CODES.has(moneda) && saldoRaw > 0) {
      const tasa = tasaUsd > 0 ? tasaUsd : 1;
      const usd = saldoRaw / tasa;
      if (usd > 0) usdInventory += usd;
    }
  });

  activos.neto = activos.cup + activos.deudas;
  const liquidityTotal = Object.values(liquidityByBank).reduce((acc, v) => acc + (v || 0), 0);

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
  } = result;

  const blocks = [];
  blocks.push('🧮 <b>Asesor de Fondo</b>');
  blocks.push('━━━━━━━━━━━━━━━━━━');
  blocks.push(urgency || '🟢 NORMAL');

  const estado = [
    '📊 <b>Estado actual CUP</b>',
    `• Activos: ${fmtCup(activosCup)} CUP`,
    `• Deudas: ${fmtCup(deudasCup)} CUP`,
    `• Neto: ${fmtCup(netoCup)} CUP`,
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
      `• Reservado: ${fmtUsd(invReserve)} USD`,
      `• Usable ahora: ${fmtUsd(invUsable)} USD${invUsable < (config.minSellUsd || 0) ? ' (⚠️ por debajo del mínimo de venta)' : ''}`
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

  const limitsData = monthlyLimits || { cards: [] };
  const orderedCards = sortCardsByPreference(limitsData.cards || [], config.allocationBankOrder || [])
    // No mostrar BOLSA (MITRANSFER y similares) en el bloque de límites
    .filter((c) => !c.isBolsa && c.bank !== 'MITRANSFER');
  const limitPreLines = [];
  if (!orderedCards.length) {
    limitPreLines.push('—');
  } else {
    const hdr = `${'Banco'.padEnd(8)} ${'Tarjeta'.padEnd(13)} ${'SAL/LIM'.padStart(17)} ${'SALDO'.padStart(10)} ${'LIBRE'.padStart(10)} ${'CAP'.padStart(10)}  Estado`;
    const dash = '─'.repeat(hdr.length);
    limitPreLines.push(hdr, dash);
    orderedCards.forEach((card) => {
      const bank = (card.bank || '').toUpperCase();
      const mask = card.mask || maskCardNumber(card.numero);
      const usedStr = formatInteger(card.usedOut).padStart(8);
      const limitStr = formatInteger(card.limit).padStart(8);
      const saldoStr = formatInteger(card.balancePos).padStart(10);
      const remainingStr = formatInteger(card.remaining).padStart(10);
      const capStr = formatInteger(card.depositCap).padStart(10);
      const statusText = describeLimitStatus(card.status);
      const salLim = `${usedStr}/${limitStr}`.padStart(17);
      const line = `${bank.padEnd(8)} ${mask.padEnd(13)} ${salLim} ${saldoStr} ${remainingStr} ${capStr}  ${statusText}`;
      limitPreLines.push(line);
    });
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
      const hdr  = `  ${'Banco'.padEnd(8)} ${'Tarjeta'.padEnd(13)} ${'↦ CUP'.padStart(10)}   ${'cap antes→desp'.padEnd(21)} Estado`;
      const dash = '  ' + '─'.repeat(hdr.trimStart().length);
      suggestionPreLines.push(hdr, dash);
      distribution.assignments.forEach((item) => {
        const bank = (item.bank || '').toUpperCase();
        const mask = item.mask || maskCardNumber(item.numero);
        const assignStr = formatInteger(item.assignCup).padStart(9);
        const beforeStr = formatInteger(item.remainingAntes).padStart(10);
        const afterStr  = formatInteger(item.remainingDespues).padStart(10);
        const flag      = describeAllocationStatus(item.status);
        const bolsaTag  = item.isBolsa ? ' 🧳 fallback' : '';
        if (item.isBolsa) usedBolsaInDistribution = true;
        const cap = `${beforeStr}→${afterStr}`.padEnd(21);
        const line = `  ${bank.padEnd(8)} ${mask.padEnd(13)} ${assignStr}   ${cap} ${flag}${bolsaTag}`;
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

  const limitsBlock = [
    '────────────────────────────────',
    '🚦 <b>Límite mensual por tarjeta</b>',
    `<pre>${limitPreLines.map((line) => escapeHtml(line)).join('\n')}</pre>`,
    '📍 <b>Sugerencia de destino del CUP</b>',
    `<pre>${suggestionPreLines.map((line) => escapeHtml(line)).join('\n')}</pre>`,
    '────────────────────────────────',
  ];
  blocks.push(limitsBlock.join('\n'));

  const proyeccion = [
    '🧾 <b>Proyección post-venta</b>',
    `• Negativos: ${fmtCup(projection.negativosPost)} CUP`,
    `• Colchón proyectado: ${fmtCup(projection.colchonPost)} CUP ${
      projection.colchonPost >= cushionTarget ? '≥' : '<'
    } ${fmtCup(cushionTarget)}`,
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
      liquidityBlock.push(`• ${escapeHtml(item.bank)}: ${fmtCup(item.amount)} CUP`);
    });
  }
  blocks.push(liquidityBlock.join('\n'));

  const explicacion = [
    '📐 <b>Explicación</b>',
    `• Fórmula: necesidad = |deudas| + colchón − activos = ${fmtCup(deudaAbs)} + ${fmtCup(
      cushionTarget
    )} − ${fmtCup(activosCup)} = ${fmtCup(needCup)} CUP`,
    `• Objetivo USD = ceil(necesidad / sellNet) (+ márgenes y redondeo)`,
    `• sellNet = floor(SELL × (1 − fee)) ⇒ SELL: ${fmtCup(config.sellRate)} (fuente ${
      plan.usedSellSource === 'db' ? 'DB' : 'ENV'
    })  fee: ${(config.sellFeePct * 100).toFixed(2)}%`,
  ];
  blocks.push(explicacion.join('\n'));

  const parametros = [
    '📝 <b>Parámetros</b>',
    `• Mínimo por operación: ${fmtUsd(config.minSellUsd)} USD`,
    `• SELL bruto: ${fmtCup(config.sellRate)}  • Fee: ${(config.sellFeePct * 100).toFixed(2)}%  • SELL neto: ${fmtCup(
      plan.sellNet
    )}`,
    `• Margen FX: ${(config.fxMarginPct * 100).toFixed(2)}%  • Redondeo: ${fmtUsd(
      config.sellRoundToUsd
    )} USD  • USD reserva: ${fmtUsd(config.minKeepUsd)}`,
  ];
  blocks.push(parametros.join('\n'));

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

    let sellSource = 'env';

    if (!opts.skipSellRateFetch) {
      const sellFromDb = await getSellRateFromDb();
      if (sellFromDb) {
        config.sellRate = sellFromDb;
        sellSource = 'db';
      } else {
        console.log(`[fondoAdvisor] SELL rate fallback (config/env) => ${config.sellRate}`);
      }
    }

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
    };

    const blocks = renderAdvice(result);

    if (opts.send) {
      await opts.send(blocks.join('\n\n'));
    } else if (ctx) {
      await sendLargeMessage(ctx, blocks, { parse_mode: 'HTML' });
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
            .then(() => runner(ctx))
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
};

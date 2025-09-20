'use strict';

const path = require('path');
const { escapeHtml } = require('../helpers/format');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');

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
  buyRate: 400,
  sellRate: 452,
  minSellUsd: 40,
  liquidityBanks: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
};

const USD_CODES = new Set(['USD', 'MLC']);

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
    buyRate: parseNumber(env.ADVISOR_BUY_RATE_CUP_PER_USD, DEFAULT_CONFIG.buyRate),
    sellRate: parseNumber(env.ADVISOR_SELL_RATE_CUP_PER_USD, DEFAULT_CONFIG.sellRate),
    minSellUsd: parseNumber(env.ADVISOR_MIN_SELL_USD, DEFAULT_CONFIG.minSellUsd),
    liquidityBanks: parseList(env.ADVISOR_BANKS_LIQUIDOS, DEFAULT_CONFIG.liquidityBanks),
  };
}

function fmtCup(value) {
  const rounded = Math.round(value || 0);
  return escapeHtml(
    rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  );
}

function fmtUsd(value) {
  const rounded = Math.ceil(value || 0);
  return escapeHtml(
    rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  );
}

async function getLatestBalances() {
  const sql = `
    SELECT COALESCE(m.codigo,'—')  AS moneda,
           COALESCE(b.codigo,'SIN BANCO') AS banco,
           COALESCE(m.tasa_usd,1)  AS tasa_usd,
           COALESCE(mv.saldo_nuevo,0) AS saldo
      FROM tarjeta t
      LEFT JOIN banco b ON b.id = t.banco_id
      LEFT JOIN moneda m ON m.id = t.moneda_id
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

function aggregateBalances(rows = [], liquidityBanks = []) {
  const activos = { cup: 0, deudas: 0, neto: 0 };
  const usdInventory = { units: 0 };
  const liquidityByBank = {};
  const liquiditySet = new Set(liquidityBanks.map((b) => b.toUpperCase()));

  rows.forEach((r) => {
    const saldoRaw = Number(r.saldo) || 0;
    const moneda = (r.moneda || '').toUpperCase();
    const banco = (r.banco || '').toUpperCase();
    const tasaUsd = Number(r.tasa_usd) || 0;

    if (moneda === 'CUP') {
      if (saldoRaw >= 0) {
        activos.cup += saldoRaw;
        if (liquiditySet.has(banco)) {
          liquidityByBank[banco] = (liquidityByBank[banco] || 0) + saldoRaw;
        }
      } else {
        activos.deudas += saldoRaw;
      }
    }

    if (USD_CODES.has(moneda)) {
      const usd = saldoRaw * (tasaUsd || 1);
      if (usd > 0) usdInventory.units += usd;
    }
  });

  activos.neto = activos.cup + activos.deudas;
  const liquidityTotal = Object.values(liquidityByBank).reduce((acc, v) => acc + v, 0);

  return {
    activosCup: activos.cup,
    deudasCup: activos.deudas,
    netoCup: activos.neto,
    usdInventory: usdInventory.units,
    liquidityByBank,
    liquidityTotal,
  };
}

function computeNeeds({ activosCup = 0, deudasCup = 0, cushionTarget = DEFAULT_CONFIG.cushion }) {
  const deudaAbs = Math.abs(deudasCup);
  const cushion = Math.round(cushionTarget || 0);
  const disponibles = activosCup - deudaAbs;
  const rawNeed = deudaAbs + cushion - activosCup;
  const needCup = Math.max(0, Math.round(rawNeed));
  return { needCup, cushionTarget: cushion, disponibles, deudaAbs };
}

function computePlan({
  needCup = 0,
  usdInventory = 0,
  sellRate = DEFAULT_CONFIG.sellRate,
  buyRate = DEFAULT_CONFIG.buyRate,
  minSellUsd = DEFAULT_CONFIG.minSellUsd,
  liquidityByBank = {},
}) {
  const plan = { status: needCup > 0 ? 'NEED_ACTION' : 'OK' };
  if (needCup <= 0) return plan;

  const sell = { usdToSell: 0, cupOut: 0, covers: false };
  const totalLiquidity = Object.values(liquidityByBank).reduce((acc, v) => acc + (v > 0 ? v : 0), 0);

  if (usdInventory > 0 && sellRate > 0) {
    const requiredUsd = Math.ceil(needCup / sellRate);
    let usdToSell = Math.min(usdInventory, requiredUsd);
    let minWarning = false;
    if (usdToSell > 0 && usdToSell < minSellUsd) {
      if (usdInventory >= minSellUsd) {
        usdToSell = Math.min(usdInventory, minSellUsd);
      } else {
        minWarning = true;
      }
    }
    usdToSell = Math.min(usdInventory, Math.ceil(usdToSell));
    if (usdToSell > 0) {
      sell.usdToSell = usdToSell;
      sell.cupOut = Math.round(usdToSell * sellRate);
      sell.covers = sell.cupOut >= needCup;
      if (minWarning) sell.minWarning = true;
      plan.sellUsdFirst = sell;
    }
  }

  const alreadyCovered = plan.sellUsdFirst ? plan.sellUsdFirst.cupOut : 0;
  const restante = Math.max(0, needCup - alreadyCovered);

  if (restante <= 0) {
    plan.status = 'NEED_ACTION';
    return plan;
  }

  if (sellRate <= buyRate || buyRate <= 0) {
    plan.status = 'NEED_ACTION';
    return plan;
  }

  const profitPerUsd = sellRate - buyRate;
  let usdToCycle = Math.ceil(restante / profitPerUsd);
  const usdAffordable = Math.floor(totalLiquidity / buyRate);
  let limitedByLiquidity = false;
  if (usdAffordable > 0 && usdToCycle > usdAffordable) {
    usdToCycle = usdAffordable;
    limitedByLiquidity = true;
  }
  if (usdAffordable === 0) {
    usdToCycle = 0;
    limitedByLiquidity = true;
  }

  if (usdToCycle > 0) {
    const cupToCommit = Math.round(usdToCycle * buyRate);
    const cupBack = Math.round(usdToCycle * sellRate);
    const profit = cupBack - cupToCommit;
    const cycles = Math.max(1, Math.ceil(usdToCycle / Math.max(minSellUsd, 1)));
    const covers = profit >= restante;
    const missingProfit = Math.max(0, restante - profit);
    const missingLiquidityCup = limitedByLiquidity
      ? Math.max(0, Math.round(restante - profit > 0 ? ((restante - profit) / profitPerUsd) * buyRate : 0))
      : 0;

    plan.arbitrage = {
      usdToCycle,
      cupToCommit,
      cupBack,
      profit,
      cycles,
      covers,
      limitedByLiquidity,
      liquidityAvailable: Math.round(totalLiquidity),
    };
    if (limitedByLiquidity) {
      plan.arbitrage.missingProfit = missingProfit;
      plan.arbitrage.missingLiquidityCup = missingLiquidityCup;
    }
  } else {
    plan.arbitrage = {
      usdToCycle: 0,
      cupToCommit: 0,
      cupBack: 0,
      profit: 0,
      cycles: 0,
      covers: false,
      limitedByLiquidity: true,
      liquidityAvailable: Math.round(totalLiquidity),
      missingProfit: restante,
      missingLiquidityCup: Math.round(restante > 0 ? (restante / profitPerUsd) * buyRate : 0),
    };
  }

  return plan;
}

function renderAdvice(result) {
  const {
    activosCup,
    deudasCup,
    netoCup,
    cushionTarget,
    needCup,
    disponibles,
    usdInventory,
    usdInventoryCup,
    plan,
    liquidityByBank,
    config,
  } = result;

  const blocks = [];
  blocks.push('🧮 <b>Asesor de Fondo</b>');
  blocks.push('━━━━━━━━━━━━━━━━━━');

  const estado = [];
  estado.push('📊 <b>Estado actual CUP</b>');
  estado.push(`• Activos: ${fmtCup(activosCup)} CUP`);
  estado.push(`• Deudas: ${fmtCup(deudasCup)} CUP`);
  estado.push(`• Neto: ${fmtCup(netoCup)} CUP`);
  estado.push(`• Disponible tras deudas: ${fmtCup(disponibles)} CUP`);
  blocks.push(estado.join('\n'));

  const objetivo = [];
  objetivo.push('🎯 <b>Objetivo</b>');
  objetivo.push(`• Colchón objetivo: ${fmtCup(cushionTarget)} CUP`);
  objetivo.push(`• Necesidad adicional: ${fmtCup(needCup)} CUP`);
  blocks.push(objetivo.join('\n'));

  if (usdInventory > 0) {
    const inventario = [];
    inventario.push('💵 <b>Inventario USD</b>');
    inventario.push(`• Disponible: ${fmtUsd(usdInventory)} USD`);
    inventario.push(`• Equiv. a SELL: ${fmtCup(usdInventoryCup)} CUP`);
    blocks.push(inventario.join('\n'));
  }

  const recomendacion = [];
  recomendacion.push('🧭 <b>Recomendación</b>');
  if (plan.status === 'OK') {
    recomendacion.push('• Caso OK (needCup <= 0):');
    recomendacion.push('  ✅ Ya estás cubierto. Colchón ≥ objetivo.');
    const excedente = Math.max(0, Math.round(disponibles - cushionTarget));
    if (excedente > Math.round(cushionTarget * 0.2)) {
      recomendacion.push(
        '  💡 Sugerencia: si superas 1.2× colchón, puedes resguardar valor comprando USD cuando convenga.'
      );
    }
  } else {
    recomendacion.push('• Caso NEED_ACTION (needCup > 0):');
    let step = 1;
    if (plan.sellUsdFirst) {
      recomendacion.push(
        `  ${step}) Vende ${fmtUsd(plan.sellUsdFirst.usdToSell)} USD → +${fmtCup(plan.sellUsdFirst.cupOut)} CUP`
      );
      if (plan.sellUsdFirst.minWarning) {
        recomendacion.push(
          `    ⚠️ Inventario menor al mínimo de ${fmtUsd(config.minSellUsd)} USD. Ajusta con agentes.`
        );
      }
      if (plan.sellUsdFirst.covers) {
        recomendacion.push('    ✅ Con la venta de USD cubres el faltante.');
      }
      step += 1;
    }
    if (plan.arbitrage && plan.arbitrage.usdToCycle > 0) {
      recomendacion.push(
        `  ${step}) Arbitraje: compra ${fmtUsd(plan.arbitrage.usdToCycle)} USD a ${fmtCup(config.buyRate)} (= ${fmtCup(plan.arbitrage.cupToCommit)} CUP), véndelos a ${fmtCup(config.sellRate)} (= ${fmtCup(plan.arbitrage.cupBack)} CUP) → utilidad ${fmtCup(plan.arbitrage.profit)} CUP`
      );
      if (plan.arbitrage.limitedByLiquidity) {
        recomendacion.push('    ⚠️ Liquidez rápida insuficiente para cubrir todo el plan.');
        if (plan.arbitrage.missingLiquidityCup) {
          recomendacion.push(
            `      • Falta movilizar: ${fmtCup(plan.arbitrage.missingLiquidityCup)} CUP`
          );
        }
      }
      if (plan.arbitrage.covers) {
        recomendacion.push('    ✅ Con el arbitraje cubres el faltante restante.');
      }
    } else if (!(plan.sellUsdFirst && plan.sellUsdFirst.covers)) {
      recomendacion.push('  ⚠️ Sin liquidez rápida suficiente para ejecutar arbitraje ahora.');
    }
  }
  blocks.push(recomendacion.join('\n'));

  const liquidityEntries = Object.entries(liquidityByBank)
    .map(([bank, amount]) => ({ bank, amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const liquidityBlock = [];
  liquidityBlock.push('🏦 <b>Liquidez rápida disponible</b>');
  if (!liquidityEntries.length) {
    liquidityBlock.push('• —');
  } else {
    liquidityEntries.forEach((item) => {
      liquidityBlock.push(`• ${escapeHtml(item.bank)}: ${fmtCup(item.amount)} CUP`);
    });
  }
  blocks.push(liquidityBlock.join('\n'));

  const nota = [];
  nota.push('📝 <b>Parámetros</b>');
  nota.push(`• Mínimo por operación: ${fmtUsd(config.minSellUsd)} USD`);
  nota.push(`• Tasas: BUY=${fmtCup(config.buyRate)} / SELL=${fmtCup(config.sellRate)}`);
  blocks.push(nota.join('\n'));

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
    const config = opts.config || loadConfig();
    const balances = opts.balances || (await getLatestBalances());
    const totals = aggregateBalances(balances, config.liquidityBanks);
    const needs = computeNeeds({
      activosCup: totals.activosCup,
      deudasCup: totals.deudasCup,
      cushionTarget: config.cushion,
    });
    const plan = computePlan({
      needCup: needs.needCup,
      usdInventory: totals.usdInventory,
      sellRate: config.sellRate,
      buyRate: config.buyRate,
      minSellUsd: config.minSellUsd,
      liquidityByBank: totals.liquidityByBank,
    });

    const usdInventoryCup = Math.round(totals.usdInventory * config.sellRate);

    const result = {
      ...totals,
      ...needs,
      usdInventory: totals.usdInventory,
      usdInventoryCup,
      plan,
      config,
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
    scenes.saldoWizard,
    scenes.tarjetasAssist,
    scenes.monitorAssist,
    scenes.extractoAssist,
  ];
  targets.forEach((scene) => {
    if (scene && typeof scene.on === 'function') {
      scene.on('leave', (ctx) => {
        const runner = module.exports.runFondo || runFondo;
        return runner(ctx).catch((err) => {
          console.error('[fondoAdvisor] Error en leave handler:', err.message);
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
};

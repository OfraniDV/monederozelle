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
    buyRate: parseNumber(env.ADVISOR_BUY_RATE_CUP_PER_USD, DEFAULT_CONFIG.buyRate),
    sellRate: parseNumber(env.ADVISOR_SELL_RATE_CUP_PER_USD, DEFAULT_CONFIG.sellRate),
    minSellUsd: Math.ceil(parseNumber(env.ADVISOR_MIN_SELL_USD, DEFAULT_CONFIG.minSellUsd)),
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
}) {
  const normalizedNeed = Math.max(0, Math.round(needCup || 0));
  const safeSellRate = sellRate > 0 ? Math.round(sellRate) : 0;
  const normalizedInventory = usdInventory > 0 ? Math.floor(usdInventory) : 0;
  const minUsd = minSellUsd > 0 ? Math.ceil(minSellUsd) : 0;

  console.log(
    `[fondoAdvisor] computePlan => needCup=${normalizedNeed} sellRate=${safeSellRate} inventoryUSD=${normalizedInventory} minUSD=${minUsd}`
  );

  if (normalizedNeed === 0 || safeSellRate === 0) {
    return {
      status: 'OK',
      sellTarget: { usd: 0, cupIn: 0 },
      sellNow: { usd: 0, cupIn: 0 },
      remainingCup: 0,
      remainingUsd: 0,
    };
  }

  const targetUsd = Math.ceil(normalizedNeed / safeSellRate);
  const targetCup = targetUsd * safeSellRate;
  console.log(`[fondoAdvisor] Venta objetivo => usd=${targetUsd} cup=${targetCup}`);

  let sellNowUsd = 0;
  let minWarning = false;
  if (normalizedInventory >= minUsd) {
    sellNowUsd = Math.min(normalizedInventory, targetUsd);
  } else if (targetUsd > 0 && minUsd > 0) {
    minWarning = true;
  }
  const sellNowCup = sellNowUsd * safeSellRate;
  const remainingCup = Math.max(0, normalizedNeed - sellNowCup);
  const remainingUsd = safeSellRate > 0 ? Math.ceil(remainingCup / safeSellRate) : 0;

  console.log(
    `[fondoAdvisor] Venta inmediata => usd=${sellNowUsd} cup=${sellNowCup} remainingCup=${remainingCup} remainingUsd=${remainingUsd}`
  );
  if (minWarning) {
    console.log('[fondoAdvisor] Inventario USD por debajo del mínimo configurado.');
  }

  const sellNow = minWarning
    ? { usd: sellNowUsd, cupIn: sellNowCup, minWarning: true }
    : { usd: sellNowUsd, cupIn: sellNowCup };

  return {
    status: targetUsd > 0 ? 'NEED_ACTION' : 'OK',
    sellTarget: { usd: targetUsd, cupIn: targetCup },
    sellNow,
    remainingCup,
    remainingUsd,
  };
}

function computeUrgency({ needCup = 0, sellNowUsd = 0, remainingCup = 0 }) {
  if (needCup > 0 && sellNowUsd === 0) return '🔴 URGENTE';
  if (needCup > 0 && sellNowUsd > 0 && remainingCup > 0) return '🟠 PRIORITARIO';
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
    liquidityByBank,
    config,
    deudaAbs,
    urgency,
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
    `• Disponible tras deudas: ${fmtCup(disponibles)} CUP`,
  ];
  blocks.push(estado.join('\n'));

  const objetivo = [
    '🎯 <b>Objetivo</b>',
    `• Colchón objetivo: ${fmtCup(cushionTarget)} CUP`,
    `• Necesidad adicional: ${fmtCup(needCup)} CUP`,
  ];
  blocks.push(objetivo.join('\n'));

  const venta = [
    '💸 <b>Venta requerida (Zelle)</b>',
    `• Objetivo: vender ${fmtUsd(plan.sellTarget.usd)} USD a ${fmtCup(config.sellRate)} ⇒ +${fmtCup(plan.sellTarget.cupIn)} CUP`,
  ];
  const sellNowLine = `• Vende ahora: ${fmtUsd(plan.sellNow.usd)} USD ⇒ +${fmtCup(plan.sellNow.cupIn)} CUP`;
  if (plan.sellNow.usd === 0 && plan.sellNow.minWarning) {
    venta.push(`${sellNowLine} (⚠️ inventario menor al mínimo de ${fmtUsd(config.minSellUsd)} USD)`);
  } else {
    venta.push(sellNowLine);
  }
  venta.push(
    `• Faltante tras venta: ${fmtCup(plan.remainingCup)} CUP (≈ ${fmtUsd(plan.remainingUsd)} USD)`
  );
  blocks.push(venta.join('\n'));

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
    `• Fórmula: necesidad = |deudas| + colchón − activos = ${fmtCup(deudaAbs)} + ${fmtCup(cushionTarget)} − ${fmtCup(activosCup)} = ${fmtCup(needCup)} CUP`,
    `• Objetivo USD = ceil(necesidad / SELL) = ceil(${fmtCup(needCup)} / ${fmtCup(config.sellRate)}) = ${fmtUsd(plan.sellTarget.usd)} USD`,
  ];
  blocks.push(explicacion.join('\n'));

  const parametros = [
    '📝 <b>Parámetros</b>',
    `• Mínimo por operación: ${fmtUsd(config.minSellUsd)} USD`,
    `• Tasa SELL: ${fmtCup(config.sellRate)}`,
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

    if (!opts.skipSellRateFetch) {
      const sellFromDb = await getSellRateFromDb();
      if (sellFromDb) {
        config.sellRate = sellFromDb;
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
    });

    const urgency = computeUrgency({
      needCup: needs.needCup,
      sellNowUsd: plan.sellNow.usd,
      remainingCup: plan.remainingCup,
    });
    console.log(`[fondoAdvisor] Urgencia calculada => ${urgency}`);

    const result = {
      ...totals,
      ...needs,
      plan,
      config,
      urgency,
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
};

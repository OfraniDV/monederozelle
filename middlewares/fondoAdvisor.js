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
  sellRate: 452,
  minSellUsd: 40,
  liquidityBanks: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
  sellFeePct: 0,
  fxMarginPct: 0,
  sellRoundToUsd: 1,
  minKeepUsd: 0,
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
  };
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

  const proyeccion = [
    '🧾 <b>Proyección post-venta</b>',
    '• Negativos: 0 CUP (proyectado)',
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
};

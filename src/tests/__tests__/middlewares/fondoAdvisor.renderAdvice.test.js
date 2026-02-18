'use strict';

const { renderAdvice } = require('../../../middlewares/fondoAdvisor');

function buildBaseResult(overrides = {}) {
  const baseConfig = {
    cushion: 180000,
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
  };

  const base = {
    activosCup: 412779,
    deudasCup: -275000,
    netoCup: 137779,
    cushionTarget: 180000,
    needCup: 42221,
    disponibles: 137779,
    plan: {
      sellTarget: { usd: 94, cupIn: 42488 },
      sellNow: { usd: 80, cupIn: 36160 },
      remainingCup: 6061,
      remainingUsd: 14,
      sellNet: 452,
    },
    projection: { negativosPost: 0, colchonPost: 173939 },
    liquidityByBank: {
      BANDEC: 322491,
      MITRANSFER: 53628,
      METRO: 23295,
      BPA: 13365,
    },
    config: baseConfig,
    deudaAbs: 275000,
    urgency: '🟠 PRIORITARIO',
    monthlyLimits: { cards: [], totals: { totalRemaining: 0, blocked: 0, extendable: 0 } },
    distributionNow: { assignments: [], leftover: 0, totalAssigned: 0 },
    distributionTarget: { assignments: [], leftover: 6061, totalAssigned: 0 },
    buyRateCup: 400,
    buyRateSource: 'db',
    sellRateSource: 'env',
    usdInventory: 180,
    history: {
      prevDay: {
        activosCup: 430000,
        deudasCup: -270000,
        netoCup: 160000,
        netoTrasColchon: -20000,
        disponibles: 160000,
        usdInventory: 190,
      },
      prevMonth: {
        activosCup: 450000,
        deudasCup: -260000,
        netoCup: 190000,
        netoTrasColchon: 10000,
        disponibles: 190000,
        usdInventory: 205,
      },
    },
  };

  const merged = {
    ...base,
    ...overrides,
  };

  merged.plan = {
    ...base.plan,
    ...(overrides.plan || {}),
  };

  merged.projection = {
    ...base.projection,
    ...(overrides.projection || {}),
  };

  merged.config = {
    ...baseConfig,
    ...(overrides.config || {}),
  };

  merged.liquidityByBank = {
    ...base.liquidityByBank,
    ...(overrides.liquidityByBank || {}),
  };

  const overridesMonthly = overrides.monthlyLimits || {};
  merged.monthlyLimits = {
    cards: Array.isArray(overridesMonthly.cards) ? overridesMonthly.cards : base.monthlyLimits.cards,
    totals: {
      ...base.monthlyLimits.totals,
      ...(overridesMonthly.totals || {}),
    },
  };

  merged.distributionNow = {
    ...base.distributionNow,
    ...(overrides.distributionNow || {}),
  };

  merged.distributionTarget = overrides.hasOwnProperty('distributionTarget')
    ? overrides.distributionTarget
    : base.distributionTarget;

  return merged;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('renderAdvice output formatting', () => {
  test('liquidez rápida muestra equivalentes en USD cuando hay tasa de compra', () => {
    const result = buildBaseResult();
    const blocks = renderAdvice(result);
    const liquidityBlock = blocks.find((b) => b.startsWith('🏦 <b>Liquidez rápida disponible</b>'));
    expect(liquidityBlock).toBeDefined();
    expect(liquidityBlock).toContain('• BANDEC: 322,491 CUP (≈ 806.23 USD)');
    expect(liquidityBlock).toContain('• MITRANSFER: 53,628 CUP (≈ 134.07 USD)');
    expect(liquidityBlock).toContain('• METRO: 23,295 CUP (≈ 58.24 USD)');
    expect(liquidityBlock).toContain('• BPA: 13,365 CUP (≈ 33.41 USD)');
  });

  test('estado actual elimina sufijo de tasa de compra en equivalentes USD', () => {
    const result = buildBaseResult();
    const message = renderAdvice(result).join('\n\n');
    expect(message).toContain('📊 <b>Estado actual</b>');
    expect(message).not.toContain('📊 <b>Estado actual CUP</b>');
    expect(message).toContain('ℹ️ <b>Indicadores</b>');
    expect(message).not.toContain('@ compra');
  });

  test('se eliminan bloques de tasas, equivalencias y parámetros', () => {
    const result = buildBaseResult();
    const message = renderAdvice(result).join('\n\n');
    expect(message).not.toContain('💱 <b>Tasas de referencia</b>');
    expect(message).not.toContain('🔄 <b>Equivalencias de referencia</b>');
    expect(message).not.toContain('📝 <b>Parámetros</b>');
  });

  test('snapshot completo mantiene formato HTML de liquidez', () => {
    const result = buildBaseResult();
    const message = renderAdvice(result).join('\n\n');
    expect(message).toMatchSnapshot();
  });

  test('liquidez rápida se mantiene solo en CUP cuando no hay tasa válida', () => {
    const result = buildBaseResult({ buyRateCup: null, buyRateSource: 'none' });
    const liquidityBlock = renderAdvice(result).find((b) =>
      b.startsWith('🏦 <b>Liquidez rápida disponible</b>')
    );
    expect(liquidityBlock).toBeDefined();
    expect(liquidityBlock).toContain('• BANDEC: 322,491 CUP');
    expect(liquidityBlock).not.toContain('USD');
  });
});

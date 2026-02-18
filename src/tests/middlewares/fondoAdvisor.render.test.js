'use strict';

const { renderAdvice, createFmtCupUsdPair } = require('../../middlewares/fondoAdvisor');

function deepMerge(target = {}, source = {}) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (Array.isArray(value)) {
      output[key] = value.slice();
    } else if (value && typeof value === 'object') {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

function buildBaseResult(overrides = {}) {
  const base = {
    activosCup: 250000,
    deudasCup: -80000,
    netoCup: 170000,
    cushionTarget: 120000,
    needCup: 30000,
    disponibles: 90000,
    plan: {
      sellTarget: {
        usd: 200,
        cupIn: 90000,
      },
      sellNow: {
        usd: 150,
        cupIn: 67500,
        minWarning: false,
      },
      remainingCup: 22500,
      remainingUsd: 70,
      sellNet: 450,
      usedSellSource: 'db',
    },
    projection: {
      negativosPost: -5000,
      colchonPost: 110000,
    },
    liquidityByBank: {
      BANDEC: 50000,
      BPA: 30000,
      METRO: 20000,
    },
    config: {
      minKeepUsd: 50,
      sellRate: 450,
      minSellUsd: 40,
      liquidityBanks: ['BANDEC', 'BPA', 'METRO'],
      sellFeePct: 0.02,
      fxMarginPct: 0,
      sellRoundToUsd: 1,
      buyRateCup: 325,
      buyRateSource: 'db',
      sellRateSource: 'db',
      limitMonthlyDefaultCup: 120000,
      limitMonthlyBpaCup: 150000,
      allocationBankOrder: ['BANDEC', 'BPA', 'METRO'],
    },
    deudaAbs: 80000,
    urgency: '🟠 PRIORITARIO',
    monthlyLimits: {
      cards: [
        {
          bank: 'BANDEC',
          mask: '#1111',
          numero: '1111111111111111',
          usedOut: 30000,
          balancePos: 10000,
          remaining: 90000,
          depositCap: 80000,
          status: 'OK',
          extendable: false,
          isBolsa: false,
        },
        {
          bank: 'BPA',
          mask: '#2222',
          numero: '2222222222222222',
          usedOut: 40000,
          balancePos: 5000,
          remaining: 110000,
          depositCap: 105000,
          status: 'EXTENDABLE',
          extendable: true,
          isBolsa: false,
        },
        {
          bank: 'METRO',
          mask: '#3333',
          numero: '3333333333333333',
          usedOut: 20000,
          balancePos: 0,
          remaining: 100000,
          depositCap: 100000,
          status: 'OK',
          extendable: false,
          isBolsa: false,
        },
      ],
      totals: {
        blocked: 0,
        extendable: 1,
        totalRemaining: 300000,
      },
    },
    distributionNow: {
      assignments: [
        {
          bank: 'BANDEC',
          numero: '1111111111111111',
          mask: '#1111',
          assignCup: 40000,
          remainingAntes: 60000,
          remainingDespues: 20000,
          status: 'OK',
          isBolsa: false,
        },
        {
          bank: 'BPA',
          numero: '2222222222222222',
          mask: '#2222',
          assignCup: 20000,
          remainingAntes: 50000,
          remainingDespues: 30000,
          status: 'EXTENDABLE',
          isBolsa: false,
        },
      ],
      leftover: 5000,
      totalAssigned: 60000,
    },
    distributionTarget: {
      assignments: [
        {
          bank: 'BANDEC',
          numero: '1111111111111111',
          mask: '#1111',
          assignCup: 50000,
          remainingAntes: 60000,
          remainingDespues: 10000,
          status: 'OK',
          isBolsa: false,
        },
        {
          bank: 'BPA',
          numero: '2222222222222222',
          mask: '#2222',
          assignCup: 30000,
          remainingAntes: 60000,
          remainingDespues: 30000,
          status: 'EXTENDABLE',
          isBolsa: false,
        },
        {
          bank: 'MITRANSFER',
          numero: '4444444444444444',
          mask: '#4444',
          assignCup: 10000,
          remainingAntes: 20000,
          remainingDespues: 10000,
          status: 'OK',
          isBolsa: true,
        },
      ],
      leftover: 10000,
      totalAssigned: 90000,
    },
    buyRateCup: 325,
    buyRateSource: 'db',
    sellRateSource: 'db',
    usdInventory: 260,
    history: {
      prevDay: {
        activosCup: 240000,
        deudasCup: -140000,
        netoCup: 100000,
        netoTrasColchon: -20000,
        disponibles: 100000,
        usdInventory: 240,
      },
      prevMonth: {
        activosCup: 255000,
        deudasCup: -110000,
        netoCup: 145000,
        netoTrasColchon: 25000,
        disponibles: 145000,
        usdInventory: 280,
      },
    },
  };

  return deepMerge(base, overrides);
}

describe('createFmtCupUsdPair', () => {
  test('formatea con tasa de compra', () => {
    const fmt = createFmtCupUsdPair({ hasBuyRate: true, resolvedBuyRate: 325 });
    expect(fmt(650)).toBe('650 CUP (≈ 2.00 USD)');
    expect(fmt(-325)).toBe('-325 CUP (≈ -1.00 USD)');
  });

  test('omite USD cuando no hay tasa', () => {
    const fmt = createFmtCupUsdPair({ hasBuyRate: false, resolvedBuyRate: 0 });
    expect(fmt(5000)).toBe('5,000 CUP');
    expect(fmt(Number.NaN)).toBe('0 CUP');
  });
});

describe('renderAdvice formatting', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('incluye pares CUP/USD y nuevo orden en Estado y Objetivo', () => {
    const blocks = renderAdvice(buildBaseResult());
    const estado = blocks.find((block) => block.startsWith('📊 <b>Estado actual</b>'));
    expect(estado).toContain('Activos: 250,000 CUP (≈ 769.23 USD)');
    expect(estado).toContain('Deudas: -80,000 CUP (≈ -246.15 USD)');
    const colchIndex = estado.indexOf('Colchón actual');
    const netoIndex = estado.indexOf('Neto');
    expect(colchIndex).toBeGreaterThan(0);
    expect(netoIndex).toBeGreaterThan(colchIndex);

    const objetivo = blocks.find((block) => block.startsWith('🎯 <b>Objetivo</b>'));
    expect(objetivo).toContain('Colchón objetivo: 120,000 CUP (≈ 369.23 USD)');
    expect(objetivo).toContain('Necesidad adicional: 30,000 CUP (≈ 92.31 USD)');
  });

  test('agrega columna ≈USD(LIBRE) y totales en USD en la tabla de límites', () => {
    const blocks = renderAdvice(buildBaseResult());
    const tableIndex = blocks.findIndex((block) => block.includes('🚦 <b>Límite mensual por tarjeta</b>'));
    const tablePre = blocks[tableIndex + 2];
    expect(tablePre).toContain('≈USD(LIBRE)');
    expect(tablePre).toContain('≈USD totales: SAL');
  });

  test('muestra nota y omite pares USD cuando no hay tasa', () => {
    const blocks = renderAdvice(
      buildBaseResult({
        buyRateCup: null,
        buyRateSource: 'none',
        config: { buyRateCup: null, buyRateSource: 'none' },
      })
    );
    const joined = blocks.join('\n\n');
    expect(joined).not.toContain('(≈ ');
    expect(joined).toContain('ℹ️ No se mostró equivalente en USD porque no hay tasa de compra configurada.');
  });
});

describe('renderAdvice snapshots', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('caso base con tasa 325', () => {
    const blocks = renderAdvice(buildBaseResult());
    expect(blocks.join('\n\n')).toMatchSnapshot();
  });

  test('caso sin tasa de compra', () => {
    const blocks = renderAdvice(
      buildBaseResult({
        buyRateCup: null,
        buyRateSource: 'none',
        config: { buyRateCup: null, buyRateSource: 'none' },
      })
    );
    expect(blocks.join('\n\n')).toMatchSnapshot();
  });

  test('caso con escenarios y leftover destacados', () => {
    const blocks = renderAdvice(
      buildBaseResult({
        plan: {
          sellTarget: { usd: 250, cupIn: 112500 },
          sellNow: { usd: 180, cupIn: 81000, minWarning: true },
          remainingCup: 31500,
          remainingUsd: 97,
          sellNet: 450,
        },
        distributionNow: {
          assignments: [
            {
              bank: 'BANDEC',
              numero: '1111111111111111',
              mask: '#1111',
              assignCup: 50000,
              remainingAntes: 60000,
              remainingDespues: 10000,
              status: 'OK',
              isBolsa: false,
            },
          ],
          leftover: 30000,
          totalAssigned: 50000,
        },
      })
    );
    expect(blocks.join('\n\n')).toMatchSnapshot();
  });
});

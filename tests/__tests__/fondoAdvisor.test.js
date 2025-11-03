'use strict';

const {
  computeNeeds,
  renderAdvice,
  aggregateBalances,
  computePlan,
  computeProjection,
} = require('../../middlewares/fondoAdvisor');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fondoAdvisor core calculations', () => {
  test('computeNeeds aplica fórmula principal con redondeo', () => {
    const result = computeNeeds({
      activosCup: 161654,
      deudasCup: -168764,
      cushionTarget: 150000,
    });
    expect(result.needCup).toBe(157110);
    expect(result.deudaAbs).toBe(168764);
    expect(result.disponibles).toBe(-7110); // 161654 - 168764
  });

  test('aggregateBalances ignora cuentas por cobrar y convierte USD', () => {
    const rows = [
      {
        moneda: 'CUP',
        banco: 'BANDEC',
        agente: 'Cliente Deuda',
        numero: 'Cuenta debe',
        saldo: 5000,
        tasa_usd: 1,
      },
      {
        moneda: 'CUP',
        banco: 'BANDEC',
        agente: 'Cliente Deuda',
        numero: 'Cuenta debe',
        saldo: -5000,
        tasa_usd: 1,
      },
      {
        moneda: 'USD',
        banco: 'BANDEC',
        agente: 'Caja fuerte',
        numero: '1111',
        saldo: 900,
        tasa_usd: 1,
      },
      {
        moneda: 'MLC',
        banco: 'BPA',
        agente: 'Caja fuerte',
        numero: '2222',
        saldo: 45200,
        tasa_usd: 1 / 452,
      },
    ];
    const totals = aggregateBalances(rows, ['BANDEC', 'BPA']);
    expect(totals.activosCup).toBe(0);
    expect(totals.deudasCup).toBe(-5000);
    expect(Math.round(totals.usdInventory)).toBe(1000);
    expect(totals.liquidityByBank.BANDEC || 0).toBe(0);
    expect(totals.debtsDetail).toHaveLength(1);
    expect(totals.debtsDetail[0]).toEqual({
      agente: 'CLIENTE DEUDA',
      banco: 'BANDEC',
      numero: 'CUENTA DEBE',
      tasaUsd: 1,
      saldoCup: -5000,
    });
  });

  test('renderAdvice genera mensaje en español sin etiquetas prohibidas', () => {
    const config = {
      cushion: 150000,
      sellRate: 452,
      minSellUsd: 40,
      liquidityBanks: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
      sellFeePct: 0,
      fxMarginPct: 0,
      sellRoundToUsd: 1,
      minKeepUsd: 0,
    };
    const liquidity = {
      BANDEC: 70771.82,
      MITRANSFER: 53628.0,
      METRO: 5909.37,
      BPA: 1345.0,
    };
    const needs = computeNeeds({
      activosCup: 161654,
      deudasCup: -168764,
      cushionTarget: config.cushion,
    });
    const plan = computePlan({
      needCup: needs.needCup,
      usdInventory: 200,
      sellRate: config.sellRate,
      minSellUsd: config.minSellUsd,
      sellFeePct: config.sellFeePct,
      fxMarginPct: config.fxMarginPct,
      sellRoundToUsd: config.sellRoundToUsd,
      minKeepUsd: config.minKeepUsd,
      sellRateSource: 'env',
    });
    const projection = computeProjection(161654, -168764, plan.sellNow.cupIn);
    const netoTrasColchon = 161654 - 168764 - config.cushion;
    const result = {
      activosCup: 161654,
      deudasCup: -168764,
      netoCup: netoTrasColchon,
      ...needs,
      plan,
      projection,
      liquidityByBank: liquidity,
      config,
      urgency: '🟠 PRIORITARIO',
    };
    const blocks = renderAdvice(result);
    const message = blocks.join('\n\n');
    expect(Array.isArray(blocks)).toBe(true);
    expect(message).toContain('💸 <b>Venta requerida (Zelle)</b>');
    expect(message).toContain('👉 Objetivo: vender 348 USD a 452 ⇒ +157,296 CUP');
    expect(message).toContain('👉 Vende ahora: 200 USD ⇒ +90,400 CUP');
    expect(message).toContain('Faltante tras venta: 66,710 CUP');
    expect(message).not.toContain('Faltante tras venta: 66,710 CUP (≈');
    expect(message).toContain('🧾 <b>Proyección post-venta</b>');
    expect(message).toContain('Colchón proyectado: 83,290 CUP');
    expect(message).toContain('🏦 <b>Liquidez rápida disponible</b>');
    expect(message).not.toContain('ciclos');
    expect(message).not.toContain('<br>');
    expect(message).not.toContain('<ul>');
  });
});

describe('Detalle de deudas en renderAdvice', () => {
  const baseConfig = {
    cushion: 0,
    sellRate: 452,
    minSellUsd: 0,
    liquidityBanks: ['BANDEC'],
    sellFeePct: 0,
    fxMarginPct: 0,
    sellRoundToUsd: 1,
    minKeepUsd: 0,
    limitMonthlyDefaultCup: 0,
    limitMonthlyBpaCup: 0,
    extendableBanks: [],
    assessableBanks: [],
    allocationBankOrder: [],
  };

  function buildMinimalResult(overrides = {}) {
    const plan = overrides.plan || {
      sellNow: { cupIn: 0, usd: 0 },
      sellTarget: { cupIn: 0, usd: 0 },
      remainingCup: 0,
      remainingUsd: 0,
    };
    return {
      activosCup: overrides.activosCup ?? 0,
      deudasCup: overrides.deudasCup ?? -1000,
      netoCup: overrides.netoCup ?? -1000,
      cushionTarget: overrides.cushionTarget ?? 0,
      needCup: overrides.needCup ?? 0,
      disponibles: overrides.disponibles ?? 0,
      plan,
      projection: overrides.projection || { negativosPost: 0, colchonPost: 0 },
      liquidityByBank: overrides.liquidityByBank || {},
      config: { ...baseConfig, ...(overrides.config || {}) },
      deudaAbs: overrides.deudaAbs ?? 1000,
      urgency: overrides.urgency || '🟢 NORMAL',
      monthlyLimits: overrides.monthlyLimits || { cards: [], totals: { blocked: 0, extendable: 0 } },
      distributionNow: overrides.distributionNow || { assignments: [], leftover: 0, totalAssigned: 0 },
      distributionTarget: overrides.distributionTarget || { assignments: [], leftover: 0, totalAssigned: 0 },
      buyRateCup: overrides.buyRateCup,
      buyRateSource: overrides.buyRateSource,
      sellRateSource: overrides.sellRateSource || 'ENV',
      usdInventory: overrides.usdInventory ?? 0,
      debtsDetail: overrides.debtsDetail || [],
    };
  }

  test('incluye columna USD y totales por agente cuando hay tasa de compra', () => {
    const debtsDetail = [
      { agente: 'CLAUDIA', banco: 'METRO', numero: '0000392', tasaUsd: 1, saldoCup: -3750 },
      { agente: 'CLAUDIA', banco: 'BANDEC', numero: '0008731', tasaUsd: 1, saldoCup: -116 },
      { agente: 'LILI', banco: 'METRO', numero: '0000000', tasaUsd: 1, saldoCup: -35600 },
    ];
    const result = buildMinimalResult({
      deudasCup: -39466,
      deudaAbs: 39466,
      buyRateCup: 452,
      buyRateSource: 'db',
      config: { buyRateCup: 452, buyRateSource: 'db' },
      debtsDetail,
    });
    const blocks = renderAdvice(result);
    const message = blocks.join('\n\n');
    expect(message).toContain('📉 <b>Detalle de deudas por agente/subcuenta</b>');
    expect(message).toContain('≈USD');
    expect(message).toContain('TOTAL CLAUDIA');
    expect(message).toContain('TOTAL LILI');
    expect(message).toContain('TOTAL GENERAL');
    expect(message).toContain('39,466');
  });

  test('omite columna USD cuando no hay tasa de compra', () => {
    const debtsDetail = [
      { agente: 'CLAUDIA', banco: 'METRO', numero: '0000392', tasaUsd: 1, saldoCup: -3750 },
    ];
    const result = buildMinimalResult({
      deudasCup: -3750,
      deudaAbs: 3750,
      buyRateCup: null,
      buyRateSource: 'none',
      config: { buyRateCup: 0, buyRateSource: 'none' },
      debtsDetail,
    });
    const blocks = renderAdvice(result);
    const message = blocks.join('\n\n');
    expect(message).toContain('📉 <b>Detalle de deudas por agente/subcuenta</b>');
    expect(message).not.toContain('≈USD');
    expect(message).toContain('TOTAL GENERAL');
    expect(message).toContain('3,750');
  });
});

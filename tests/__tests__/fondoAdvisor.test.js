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
        tasa_usd: 452,
      },
    ];
    const totals = aggregateBalances(rows, ['BANDEC', 'BPA']);
    expect(totals.activosCup).toBe(0);
    expect(totals.deudasCup).toBe(-5000);
    expect(Math.round(totals.usdInventory)).toBe(1000);
    expect(totals.liquidityByBank.BANDEC || 0).toBe(0);
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
    const result = {
      activosCup: 161654,
      deudasCup: -168764,
      netoCup: 161654 - 168764,
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
    expect(message).toContain('Objetivo: vender 348 USD a 452 ⇒ +157,296 CUP');
    expect(message).toContain('Vende ahora: 200 USD ⇒ +90,400 CUP');
    expect(message).toContain('Faltante tras venta: 66,710 CUP (≈ 148 USD)');
    expect(message).toContain('🧾 <b>Proyección post-venta</b>');
    expect(message).toContain('Colchón proyectado: 252,054 CUP');
    expect(message).toContain('🏦 <b>Liquidez rápida disponible</b>');
    expect(message).not.toContain('ciclos');
    expect(message).not.toContain('<br>');
    expect(message).not.toContain('<ul>');
  });
});

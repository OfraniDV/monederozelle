'use strict';

const {
  computeNeeds,
  computePlan,
  renderAdvice,
  aggregateBalances,
} = require('../../middlewares/fondoAdvisor');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fondoAdvisor core calculations', () => {
  test('computeNeeds aplica fórmula principal', () => {
    const result = computeNeeds({
      activosCup: 161654.19,
      deudasCup: -168763.99,
      cushionTarget: 150000,
    });
    expect(result.needCup).toBe(157110);
    expect(result.deudaAbs).toBe(168764);
    expect(result.disponibles).toBe(-7110);
  });

  describe('computePlan con tasas estándar', () => {
    const baseOptions = {
      needCup: 157110,
      sellRate: 452,
      buyRate: 400,
      minSellUsd: 40,
      liquidityByBank: {
        BANDEC: 70771.82,
        MITRANSFER: 53628.0,
        METRO: 5909.37,
        BPA: 1345.0,
      },
    };

    test('sin inventario disponible recurre a ciclos', () => {
      const plan = computePlan({ ...baseOptions, usdInventory: 0 });
      expect(plan.sellTarget.usd).toBe(348);
      expect(plan.sellTarget.cupIn).toBe(157296);
      expect(plan.sellNow.usd).toBe(0);
      expect(plan.remainingCup).toBe(157110);
      expect(plan.optionalCycle.usdPerCycle).toBe(329);
      expect(plan.optionalCycle.profitPerCycle).toBe(17108);
      expect(plan.optionalCycle.cyclesNeeded).toBe(10);
      expect(plan.urgency).toBe('🔴 URGENTE');
    });

    test('con 200 USD inventario reduce ciclos y prioridad', () => {
      const plan = computePlan({ ...baseOptions, usdInventory: 200 });
      expect(plan.sellNow.usd).toBe(200);
      expect(plan.sellNow.cupIn).toBe(90400);
      expect(plan.remainingCup).toBe(66710);
      expect(plan.optionalCycle.cyclesNeeded).toBe(4);
      expect(plan.urgency).toBe('🟠 PRIORITARIO');
    });

    test('inventario bajo mínimo y liquidez insuficiente por ciclo', () => {
      const tinyPlan = computePlan({
        needCup: 10000,
        usdInventory: 20,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 1000 },
      });
      expect(tinyPlan.sellNow.usd).toBe(20);
      expect(tinyPlan.sellNow.minWarning).toBe(true);
      expect(tinyPlan.optionalCycle.usdPerCycle).toBe(2);
      expect(tinyPlan.optionalCycle.belowMin).toBe(true);
      expect(tinyPlan.optionalCycle.cyclesNeeded).toBe(10);
      expect(tinyPlan.urgency).toBe('🔴 URGENTE');
    });
  });

  test('aggregateBalances ignora cuentas por cobrar marcadas como deuda', () => {
    const rows = [
      {
        moneda: 'CUP',
        banco: 'BANDEC',
        agente: 'Cliente Deuda',
        numero: '*debe*',
        saldo: 5000,
        tasa_usd: 1,
      },
      {
        moneda: 'CUP',
        banco: 'BANDEC',
        agente: 'Cliente Deuda',
        numero: '*debe*',
        saldo: -5000,
        tasa_usd: 1,
      },
    ];
    const totals = aggregateBalances(rows, ['BANDEC']);
    expect(totals.activosCup).toBe(0);
    expect(totals.deudasCup).toBe(-5000);
    expect(totals.liquidityByBank.BANDEC || 0).toBe(0);
  });

  test('renderAdvice genera mensaje en español sin etiquetas prohibidas', () => {
    const config = {
      cushion: 150000,
      buyRate: 400,
      sellRate: 452,
      minSellUsd: 40,
      liquidityBanks: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
    };
    const liquidity = {
      BANDEC: 70771.82,
      MITRANSFER: 53628.0,
      METRO: 5909.37,
      BPA: 1345.0,
    };
    const needs = computeNeeds({
      activosCup: 161654.19,
      deudasCup: -168763.99,
      cushionTarget: config.cushion,
    });
    const plan = computePlan({
      needCup: needs.needCup,
      usdInventory: 200,
      sellRate: config.sellRate,
      buyRate: config.buyRate,
      minSellUsd: config.minSellUsd,
      liquidityByBank: liquidity,
    });
    const result = {
      activosCup: 161654.19,
      deudasCup: -168763.99,
      netoCup: 161654.19 - 168763.99,
      ...needs,
      plan,
      liquidityByBank: liquidity,
      config,
    };
    const blocks = renderAdvice(result);
    const message = blocks.join('\n\n');
    expect(Array.isArray(blocks)).toBe(true);
    expect(message).toContain('💸 <b>Venta requerida</b>');
    expect(message).toContain('Objetivo: vender 348 USD a 452 ⇒ +157,296 CUP');
    expect(message).toContain('Vende ahora: 200 USD ⇒ +90,400 CUP');
    expect(message).toContain('🛒 <b>Compra por ciclos (opcional)</b>');
    expect(message).toContain('🟠 PRIORITARIO');
    expect(message).toContain('Faltante tras venta: 66,710 CUP');
    expect(message).not.toContain('<br>');
    expect(message).not.toContain('<ul>');
  });
});

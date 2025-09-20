'use strict';

const {
  computeNeeds,
  computePlan,
  computeProjection,
  aggregateBalances,
} = require('../../middlewares/fondoAdvisor');

const BASE_CONFIG = {
  sellRate: 452,
  minSellUsd: 40,
  sellFeePct: 0,
  fxMarginPct: 0,
  sellRoundToUsd: 1,
  minKeepUsd: 0,
  sellRateSource: 'env',
};

describe('fondoAdvisor pure calculations', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('needCup sin colchón y con colchón objetivo', () => {
    const base = { activosCup: 131654, deudasCup: -168764 };
    const noCushion = computeNeeds({ ...base, cushionTarget: 0 });
    expect(noCushion.needCup).toBe(37110);
    expect(noCushion.disponibles).toBe(-37110);
    expect(noCushion.deudaAbs).toBe(168764);

    const withCushion = computeNeeds({ ...base, cushionTarget: 100000 });
    expect(withCushion.needCup).toBe(137110);
    expect(withCushion.disponibles).toBe(-37110);
    expect(withCushion.deudaAbs).toBe(168764);
  });

  test('venta sin inventario respeta mínimo por operación', () => {
    const plan = computePlan({
      needCup: 37110,
      usdInventory: 0,
      ...BASE_CONFIG,
    });
    expect(plan.sellNet).toBe(452);
    expect(plan.sellTarget).toEqual({ usd: 83, cupIn: 37516 });
    expect(plan.sellNow).toEqual({ usd: 0, cupIn: 0, minWarning: true });
    expect(plan.remainingCup).toBe(37110);
    expect(plan.remainingUsd).toBe(83);
  });

  test('venta con inventario suficiente cubre todo y proyecta colchón', () => {
    const plan = computePlan({
      needCup: 37110,
      usdInventory: 500,
      ...BASE_CONFIG,
    });
    expect(plan.sellTarget).toEqual({ usd: 83, cupIn: 37516 });
    expect(plan.sellNow).toEqual({ usd: 83, cupIn: 37516 });
    expect(plan.remainingCup).toBe(0);
    expect(plan.remainingUsd).toBe(0);

    const projection = computeProjection(131654, -168764, plan.sellNow.cupIn);
    expect(projection).toEqual({ negativosPost: 0, colchonPost: 406 });
  });

  test('aplica fee, margen FX y redondeo', () => {
    const plan = computePlan({
      needCup: 37110,
      usdInventory: 100,
      ...BASE_CONFIG,
      sellFeePct: 0.004,
      fxMarginPct: 0.01,
      sellRoundToUsd: 5,
    });
    expect(plan.sellNet).toBe(450);
    expect(plan.sellTarget).toEqual({ usd: 85, cupIn: 38250 });
    expect(plan.sellNow).toEqual({ usd: 85, cupIn: 38250 });
    expect(plan.remainingCup).toBe(0);
  });

  test('respeta redondeo y reserva mínima de inventario', () => {
    const plan = computePlan({
      needCup: 37110,
      usdInventory: 2400,
      ...BASE_CONFIG,
      sellRoundToUsd: 10,
      minKeepUsd: 50,
    });
    expect(plan.sellTarget).toEqual({ usd: 90, cupIn: 40680 });
    expect(plan.sellNow).toEqual({ usd: 90, cupIn: 40680 });
  });

  test('aggregateBalances ignora por cobrar y suma USD reales', () => {
    const rows = [
      { moneda: 'CUP', banco: 'BANDEC', agente: 'Caja operativa', numero: 'Cuenta 1', saldo: 120000, tasa_usd: 1 },
      { moneda: 'CUP', banco: 'BANDEC', agente: 'Cliente Deudor', numero: 'Cuenta deuda', saldo: -5000, tasa_usd: 1 },
      { moneda: 'CUP', banco: 'BANDEC', agente: 'Pago debe', numero: 'Por cobrar', saldo: 10000, tasa_usd: 1 },
      { moneda: 'USD', banco: 'BANDEC', agente: 'Caja fuerte', numero: '1111', saldo: 900, tasa_usd: 1 },
      { moneda: 'MLC', banco: 'BPA', agente: 'Caja fuerte', numero: '2222', saldo: 45200, tasa_usd: 452 },
    ];

    const totals = aggregateBalances(rows, ['BANDEC', 'BPA']);
    expect(totals.activosCup).toBe(120000);
    expect(totals.deudasCup).toBe(-5000);
    expect(Math.floor(totals.usdInventory)).toBe(1000);
    expect(totals.liquidityByBank.BANDEC).toBe(120000);
    expect(totals.liquidityByBank.BPA).toBeUndefined();
  });
});

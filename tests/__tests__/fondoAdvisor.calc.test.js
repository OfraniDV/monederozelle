'use strict';

const {
  computeNeeds,
  computePlan,
} = require('../../middlewares/fondoAdvisor');

describe('fondoAdvisor calculations', () => {
  describe('computeNeeds', () => {
    it('respeta el colchón objetivo al sumar deudas y activos', () => {
      const result = computeNeeds({ activosCup: 131654, deudasCup: -168764, cushionTarget: 100000 });
      expect(result.needCup).toBe(137110);
      expect(result.disponibles).toBe(-37110); // activos - |deudas|
      expect(result.cushionTarget).toBe(100000);
      expect(result.deudaAbs).toBe(168764);
    });

    it('permite colchón cero y calcula necesidad mínima', () => {
      const result = computeNeeds({ activosCup: 131654, deudasCup: -168764, cushionTarget: 0 });
      expect(result.needCup).toBe(37110);
      expect(result.disponibles).toBe(-37110);
      expect(result.deudaAbs).toBe(168764);
    });
  });

  describe('computePlan con SELL 452 y mínimo 40 USD', () => {
    const baseConfig = {
      sellRate: 452,
      minSellUsd: 40,
    };

    it('case A: sin inventario disponible marca todo como faltante', () => {
      const plan = computePlan({ needCup: 137110, usdInventory: 0, ...baseConfig });
      expect(plan.status).toBe('NEED_ACTION');
      expect(plan.sellTarget).toEqual({ usd: 304, cupIn: 137408 });
      expect(plan.sellNow.usd).toBe(0);
      expect(plan.sellNow.minWarning).toBe(true);
      expect(plan.remainingCup).toBe(137110);
      expect(plan.remainingUsd).toBe(304);
    });

    it('case B: inventario suficiente cubre la necesidad completa', () => {
      const plan = computePlan({ needCup: 37110, usdInventory: 200, ...baseConfig });
      expect(plan.sellTarget).toEqual({ usd: 83, cupIn: 37516 });
      expect(plan.sellNow.usd).toBe(83);
      expect(plan.sellNow.cupIn).toBe(37516);
      expect(plan.remainingCup).toBe(0);
      expect(plan.remainingUsd).toBe(0);
    });

    it('case C: inventario menor al mínimo detiene la venta inmediata', () => {
      const plan = computePlan({ needCup: 37110, usdInventory: 20, ...baseConfig });
      expect(plan.sellTarget.usd).toBe(83);
      expect(plan.sellNow.usd).toBe(0);
      expect(plan.sellNow.minWarning).toBe(true);
      expect(plan.remainingCup).toBe(37110);
      expect(plan.remainingUsd).toBe(83);
    });

    it('sin necesidad devuelve estado OK y montos en cero', () => {
      const plan = computePlan({ needCup: 0, usdInventory: 500, ...baseConfig });
      expect(plan.status).toBe('OK');
      expect(plan.sellTarget.usd).toBe(0);
      expect(plan.sellNow.usd).toBe(0);
      expect(plan.remainingCup).toBe(0);
      expect(plan.remainingUsd).toBe(0);
    });
  });
});

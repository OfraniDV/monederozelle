'use strict';

const {
  computeNeeds,
  computePlan,
} = require('../../middlewares/fondoAdvisor');

describe('fondoAdvisor calculations', () => {
  describe('computeNeeds', () => {
    it('returns zero need when cushion is satisfied', () => {
      const result = computeNeeds({ activosCup: 200000, deudasCup: -50000, cushionTarget: 150000 });
      expect(result.needCup).toBe(0);
      expect(result.cushionTarget).toBe(150000);
      expect(Math.round(result.disponibles)).toBe(150000);
    });

    it('calculates additional need when cushion is not met', () => {
      const result = computeNeeds({ activosCup: 120000, deudasCup: -30000, cushionTarget: 150000 });
      expect(result.needCup).toBe(60000);
      expect(result.cushionTarget).toBe(150000);
      expect(Math.round(result.disponibles)).toBe(90000);
    });
  });

  describe('computePlan', () => {
    it('cubre la necesidad vendiendo solo inventario USD', () => {
      const plan = computePlan({
        needCup: 50000,
        usdInventory: 200,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: {},
      });
      expect(plan.sellTarget.usd).toBe(111);
      expect(plan.sellNow.usd).toBe(111);
      expect(plan.sellNow.cupIn).toBe(50172);
      expect(plan.remainingCup).toBe(0);
      expect(plan.urgency).toBe('🟢 NORMAL');
    });

    it('usa ciclos cuando no hay inventario USD', () => {
      const plan = computePlan({
        needCup: 80000,
        usdInventory: 0,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 800000 },
      });
      expect(plan.sellTarget.usd).toBe(177);
      expect(plan.sellNow.usd).toBe(0);
      expect(plan.remainingCup).toBe(80000);
      expect(plan.optionalCycle.usdPerCycle).toBe(2000);
      expect(plan.optionalCycle.profitPerCycle).toBe(104000);
      expect(plan.optionalCycle.cyclesNeeded).toBe(1);
      expect(plan.urgency).toBe('🟢 NORMAL');
    });

    it('combina venta inmediata y ciclos para cubrir el faltante', () => {
      const plan = computePlan({
        needCup: 120000,
        usdInventory: 100,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 600000 },
      });
      expect(plan.sellNow.usd).toBe(100);
      expect(plan.sellNow.cupIn).toBe(45200);
      expect(plan.remainingCup).toBe(74800);
      expect(plan.optionalCycle.usdPerCycle).toBe(1500);
      expect(plan.optionalCycle.profitPerCycle).toBe(78000);
      expect(plan.optionalCycle.cyclesNeeded).toBe(1);
      expect(plan.urgency).toBe('🟢 NORMAL');
    });

    it('marca urgencia cuando la liquidez rápida no alcanza', () => {
      const plan = computePlan({
        needCup: 90000,
        usdInventory: 0,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 20000 },
      });
      expect(plan.optionalCycle.usdPerCycle).toBe(50);
      expect(plan.optionalCycle.profitPerCycle).toBe(2600);
      expect(plan.optionalCycle.cyclesNeeded).toBe(35);
      expect(plan.remainingCup).toBe(90000);
      expect(plan.urgency).toBe('🔴 URGENTE');
    });

    it('reporta normalidad cuando no hay necesidad adicional', () => {
      const plan = computePlan({ needCup: 0, usdInventory: 0, sellRate: 452, buyRate: 400 });
      expect(plan.sellTarget.usd).toBe(0);
      expect(plan.remainingCup).toBe(0);
      expect(plan.urgency).toBe('🟢 NORMAL');
    });
  });
});

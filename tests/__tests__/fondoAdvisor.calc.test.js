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
    it('covers need selling USD inventory only', () => {
      const plan = computePlan({
        needCup: 50000,
        usdInventory: 200,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: {},
      });
      expect(plan.status).toBe('NEED_ACTION');
      expect(plan.sellUsdFirst).toMatchObject({ usdToSell: 111, cupOut: 50172, covers: true });
      expect(plan.arbitrage).toBeUndefined();
    });

    it('uses arbitrage when no USD inventory', () => {
      const plan = computePlan({
        needCup: 80000,
        usdInventory: 0,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 800000 },
      });
      expect(plan.status).toBe('NEED_ACTION');
      expect(plan.sellUsdFirst).toBeUndefined();
      expect(plan.arbitrage).toMatchObject({
        usdToCycle: 1539,
        cupToCommit: 615600,
        cupBack: 695628,
        profit: 80028,
        covers: true,
      });
      expect(plan.arbitrage.cycles).toBeGreaterThanOrEqual(1);
    });

    it('combines USD sale and arbitrage when necessary', () => {
      const plan = computePlan({
        needCup: 120000,
        usdInventory: 100,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 600000 },
      });
      expect(plan.sellUsdFirst).toMatchObject({ cupOut: 45200 });
      expect(plan.arbitrage.usdToCycle).toBeGreaterThan(0);
      expect(plan.arbitrage.covers).toBe(true);
    });

    it('flags liquidity shortfall when quick banks lack funds', () => {
      const plan = computePlan({
        needCup: 90000,
        usdInventory: 0,
        sellRate: 452,
        buyRate: 400,
        minSellUsd: 40,
        liquidityByBank: { BANDEC: 20000 },
      });
      expect(plan.arbitrage.limitedByLiquidity).toBe(true);
      expect(plan.arbitrage.usdToCycle).toBe(50);
      expect(plan.arbitrage.profit).toBe(2600);
      expect(plan.arbitrage.covers).toBe(false);
    });

    it('marks plan as OK when no extra need', () => {
      const plan = computePlan({ needCup: 0, usdInventory: 0, sellRate: 452, buyRate: 400 });
      expect(plan.status).toBe('OK');
    });
  });
});

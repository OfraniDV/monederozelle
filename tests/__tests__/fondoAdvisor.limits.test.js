'use strict';

const {
  classifyMonthlyUsage,
  computeCupDistribution,
  buildUsageCondition,
  renderAdvice,
  sortCardsByPreference,
} = require('../../middlewares/fondoAdvisor');

const BASE_LIMIT_CONFIG = {
  limitMonthlyDefaultCup: 120000,
  limitMonthlyBpaCup: 120000,
  extendableBanks: ['BPA'],
};

describe('fondoAdvisor monthly limits and allocation', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('clasifica límites mensuales según banco y uso', () => {
    const rows = [
      { id: 1, numero: '1234567890123456', banco: 'BANDEC', used_out: 121000 },
      { id: 2, numero: '6543210987654321', banco: 'BPA', used_out: 130000 },
      { id: 3, numero: '7777888899990000', banco: 'MITRANSFER', used_out: 50000 },
    ];

    const { cards } = classifyMonthlyUsage(rows, BASE_LIMIT_CONFIG);
    const byBank = Object.fromEntries(cards.map((c) => [c.bank, c]));

    expect(byBank.BANDEC.status).toBe('BLOCKED');
    expect(byBank.BANDEC.remaining).toBe(0);

    expect(byBank.BPA.status).toBe('EXTENDABLE');
    expect(byBank.BPA.remaining).toBe(0);

    expect(byBank.MITRANSFER.status).toBe('OK');
    expect(byBank.MITRANSFER.remaining).toBe(70000);
  });

  test('distribuye CUP respetando orden y usando extendibles como respaldo', () => {
    const rows = [
      { id: 1, numero: '1111222233334444', banco: 'BANDEC', used_out: 100000 },
      { id: 2, numero: '2222333344445555', banco: 'MITRANSFER', used_out: 60000 },
      { id: 3, numero: '3333444455556666', banco: 'BPA', used_out: 120000 },
    ];
    const config = {
      ...BASE_LIMIT_CONFIG,
      allocationBankOrder: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
    };
    const { cards } = classifyMonthlyUsage(rows, config);
    const distribution = computeCupDistribution(100000, cards, config.allocationBankOrder);

    expect(distribution.leftover).toBe(0);
    expect(distribution.assignments).toHaveLength(3);

    const [ban, mit, bpa] = distribution.assignments;
    expect(ban.bank).toBe('BANDEC');
    expect(ban.assignCup).toBe(20000);

    expect(mit.bank).toBe('MITRANSFER');
    expect(mit.assignCup).toBe(60000);

    expect(bpa.bank).toBe('BPA');
    expect(bpa.assignCup).toBe(20000);
    expect(bpa.status).toBe('EXTENDABLE');
  });

  test('buildUsageCondition sin patrones usa fallback de importe negativo', () => {
    const { clause, params } = buildUsageCondition({});
    expect(clause).toContain('NOT (UPPER(b.codigo) = ANY(');
    expect(clause).toContain('mv.descripcion IS NULL');
    expect(params).toEqual([[]]);
  });

  test('renderAdvice incluye bloques de límites y sugerencias con banderas', () => {
    const cards = classifyMonthlyUsage(
      [
        { id: 1, numero: '1111222233334444', banco: 'BANDEC', used_out: 120000 },
        { id: 2, numero: '2222333344445555', banco: 'MITRANSFER', used_out: 40000 },
        { id: 3, numero: '3333444455556666', banco: 'BPA', used_out: 125000 },
      ],
      BASE_LIMIT_CONFIG
    );

    const advice = renderAdvice({
      activosCup: 0,
      deudasCup: 0,
      netoCup: 0,
      cushionTarget: 0,
      needCup: 0,
      disponibles: 0,
      plan: {
        sellTarget: { usd: 0, cupIn: 0 },
        sellNow: { usd: 0, cupIn: 150000 },
        remainingCup: 0,
        remainingUsd: 0,
        sellNet: 452,
      },
      projection: { negativosPost: 0, colchonPost: 0 },
      liquidityByBank: {},
      config: {
        allocationBankOrder: ['BANDEC', 'MITRANSFER', 'BPA'],
        liquidityBanks: [],
        minSellUsd: 0,
        sellRate: 452,
        sellFeePct: 0,
        fxMarginPct: 0,
        sellRoundToUsd: 1,
        minKeepUsd: 0,
      },
      deudaAbs: 0,
      urgency: '🟢 NORMAL',
      monthlyLimits: cards,
      distributionNow: computeCupDistribution(150000, cards.cards, ['BANDEC', 'MITRANSFER', 'BPA']),
      distributionTarget: null,
    });

    const text = advice.join('\n\n');
    expect(text).toContain('🚦 <b>Límite mensual por tarjeta</b>');
    expect(text).toContain('⛔️ No recibir CUP');
    expect(text).toContain('🟡 Límite alcanzado, ampliable Multibanca 24h');
    expect(text).toContain('📍 <b>Sugerencia de destino del CUP</b>');
    expect(text).toContain('🟡 ampliable (Multibanca 24h)');
  });

  test('ordenamiento respeta ADVISOR_ALLOCATION_BANK_ORDER', () => {
    const rows = [
      { id: 1, numero: '1111', banco: 'OTRO', used_out: 0 },
      { id: 2, numero: '2222', banco: 'MITRANSFER', used_out: 0 },
      { id: 3, numero: '3333', banco: 'BANDEC', used_out: 0 },
    ];
    const config = {
      ...BASE_LIMIT_CONFIG,
      allocationBankOrder: ['BANDEC', 'MITRANSFER'],
    };
    const { cards } = classifyMonthlyUsage(rows, config);
    const ordered = sortCardsByPreference(cards, config.allocationBankOrder);

    expect(ordered[0].bank).toBe('BANDEC');
    expect(ordered[1].bank).toBe('MITRANSFER');
    expect(ordered[2].bank).toBe('OTRO');
  });
});


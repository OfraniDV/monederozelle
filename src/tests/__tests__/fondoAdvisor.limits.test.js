'use strict';

jest.mock('../../psql/db.js', () => ({
  query: jest.fn(),
}));

const db = require('../../psql/db.js');

const {
  classifyMonthlyUsage,
  computeCupDistribution,
  renderAdvice,
  sortCardsByPreference,
  getMonthlyOutflowsByCard,
  normalizeBankCode,
} = require('../../middlewares/fondoAdvisor');

const BASE_LIMIT_CONFIG = {
  limitMonthlyDefaultCup: 120000,
  limitMonthlyBpaCup: 120000,
  extendableBanks: ['BPA'],
  assessableBanks: ['BANDEC', 'BPA', 'METRO', 'MITRANSFER'],
};

describe('fondoAdvisor monthly limits and allocation', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('clasifica límites mensuales según banco y uso', () => {
    const rows = [
      { id: 1, numero: '1234567890123456', banco: 'BANDEC', used_out: 121000, saldo_actual: -500 },
      { id: 2, numero: '6543210987654321', banco: 'BPA', used_out: 130000, saldo_actual: 2000 },
      { id: 3, numero: '7777888899990000', banco: 'MITRANSFER', used_out: 50000, saldo_actual: 20000 },
    ];

    const { cards } = classifyMonthlyUsage(rows, BASE_LIMIT_CONFIG);
    const byBank = Object.fromEntries(cards.map((c) => [c.bank, c]));

    expect(byBank.BANDEC.status).toBe('BLOCKED');
    expect(byBank.BANDEC.remaining).toBe(0);
    expect(byBank.BANDEC.depositCap).toBe(0);

    expect(byBank.BPA.status).toBe('EXTENDABLE');
    expect(byBank.BPA.remaining).toBe(0);
    expect(byBank.BPA.depositCap).toBe(0);

    expect(byBank.MITRANSFER.status).toBe('OK');
    expect(byBank.MITRANSFER.remaining).toBe(70000);
    expect(byBank.MITRANSFER.depositCap).toBe(50000);
    expect(byBank.MITRANSFER.balancePos).toBe(20000);
  });

  test('distribuye CUP respetando orden y usando extendibles como respaldo', () => {
    const rows = [
      { id: 1, numero: '1111222233334444', banco: 'BANDEC', used_out: 100000, saldo_actual: 0 },
      { id: 2, numero: '2222333344445555', banco: 'MITRANSFER', used_out: 60000, saldo_actual: 0 },
      { id: 3, numero: '3333444455556666', banco: 'BPA', used_out: 120000, saldo_actual: 0 },
    ];
    const config = {
      ...BASE_LIMIT_CONFIG,
      allocationBankOrder: ['BANDEC', 'MITRANSFER', 'METRO', 'BPA'],
    };
    const { cards } = classifyMonthlyUsage(rows, config);
    const distribution = computeCupDistribution(100000, cards, config.allocationBankOrder);

    expect(distribution.leftover).toBe(0);
    expect(distribution.assignments).toHaveLength(2);

    const [ban, bpa] = distribution.assignments;
    expect(ban.bank).toBe('BANDEC');
    expect(ban.assignCup).toBe(20000);
    expect(ban.remainingAntes).toBe(20000);

    expect(bpa.bank).toBe('BPA');
    expect(bpa.assignCup).toBe(80000);
    expect(bpa.status).toBe('EXTENDABLE');
    expect(bpa.remainingAntes).toBe(0);
    expect(bpa.isBolsa).toBe(false);
  });

  test('getMonthlyOutflowsByCard agrega solo CUP y bancos reales normalizando sinónimos', async () => {
    const banDecMovs = [-5000, 2000, -1500];
    const bpaMovs = [-80000, -40000, 5000];

    db.query.mockImplementationOnce((sql, params) => {
      expect(sql).toContain('CASE WHEN mv.importe < 0 THEN -mv.importe ELSE 0 END');
      expect(params).toEqual([['BANDEC', 'BPA', 'METRO', 'MITRANSFER']]);
      const aggregatedRows = [
        {
          id: 1,
          numero: '11112222',
          banco: 'BANDEC',
          moneda: 'CUP',
          used_out: banDecMovs.reduce((acc, importe) => (importe < 0 ? acc + -importe : acc), 0),
          saldo_actual: 12000,
        },
        {
          id: 2,
          numero: '22223333',
          banco: 'BPA',
          moneda: 'CUP',
          used_out: bpaMovs.reduce((acc, importe) => (importe < 0 ? acc + -importe : acc), 0),
          saldo_actual: 8000,
        },
        { id: 3, numero: '33334444', banco: 'BANCA', moneda: 'CUP', used_out: 50000 },
        { id: 4, numero: '44445555', banco: 'BANDEC', moneda: 'USD', used_out: 3000 },
        { id: 5, numero: '55556666', banco: 'MI TRANSFER', moneda: 'CUP', used_out: 1000, saldo_actual: 100 },
        {
          id: 6,
          numero: '66667777',
          banco: 'BANCO METROPOLITANO',
          moneda: 'CUP',
          used_out: 2000,
          saldo_actual: 50,
        },
      ];
      return Promise.resolve({ rows: aggregatedRows });
    });

    const rows = await getMonthlyOutflowsByCard(BASE_LIMIT_CONFIG);
    expect(rows).toHaveLength(4);

    const byBank = Object.fromEntries(rows.map((row) => [row.banco, row]));
    const expectedBanDec = banDecMovs.reduce((acc, importe) => (importe < 0 ? acc + -importe : acc), 0);
    const expectedBpa = bpaMovs.reduce((acc, importe) => (importe < 0 ? acc + -importe : acc), 0);
    expect(byBank.BANDEC.used_out).toBe(expectedBanDec);
    expect(byBank.BANDEC.saldo_actual).toBe(12000);
    expect(byBank.BPA.used_out).toBe(expectedBpa);
    expect(byBank.BPA.saldo_actual).toBe(8000);
    expect(byBank.MITRANSFER.used_out).toBe(1000);
    expect(byBank.METRO.used_out).toBe(2000);
    expect(Object.keys(byBank)).not.toContain('BANCA');
    rows.forEach((row) => {
      expect(row.moneda).toBe('CUP');
    });
  });

  test("getMonthlyOutflowsByCard consulta esquema público si 'chema' está vacío", async () => {
    db.query
      .mockImplementationOnce((sql, params) => {
        expect(sql).toContain('chema.tarjeta');
        expect(params).toEqual([['BANDEC', 'BPA', 'METRO', 'MITRANSFER']]);
        return Promise.resolve({ rows: [] });
      })
      .mockImplementationOnce((sql, params) => {
        expect(sql).not.toContain('chema.tarjeta');
        expect(params).toEqual([['BANDEC', 'BPA', 'METRO', 'MITRANSFER']]);
        return Promise.resolve({
          rows: [
            {
              id: 10,
              numero: '10101010',
              banco: 'BANDEC',
              moneda: 'CUP',
              used_out: 12345,
              saldo_actual: 6789,
            },
          ],
        });
      });

    const rows = await getMonthlyOutflowsByCard(BASE_LIMIT_CONFIG);
    expect(rows).toHaveLength(1);
    expect(rows[0].banco).toBe('BANDEC');
    expect(rows[0].used_out).toBe(12345);
  });

  test('normalizeBankCode reduce sinónimos comunes a códigos estándar', () => {
    expect(normalizeBankCode('MI TRANSFER')).toBe('MITRANSFER');
    expect(normalizeBankCode('BANCO METROPOLITANO')).toBe('METRO');
    expect(normalizeBankCode('banDeC')).toBe('BANDEC');
    expect(normalizeBankCode('Banco Popular de Ahorro S.A.')).toBe('BPA');
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
    expect(text).toContain('<pre>');
    expect(text).toContain('⛔️');
    expect(text).toContain('🟡 ampliable');
    expect(text).toContain('📍 <b>Sugerencia de destino</b>');
    expect(text).toContain('🟡');
    const limitPre = (text.match(/Límite mensual por tarjeta<\/b>\n<pre>([\s\S]*?)<\/pre>/) || [])[1] || '';
    const suggestionPre = (text.match(/Sugerencia de destino<\/b>\n<pre>([\s\S]*?)<\/pre>/) || [])[1] || '';
    [limitPre, suggestionPre].forEach((segment) => {
      expect(segment).not.toContain('BANCA');
      expect(segment).not.toContain('WESTERU');
      expect(segment).not.toContain('USD');
      expect(segment).not.toContain('MLC');
    });
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


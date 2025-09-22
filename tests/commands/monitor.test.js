jest.mock('../../psql/db.js', () => ({
  query: jest.fn(),
}));

const { query } = require('../../psql/db.js');
const { parseArgs, calcRanges, getSellRate } = require('../../commands/monitor');
const moment = require('moment-timezone');

describe('parseArgs', () => {
  test('reconoce --fecha', () => {
    const opts = parseArgs('/monitor dia --fecha=2024-03-05');
    expect(opts.period).toBe('dia');
    expect(opts.fecha).toBe('2024-03-05');
  });

  test('reconoce --mes', () => {
    const opts = parseArgs('/monitor mes --mes=2024-02');
    expect(opts.period).toBe('mes');
    expect(opts.mes).toBe('2024-02');
  });
});

describe('calcRanges', () => {
  test('rango por fecha', () => {
    const { start, end } = calcRanges('dia', 'UTC', '2024-03-05');
    expect(moment.tz(start, 'UTC').format('YYYY-MM-DD')).toBe('2024-03-05');
    expect(moment.tz(end, 'UTC').format('YYYY-MM-DD')).toBe('2024-03-05');
  });

  test('rango por mes', () => {
    const { start, end } = calcRanges('mes', 'UTC', null, '2024-02');
    expect(moment.tz(start, 'UTC').format('YYYY-MM')).toBe('2024-02');
    expect(moment.tz(end, 'UTC').format('YYYY-MM')).toBe('2024-02');
  });
});

describe('getSellRate', () => {
  beforeEach(() => {
    query.mockReset();
  });

  afterEach(() => {
    delete process.env.ADVISOR_SELL_RATE_CUP_PER_USD;
    delete process.env.ADVISOR_SELL_FEE_PCT;
    delete process.env.ADVISOR_FX_MARGIN_PCT;
  });

  test('usa tasa de compra de la DB sin invertirla', async () => {
    process.env.ADVISOR_SELL_RATE_CUP_PER_USD = '459';
    process.env.ADVISOR_SELL_FEE_PCT = '0.02';
    process.env.ADVISOR_FX_MARGIN_PCT = '0';
    query.mockResolvedValue({ rows: [{ tasa_usd: 400 }] });

    const info = await getSellRate();

    expect(info.buyRate).toBe(400);
    expect(info.buySource).toBe('db');
    expect(info.sellRate).toBe(459);
    expect(info.source).toBe('env');
    expect(info.sellNet).toBe(449);
  });
});

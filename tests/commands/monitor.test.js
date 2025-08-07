const { parseArgs, calcRanges } = require('../../commands/monitor');
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

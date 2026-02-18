'use strict';

const {
  getAdvisorSettingsSnapshot,
  loadAdvisorConfigOverrides,
  saveAdvisorSetting,
} = require('../../helpers/advisorSettings');

describe('advisorSettings helper', () => {
  test('usa .env como fallback cuando no hay overrides en DB', async () => {
    const queryFn = jest.fn().mockResolvedValue({ rows: [] });
    const env = {
      ADVISOR_CUSHION_CUP: '170000',
      ADVISOR_SELL_RATE_CUP_PER_USD: '520',
      ADVISOR_MIN_SELL_USD: '50',
      LIMIT_MONTHLY_DEFAULT_CUP: '130000',
      LIMIT_MONTHLY_BPA_CUP: '140000',
      LIMIT_EXTENDABLE_BANKS: 'BPA, BANDEC',
    };

    const snapshot = await getAdvisorSettingsSnapshot({ env, queryFn });
    const byKey = Object.fromEntries(snapshot.map((item) => [item.key, item]));

    expect(byKey.ADVISOR_CUSHION_CUP.effectiveValue).toBe('170000');
    expect(byKey.ADVISOR_SELL_RATE_CUP_PER_USD.effectiveValue).toBe('520');
    expect(byKey.LIMIT_EXTENDABLE_BANKS.effectiveValue).toBe('BPA,BANDEC');
    expect(byKey.ADVISOR_CUSHION_CUP.source).toBe('env');
  });

  test('aplica overrides válidos de DB', async () => {
    const queryFn = jest.fn().mockResolvedValue({
      rows: [
        { key: 'ADVISOR_CUSHION_CUP', value: '180000' },
        { key: 'LIMIT_EXTENDABLE_BANKS', value: 'BPA, METRO' },
      ],
    });

    const runtime = await loadAdvisorConfigOverrides({ queryFn });

    expect(runtime.overrides.cushion).toBe(180000);
    expect(runtime.overrides.extendableBanks).toEqual(['BPA', 'METRO']);
    expect(runtime.sources.cushion).toBe('db');
  });

  test('saveAdvisorSetting normaliza y valida', async () => {
    const queryFn = jest.fn().mockResolvedValue({ rowCount: 1 });
    const value = await saveAdvisorSetting('LIMIT_EXTENDABLE_BANKS', 'bpa, bandec, bpa', {
      queryFn,
      userId: 999,
    });
    expect(value).toBe('BPA,BANDEC');
    expect(queryFn).toHaveBeenCalledTimes(1);
    await expect(
      saveAdvisorSetting('ADVISOR_SELL_RATE_CUP_PER_USD', '0', { queryFn })
    ).rejects.toThrow('>= 1');
  });
});


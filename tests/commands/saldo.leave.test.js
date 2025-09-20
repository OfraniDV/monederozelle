'use strict';

jest.mock('../../middlewares/fondoAdvisor', () => ({
  runFondo: jest.fn().mockResolvedValue(null),
}));

const { runFondo } = require('../../middlewares/fondoAdvisor');
const saldoWizard = require('../../commands/saldo');

describe('saldo wizard leave hook', () => {
  beforeEach(() => {
    runFondo.mockClear();
  });

  it('ejecuta el análisis de fondo al abandonar el asistente', async () => {
    const ctx = { wizard: { state: { foo: 'bar' } }, session: {} };

    await saldoWizard.handleSaldoLeave(ctx);

    expect(ctx.wizard.state).toEqual({});
    expect(runFondo).toHaveBeenCalledTimes(1);
    expect(runFondo).toHaveBeenCalledWith(ctx);
  });
});

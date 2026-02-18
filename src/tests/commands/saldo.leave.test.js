'use strict';

jest.mock('../../middlewares/fondoAdvisor', () => ({
  runFondo: jest.fn().mockResolvedValue(null),
}));

const { runFondo } = require('../../middlewares/fondoAdvisor');
const saldoWizard = require('../../commands/saldo');

describe('saldo wizard leave hook', () => {
  beforeEach(() => {
    runFondo.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envía el análisis por DM cuando el asistente se cierra en un grupo', async () => {
    const sendMessage = jest.fn().mockResolvedValue();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    runFondo.mockImplementation(async (ctxArg, opts) => {
      expect(opts).toBeDefined();
      expect(typeof opts.send).toBe('function');
      await opts.send('<b>análisis</b>');
    });

    const ctx = {
      wizard: { state: { foo: 'bar' } },
      session: {},
      chat: { type: 'supergroup', id: -100 },
      from: { id: 123 },
      telegram: { sendMessage },
    };

    await saldoWizard.handleSaldoLeave(ctx);

    expect(ctx.wizard.state).toEqual({});
    expect(runFondo).toHaveBeenCalledTimes(1);
    expect(runFondo).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ send: expect.any(Function) })
    );
    expect(sendMessage).toHaveBeenCalledWith(123, '<b>análisis</b>', {
      parse_mode: 'HTML',
    });
    expect(logSpy).toHaveBeenCalledWith('[SALDO_WIZ] fondoAdvisor enviado por DM a', 123);
  });

  it('omite el envío al grupo si el DM falla', async () => {
    const error = Object.assign(new Error('403: Forbidden'), { code: 403 });
    const sendMessage = jest.fn().mockRejectedValue(error);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    runFondo.mockImplementation(async (ctxArg, opts) => {
      await opts.send('reporte');
    });

    const ctx = {
      wizard: { state: { foo: 'bar' } },
      session: {},
      chat: { type: 'group', id: -200 },
      from: { id: 987 },
      telegram: { sendMessage },
    };

    await expect(saldoWizard.handleSaldoLeave(ctx)).resolves.toBeUndefined();

    expect(runFondo).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      '[SALDO_WIZ] No se pudo enviar DM del fondoAdvisor:',
      error.message
    );
  });

  it('mantiene el envío en el chat privado', async () => {
    runFondo.mockResolvedValue(null);
    const ctx = {
      wizard: { state: { foo: 'bar' } },
      session: {},
      chat: { type: 'private', id: 555 },
      telegram: { sendMessage: jest.fn() },
    };

    await saldoWizard.handleSaldoLeave(ctx);

    expect(runFondo).toHaveBeenCalledTimes(1);
    expect(runFondo).toHaveBeenCalledWith(ctx);
  });
});

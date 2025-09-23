'use strict';

const advisor = require('../../middlewares/fondoAdvisor');

function buildScene() {
  const handlers = {};
  return {
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit(event, ctx) {
      if (handlers[event]) {
        return handlers[event](ctx);
      }
      return null;
    },
  };
}

describe('fondoAdvisor wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers leave listeners on target scenes', async () => {
    const saldoScene = buildScene();
    const tarjetasScene = buildScene();
    const monitorScene = buildScene();
    const extractoScene = buildScene();
    const runSpy = jest.spyOn(advisor, 'runFondo').mockResolvedValue(null);

    advisor.registerFondoAdvisor({
      scenes: {
        saldoWizard: saldoScene,
        tarjetasAssist: tarjetasScene,
        monitorAssist: monitorScene,
        extractoAssist: extractoScene,
      },
    });

    expect(saldoScene.on).not.toHaveBeenCalled();
    expect(tarjetasScene.on).toHaveBeenCalledWith('leave', expect.any(Function));
    expect(monitorScene.on).toHaveBeenCalledWith('leave', expect.any(Function));
    expect(extractoScene.on).toHaveBeenCalledWith('leave', expect.any(Function));

    const ctx = { session: {}, reply: jest.fn() };
    await tarjetasScene.emit('leave', ctx);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runSpy).toHaveBeenCalledWith(ctx);

    runSpy.mockRestore();
  });

  it('intenta enviar el análisis por DM cuando el leave ocurre en un grupo', async () => {
    const tarjetasScene = buildScene();
    const runSpy = jest.spyOn(advisor, 'runFondo').mockImplementation(async (ctxArg, opts) => {
      expect(opts).toEqual(expect.objectContaining({ send: expect.any(Function) }));
      await opts.send('resumen');
    });

    advisor.registerFondoAdvisor({
      scenes: {
        tarjetasAssist: tarjetasScene,
      },
    });

    const sendMessage = jest.fn().mockResolvedValue();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = {
      session: {},
      chat: { type: 'group', id: -300 },
      from: { id: 77 },
      telegram: { sendMessage },
    };

    await tarjetasScene.emit('leave', ctx);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runSpy).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ send: expect.any(Function) })
    );
    expect(sendMessage).toHaveBeenCalledWith(77, 'resumen', { parse_mode: 'HTML' });
    expect(logSpy).toHaveBeenCalledWith('[fondoAdvisor] leave en grupo; se intentará envío por DM.');

    logSpy.mockRestore();
    runSpy.mockRestore();
  });

  it('runFondo builds summary message with provided balances', async () => {
    const ctx = { session: {}, reply: jest.fn() };
    const send = jest.fn().mockResolvedValue();
    const balances = [
      { moneda: 'CUP', banco: 'BANDEC', saldo: 100000, tasa_usd: 0.0083 },
      { moneda: 'CUP', banco: 'BANDEC', saldo: -60000, tasa_usd: 0.0083 },
      { moneda: 'USD', banco: 'BANDEC', saldo: 150, tasa_usd: 1 },
    ];
    const config = {
      cushion: 150000,
      buyRate: 400,
      sellRate: 452,
      minSellUsd: 40,
      liquidityBanks: ['BANDEC'],
    };

    const result = await advisor.runFondo(ctx, { balances, config, send });

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message).toContain('Asesor de Fondo');
    expect(message).toContain('Venta requerida (Zelle)');
    expect(message).toContain('Faltante tras venta');
    expect(message).toContain('Liquidez rápida disponible');
    expect(message).toContain('BANDEC: 100,000 CUP (≈ 250.00 USD)');
    expect(message).not.toContain('Compra (DB)');
    expect(message).not.toContain('@ compra');
    expect(message).toContain('Disponible ahora');
    expect(message).not.toContain('Reservado');
    expect(result.plan.remainingCup).toBeGreaterThan(0);
    expect(result.urgency).toBe('🟠 PRIORITARIO');
    expect(result.buyRateCup).toBe(400);
  });
});

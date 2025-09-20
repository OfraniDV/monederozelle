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
    expect(result.plan.remainingCup).toBeGreaterThan(0);
    expect(result.urgency).toBe('🟠 PRIORITARIO');
  });
});

'use strict';

const { runFondo } = require('../../middlewares/fondoAdvisor');
const seedMinimal = require('../seedMinimal');

test('runFondo envía el resumen al privado cuando se ejecuta desde un grupo', async () => {
  await seedMinimal();

  const ctx = {
    session: {},
    from: { id: 123, username: 'tester' },
    chat: { id: -456, type: 'supergroup' },
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({}),
    },
    reply: jest.fn().mockResolvedValue({}),
  };

  await runFondo(ctx, {
    skipSellRateFetch: true,
    balances: [
      {
        moneda: 'CUP',
        banco: 'BANDEC',
        agente: 'AG',
        numero: '0001',
        saldo: 100000,
        tasa_usd: 0.01,
      },
    ],
    config: {
      cushion: 50000,
      sellRate: 450,
      minSellUsd: 40,
      liquidityBanks: ['BANDEC'],
    },
  });

  const recipients = ctx.telegram.sendMessage.mock.calls.map((call) => call[0]);
  expect(recipients.every((id) => id === ctx.from.id)).toBe(true);
  expect(ctx.reply).toHaveBeenCalled();
  const [notice] = ctx.reply.mock.calls[0];
  expect(notice).toContain('resumen del fondo por privado');
});

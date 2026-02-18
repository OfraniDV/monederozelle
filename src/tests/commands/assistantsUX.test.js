const { query } = require('../../psql/db.js');
const { showExtract } = require('../../commands/extracto_assist');
jest.mock('../../commands/monitor', () => ({
  runMonitor: jest.fn().mockResolvedValue(['dummy'])
}));
const monitorAssist = require('../../commands/monitor_assist');
const seedMinimal = require('../seedMinimal');

beforeAll(async () => {
  await seedMinimal();
  await query(`INSERT INTO tarjeta (id, numero, agente_id, moneda_id, banco_id) VALUES
    (100,'0100',1,1,1) ON CONFLICT (id) DO NOTHING;`);
  await query(`INSERT INTO movimiento (tarjeta_id,descripcion,saldo_anterior,importe,saldo_nuevo,creado_en) VALUES
    (100,'Inicial',0,10,10,'2025-08-06 10:00:00');`);
});

test('showExtract coloca teclado Save/Exit al final', async () => {
  const ctx = {
    wizard: { state: { filters: { period: 'dia', fecha: '2025-08-06' }, tarjetasAll: [] } },
    reply: jest.fn().mockResolvedValue(true),
    telegram: { editMessageText: jest.fn() }
  };
  await showExtract(ctx);
  const last = ctx.reply.mock.calls.at(-1);
  expect(last[0]).toMatch('Reporte generado.');
  const kb = last[1].reply_markup.inline_keyboard;
  expect(kb).toHaveLength(1);
  expect(kb[0]).toHaveLength(2);
  expect(ctx.telegram.editMessageText).not.toHaveBeenCalled();
});

test('monitorAssist envía teclado y no edita después', async () => {
  const ctx = {
    chat: { id: 1 },
    wizard: {
      state: {
        route: 'MAIN',
        filters: { period: 'dia', monedaNombre: 'Todas' },
        nav: { stack: [], msgId: 1, current: 'MAIN' },
      }
    },
    callbackQuery: { data: 'RUN', message: { message_id: 1 } },
    answerCbQuery: jest.fn().mockResolvedValue(),
    reply: jest.fn().mockResolvedValue({ message_id: 2 }),
    telegram: {
      editMessageText: jest.fn(),
      deleteMessage: jest.fn().mockResolvedValue(true),
    },
    botInfo: {}
  };
  await monitorAssist.steps[1](ctx);
  const last = ctx.reply.mock.calls.at(-1);
  expect(last[0]).toMatch('Reporte generado.');
  const kb = last[1].reply_markup.inline_keyboard;
  expect(kb).toHaveLength(2);
  expect(kb[0]).toHaveLength(2);
  expect(kb[0][1].text).toMatch('Volver');
  expect(kb[1]).toHaveLength(1);
  expect(kb[1][0].text).toMatch('Salir');
  expect(ctx.telegram.editMessageText).not.toHaveBeenCalled();
  expect(ctx.telegram.deleteMessage).toHaveBeenCalled();
});

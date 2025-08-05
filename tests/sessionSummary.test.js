const { query } = require('../psql/db');
const { recordChange, flushOnExit } = require('../helpers/sessionSummary');
const seedMinimal = require('./seedMinimal');
const moment = require('moment-timezone');

test('flushOnExit reports total, day and last deltas', async () => {
  await seedMinimal();
  await query(
    'INSERT INTO tarjeta (id, agente_id, banco_id, moneda_id, numero) VALUES (1,1,1,1,\'TST\')'
  );
  const tz = 'America/Havana';
  const now = moment.tz(tz);
  const twoDays = now.clone().subtract(2, 'day').hour(12);
  const oneDay = now.clone().subtract(1, 'day').hour(12);
  const todayMorning = now.clone().startOf('day').add(9, 'hours');
  const todayNoon = now.clone().startOf('day').add(12, 'hours');
  await query(
    'INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, creado_en) VALUES (1,0,30,30,$1)',
    [twoDays.toDate()]
  );
  await query(
    'INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, creado_en) VALUES (1,30,20,50,$1)',
    [oneDay.toDate()]
  );
  await query(
    'INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, creado_en) VALUES (1,50,10,60,$1)',
    [todayMorning.toDate()]
  );
  await query(
    'INSERT INTO movimiento (tarjeta_id, saldo_anterior, importe, saldo_nuevo, creado_en) VALUES (1,60,20,80,$1)',
    [todayNoon.toDate()]
  );
  recordChange(1, 1, 60, 80);

  const sent = [];
  const ctx = {
    from: { id: 1, username: 'tester', first_name: 'Test' },
    chat: { id: 99, type: 'private' },
    telegram: {
      sendMessage: async (id, html) => {
        sent.push(html);
      },
    },
  };

  await flushOnExit(ctx);

  expect(sent.length).toBe(4);
  expect(sent[1]).toMatch(/30\.00.*80\.00.*\+50\.00/);
  expect(sent[2]).toMatch(/50\.00.*80\.00.*\+30\.00/);
  expect(sent[3]).toMatch(/60\.00.*80\.00.*\+20\.00/);
});

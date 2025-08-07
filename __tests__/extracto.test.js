jest.mock('../psql/db.js', () => ({ query: jest.fn() }));

const pool = require('../psql/db.js');
const extracto = require('../commands/extracto_assist');
const { showExtract } = extracto;

const sampleDate = new Date('2024-03-05T12:00:00Z');

test('showExtract usa rango de fecha y agrupa por agente', async () => {
  pool.query
    .mockResolvedValueOnce({
      rows: [
        {
          tarjeta_id: 1,
          descripcion: 'Pago',
          importe: '100',
          saldo_nuevo: '1100',
          creado_en: sampleDate.toISOString(),
          numero: '111',
          agente: 'Ag1',
          agente_emoji: '',
          banco: 'Banco',
          banco_emoji: '',
          moneda: 'USD',
          mon_emoji: '$',
          tasa: 1,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ tarjeta_id: 1, saldo_nuevo: '1000' }] })
    .mockResolvedValueOnce({ rows: [{ tarjeta_id: 1, saldo_nuevo: '1000' }] });

  const ctx = {
    wizard: {
      state: {
        filters: { period: 'dia', fecha: '2024-03-05' },
        tarjetasAll: [{ id: 1 }],
      },
    },
    reply: jest.fn().mockResolvedValue(true),
  };

  await showExtract(ctx);
  const firstCall = pool.query.mock.calls[0][1];
  expect(firstCall[1]).toEqual(new Date('2024-03-05T00:00:00.000Z'));
  expect(firstCall[2]).toEqual(new Date('2024-03-05T23:59:59.999Z'));
  const text = ctx.reply.mock.calls[0][0];
  expect(text).toMatch(/Ag1/);
});

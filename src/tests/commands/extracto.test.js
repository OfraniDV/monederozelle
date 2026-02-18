const { query } = require('../../psql/db.js');
const extracto = require('../../commands/extracto_assist');
const { showExtract } = extracto;
const seedMinimal = require('../seedMinimal');

beforeAll(async () => {
  await seedMinimal();
  await query(`INSERT INTO tarjeta (id, numero, agente_id, moneda_id, banco_id) VALUES
    (5,'0005',1,1,1),(7,'0007',1,1,1),(9,'0009',1,1,1),
    (20,'0020',1,1,1),(21,'0021',1,1,1),(22,'0022',1,1,1),
    (24,'0024',1,1,1),(25,'0025',1,1,1)
    ON CONFLICT (id) DO NOTHING;`);
  await query(`INSERT INTO movimiento (tarjeta_id,descripcion,saldo_anterior,importe,saldo_nuevo,creado_en) VALUES
 (7,'Actualización +',14556.00,1543.04,16099.04,'2025-08-06 22:20:40.154'),
 (20,'Actualización +',-131014.34,900.00,-130114.34,'2025-08-06 21:32:21.888'),
 (22,'Actualización +',17366.99,2020.00,19386.99,'2025-08-06 21:31:31.971'),
 (25,'Saldo inicial',0.00,0.67,0.67,'2025-08-06 21:30:40.803'),
 (9,'Actualización +',9266.00,10845.00,20111.00,'2025-08-06 20:43:35.738'),
 (20,'Actualización –',-130535.09,-479.25,-131014.34,'2025-08-06 19:34:06.292'),
 (21,'Actualización +',-2731.35,0.00,-2731.35,'2025-08-06 19:23:16.287'),
 (20,'Actualización +',-150743.84,20208.75,-130535.09,'2025-08-06 19:23:08.111'),
 (24,'Saldo inicial',0.00,60.00,60.00,'2025-08-06 18:37:56.634'),
 (22,'Actualización +',9436.99,7930.00,17366.99,'2025-08-06 15:46:20.903'),
 (5,'Actualización –',25556.38,-20000.00,5556.38,'2025-08-06 15:46:04.416');`);
});

test('Periodo → Día → DAY_6 sin filtros devuelve extracto', async () => {
  const ctx = {
    wizard: { state: { filters: { period: 'dia', fecha: '2025-08-06' }, tarjetasAll: [] } },
    reply: jest.fn().mockResolvedValue(true),
  };
  await showExtract(ctx);
  const joined = ctx.reply.mock.calls.map((c) => c[0]).join(' ');
  expect(joined).not.toMatch('⚠️ No hay tarjetas');
});

test('Flujo completo con filtros específicos genera extracto', async () => {
  const ctx = {
    wizard: {
      state: {
        filters: {
          agenteId: 1,
          agenteNombre: 'Agente Fake',
          monedaId: 1,
          monedaNombre: 'Fake',
          bancoId: 1,
          bancoNombre: 'Fake Bank',
          tarjetaId: 5,
          tarjetaNumero: '0005',
          period: 'dia',
          fecha: '2025-08-06',
        },
        tarjetasAll: [],
      },
    },
    reply: jest.fn().mockResolvedValue(true),
  };
  await showExtract(ctx);
  const joined = ctx.reply.mock.calls.map((c) => c[0]).join(' ');
  expect(joined).not.toMatch('⚠️');
});

test('showExtract consulta al menos 10 movimientos', async () => {
  const db = require('../../psql/db.js');
  const spy = jest.spyOn(db, 'query');
  const ctx = {
    wizard: { state: { filters: { period: 'dia', fecha: '2025-08-06' }, tarjetasAll: [] } },
    reply: jest.fn().mockResolvedValue(true),
  };
  await showExtract(ctx);
  const movCallIdx = spy.mock.calls.findIndex((c) => c[0].includes('FROM movimiento'));
  const movRows = (await spy.mock.results[movCallIdx].value).rows;
  expect(movRows.length).toBeGreaterThanOrEqual(10);
  spy.mockRestore();
});


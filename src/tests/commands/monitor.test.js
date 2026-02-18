const moment = require('moment-timezone');
const db = require('../../psql/db.js');
const {
  parseArgs,
  calcRanges,
  getSellRate,
  SQL_BASE,
  resumenPor,
  transformRow,
} = require('../../commands/monitor');
const seedMinimal = require('../seedMinimal');
const tarjetasCommand = require('../../commands/tarjetas');

const { LAST_MOVEMENTS_SQL } = tarjetasCommand;

describe('parseArgs', () => {
  test('reconoce --fecha', () => {
    const opts = parseArgs('/monitor dia --fecha=2024-03-05');
    expect(opts.period).toBe('dia');
    expect(opts.fecha).toBe('2024-03-05');
  });

  test('reconoce --mes', () => {
    const opts = parseArgs('/monitor mes --mes=2024-02');
    expect(opts.period).toBe('mes');
    expect(opts.mes).toBe('2024-02');
  });
});

describe('calcRanges', () => {
  test('rango por fecha', () => {
    const { start, end } = calcRanges('dia', 'UTC', '2024-03-05');
    expect(moment.tz(start, 'UTC').format('YYYY-MM-DD')).toBe('2024-03-05');
    expect(moment.tz(end, 'UTC').format('YYYY-MM-DD')).toBe('2024-03-05');
  });

  test('rango por mes', () => {
    const { start, end } = calcRanges('mes', 'UTC', null, '2024-02');
    expect(moment.tz(start, 'UTC').format('YYYY-MM')).toBe('2024-02');
    expect(moment.tz(end, 'UTC').format('YYYY-MM')).toBe('2024-02');
  });
});

describe('getSellRate', () => {
  let querySpy;

  beforeEach(() => {
    querySpy = jest.spyOn(db, 'query').mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    querySpy.mockRestore();
    delete process.env.ADVISOR_SELL_RATE_CUP_PER_USD;
    delete process.env.ADVISOR_SELL_FEE_PCT;
    delete process.env.ADVISOR_FX_MARGIN_PCT;
  });

  test('usa tasa de compra de la DB sin invertirla', async () => {
    process.env.ADVISOR_SELL_RATE_CUP_PER_USD = '459';
    process.env.ADVISOR_SELL_FEE_PCT = '0.02';
    process.env.ADVISOR_FX_MARGIN_PCT = '0';
    querySpy.mockResolvedValueOnce({ rows: [{ tasa_usd: 400 }] });

    const info = await getSellRate();

    expect(info.buyRate).toBe(400);
    expect(info.buySource).toBe('db');
    expect(info.sellRate).toBe(459);
    expect(info.source).toBe('env');
    expect(info.sellNet).toBe(449);
  });
});

describe('monitor SQL alignment', () => {
  const CARD_IDS = [101, 102, 103];
  let range;
  let monedaUsdId;
  let bankBbId;
  let agenteDosId;

  const monitorParams = () => [range.start.toDate(), range.end.toDate(), CARD_IDS];

  const fetchMonitorRows = async () => {
    const sql = `${SQL_BASE} WHERE t.id = ANY($3::int[]) ORDER BY t.id`;
    const { rows } = await db.query(sql, monitorParams());
    return rows;
  };

  const mapDatos = (rows) => rows.map((row) => transformRow(row, range.start.toDate()));

  beforeAll(async () => {
    await seedMinimal();
    range = calcRanges('mes', 'America/Havana', null, '2024-01');
    await db.query("UPDATE moneda SET tasa_usd = 0.04 WHERE id = 1");
    await db.query(
      "INSERT INTO moneda (id, codigo, nombre, tasa_usd) VALUES (2,'USD','Dólar',1) ON CONFLICT DO NOTHING;"
    );
    await db.query(
      "INSERT INTO banco (id, codigo, nombre) VALUES (2,'BB','Banco B') ON CONFLICT DO NOTHING;"
    );
    await db.query(
      "INSERT INTO agente (id, nombre) VALUES (2,'Agente Dos') ON CONFLICT DO NOTHING;"
    );
    const { rows: usdRows } = await db.query(
      "SELECT id FROM moneda WHERE codigo='USD' LIMIT 1;"
    );
    monedaUsdId = usdRows[0].id;
    const { rows: bancoRows } = await db.query(
      "SELECT id FROM banco WHERE codigo='BB' LIMIT 1;"
    );
    bankBbId = bancoRows[0].id;
    const { rows: agenteRows } = await db.query(
      "SELECT id FROM agente WHERE nombre='Agente Dos' LIMIT 1;"
    );
    agenteDosId = agenteRows[0].id;
  });

  beforeEach(async () => {
    await db.query('DELETE FROM movimiento WHERE tarjeta_id = ANY($1::int[])', [CARD_IDS]);
    await db.query('DELETE FROM tarjeta WHERE id = ANY($1::int[])', [CARD_IDS]);
    await db.query(
      `INSERT INTO tarjeta (id, numero, agente_id, moneda_id, banco_id) VALUES
         (101,'000101',1,1,1),
         (102,'000102',$1,1,$2),
         (103,'000103',1,$3,$2)
       ON CONFLICT (id) DO NOTHING;`,
      [agenteDosId, bankBbId, monedaUsdId]
    );
    await db.query(
      `INSERT INTO movimiento (tarjeta_id, descripcion, saldo_anterior, importe, saldo_nuevo, creado_en) VALUES
         (101,'Carga diciembre',0,1000,1000,'2023-12-20 10:00:00-05'),
         (101,'Ingreso enero',1000,600,1600,'2024-01-10 09:00:00-05'),
         (101,'Depósito enero',1600,200,1800,'2024-01-25 11:00:00-05'),
         (102,'Saldo previo',0,500,500,'2023-12-28 12:00:00-05'),
         (102,'Movimiento fuera',500,200,700,'2024-02-02 12:00:00-05'),
         (103,'Alta tarjeta',0,200,200,'2024-01-12 08:30:00-05')`
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM movimiento WHERE tarjeta_id = ANY($1::int[])', [CARD_IDS]);
    await db.query('DELETE FROM tarjeta WHERE id = ANY($1::int[])', [CARD_IDS]);
  });

  test('tarjeta sin movimientos en el período produce delta 0', async () => {
    const rows = await fetchMonitorRows();
    const tarjeta102 = rows.find((r) => r.id === 102);
    const { data } = transformRow(tarjeta102, range.start.toDate());
    expect(data.delta).toBe(0);
    expect(data.movs).toBe(0);
  });

  test('tarjeta con múltiples movimientos acumula delta correcto', async () => {
    const rows = await fetchMonitorRows();
    const tarjeta101 = rows.find((r) => r.id === 101);
    const { data } = transformRow(tarjeta101, range.start.toDate());
    expect(data.delta).toBe(800);
    expect(data.movs).toBe(2);
  });

  test('tarjeta creada dentro del período parte de saldo 0', async () => {
    const rows = await fetchMonitorRows();
    const tarjeta103 = rows.find((r) => r.id === 103);
    const { data, meta } = transformRow(tarjeta103, range.start.toDate());
    expect(data.saldo_ini).toBe(0);
    expect(meta.bornInRange).toBe(true);
    expect(data.movs).toBe(1);
    expect(data.delta).toBe(200);
  });

  test('agrupaciones por agente y banco suman exactamente', async () => {
    const monitorRows = await fetchMonitorRows();
    const datos = mapDatos(monitorRows).map((entry) => entry.data);

    const porAgente = resumenPor(datos, 'agente');
    porAgente.forEach((val, agente) => {
      const suma = datos.filter((d) => d.agente === agente).reduce((acc, d) => acc + d.saldo_fin, 0);
      expect(val.fin).toBeCloseTo(suma);
    });

    const porBanco = resumenPor(datos, 'banco');
    porBanco.forEach((val, banco) => {
      const suma = datos.filter((d) => d.banco === banco).reduce((acc, d) => acc + d.saldo_fin, 0);
      expect(val.fin).toBeCloseTo(suma);
    });
  });

  test('total por moneda coincide con la suma de sus bancos', async () => {
    const monitorRows = await fetchMonitorRows();
    const datos = mapDatos(monitorRows).map((entry) => entry.data);
    const porMoneda = new Map();
    datos.forEach((d) => {
      if (!porMoneda.has(d.moneda)) porMoneda.set(d.moneda, []);
      porMoneda.get(d.moneda).push(d);
    });

    porMoneda.forEach((lista) => {
      const totalFilas = lista.reduce((acc, d) => acc + d.saldo_fin, 0);
      const porBanco = resumenPor(lista, 'banco');
      const totalBancos = Array.from(porBanco.values()).reduce((acc, val) => acc + val.fin, 0);
      expect(totalBancos).toBeCloseTo(totalFilas);
    });
  });

  test('snapshot actual de monitor coincide con /tarjetas', async () => {
    const monitorRows = await fetchMonitorRows();
    const snapshotMonitor = monitorRows.reduce(
      (acc, row) => acc + Number(row.saldo_fin_total || 0),
      0
    );
    const { rows: tarjetasRows } = await db.query(LAST_MOVEMENTS_SQL);
    const snapshotTarjetas = tarjetasRows
      .filter((r) => CARD_IDS.includes(r.id))
      .reduce((acc, row) => acc + Number(row.saldo_fin || 0), 0);

    expect(snapshotMonitor).toBeCloseTo(snapshotTarjetas);
  });
});

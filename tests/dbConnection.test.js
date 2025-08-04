const { Client } = require('pg');

test('connects and runs SELECT 1', async () => {
  const client = new Client();
  await client.connect();
  const res = await client.query('SELECT 1 AS result');
  await client.end();
  expect(res.rows[0].result).toBe(1);
});

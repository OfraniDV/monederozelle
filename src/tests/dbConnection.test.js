// tests/dbConnection.test.js
require('dotenv').config({ path: './.env.test' });
const { Client } = require('pg');

test('conexión a PostgreSQL responde SELECT 1', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query('SELECT 1 AS result');
    expect(res.rows[0].result).toBe(1);
  } finally {
    await client.end();
  }
});

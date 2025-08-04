const { Client } = require('pg');

async function ensureRoleAndDb() {
  const admin = new Client({ user: 'postgres', database: 'postgres' });
  await admin.connect();

  const roleRes = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['wallet']);
  if (roleRes.rowCount === 0) {
    await admin.query("CREATE ROLE wallet LOGIN PASSWORD '123456789'");
    console.log('Role wallet created');
  }

  const dbRes = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['wallet_test']);
  if (dbRes.rowCount === 0) {
    await admin.query('CREATE DATABASE wallet_test OWNER wallet');
    console.log('Database wallet_test created');
  }

  await admin.end();
}

ensureRoleAndDb().catch((err) => {
  console.error('Failed ensuring test database', err);
  process.exit(1);
});

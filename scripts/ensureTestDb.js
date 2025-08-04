// scripts/ensureTestDb.js
/**
 * Asegura que exista el role 'wallet' y la base de datos de prueba 'wallet_test'.
 * Genera .env.test con la conexión adecuada.
 */
const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config(); // carga .env si existe (para leer host/port si se quiere)

const ADMIN_CONN = process.env.ADMIN_DATABASE_URL || 'postgresql://postgres@localhost:5432/postgres';
const TEST_DB = 'wallet_test';
const TEST_ROLE = 'wallet';
const TEST_PASS = '123456789';

async function waitForPostgres(client, attempts = 8, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      await client.query('SELECT 1');
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

async function ensureRoleAndDb() {
  const admin = new Client({ connectionString: ADMIN_CONN });
  await admin.connect();

  // Esperar que Postgres responda
  await waitForPostgres(admin);

  // Crear role si no existe
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${TEST_ROLE}') THEN
        CREATE ROLE ${TEST_ROLE} LOGIN PASSWORD '${TEST_PASS}';
      END IF;
    END
    $$;
  `);
  console.log(`✅ role "${TEST_ROLE}" asegurado.`);

  // Crear base de datos si no existe
  const dbRes = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [TEST_DB]);
  if (dbRes.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB} OWNER ${TEST_ROLE};`);
    console.log(`🆕 base de datos "${TEST_DB}" creada.`);
  } else {
    console.log(`✅ base de datos "${TEST_DB}" ya existe.`);
  }

  await admin.end();
}

function writeEnvTest() {
  const content = `NODE_ENV=test
DATABASE_URL=postgresql://${TEST_ROLE}:${TEST_PASS}@localhost:5432/${TEST_DB}
`;
  try {
    fs.writeFileSync('.env.test', content);
    console.log('✅ .env.test generado.');
  } catch (e) {
    console.warn('⚠️ error escribiendo .env.test:', e.message);
  }
}

async function main() {
  try {
    await ensureRoleAndDb();
    writeEnvTest();
  } catch (e) {
    console.error('❌ error asegurando test DB:', e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ensureRoleAndDb };

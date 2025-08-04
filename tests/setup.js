// tests/setup.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });

// Asegura DB de test y esquema completo
const { pool } = require('../psql/db');
const { ensureRoleAndDb } = require('../scripts/ensureTestDb');
const crearTablaUsuarios = require('../psql/tablausuarios');
const initWalletSchema = require('../psql/initWalletSchema');

beforeAll(async () => {
  // 1. Crear role + base de test y .env.test
  await ensureRoleAndDb();
  // 2. Crear/escalar el esquema necesario (usuarios, wallet, tablas, secuencias)
  await crearTablaUsuarios();
  await initWalletSchema();
});

afterAll(async () => {
  // Cierra todas las conexiones del pool y permite que Jest salga limpio
  await pool.end();
});
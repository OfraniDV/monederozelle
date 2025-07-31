// db.js — configuración mejorada de conexión a PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

/**
 * Helper para obtener una variable, con fallback opcional (ej: compatibilidad hacia atrás).
 */
function getEnv(name, fallback) {
  if (process.env[name] !== undefined) return process.env[name];
  if (fallback && process.env[fallback] !== undefined) return process.env[fallback];
  return undefined;
}

// Cargar y normalizar variables de entorno
const DB_HOST = getEnv('DB_HOST', 'DB_URL'); // antiguamente usabas DB_URL, se mantiene compatibilidad
const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

// Validaciones mínimas tempranas
if (!DB_HOST) {
  throw new Error('Falta la variable de entorno DB_HOST o DB_URL');
}
if (!DB_USER) {
  throw new Error('Falta la variable de entorno DB_USER');
}
if (!DB_PASSWORD) {
  throw new Error('Falta la variable de entorno DB_PASSWORD');
}
if (!DB_NAME) {
  throw new Error('Falta la variable de entorno DB_NAME');
}

// Soporte opcional de SSL si se activa en el .env (por ejemplo DB_SSL=true)
let ssl = false;
if (process.env.DB_SSL && (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1')) {
  ssl = {
    // Por defecto se verifica el certificado; se puede desactivar con DB_SSL_REJECT_UNAUTHORIZED=false
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
    ...(process.env.DB_SSL_CERT ? { cert: process.env.DB_SSL_CERT } : {}),
    ...(process.env.DB_SSL_KEY ? { key: process.env.DB_SSL_KEY } : {}),
  };
}

// Construir la configuración del pool
const poolConfig = {
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  ...(ssl ? { ssl } : {}),
  // Opcionales con valores por defecto y override desde .env
  max: process.env.DB_MAX_CLIENTS ? parseInt(process.env.DB_MAX_CLIENTS, 10) : 10, // conexiones máximas
  idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT_MS
    ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)
    : 30000, // 30 segundos
  connectionTimeoutMillis: process.env.DB_CONN_TIMEOUT_MS
    ? parseInt(process.env.DB_CONN_TIMEOUT_MS, 10)
    : 2000, // 2 segundos para obtener conexión
};

const pool = new Pool(poolConfig);

// Escuchar errores inesperados en el pool (clientes ya conectados)
pool.on('error', (err, client) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

/**
 * Test ligero de conexión al arrancar (no rompe el proceso si falla, solo avisa).
 */
(async function testConnection() {
  try {
    const client = await pool.connect();
    client.release();
    console.log('✅ Conexión a PostgreSQL establecida correctamente.');
  } catch (e) {
    console.warn('⚠️ No se pudo verificar la conexión inicial a PostgreSQL:', e.message);
  }
})();

module.exports = pool;

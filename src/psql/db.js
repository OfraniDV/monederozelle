// psql/db.js
// Módulo de conexión a PostgreSQL usando Pool de pg.
// Lee configuración desde variables de entorno y expone
// el pool y una función query con logs de depuración.

require('dotenv').config();
const { Pool } = require('pg');

// Permite usar un DATABASE_URL completo o campos separados.
const connectionString = process.env.DATABASE_URL;
const poolConfig = connectionString
  ? { connectionString }
  : {
      host: process.env.DB_HOST || process.env.PGHOST,
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
      user: process.env.DB_USER || process.env.PGUSER,
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
      database: process.env.DB_NAME || process.env.PGDATABASE,
    };

// Crear el pool de conexiones.
const pool = new Pool(poolConfig);

// Log simple para cada consulta ejecutada.
async function query(text, params) {
  console.log('[db] query', text.trim().split(/\s+/).slice(0, 6).join(' '), params || []);
  return pool.query(text, params);
}

// Manejar errores del pool de forma clara.
pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool', err);
});

module.exports = { pool, query };

// Comentarios de modificaciones:
// - Se creó este módulo para centralizar la conexión a PostgreSQL.
// - Se agregó soporte para DATABASE_URL o variables separadas.
// - Se expuso la función query con logs prefijados por [db].
// - Se añadió manejo de errores del pool y mensajes en español.

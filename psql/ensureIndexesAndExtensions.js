const { pool } = require('./db');

/**
 * Verifica e instala extensiones e índices necesarios para el bot.
 * Es seguro de ejecutar múltiples veces.
 */
async function ensureExtension(name) {
  try {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM pg_extension WHERE extname = $1',
      [name]
    );
    if (rowCount > 0) {
      console.log(`✅ extensión "${name}" ya instalada`);
      return;
    }
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${name};`);
    console.log(`🆕 extensión "${name}" habilitada`);
  } catch (err) {
    console.error(`❌ error verificando extensión ${name}:`, err.message);
  }
}

async function ensureIndex(name, sql) {
  try {
    const { rows } = await pool.query('SELECT to_regclass($1) AS idx', [name]);
    if (rows[0]?.idx) {
      console.log(`✅ índice ${name} ya existe`);
      return;
    }
    const start = Date.now();
    await pool.query(sql);
    const diff = Date.now() - start;
    console.log(`🆕 índice ${name} creado en ${diff}ms`);
  } catch (err) {
    console.warn(`⚠️ fallo creando índice ${name}:`, err.message);
  }
}

async function ensure() {
  console.log('🔧 Verificando extensiones e índices...');

  await ensureExtension('unaccent');

  // Índices sobre movimientos
  await ensureIndex(
    'idx_movimiento_tarjeta_fecha',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_tarjeta_fecha ON movimiento(tarjeta_id, creado_en);'
  );
  await ensureIndex(
    'idx_movimiento_creado_en',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_creado_en ON movimiento(creado_en);'
  );
  await ensureIndex(
    'idx_movimiento_tarjeta_creado_en_desc',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_tarjeta_creado_en_desc ON movimiento(tarjeta_id, creado_en DESC);'
  );

  // Índices funcionales para búsquedas
  await ensureIndex(
    'idx_agente_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_agente_lower_nombre ON agente (lower(nombre));'
  );
  await ensureIndex(
    'idx_agente_unaccent_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_agente_unaccent_lower_nombre ON agente (unaccent(lower(nombre)));'
  );
  await ensureIndex(
    'idx_banco_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_banco_lower_nombre ON banco (lower(nombre));'
  );
  await ensureIndex(
    'idx_banco_unaccent_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_banco_unaccent_lower_nombre ON banco (unaccent(lower(nombre)));'
  );
  await ensureIndex(
    'idx_moneda_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_moneda_lower_nombre ON moneda (lower(nombre));'
  );
  await ensureIndex(
    'idx_moneda_unaccent_lower_nombre',
    'CREATE INDEX IF NOT EXISTS idx_moneda_unaccent_lower_nombre ON moneda (unaccent(lower(nombre)));'
  );

  console.log('✅ Extensiones e índices verificados.');
}

module.exports = { ensure };

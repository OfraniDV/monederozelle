// psql/bootstrapSchemaAndIndexes.js
const { pool } = require('../psql/db.js');
const crearTablaUsuarios = require('./tablausuarios');
const initWalletSchema   = require('./initWalletSchema');

/*──────── helpers ────────*/
async function ensureExtension(name) {
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM pg_extension WHERE extname = $1', [name]);
    if (rowCount) return console.log(`✅ extensión "${name}" ya instalada.`);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${name};`);
    console.log(`🆕 extensión "${name}" habilitada.`);
  } catch (e) { console.warn(`⚠️ extensión "${name}":`, e.message); }
}

async function ensureIndex(name, sql) {
  try {
    const { rows } = await pool.query('SELECT to_regclass($1) AS ok', [name]);
    if (rows[0]?.ok) return console.log(`✅ índice ${name} ya existe.`);
    const t0 = Date.now();
    await pool.query(sql);
    console.log(`🆕 índice ${name} creado en ${Date.now() - t0} ms.`);
  } catch (e) { console.warn(`⚠️ índice ${name}:`, e.message); }
}

/* columna nombre_search (generated-column o trigger fallback) */
async function ensureNombreSearch(table) {
  const col = 'nombre_search';
  const idx = `idx_${table}_${col}`;

  /* intentar columna generada (Postgres ≥12) */
  let generatedOK = false;
  try {
    const { rows } = await pool.query(`SELECT current_setting('server_version_num')::int AS v`);
    if (rows[0].v >= 120000) {
      await pool.query(
        `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS ${col}
         TEXT GENERATED ALWAYS AS (unaccent(lower(nombre))) STORED;`
      );
      generatedOK = true;
      console.log(`✅ columna generada ${col} en ${table}.`);
    }
  } catch { /** ignore */ }

  /* fallback: columna + trigger */
  if (!generatedOK) {
    const fn = `fn_${table}_${col}_upd`;
    const trg = `tr_${table}_${col}_upd`;

    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} TEXT;`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN NEW.${col}:=unaccent(lower(NEW.nombre)); RETURN NEW; END; $$ LANGUAGE plpgsql;`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='${trg}') THEN
          CREATE TRIGGER ${trg}
            BEFORE INSERT OR UPDATE ON ${table}
            FOR EACH ROW EXECUTE FUNCTION ${fn}();
        END IF;
      END; $$`);
    await pool.query(`
      UPDATE ${table}
         SET ${col}=unaccent(lower(nombre))
       WHERE ${col} IS DISTINCT FROM unaccent(lower(nombre));`);
    console.log(`🆕 trigger y backfill ${col} en ${table}.`);
  }

  await ensureIndex(idx, `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx} ON ${table}(${col});`);
}

/*──────── orquestador ────────*/
async function bootstrap() {
  console.log('🛠️ Bootstrap BD…');

  /* 1. tablas/esquema base */
  await crearTablaUsuarios();
  await initWalletSchema();

  /* 2. extensiones */
  await ensureExtension('unaccent');

  /* 3. columnas + índices de búsqueda */
  await ensureNombreSearch('agente');
  await ensureNombreSearch('banco');
  await ensureNombreSearch('moneda');

  /* 4. índices sobre movimiento */
  await ensureIndex(
    'idx_movimiento_tarjeta_fecha',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_tarjeta_fecha ON movimiento(tarjeta_id,creado_en);'
  );
  await ensureIndex(
    'idx_movimiento_creado_en',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_creado_en ON movimiento(creado_en);'
  );
  await ensureIndex(
    'idx_movimiento_tarjeta_creado_en_desc',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimiento_tarjeta_creado_en_desc ON movimiento(tarjeta_id,creado_en DESC);'
  );

  console.log('✅ Bootstrap BD completo.');
}

module.exports = { bootstrap };

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  }).then(() => process.exit(0));
}

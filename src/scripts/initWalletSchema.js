// psql/initWalletSchema.js
// -----------------------------------------------------------------------------
// Crea / migra el esquema base para el monedero: monedas, bancos, agentes,
// tarjetas y movimientos. Añade columnas nuevas si se han introducido en versiones
// posteriores (codigo, emoji, tasa_usd, etc.).
// Al finalizar, sincroniza **todas** las secuencias SERIAL con (MAX(id)+1) de su
// tabla para evitar errores 23505 cuando se insertaron filas manualmente.
// -----------------------------------------------------------------------------
const { pool } = require('../psql/db.js'); // Exporta un Pool de pg

/**
 * Ejecuta un conjunto de sentencias DDL dentro de una transacción.
 */
async function runInTransaction(statements) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of statements) {
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('✅ Esquema wallet verificado/actualizado correctamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error creando/migrando esquema wallet:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recorre todas las secuencias SERIAL declaradas en la base y las adelanta a
 * MAX(id)+1 de su tabla. Evita "duplicate key value" si la secuencia quedó
 * desfasada tras importaciones manuales.
 */
async function syncSequences() {
  const { rows } = await pool.query(`
    SELECT  c.relname         AS seq_name,
            t.relname         AS table_name,
            a.attname         AS col_name
    FROM    pg_class c
    JOIN    pg_depend d   ON d.objid = c.oid   AND d.deptype = 'a'
    JOIN    pg_class t    ON t.oid  = d.refobjid
    JOIN    pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE   c.relkind = 'S';`);

  for (const r of rows) {
    await pool.query(`
      SELECT setval($1, (SELECT COALESCE(MAX(${r.col_name}),0)+1 FROM ${r.table_name}), false);`,
      [r.seq_name]);
  }
  console.log('🔄 Secuencias sincronizadas');
}

/**
 * Genera todas las sentencias necesarias para:
 *  - Crear las tablas con la forma más reciente.
 *  - Añadir columnas nuevas si se actualizó una versión anterior.
 *  - Asegurar índices únicos donde corresponde.
 */
const getAllDDLs = () => [
  // 1. Moneda: tiene código (abreviatura), nombre, tasa_usd (en USD), emoji.
  `
  CREATE TABLE IF NOT EXISTS moneda (
    id         SERIAL PRIMARY KEY,
    codigo     TEXT UNIQUE NOT NULL,
    nombre     TEXT NOT NULL,
    tasa_usd   NUMERIC(18,6) NOT NULL DEFAULT 1, -- cuánto vale 1 unidad en USD
    emoji      TEXT DEFAULT '',
    creado_en  TIMESTAMPTZ DEFAULT now()
  );
  `,

  // 2. Banco: código identificador, nombre legible, emoji.
  `
  CREATE TABLE IF NOT EXISTS banco (
    id         SERIAL PRIMARY KEY,
    codigo     TEXT UNIQUE NOT NULL,
    nombre     TEXT UNIQUE NOT NULL,
    emoji      TEXT DEFAULT '',
    creado_en  TIMESTAMPTZ DEFAULT now()
  );
  `,

  // 3. Agente (dueño): nombre y posible emoji.
  `
  CREATE TABLE IF NOT EXISTS agente (
    id         SERIAL PRIMARY KEY,
    nombre     TEXT UNIQUE NOT NULL,
    emoji      TEXT DEFAULT '',
    creado_en  TIMESTAMPTZ DEFAULT now()
  );
  `,

  // 4. Tarjeta / sub-cuenta: número/alias, referencias.
  `
  CREATE TABLE IF NOT EXISTS tarjeta (
    id          SERIAL PRIMARY KEY,
    numero      TEXT UNIQUE NOT NULL,
    agente_id   INTEGER REFERENCES agente(id),
    moneda_id   INTEGER REFERENCES moneda(id),
    banco_id    INTEGER REFERENCES banco(id),  -- NULL para Saldo Móvil / Bolsa
    emoji       TEXT DEFAULT '',
    creado_en   TIMESTAMPTZ DEFAULT now()
  );
  `,

  // 5. Movimientos: histórico con saldo anterior/nuevo.
  `
  CREATE TABLE IF NOT EXISTS movimiento (
    id             SERIAL PRIMARY KEY,
    tarjeta_id     INTEGER NOT NULL REFERENCES tarjeta(id) ON DELETE CASCADE,
    descripcion    TEXT,
    saldo_anterior NUMERIC(18,2) NOT NULL,
    importe        NUMERIC(18,2) NOT NULL,        -- + entrada; – salida
    saldo_nuevo    NUMERIC(18,2) NOT NULL,
    creado_en      TIMESTAMPTZ DEFAULT now()
  );
  `,

  // 6. Índices de utilidad
  `
  CREATE INDEX IF NOT EXISTS idx_movimiento_tarjeta_fecha
    ON movimiento(tarjeta_id, creado_en);
  `,

  // 7. Compatibilidad / migración: añadir columnas que falten.
  `ALTER TABLE moneda  ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE banco   ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE agente  ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS banco_id INTEGER REFERENCES banco(id);`,

  // 8. Índices únicos de respaldo
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_moneda_codigo ON moneda(codigo);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_codigo  ON banco(codigo);`
];

/**
 * Inicializa / migra el esquema completo y sincroniza las secuencias.
 */
const initWalletSchema = async () => {
  const ddls = getAllDDLs();
  await runInTransaction(ddls);
  await syncSequences();
};

module.exports = initWalletSchema;

if (require.main === module) {
  initWalletSchema().catch((e) => {
    console.error(e);
    process.exit(1);
  }).then(() => process.exit(0));
}

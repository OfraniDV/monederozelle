// psql/initWalletSchema.js
// -----------------------------------------------------------------------------
// Crea / migra el esquema base para el monedero: monedas, bancos, agentes,
// tarjetas y movimientos. Añade columnas nuevas si se han introducido en versiones
// posteriores (codigo, emoji, tasa_usd, etc.).
// No pobla datos: todo queda vacío hasta que el usuario interactúe vía wizard.
// -----------------------------------------------------------------------------
const pool = require('./db.js'); // debe exportar el Pool de pg (ej. wrapper sobre db.js.js)

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

  // 4. Tarjeta / sub-cuenta: número/alias, referencia a agente, moneda y banco opcional.
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

  // 5. Movimientos: histórico con saldo anterior/nuevo e importe (diferencia).
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

  // 7. Compatibilidad / migración: si alguna tabla ya existía pero le faltan columnas, se agregan.
  `ALTER TABLE moneda ADD COLUMN IF NOT EXISTS codigo TEXT;`,
  `ALTER TABLE moneda ADD COLUMN IF NOT EXISTS nombre TEXT;`,
  `ALTER TABLE moneda ADD COLUMN IF NOT EXISTS tasa_usd NUMERIC(18,6) NOT NULL DEFAULT 1;`,
  `ALTER TABLE moneda ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE banco ADD COLUMN IF NOT EXISTS codigo TEXT;`,
  `ALTER TABLE banco ADD COLUMN IF NOT EXISTS nombre TEXT;`,
  `ALTER TABLE banco ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE agente ADD COLUMN IF NOT EXISTS nombre TEXT;`,
  `ALTER TABLE agente ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS numero TEXT;`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS agente_id INTEGER REFERENCES agente(id);`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS moneda_id INTEGER REFERENCES moneda(id);`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS banco_id INTEGER REFERENCES banco(id);`,
  `ALTER TABLE tarjeta ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '';`,
  // Nota: no reclamamos columnas de movimiento porque ya estaban completas en el esquema base anterior.

  // 8. Asegurar índices únicos en 'codigo' si no se crearon por definición original (para casos antiguos)
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_moneda_codigo ON moneda(codigo);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_codigo ON banco(codigo);`
];

/**
 * Inicializa / migra el esquema completo.
 */
const initWalletSchema = async () => {
  const ddls = getAllDDLs();
  await runInTransaction(ddls);
};

module.exports = initWalletSchema;

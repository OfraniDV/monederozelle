const pool = require('../psql/db.js');

const crearCuenta = async (ctx) => {
  const [accountName, initialBalance = 0] = ctx.message.text.split(' ').slice(1);

  if (accountName) {
    const checkTableQuery = `
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = $1;
    `;

    try {
      const result = await pool.query(checkTableQuery, [accountName]);
      if (result.rowCount > 0) {
        ctx.reply(`Ya existe una cuenta con el nombre "${accountName}".`);
      } else {
        const createTableQuery = `
          CREATE TABLE IF NOT EXISTS ${accountName} (
            id SERIAL PRIMARY KEY,
            descripcion TEXT,
            debito NUMERIC(15, 2) NOT NULL DEFAULT 0,
            credito NUMERIC(15, 2) NOT NULL DEFAULT 0,
            total NUMERIC(15, 2) NOT NULL DEFAULT 0,
            fecha DATE NOT NULL
          );
        `;

        const initialBalanceQuery = `
          INSERT INTO ${accountName} (descripcion, credito, total, fecha)
          VALUES ('Saldo inicial', $1, $1, NOW());
        `;

        await pool.query(createTableQuery);
        await pool.query(initialBalanceQuery, [initialBalance]);
        ctx.reply(`Cuenta "${accountName}" creada con un saldo inicial de ${initialBalance}.`);
      }
    } catch (err) {
      console.error(err);
      ctx.reply('Error al crear la cuenta. Por favor, inténtalo de nuevo.');
    }
  } else {
    ctx.reply('Por favor, ingresa un nombre de cuenta.');
  }
};

module.exports = crearCuenta;
const pool = require('../psql/db.js');

const listarCuentas = async (ctx) => {
  const listTablesQuery = `
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public';
  `;

  try {
    const result = await pool.query(listTablesQuery);
    const cuentas = result.rows.map(row => row.tablename);

    if (cuentas.length > 0) {
      ctx.reply(`📋 Cuentas existentes:\n\n${cuentas.map((cuenta, index) => `${index + 1}. ${cuenta}`).join('\n')}`);
    } else {
      ctx.reply('❌ No hay cuentas existentes.');
    }
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ Error al listar las cuentas. Por favor, inténtalo de nuevo.');
  }
};

module.exports = listarCuentas;
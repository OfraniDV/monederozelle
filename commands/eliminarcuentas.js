// eliminarcuentas.js
const pool = require('../psql/db.js');

const eliminarCuenta = async (ctx) => {
  const cuenta = ctx.message.text.split(' ')[1];

  if (!cuenta) {
    ctx.reply('❌ Por favor, proporciona el nombre de la cuenta que deseas eliminar.');
    return;
  }

  const eliminarCuentaQuery = `
    DROP TABLE IF EXISTS "${cuenta}";
  `;

  try {
    await pool.query(eliminarCuentaQuery);
    ctx.reply(`✅ La cuenta "${cuenta}" ha sido eliminada con éxito.`);
  } catch (err) {
    console.error(err);
    ctx.reply(`⚠️ Hubo un error al eliminar la cuenta "${cuenta}". Por favor, inténtalo de nuevo.`);
  }
};

module.exports = eliminarCuenta;
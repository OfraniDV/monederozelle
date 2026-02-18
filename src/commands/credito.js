const pool = require('../psql/db.js');

const credito = async (ctx) => {
  const [_, cuenta, monto, ...descripcionArr] = ctx.message.text.split(' ');
  const descripcion = descripcionArr.join(' ');

  if (!cuenta || !monto || !descripcion) {
    ctx.reply('❌ Por favor, proporciona el nombre de la cuenta, el monto y la descripción de la transacción de crédito.');
    return;
  }

  const montoFloat = parseFloat(monto);

  if (isNaN(montoFloat)) {
    ctx.reply('❌ Por favor, proporciona un monto válido.');
    return;
  }

  const obtenerTotalAnteriorQuery = `
    SELECT total
    FROM ${cuenta}
    ORDER BY fecha DESC, id DESC
    LIMIT 1;
  `;

  const insertarCreditoQuery = `
    INSERT INTO ${cuenta} (descripcion, credito, total, fecha)
    VALUES ($1, $2, $3, NOW());
  `;

  try {
    const result = await pool.query(obtenerTotalAnteriorQuery);
    const totalAnterior = result.rows.length > 0 ? parseFloat(result.rows[0].total) : 0;
    const nuevoTotal = parseFloat((totalAnterior + montoFloat).toFixed(2));

    await pool.query(insertarCreditoQuery, [descripcion, parseFloat(montoFloat.toFixed(2)), nuevoTotal]);

    ctx.reply(`✅ Transacción de crédito agregada con éxito a la cuenta "${cuenta}".`);
  } catch (err) {
    console.error(err);
    ctx.reply(`⚠️ Hubo un error al agregar la transacción de crédito a la cuenta "${cuenta}". Por favor, inténtalo de nuevo.`);
  }
};

module.exports = credito;

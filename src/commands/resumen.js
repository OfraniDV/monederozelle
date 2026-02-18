const pool = require('../psql/db.js');
const { escapeMarkdown } = require('telegram-escape');

const resumen = async (ctx) => {
  const cuenta = ctx.message.text.split(' ')[1];

  if (!cuenta) {
    ctx.reply('❌ Por favor, proporciona el nombre de la cuenta para generar el resumen.');
    return;
  }

  const query = `
    SELECT *
    FROM ${cuenta}
    ORDER BY fecha ASC, id ASC;
  `;

  try {
    const result = await pool.query(query);

    if (result.rowCount === 0) {
      ctx.reply(`❌ No se encontraron transacciones para la cuenta "${cuenta}".`);
      return;
    }

    let fechaAnterior = null;
    let subTotal = 0;
    let totalMes = 0;
    let totalCreditoMes = 0;  // Nuevo: total de crédito del mes
    let totalDebitoMes = 0;   // Nuevo: total de débito del mes

    const resumenText = `Resumen de la cuenta "${escapeMarkdown(cuenta)}"\n\n${
      result.rows.map((row, index) => {
        const { id, descripcion, debito, credito, total, fecha } = row;
        let transactionText = '';

        if (fechaAnterior && fecha.toDateString() !== fechaAnterior.toDateString()) {
          transactionText += `Saldo final del día: $${subTotal.toFixed(2)}\n\n`;
          totalMes += subTotal;
          subTotal = 0;
        }

        if (!fechaAnterior || fecha.toDateString() !== fechaAnterior.toDateString()) {
          transactionText += `Fecha: ${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}\n`;
          if (descripcion === 'Saldo inicial') {
            transactionText += `${id}. ${escapeMarkdown(descripcion)}: $0.00\n`;
          }
        }

        if (descripcion !== 'Saldo inicial') {
          transactionText += `${id}. ${escapeMarkdown(descripcion)}: `;
        }

        if (debito && debito !== '0.00') {
          transactionText += `(-) $${parseFloat(debito).toFixed(2)}\n`;
          subTotal -= parseFloat(debito);
          totalDebitoMes += parseFloat(debito); // Sumamos al total de débito del mes
        } else if (credito && credito !== '0.00') {
          transactionText += `(+) $${parseFloat(credito).toFixed(2)}\n`;
          subTotal += parseFloat(credito);
          totalCreditoMes += parseFloat(credito); // Sumamos al total de crédito del mes
        }

        if (index === result.rows.length - 1) {
          transactionText += `Saldo final del día: $${subTotal.toFixed(2)}\n`;
          totalMes += subTotal;
        }

        fechaAnterior = fecha;
        return transactionText;
      }).join('')
    }`;

    ctx.reply(`${resumenText}\nSaldo final del mes: $${totalMes.toFixed(2)}\nTotal débito del mes: $${totalDebitoMes.toFixed(2)}\nTotal crédito del mes: $${totalCreditoMes.toFixed(2)}`);

  } catch (err) {
    console.error(err);
    ctx.reply(`⚠️ Hubo un error al generar el resumen para la cuenta "${escapeMarkdown(cuenta)}". Por favor, verifica que la cuenta exista y que haya transacciones registradas.`);
  }
};

module.exports = resumen;


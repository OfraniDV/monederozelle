const pool = require('../psql/db.js');
const { escapeMarkdown } = require('telegram-escape');

const obtenerTablas = async () => {
  const query = `
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public';
  `;

  try {
    const result = await pool.query(query);
    return result.rows
      .map(row => row.tablename)
      .filter(tablename => tablename !== 'usuarios');
  } catch (err) {
    console.error(err);
    return [];
  }
};

const generarResumenCuenta = async (cuenta) => {
  const query = `
    SELECT *
    FROM ${cuenta}
    ORDER BY fecha ASC, id ASC;
  `;

  try {
    const result = await pool.query(query);

    if (result.rowCount === 0) {
      return `❌ No se encontraron transacciones para la cuenta "${cuenta}".\n\n`;
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
        }

        if (descripcion === 'Saldo inicial') {
          transactionText += `${id}. ${escapeMarkdown(descripcion)}: $${parseFloat(debito).toFixed(2)}\n`;
        } else {
          transactionText += `${id}. ${escapeMarkdown(descripcion)}: `;
        }

        if (debito && debito !== '0.00' && descripcion !== 'Saldo inicial') {
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

    return `${resumenText}\nSaldo final del mes: $${totalMes.toFixed(2)}\nTotal débito del mes: $${totalDebitoMes.toFixed(2)}\nTotal crédito del mes: $${totalCreditoMes.toFixed(2)}\n\n`;

  } catch (err) {
    console.error(err);
    return `⚠️ Hubo un error al generar el resumen para la cuenta "${escapeMarkdown(cuenta)}". Por favor, verifica que la cuenta exista y que haya transacciones registradas.\n\n`;
  }
};

const enviarResumen = async (ctx, resumen) => {
  const limiteCaracteres = 4096;
  const cantidadMensajes = Math.ceil(resumen.length / limiteCaracteres);

  for (let i = 0; i < cantidadMensajes; i++) {
      const mensaje = resumen.slice(i * limiteCaracteres, (i + 1) * limiteCaracteres);
      await ctx.reply(mensaje);
  }
};

const resumenTotal = async (ctx) => {
  const tablas = await obtenerTablas();

  if (tablas.length === 0) {
      ctx.reply('❌ No hay cuentas existentes en la base de datos.');
      return;
  }

  for (const tabla of tablas) {
      const resumen = await generarResumenCuenta(tabla);
      await enviarResumen(ctx, resumen); // Enviamos el resumen de cada cuenta de forma individual.
  }
};

module.exports = resumenTotal;

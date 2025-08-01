// comandos/tarjetas.js
// Lista de tarjetas con saldo actual, agrupado por moneda y banco, con subtotales y conversión a USD.
// No hay bancos hardcodeados: se toman de la base de datos tal como están registrados.
const { Markup } = require('telegraf');
const pool = require('../psql/db.js');

/**
 * Formatea un número a estilo "1,234.56".
 */
function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Escapa caracteres peligrosos para Markdown básico. (Telegraf replyWithMarkdown asume Markdown simple).
 * Si en el futuro se usa MarkdownV2, habría que adaptar el escape.
 */
function safeText(text) {
  if (!text && text !== 0) return '';
  return String(text);
}

module.exports = bot => {
  bot.command('tarjetas', async ctx => {
    try {
      const q = `
        SELECT t.id,
               t.numero,
               a.nombre   AS agente,
               a.emoji    AS agente_emoji,
               b.codigo   AS banco,
               b.emoji    AS banco_emoji,
               m.codigo   AS moneda,
               m.emoji    AS moneda_emoji,
               COALESCE(m.tasa_usd, 1) AS tasa_usd,
               COALESCE(mv.saldo_nuevo, 0) AS saldo
        FROM tarjeta t
        LEFT JOIN agente a  ON a.id = t.agente_id
        LEFT JOIN banco  b  ON b.id = t.banco_id
        LEFT JOIN moneda m  ON m.id = t.moneda_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
          FROM movimiento
          WHERE tarjeta_id = t.id
          ORDER BY creado_en DESC
          LIMIT 1
        ) mv ON true;
      `;
      const rows = (await pool.query(q)).rows;
      if (!rows.length) {
        return ctx.reply('No hay tarjetas registradas todavía.');
      }

      // Agrupar por moneda y luego por banco
      const byCurrency = {}; // { [moneda]: { moneda_emoji, tasa_usd, banks: { [banco]: [rows] }, currencyTotal } }
      const bankTotalsUSD = {}; // acumulado por banco en USD (todas monedas)
      let grandTotalUSD = 0;

      for (const r of rows) {
        const moneda = r.moneda || '—';
        const banco = r.banco || 'Sin banco';

        if (!byCurrency[moneda]) {
          byCurrency[moneda] = {
            moneda_emoji: r.moneda_emoji || '',
            tasa_usd: Number(r.tasa_usd || 1),
            banks: {},
            currencyTotal: 0,
          };
        }
        if (!byCurrency[moneda].banks[banco]) {
          byCurrency[moneda].banks[banco] = [];
        }

        byCurrency[moneda].banks[banco].push(r);
        byCurrency[moneda].currencyTotal += Number(r.saldo || 0);

        // Acumular por banco en USD
        const saldoUSD = Number(r.saldo || 0) * Number(r.tasa_usd || 1);
        bankTotalsUSD[banco] = (bankTotalsUSD[banco] || 0) + saldoUSD;

        grandTotalUSD += saldoUSD;
      }

      // Enviar un mensaje por cada moneda
      for (const [moneda, info] of Object.entries(byCurrency)) {
        // ordenar bancos alfabéticamente
        const bancosOrdenados = Object.keys(info.banks).sort((a, b) => a.localeCompare(b));

        let msg = `💱 *Moneda:* ${safeText(info.moneda_emoji)} ${safeText(moneda)}\n\n`;
        msg += `📊 *Subtotales por banco:*\n`;

        for (const banco of bancosOrdenados) {
          const filas = info.banks[banco];
          const bancoEmoji = safeText(filas[0]?.banco_emoji || '');
          msg += `\n${bancoEmoji} *${safeText(banco)}*\n`;
          for (const r of filas) {
            const agenteDisplay = `${r.agente_emoji ? safeText(r.agente_emoji) + ' ' : ''}${safeText(r.agente || '—')}`;
            const bancoDisplay = `${r.banco_emoji ? safeText(r.banco_emoji) + ' ' : ''}${safeText(r.banco || 'sin banco')}`;
            const monedaDisplay = `${r.moneda_emoji ? safeText(r.moneda_emoji) + ' ' : ''}${safeText(r.moneda || '—')}`;
            msg += `• ${safeText(r.numero)} – ${agenteDisplay} – ${bancoDisplay} – ${monedaDisplay} ⇒ ${formatAmount(r.saldo)}\n`;
          }
          const subtotalBanco = filas.reduce((sum, x) => sum + Number(x.saldo || 0), 0);
          msg += `  _Subtotal ${safeText(banco)}:_ ${formatAmount(subtotalBanco)} ${safeText(moneda)}\n`;
        }

        const totalMoneda = info.currencyTotal;
        const totalUSD = totalMoneda * info.tasa_usd;
        msg += `\n*Total en ${safeText(moneda)}:* ${formatAmount(totalMoneda)}\n`;
        msg += `*Equivalente en USD:* ${formatAmount(totalUSD)}\n`;

        await ctx.replyWithMarkdown(msg);
      }

      // Resumen general en USD por banco y total global
      let resumen = `🧮 *Resumen general en USD*\n`;
      Object.keys(bankTotalsUSD)
        .sort((a, b) => a.localeCompare(b))
        .forEach(banco => {
          resumen += `• *${safeText(banco)}*: ${formatAmount(bankTotalsUSD[banco])} USD\n`;
        });
      resumen += `\n*Total general:* ${formatAmount(grandTotalUSD)} USD`;

      await ctx.replyWithMarkdown(resumen);
    } catch (e) {
      console.error('[tarjetas] error mejorado:', e);
      ctx.reply('❌ Error al listar tarjetas con resumen.');
    }
  });
};

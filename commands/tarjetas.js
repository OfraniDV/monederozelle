// commands/tarjetas.js
// Lista tarjetas agrupadas (moneda → banco) con subtotales y conversión a USD
// e indica la tasa usada para esa conversión.

const pool = require('../psql/db.js');

/* ───────── helpers ───────── */
const fmt = (v, d = 2) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const mdEscape = (s) =>
  String(s ?? '').replace(/[*_`[\]()~>#+\-=|{}.!]/g, '\\$&');

/* ───────── comando /tarjetas ───────── */
module.exports = (bot) => {
  bot.command('tarjetas', async (ctx) => {
    try {
      /* 1. datos */
      const sql = `
        SELECT t.id,
               t.numero,
               ag.nombre AS agente,
               ag.emoji  AS agente_emoji,
               b.codigo  AS banco,
               b.emoji   AS banco_emoji,
               m.codigo  AS moneda,
               m.emoji   AS moneda_emoji,
               COALESCE(m.tasa_usd, 1) AS tasa_usd,
               COALESCE(mv.saldo_nuevo, 0) AS saldo
        FROM tarjeta t
        LEFT JOIN agente ag ON ag.id = t.agente_id
        LEFT JOIN banco  b  ON b.id = t.banco_id
        LEFT JOIN moneda m  ON m.id = t.moneda_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
            FROM movimiento
           WHERE tarjeta_id = t.id
        ORDER BY creado_en DESC
           LIMIT 1
        ) mv ON TRUE;
      `;
      const rows = (await pool.query(sql)).rows;
      if (!rows.length) return ctx.reply('No hay tarjetas registradas todavía.');

      /* 2. agrupar moneda → banco → filas */
      const byMon = {};
      const bankUsd = {};
      let globalUsd = 0;

      rows.forEach((r) => {
        const mon = r.moneda || '—';
        const bank = r.banco || 'Sin banco';
        byMon[mon] ??= {
          emoji: r.moneda_emoji || '',
          rate: Number(r.tasa_usd || 1), // 1 unidad en USD
          banks: {},
          total: 0,
        };
        byMon[mon].banks[bank] ??= {
          emoji: r.banco_emoji || '',
          filas: [],
          subtotal: 0,
        };

        byMon[mon].banks[bank].filas.push(r);
        byMon[mon].banks[bank].subtotal += Number(r.saldo);
        byMon[mon].total += Number(r.saldo);

        const usd = Number(r.saldo) * Number(r.tasa_usd);
        bankUsd[bank] = (bankUsd[bank] || 0) + usd;
        globalUsd += usd;
      });

      /* 3. mensajes por moneda */
      for (const [mon, info] of Object.entries(byMon)) {
        const header = `💱 *Moneda:* ${info.emoji} ${mdEscape(mon)}\n\n📊 *Subtotales por banco:*\n`;
        let body = '';

        Object.entries(info.banks)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([bank, data]) => {
            body += `\n${data.emoji} *${mdEscape(bank)}*\n`;
            data.filas.forEach((r) => {
              const agTxt =
                (r.agente_emoji ? r.agente_emoji + ' ' : '') + mdEscape(r.agente || '—');
              const monTxt =
                (r.moneda_emoji ? r.moneda_emoji + ' ' : '') + mdEscape(r.moneda || '—');
              body += `• ${mdEscape(r.numero)} – ${agTxt} – ${monTxt} ⇒ ${fmt(r.saldo)}\n`;
            });
            body += `  _Subtotal ${mdEscape(bank)}:_ ${fmt(data.subtotal)} ${mdEscape(mon)}\n`;
          });

        const totalMon = info.total;
        const totalUsd = totalMon * info.rate;
        const rateToUsd = fmt(info.rate, 6);
        const rateFromUsd = fmt(1 / info.rate, 2);

        const footer =
          `\n*Total en ${mdEscape(mon)}:* ${fmt(totalMon)}\n` +
          `*Equivalente en USD:* ${fmt(totalUsd)}\n` +
          `_Tasa usada: 1 ${mdEscape(mon)} = ${rateToUsd} USD · 1 USD ≈ ${rateFromUsd} ${mdEscape(
            mon
          )}_`;

        await ctx.replyWithMarkdown(header + body + footer);
      }

      /* 4. resumen global USD */
      let resumen = '🧮 *Resumen general en USD*\n';
      Object.entries(bankUsd)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([bank, usd]) => {
          resumen += `• *${mdEscape(bank)}*: ${fmt(usd)} USD\n`;
        });
      resumen += `\n*Total general:* ${fmt(globalUsd)} USD`;

      await ctx.replyWithMarkdown(resumen);
    } catch (e) {
      console.error('[tarjetas] error:', e);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

// commands/tarjetas.js
// Lista las tarjetas agrupadas por moneda y banco con subtotales, sin repetir el
// nombre del banco en cada línea. Incluye conversión a USD usando la tasa
// registrada en la tabla moneda.

const pool = require('../psql/db.js');

/* ────── helpers ────── */
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mdEscape = (s) =>
  String(s ?? '').replace(/[*_`[\]()~>#+\-=|{}.!]/g, '\\$&');

/* ────── comando /tarjetas ────── */
module.exports = (bot) => {
  bot.command('tarjetas', async (ctx) => {
    try {
      /* 1. obtener la foto más reciente de cada tarjeta */
      const sql = `
        SELECT t.id,
               t.numero,
               ag.nombre          AS agente,
               ag.emoji           AS agente_emoji,
               b.codigo           AS banco,
               b.emoji            AS banco_emoji,
               m.codigo           AS moneda,
               m.emoji            AS moneda_emoji,
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

      /* 2. agrupar { moneda → { banco → [rows] } } */
      const mapMoneda = {};
      const bancoUsdTotals = {};
      let globalUsd = 0;

      for (const r of rows) {
        const moneda = r.moneda || '—';
        const banco  = r.banco  || 'Sin banco';

        mapMoneda[moneda] ??= {
          emoji: r.moneda_emoji || '',
          tasa_usd: Number(r.tasa_usd || 1),
          banks: {},
          total: 0
        };
        mapMoneda[moneda].banks[banco] ??= {
          emoji: r.banco_emoji || '',
          filas: [],
          subtotal: 0
        };

        mapMoneda[moneda].banks[banco].filas.push(r);
        mapMoneda[moneda].banks[banco].subtotal += Number(r.saldo);
        mapMoneda[moneda].total += Number(r.saldo);

        /* totales USD por banco y global */
        const usd = Number(r.saldo) * Number(r.tasa_usd);
        bancoUsdTotals[banco] = (bancoUsdTotals[banco] || 0) + usd;
        globalUsd += usd;
      }

      /* 3. enviar un mensaje por cada moneda */
      for (const [mon, info] of Object.entries(mapMoneda)) {
        const header = `💱 *Moneda:* ${info.emoji} ${mdEscape(mon)}\n\n📊 *Subtotales por banco:*\n`;
        let body = '';

        Object.entries(info.banks)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([banco, data]) => {
            body += `\n${data.emoji} *${mdEscape(banco)}*\n`;
            data.filas.forEach((r) => {
              const agenteTxt = `${r.agente_emoji ? r.agente_emoji + ' ' : ''}${mdEscape(r.agente || '—')}`;
              const monedaTxt = `${r.moneda_emoji ? r.moneda_emoji + ' ' : ''}${mdEscape(r.moneda || '—')}`;
              body += `• ${mdEscape(r.numero)} – ${agenteTxt} – ${monedaTxt} ⇒ ${fmt(r.saldo)}\n`;
            });
            body += `  _Subtotal ${mdEscape(banco)}:_ ${fmt(data.subtotal)} ${mdEscape(mon)}\n`;
          });

        const totMon = fmt(info.total);
        const totUsd = fmt(info.total * info.tasa_usd);
        const footer = `\n*Total en ${mdEscape(mon)}:* ${totMon}\n*Equivalente en USD:* ${totUsd}\n`;

        await ctx.replyWithMarkdown(header + body + footer);
      }

      /* 4. resumen global en USD */
      let resumen = '🧮 *Resumen general en USD*\n';
      Object.entries(bancoUsdTotals)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([banco, usd]) => {
          resumen += `• *${mdEscape(banco)}*: ${fmt(usd)} USD\n`;
        });
      resumen += `\n*Total general:* ${fmt(globalUsd)} USD`;

      await ctx.replyWithMarkdown(resumen);
    } catch (err) {
      console.error('[tarjetas] error:', err);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

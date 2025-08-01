// commands/tarjetas.js
// Lista tarjetas agrupadas (moneda → banco) con subtotales y conversión a USD,
// y envía un desglose detallado por agente (moneda → tarjetas).

const pool = require('../psql/db.js');

/* ───────── helpers ───────── */
const fmt = (v, d = 2) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const mdEscape = (s) =>
  String(s ?? '').replace(/[_*`[\]()~>#+\-=|{}.!]/g, '\\$&'); // Markdown escape

/* ───────── comando /tarjetas ───────── */
module.exports = (bot) => {
  bot.command('tarjetas', async (ctx) => {
    try {
      /* 1. obtener snapshot saldo actual de cada tarjeta */
      const sql = `
        SELECT t.id, t.numero,
               COALESCE(ag.nombre,'—')  AS agente,
               COALESCE(ag.emoji,'')    AS agente_emoji,
               COALESCE(b.codigo,'Sin banco') AS banco,
               COALESCE(b.emoji,'')     AS banco_emoji,
               COALESCE(m.codigo,'—')   AS moneda,
               COALESCE(m.emoji,'')     AS moneda_emoji,
               COALESCE(m.tasa_usd,1)   AS tasa_usd,
               COALESCE(mv.saldo_nuevo,0) AS saldo
        FROM tarjeta t
        LEFT JOIN agente  ag ON ag.id = t.agente_id
        LEFT JOIN banco   b  ON b.id = t.banco_id
        LEFT JOIN moneda  m  ON m.id = t.moneda_id
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

      /* 2. estructuras: byMon, bankUsd, agentMap */
      const byMon = {};   // moneda -> { emoji, rate, banks {banco}, totalPos, totalNeg }
      const bankUsd = {}; // banco  -> usd
      const agentMap = {};/* agente -> { emoji, totalUsd, perMon { mon -> { total, filas[] } } } */
      let globalUsd = 0;

      rows.forEach((r) => {
        /* ---- moneda / banco ---- */
        byMon[r.moneda] ??= {
          emoji: r.moneda_emoji,
          rate: Number(r.tasa_usd),
          banks: {},
          totalPos: 0,
          totalNeg: 0
        };
        const monObj = byMon[r.moneda];

        monObj.banks[r.banco] ??= { emoji: r.banco_emoji, filas: [], pos: 0, neg: 0 };
        const bankObj = monObj.banks[r.banco];
        bankObj.filas.push(r);

        if (r.saldo >= 0) { bankObj.pos += +r.saldo; monObj.totalPos += +r.saldo; }
        else              { bankObj.neg += +r.saldo; monObj.totalNeg += +r.saldo; }

        /* ---- USD totales ---- */
        const usd = +r.saldo * monObj.rate;
        bankUsd[r.banco] = (bankUsd[r.banco] || 0) + usd;
        globalUsd += usd;

        /* ---- agente ---- */
        agentMap[r.agente] ??= { emoji: r.agente_emoji, totalUsd: 0, perMon: {} };
        const ag = agentMap[r.agente];
        ag.totalUsd += usd;
        ag.perMon[r.moneda] ??= { total: 0, filas: [], emoji: r.moneda_emoji, rate: monObj.rate };
        ag.perMon[r.moneda].total += +r.saldo;
        ag.perMon[r.moneda].filas.push(r);
      });

      /* 3. mensajes por moneda */
      for (const [mon, info] of Object.entries(byMon)) {
        let msg =
          `💱 *Moneda:* ${info.emoji} ${mdEscape(mon)}\n\n` +
          `📊 *Subtotales por banco:*\n`;

        Object.entries(info.banks)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([bank, data]) => {
            msg += `\n${data.emoji} *${mdEscape(bank)}*\n`;
            data.filas.forEach((r) => {
              const ag = `${r.agente_emoji ? r.agente_emoji + ' ' : ''}${mdEscape(r.agente)}`;
              const monTxt = `${r.moneda_emoji ? r.moneda_emoji + ' ' : ''}${mdEscape(r.moneda)}`;
              msg += `• ${mdEscape(r.numero)} – ${ag} – ${monTxt} ⇒ ${fmt(r.saldo)}\n`;
            });
            if (data.pos) msg += `  _Subtotal ${mdEscape(bank)} (activo):_ ${fmt(data.pos)} ${mdEscape(mon)}\n`;
            if (data.neg) msg += `  _Subtotal ${mdEscape(bank)} (deuda):_ ${fmt(data.neg)} ${mdEscape(mon)}\n`;
          });

        const rateToUsd   = fmt(info.rate, 6);
        const rateFromUsd = fmt(1 / info.rate, 2);
        const activeUsd   = info.totalPos * info.rate;
        const debtUsd     = info.totalNeg * info.rate;

        msg += `\n*Total activo:* ${fmt(info.totalPos)}\n`;
        if (info.totalNeg) msg += `*Total deuda:* ${fmt(info.totalNeg)}\n`;
        msg += `*Equivalente activo en USD:* ${fmt(activeUsd)}\n`;
        if (info.totalNeg) msg += `*Equivalente deuda en USD:* ${fmt(debtUsd)}\n`;
        msg += `\n_Tasa usada:_\n` +
               `  • 1 ${mdEscape(mon)} = ${rateToUsd} USD\n` +
               `  • 1 USD ≈ ${rateFromUsd} ${mdEscape(mon)}`;

        await ctx.replyWithMarkdown(msg);
      }

      /* 4. resumen global USD por banco */
      let resumen = '🧮 *Resumen general en USD*\n';
      Object.entries(bankUsd)
        .sort(([a],[b])=>a.localeCompare(b))
        .forEach(([bank,usd])=>{
          resumen += `• *${mdEscape(bank)}*: ${fmt(usd)} USD\n`;
        });
      resumen += `\n*Total general:* ${fmt(globalUsd)} USD`;
      await ctx.replyWithMarkdown(resumen);

      /* 5. resumen por agente (detallado) */
      const today = new Date().toLocaleDateString('es-CU', { timeZone:'America/Havana' });
      for (const [agName, agData] of Object.entries(agentMap)) {
        let agMsg =
          `📅 *${today}*\n` +
          `👤 *Resumen de ${agData.emoji ? agData.emoji + ' ' : ''}${mdEscape(agName)}*\n\n`;

        Object.entries(agData.perMon).forEach(([mon, mData]) => {
          const monLine = `${mData.emoji} *${mdEscape(mon)}*: ${fmt(mData.total)} ` +
                          `(≈ ${fmt(mData.total * mData.rate)} USD)`;
          agMsg += monLine + '\n';
          // Detalle de tarjetas
          mData.filas.forEach((r) => {
            const deudaTxt = r.saldo < 0 ? ' (deuda)' : '';
            agMsg += `   • ${mdEscape(r.numero)} – ${mdEscape(r.banco)} ⇒ ${fmt(r.saldo)}${deudaTxt}\n`;
          });
          agMsg += '\n';
        });

        agMsg += `*Total en USD:* ${fmt(agData.totalUsd)}`;

        await ctx.replyWithMarkdown(agMsg);
      }
    } catch (err) {
      console.error('[tarjetas] error:', err);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

// commands/tarjetas.js
// Lista tarjetas agrupadas (moneda → banco) con subtotales, tasa y resumen por
// agente. Incluye Total activo · Total deuda · Neto, y pausa entre mensajes
// para evitar flood de la API de Telegram.

const pool = require('../psql/db.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── helpers ───────── */
const fmt = (v, d = 2) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const mdEscape = (s) =>
  String(s ?? '').replace(/[_*`[\]()~>#+\-=|{}.!]/g, '\\$&'); // Markdown-simple escape

/* ───────── comando /tarjetas ───────── */
module.exports = (bot) => {
  bot.command('tarjetas', async (ctx) => {
    try {
      /* 1. snapshot saldo actual de cada tarjeta */
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

      /* 2. estructuras */
      const byMon   = {}; // moneda -> { emoji, rate, banks, totalPos, totalNeg }
      const bankUsd = {}; // banco  -> total USD
      const agentMap= {}; // agente -> { emoji, totalUsd, perMon{ moneda->{ total, filas[], emoji, rate } } }
      let globalUsd = 0;

      rows.forEach((r) => {
        /* moneda y banco */
        byMon[r.moneda] ??= {
          emoji: r.moneda_emoji,
          rate:  Number(r.tasa_usd),
          banks: {},
          totalPos: 0,
          totalNeg: 0
        };
        const mon = byMon[r.moneda];
        mon.banks[r.banco] ??= { emoji: r.banco_emoji, filas: [], pos: 0, neg: 0 };
        const bank = mon.banks[r.banco];
        bank.filas.push(r);

        if (r.saldo >= 0) { bank.pos += +r.saldo; mon.totalPos += +r.saldo; }
        else              { bank.neg += +r.saldo; mon.totalNeg += +r.saldo; }

        /* USD totales */
        const usd = +r.saldo * mon.rate;
        bankUsd[r.banco] = (bankUsd[r.banco] || 0) + usd;
        globalUsd += usd;

        /* agente */
        agentMap[r.agente] ??= { emoji: r.agente_emoji, totalUsd: 0, perMon: {} };
        const ag = agentMap[r.agente];
        ag.totalUsd += usd;
        ag.perMon[r.moneda] ??= { total: 0, filas: [], emoji: mon.emoji, rate: mon.rate };
        ag.perMon[r.moneda].total += +r.saldo;
        ag.perMon[r.moneda].filas.push(r);
      });

      /* 3. mensajes por moneda */
      for (const [monCode, info] of Object.entries(byMon)) {
        let msg =
          `💱 *Moneda:* ${info.emoji} ${mdEscape(monCode)}\n\n` +
          `📊 *Subtotales por banco:*\n`;

        /* bancos */
        Object.entries(info.banks)
          .sort(([a],[b])=>a.localeCompare(b))
          .forEach(([bankCode, data]) => {
            msg += `\n${data.emoji} *${mdEscape(bankCode)}*\n`;
            data.filas.forEach((r) => {
              const agTxt   = `${r.agente_emoji ? r.agente_emoji + ' ' : ''}${mdEscape(r.agente)}`;
              const monTxt  = `${r.moneda_emoji ? r.moneda_emoji + ' ' : ''}${mdEscape(r.moneda)}`;
              msg += `• ${mdEscape(r.numero)} – ${agTxt} – ${monTxt} ⇒ ${fmt(r.saldo)}\n`;
            });
            if (data.pos) msg += `  _Subtotal ${mdEscape(bankCode)} (activo):_ ${fmt(data.pos)} ${mdEscape(monCode)}\n`;
            if (data.neg) msg += `  _Subtotal ${mdEscape(bankCode)} (deuda):_ ${fmt(data.neg)} ${mdEscape(monCode)}\n`;
          });

        /* totales moneda */
        const rateToUsd   = fmt(info.rate, 6);
        const rateFromUsd = fmt(1 / info.rate, 2);
        const activeUsd   = info.totalPos * info.rate;
        const debtUsd     = info.totalNeg * info.rate;
        const neto        = info.totalPos + info.totalNeg;
        const netoUsd     = activeUsd + debtUsd;

        msg += `\n*Total activo:* ${fmt(info.totalPos)}\n`;
        if (info.totalNeg) msg += `*Total deuda:* ${fmt(info.totalNeg)}\n`;
        msg += `*Neto:* ${fmt(neto)}\n`;
        msg += `\n*Equivalente activo en USD:* ${fmt(activeUsd)}\n`;
        if (info.totalNeg) msg += `*Equivalente deuda en USD:* ${fmt(debtUsd)}\n`;
        msg += `*Equivalente neto en USD:* ${fmt(netoUsd)}\n`;
        msg += `\n_Tasa usada:_\n` +
               `  • 1 ${mdEscape(monCode)} = ${rateToUsd} USD\n` +
               `  • 1 USD ≈ ${rateFromUsd} ${mdEscape(monCode)}`;

        await ctx.replyWithMarkdown(msg);
        await sleep(350);                  // anti-flood
      }

      /* 4. resumen global USD */
      let resumen = '🧮 *Resumen general en USD*\n';
      Object.entries(bankUsd)
        .sort(([a],[b])=>a.localeCompare(b))
        .forEach(([bank,usd])=>{
          resumen += `• *${mdEscape(bank)}*: ${fmt(usd)} USD\n`;
        });
      resumen += `\n*Total general:* ${fmt(globalUsd)} USD`;
      await ctx.replyWithMarkdown(resumen);
      await sleep(350);

      /* 5. resumen por agente (detallado con tarjetas) */
      const today = new Date().toLocaleDateString('es-CU', { timeZone:'America/Havana' });
      for (const [agName, agData] of Object.entries(agentMap)) {
        if (agData.totalUsd === 0) continue; // nada relevante
        let agMsg =
          `📅 *${today}*\n` +
          `👤 *Resumen de ${agData.emoji ? agData.emoji + ' ' : ''}${mdEscape(agName)}*\n\n`;

        Object.entries(agData.perMon).forEach(([monCode, mData]) => {
          if (mData.total === 0) return; // omite monedas a cero
          const line =
            `${mData.emoji} *${mdEscape(monCode)}*: ${fmt(mData.total)} ` +
            `(≈ ${fmt(mData.total * mData.rate)} USD)`;
          agMsg += line + '\n';

          mData.filas.forEach((r) => {
            const deuda = r.saldo < 0 ? ' (deuda)' : '';
            agMsg += `   • ${mdEscape(r.numero)} ⇒ ${fmt(r.saldo)}${deuda}\n`;
          });
          agMsg += '\n';
        });

        agMsg += `*Total en USD:* ${fmt(agData.totalUsd)}`;
        await ctx.replyWithMarkdown(agMsg);
        await sleep(350);
      }
    } catch (err) {
      console.error('[tarjetas] error:', err);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

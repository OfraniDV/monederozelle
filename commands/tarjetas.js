// commands/tarjetas.js
// Lista tarjetas agrupadas (moneda → banco) con subtotales.  Oculta bloques
// vacíos (moneda o banco neto 0) y agentes sin saldo.  Incluye antispam delay.
// Migrado a HTML parse mode; escapeHtml sanitiza todos los valores dinámicos.
// Para volver a Markdown, ajustar textos y parse_mode.

const pool   = require('../psql/db.js');
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
const { escapeHtml } = require('../helpers/format');

/* ───────── helpers ───────── */
const fmt = (v, d = 2) =>
  escapeHtml(
    Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  );

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
      const byMon   = {};
      const bankUsd = {};
      const agentMap= {};
      let globalUsd = 0;

      rows.forEach(r => {
        /* moneda */
        byMon[r.moneda] ??= {
          emoji: r.moneda_emoji,
          rate:  +r.tasa_usd,
          banks: {},
          totalPos: 0,
          totalNeg: 0
        };
        const mon = byMon[r.moneda];
        /* banco */
        mon.banks[r.banco] ??= { emoji: r.banco_emoji, filas: [], pos: 0, neg: 0 };
        const bank = mon.banks[r.banco];
        bank.filas.push(r);

        if (r.saldo >= 0) { bank.pos += +r.saldo; mon.totalPos += +r.saldo; }
        else              { bank.neg += +r.saldo; mon.totalNeg += +r.saldo; }

        /* usd */
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

      /* 3. mensajes por moneda (omitiendo neto 0) */
      for (const [monCode, info] of Object.entries(byMon)) {
        const neto = info.totalPos + info.totalNeg;
        if (neto === 0) continue;                        // moneda vacía

        let msg =
          `💱 <b>Moneda:</b> ${info.emoji} ${escapeHtml(monCode)}\n\n` +
          `📊 <b>Subtotales por banco:</b>\n`;

        /* bancos */
        Object.entries(info.banks)
          .filter(([,d]) => d.pos + d.neg !== 0)        // omite banco neto 0
          .sort(([a],[b])=>a.localeCompare(b))
          .forEach(([bankCode, data]) => {
            msg += `\n${data.emoji} <b>${escapeHtml(bankCode)}</b>\n`;
            data.filas
              .filter(f => f.saldo !== 0)               // omite filas 0
              .forEach(r => {
                const agTxt = `${r.agente_emoji ? r.agente_emoji + ' ' : ''}${escapeHtml(r.agente)}`;
                const monTx = `${r.moneda_emoji ? r.moneda_emoji + ' ' : ''}${escapeHtml(r.moneda)}`;
                msg += `• ${escapeHtml(r.numero)} – ${agTxt} – ${monTx} ⇒ ${fmt(r.saldo)}\n`;
              });
            if (data.pos) msg += `  <i>Subtotal ${escapeHtml(bankCode)} (activo):</i> ${fmt(data.pos)} ${escapeHtml(monCode)}\n`;
            if (data.neg) msg += `  <i>Subtotal ${escapeHtml(bankCode)} (deuda):</i> ${fmt(data.neg)} ${escapeHtml(monCode)}\n`;
          });

        const rateToUsd   = fmt(info.rate, 6);
        const rateFromUsd = fmt(1 / info.rate, 2);
        const activeUsd   = info.totalPos * info.rate;
        const debtUsd     = info.totalNeg * info.rate;
        const netoUsd     = activeUsd + debtUsd;

        msg += `\n<b>Total activo:</b> ${fmt(info.totalPos)}\n`;
        if (info.totalNeg) msg += `<b>Total deuda:</b> ${fmt(info.totalNeg)}\n`;
        msg += `<b>Neto:</b> ${fmt(neto)}\n`;
        msg += `\n<b>Equivalente activo en USD:</b> ${fmt(activeUsd)}\n`;
        if (info.totalNeg) msg += `<b>Equivalente deuda en USD:</b> ${fmt(debtUsd)}\n`;
        msg += `<b>Equivalente neto en USD:</b> ${fmt(netoUsd)}\n`;
        msg += `\n<i>Tasa usada:</i>\n` +
               `  • 1 ${escapeHtml(monCode)} = ${rateToUsd} USD\n` +
               `  • 1 USD ≈ ${rateFromUsd} ${escapeHtml(monCode)}`;

        await ctx.reply(msg, { parse_mode: 'HTML' });
        await sleep(350);
      }

      /* 4. resumen global USD (omite bancos 0) */
      let resumen = '🧮 <b>Resumen general en USD</b>\n';
      Object.entries(bankUsd)
        .filter(([,usd]) => usd !== 0)
        .sort(([a],[b])=>a.localeCompare(b))
        .forEach(([bank,usd])=>{
          resumen += `• <b>${escapeHtml(bank)}</b>: ${fmt(usd)} USD\n`;
        });
      resumen += `\n<b>Total general:</b> ${fmt(globalUsd)} USD`;
      await ctx.reply(resumen, { parse_mode: 'HTML' });
      await sleep(350);

      /* 5. resumen por agente (omite agente 0) */
      const today = new Date().toLocaleDateString('es-CU', { timeZone:'America/Havana' });
      for (const [agName, agData] of Object.entries(agentMap)) {
        if (agData.totalUsd === 0) continue;

        let agMsg =
          `📅 <b>${escapeHtml(today)}</b>\n` +
          `👤 <b>Resumen de ${agData.emoji ? agData.emoji + ' ' : ''}${escapeHtml(agName)}</b>\n\n`;

        Object.entries(agData.perMon)
          .filter(([,m]) => m.total !== 0)              // omite moneda 0
          .forEach(([monCode, mData]) => {
            const line =
              `${mData.emoji} <b>${escapeHtml(monCode)}</b>: ${fmt(mData.total)} ` +
              `(≈ ${fmt(mData.total * mData.rate)} USD)`;
            agMsg += line + '\n';

            mData.filas
              .filter(f => f.saldo !== 0)
              .forEach(r => {
                const deuda = r.saldo < 0 ? ' (deuda)' : '';
                agMsg += `   • ${escapeHtml(r.numero)} ⇒ ${fmt(r.saldo)}${deuda}\n`;
              });
            agMsg += '\n';
          });

        agMsg += `<b>Total en USD:</b> ${fmt(agData.totalUsd)}`;
        await ctx.reply(agMsg, { parse_mode: 'HTML' });
        await sleep(350);
      }
    } catch (err) {
      console.error('[tarjetas] error:', err);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

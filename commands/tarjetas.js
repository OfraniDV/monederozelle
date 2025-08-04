// commands/tarjetas.js
// Lista tarjetas agrupadas con resumenes globales.  Emite un solo mensaje
// (o los mínimos necesarios) aprovechando el límite de 4096 caracteres por
// mensaje en Telegram.  Se muestran totales antes del detalle y se incluye
// para cada tarjeta el saldo inicial, final y la variación.

const pool = require('../psql/db.js');
const { escapeHtml } = require('../helpers/format');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */
const fmt = (v, d = 2) => {
  const num = parseFloat(v);
  const val = Number.isNaN(num) ? 0 : num;
  return escapeHtml(
    val.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
  );
};

/* -------------------------------------------------------------------------- */
/* Comando /tarjetas                                                          */
/* -------------------------------------------------------------------------- */
module.exports = (bot) => {
  bot.command('tarjetas', async (ctx) => {
    try {
      // 1. Último movimiento por tarjeta
      const sql = `
        SELECT t.id, t.numero,
               COALESCE(ag.nombre,'—')  AS agente,
               COALESCE(ag.emoji,'')    AS agente_emoji,
               COALESCE(b.codigo,'Sin banco') AS banco,
               COALESCE(b.emoji,'')     AS banco_emoji,
               COALESCE(m.codigo,'—')   AS moneda,
               COALESCE(m.emoji,'')     AS moneda_emoji,
               COALESCE(m.tasa_usd,1)   AS tasa_usd,
               COALESCE(mv.saldo_anterior,0) AS saldo_ini,
               COALESCE(mv.saldo_nuevo,0)    AS saldo_fin,
               mv.descripcion AS mov_desc,
               mv.creado_en  AS mov_fecha
          FROM tarjeta t
          LEFT JOIN agente ag ON ag.id = t.agente_id
          LEFT JOIN banco  b  ON b.id = t.banco_id
          LEFT JOIN moneda m  ON m.id = t.moneda_id
          LEFT JOIN LATERAL (
            SELECT saldo_anterior, saldo_nuevo, descripcion, creado_en
              FROM movimiento
             WHERE tarjeta_id = t.id
          ORDER BY creado_en DESC
             LIMIT 1
          ) mv ON TRUE;`;
      const rows = (await pool.query(sql)).rows;
      if (!rows.length) return ctx.reply('No hay tarjetas registradas todavía.');

      // 2. Agrupar por moneda y por agente
      const byMon = {};
      const agentMap = {};
      const bankUsd = {};
      let globalUsd = 0;

      rows.forEach((r) => {
        const ini = parseFloat(r.saldo_ini) || 0;
        const fin = parseFloat(r.saldo_fin) || 0;
        const delta = fin - ini;
        const tasa = parseFloat(r.tasa_usd) || 1;

        byMon[r.moneda] ??= {
          emoji: r.moneda_emoji,
          rate: tasa,
          ini: 0,
          fin: 0,
          banks: {},
        };
        const mon = byMon[r.moneda];
        mon.ini += ini;
        mon.fin += fin;
        mon.banks[r.banco] ??= {
          emoji: r.banco_emoji,
          ini: 0,
          fin: 0,
          tarjetas: [],
        };
        const bank = mon.banks[r.banco];
        bank.ini += ini;
        bank.fin += fin;
        bank.tarjetas.push({
          numero: r.numero,
          saldo_ini: ini,
          saldo_fin: fin,
          delta,
          agente: r.agente,
          agente_emoji: r.agente_emoji,
          desc: r.mov_desc,
          fecha: r.mov_fecha,
        });

        const usd = fin * tasa;
        bankUsd[r.banco] = (bankUsd[r.banco] || 0) + usd;
        globalUsd += usd;

        agentMap[r.agente] ??= {
          emoji: r.agente_emoji,
          totalIniUsd: 0,
          totalFinUsd: 0,
          perMon: {},
        };
        const ag = agentMap[r.agente];
        ag.totalIniUsd += ini * tasa;
        ag.totalFinUsd += fin * tasa;
        ag.perMon[r.moneda] ??= {
          emoji: r.moneda_emoji,
          rate: tasa,
          ini: 0,
          fin: 0,
          tarjetas: [],
        };
        const agMon = ag.perMon[r.moneda];
        agMon.ini += ini;
        agMon.fin += fin;
        agMon.tarjetas.push({
          numero: r.numero,
          banco: r.banco,
          banco_emoji: r.banco_emoji,
          saldo_ini: ini,
          saldo_fin: fin,
          delta,
        });
      });

      // 3. Construir bloques lógicos
      const blocks = [];
      let resumen = '💳 <b>Tarjetas</b>\n';
      resumen += '\n<b>Resumen por moneda</b>\n';
      Object.entries(byMon).forEach(([code, info]) => {
        if (info.ini === 0 && info.fin === 0) return;
        const d = info.fin - info.ini;
        resumen += `${info.emoji} <b>${escapeHtml(code)}</b>: ${fmt(info.ini)} → ${fmt(info.fin)} (Δ ${(d >= 0 ? '+' : '') + fmt(d)})\n\n`;
      });
      resumen += '<b>Resumen por agente (USD)</b>\n';
      Object.entries(agentMap).forEach(([name, info]) => {
        if (info.totalFinUsd === 0 && info.totalIniUsd === 0) return;
        const d = info.totalFinUsd - info.totalIniUsd;
        resumen += `${info.emoji ? info.emoji + ' ' : ''}${escapeHtml(name)}: ${fmt(info.totalIniUsd)} → ${fmt(info.totalFinUsd)} USD (Δ ${(d >= 0 ? '+' : '') + fmt(d)} USD)\n\n`;
      });
      resumen += `<b>Total general USD:</b> ${fmt(globalUsd)} USD`;
      blocks.push(resumen);

      for (const [monCode, info] of Object.entries(byMon)) {
        if (info.ini === 0 && info.fin === 0) continue;
        let msg = `${info.emoji} <b>${escapeHtml(monCode)}</b>\n`;
        Object.entries(info.banks).forEach(([bankCode, bank]) => {
          if (bank.ini === 0 && bank.fin === 0) return;
          msg += `\n${bank.emoji} <b>${escapeHtml(bankCode)}</b>\n`;
          bank.tarjetas.forEach((t) => {
            const d = t.delta;
            const agTxt = `${t.agente_emoji ? t.agente_emoji + ' ' : ''}${escapeHtml(t.agente)}`;
            msg += `• ${escapeHtml(t.numero)} – ${agTxt} ⇒ ${fmt(t.saldo_ini)} → ${fmt(t.saldo_fin)} (Δ ${(d >= 0 ? '+' : '') + fmt(d)})\n`;
            if (t.desc) {
              const fecha = new Date(t.fecha).toLocaleString('es-CU', {
                timeZone: 'America/Havana',
                hour12: false,
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
              msg += `   · ${fecha} ${escapeHtml(t.desc)}\n`;
            }
          });
          const bd = bank.fin - bank.ini;
          msg += `<i>Subtotal:</i> ${fmt(bank.ini)} → ${fmt(bank.fin)} (Δ ${(bd >= 0 ? '+' : '') + fmt(bd)})\n\n`;
        });
        const md = info.fin - info.ini;
        msg += `\n<b>Total:</b> ${fmt(info.ini)} → ${fmt(info.fin)} (Δ ${(md >= 0 ? '+' : '') + fmt(md)})\n`;
        msg += `<b>Equiv. fin USD:</b> ${fmt(info.fin * info.rate)}\n`;
        blocks.push(msg);
      }

      const today = new Date().toLocaleDateString('es-CU', { timeZone: 'America/Havana' });
      for (const [agName, ag] of Object.entries(agentMap)) {
        if (ag.totalFinUsd === 0 && ag.totalIniUsd === 0) continue;
        let agMsg = `📅 <b>${escapeHtml(today)}</b>\n`;
        agMsg += `👤 <b>${ag.emoji ? ag.emoji + ' ' : ''}${escapeHtml(agName)}</b>\n\n`;
        Object.entries(ag.perMon).forEach(([monCode, m]) => {
          if (m.ini === 0 && m.fin === 0) return;
          const d = m.fin - m.ini;
          agMsg += `${m.emoji} <b>${escapeHtml(monCode)}</b>: ${fmt(m.ini)} → ${fmt(m.fin)} (Δ ${(d >= 0 ? '+' : '') + fmt(d)})\n`;
          m.tarjetas.forEach((t) => {
            agMsg += `   • ${escapeHtml(t.numero)} – ${t.banco_emoji} ${escapeHtml(t.banco)} ⇒ ${fmt(t.saldo_ini)} → ${fmt(t.saldo_fin)} (Δ ${(t.delta >= 0 ? '+' : '') + fmt(t.delta)})\n`;
          });
          agMsg += '\n';
        });
        const dUsd = ag.totalFinUsd - ag.totalIniUsd;
        agMsg += `<b>Total USD:</b> ${fmt(ag.totalFinUsd)} (Δ ${(dUsd >= 0 ? '+' : '') + fmt(dUsd)} USD)`;
        blocks.push(agMsg);
      }

      // 4. Envío final
      await sendLargeMessage(ctx, blocks);
    } catch (err) {
      console.error('[tarjetas] error:', err);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

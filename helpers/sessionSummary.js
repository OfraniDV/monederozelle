const { sendAndLog, notifyOwners } = require('./reportSender');
const { fmtMoney } = require('./format');
const db = require('../psql/db.js');
const { query } = db;

const changes = new Map(); // agentId => Map(tarjetaId => {antes, despues})

function recordChange(agentId, tarjetaId, saldoAntes, saldoDespues) {
  if (!changes.has(agentId)) changes.set(agentId, new Map());
  changes.get(agentId).set(tarjetaId, { antes: saldoAntes, despues: saldoDespues });
}

function pad(str, len) {
  str = String(str);
  return str.padEnd(len).slice(0, len);
}

async function flushOnExit(ctx) {
  if (!changes.size) return;
  try {
    const agentSummaries = [];
    for (const [agId, cards] of changes.entries()) {
      const agRes = await query('SELECT nombre FROM agente WHERE id=$1', [agId]);
      const agName = agRes.rows[0]?.nombre || `#${agId}`;
      const cardRes = await query(
        `SELECT t.id, t.numero,
                COALESCE(mv.saldo_nuevo,0) AS saldo
           FROM tarjeta t
           LEFT JOIN LATERAL (
             SELECT saldo_nuevo
               FROM movimiento
              WHERE tarjeta_id = t.id
              ORDER BY creado_en DESC
              LIMIT 1
           ) mv ON true
          WHERE t.agente_id = $1
          ORDER BY t.numero`,
        [agId]
      );
      const changedLines = [];
      const untouchedLines = [];
      let totalAntes = 0;
      let totalDespues = 0;
      for (const c of cardRes.rows) {
        const change = cards.get(c.id);
        const antes = change ? change.antes : parseFloat(c.saldo) || 0;
        const despues = change ? change.despues : parseFloat(c.saldo) || 0;
        const delta = despues - antes;
        const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
        const deltaStr = `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`;
        const line = `${pad(c.numero, 8)} <code>${fmtMoney(antes)}</code> → <code>${fmtMoney(despues)}</code>   <code>${deltaStr}</code> ${emoji}`;
        if (change) changedLines.push(line); else untouchedLines.push(line);
        totalAntes += antes;
        totalDespues += despues;
      }
      const head = `📝 Resumen de ajustes – ${new Date()
        .toLocaleString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}\n👤 Agente: ${agName}\n\nTarjeta   Saldo anterior → Saldo actual   Δ\n`;
      let body = head + changedLines.join('\n');
      if (untouchedLines.length) {
        body += `\n\nSin cambios:\n` + untouchedLines.join('\n');
      }
      body += `\n\nSubtotal: <code>${fmtMoney(totalAntes)}</code> → <code>${fmtMoney(totalDespues)}</code>`;
      await sendAndLog(ctx, body.trim());
      agentSummaries.push({ agId, agName, changed: cards.size, total: cardRes.rows.length });
    }
    if (agentSummaries.length) {
      const totalChanged = agentSummaries.reduce((a, b) => a + b.changed, 0);
      const totalCards = agentSummaries.reduce((a, b) => a + b.total, 0);
      const names = agentSummaries.map((a) => a.agName).join(', ');
      const summary = `✅ Ajustes completados por <@${ctx.from?.username || ctx.from?.id}> – ${new Date()
        .toLocaleString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}\nAgentes afectados: ${names} (${totalChanged} de ${totalCards} tarjetas cambiadas)`;
      await notifyOwners(ctx, summary);
    }
  } catch (err) {
    console.error('[sessionSummary] error al enviar resumen', err);
  }
  changes.clear();
}

module.exports = { recordChange, flushOnExit };

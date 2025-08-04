const { notifyOwners } = require('./reportSender');
const { fmtMoney, escapeHtml } = require('./format');
const { ownerIds, statsChatId, comercialesGroupId } = require('../config');
const db = require('../psql/db.js');
const { query } = db;

// agentId => Map(tarjetaId => {antes, despues})
const changes = new Map();

function recordChange(agentId, tarjetaId, saldoAntes, saldoDespues) {
  if (!changes.has(agentId)) changes.set(agentId, new Map());
  changes.get(agentId).set(tarjetaId, { antes: saldoAntes, despues: saldoDespues });
}

function pad(str, len) {
  str = String(str);
  return str.padEnd(len).slice(0, len);
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}`;
}

async function broadcast(ctx, recipients, html) {
  for (const id of recipients) {
    try {
      await ctx.telegram.sendMessage(id, html, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[sessionSummary] error enviando a', id, err.message);
    }
  }
}

async function flushOnExit(ctx) {
  if (!changes.size) return; // no hay cambios registrados

  const missing = [];
  if (!ctx.from) missing.push('ctx.from');
  if (!ctx.chat) missing.push('ctx.chat');
  if (missing.length) {
    console.warn('[sessionSummary] faltan datos de contexto:', missing.join(', '));
  }

  try {
    const actor = ctx.from || {};
    const username = actor.username
      ? `@${escapeHtml(actor.username)}`
      : escapeHtml(String(actor.id || ''));
    const fullName = escapeHtml(
      `${actor.first_name || ''} ${actor.last_name || ''}`.trim(),
    );
    const role = ownerIds.includes(actor.id) ? 'Owner' : 'Usuario regular';

    const chatId = ctx.chat?.id;
    let contexto = 'Otro grupo';
    if (ctx.chat?.type === 'private') {
      contexto = 'PV';
    } else if (chatId === statsChatId) {
      contexto = 'Grupo de estadísticas';
    } else if (chatId === comercialesGroupId) {
      contexto = 'Grupo de comerciales';
    }

    const ts = formatDate(new Date());
    const header =
      `📝 Resumen de ajustes – ${ts}\n` +
      `👤 Usuario: ${username} (ID: ${actor.id})\n` +
      `• Nombre completo: ${fullName || '—'}\n` +
      `• Rol: ${role}\n` +
      `• Contexto: ${contexto}`;

    const recipients = new Set();
    if (chatId) recipients.add(chatId);
    if (statsChatId && statsChatId !== chatId) recipients.add(statsChatId);
    if (comercialesGroupId && comercialesGroupId !== chatId)
      recipients.add(comercialesGroupId);

    await broadcast(ctx, recipients, header);

    const agentSummaries = [];
    for (const [agId, cards] of changes.entries()) {
      const agRes = await query('SELECT nombre FROM agente WHERE id=$1', [agId]);
      const agName = agRes.rows[0]?.nombre || `#${agId}`;

      const cardRes = await query(
        `SELECT t.id, t.numero,
                COALESCE(fin.saldo_fin,0) AS saldo_fin,
                COALESCE(ini.saldo_ini,0) AS saldo_ini
           FROM tarjeta t
           LEFT JOIN LATERAL (
             SELECT saldo_nuevo AS saldo_fin
               FROM movimiento
              WHERE tarjeta_id = t.id
              ORDER BY creado_en DESC
              LIMIT 1
           ) fin ON true
           LEFT JOIN LATERAL (
             SELECT saldo_nuevo AS saldo_ini
               FROM movimiento
              WHERE tarjeta_id = t.id
              ORDER BY creado_en ASC
              LIMIT 1
           ) ini ON true
          WHERE t.agente_id = $1
          ORDER BY t.numero`,
        [agId],
      );

      const lines = [];
      // Antes se tomaba el saldo previo a la sesión como "inicial".
      // Ahora usamos el primer movimiento real de la tarjeta.
      for (const c of cardRes.rows) {
        const antes = parseFloat(c.saldo_ini) || 0;
        const despues = parseFloat(c.saldo_fin) || 0;
        const delta = despues - antes;
        const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
        const deltaStr = `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`;
        const line = `${pad(c.numero, 8)} <code>${fmtMoney(antes)}</code> → <code>${fmtMoney(
          despues,
        )}</code> (Δ <code>${deltaStr}</code>) ${emoji}`;
        lines.push(line);
      }

      const agentMsg =
        `👤 Agente: ${escapeHtml(agName)}\n` +
        'Tarjeta   Saldo inicial → Saldo actual   Δ\n' +
        lines.join('\n');

      await broadcast(ctx, recipients, agentMsg);
      agentSummaries.push({ agName, changed: cards.size, total: cardRes.rows.length });
    }

    if (agentSummaries.length > 1) {
      const totalChanged = agentSummaries.reduce((a, b) => a + b.changed, 0);
      const totalCards = agentSummaries.reduce((a, b) => a + b.total, 0);
      const names = agentSummaries.map((a) => a.agName).join(', ');
      const ownerMsg =
        `✅ Ajustes completados por ${username} – ${ts}\n` +
        `Agentes afectados: ${escapeHtml(names)} (${totalChanged} de ${totalCards} tarjetas con cambio)`;
      await notifyOwners(ctx, ownerMsg);
    }
  } catch (err) {
    console.error('[sessionSummary] error al enviar resumen', err);
  }

  changes.clear();
}

module.exports = { recordChange, flushOnExit };


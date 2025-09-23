const { notifyOwners } = require('./reportSender');
const { fmtMoney, escapeHtml } = require('./format');
const { safeSendMessage, safeReply } = require('./telegram');
const { ownerIds, statsChatId, comercialesGroupId } = require('../config');
const db = require('../psql/db.js');
const { query } = db;
const moment = require('moment-timezone');

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
      await safeSendMessage(ctx.telegram, id, html, { parse_mode: 'HTML' });
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
    const isGroupChat = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const privateChatId = ctx.from?.id;

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
    if (isGroupChat) {
      if (privateChatId) recipients.add(privateChatId);
    } else if (chatId) {
      recipients.add(chatId);
    }
    // Evitamos reenviar automáticamente al grupo de estadísticas para reducir el spam.
    if (comercialesGroupId) {
      const targetId = isGroupChat ? privateChatId : chatId;
      if (comercialesGroupId !== targetId) {
        recipients.add(comercialesGroupId);
      }
    }

    await broadcast(ctx, recipients, header);

    const agentSummaries = [];
    const tz = 'America/Havana';
    const start = moment.tz(tz).startOf('day');
    const end = moment.tz(tz).endOf('day');
    for (const [agId, cards] of changes.entries()) {
      const agRes = await query('SELECT nombre FROM agente WHERE id=$1', [agId]);
      const agName = agRes.rows[0]?.nombre || `#${agId}`;

      const cardRes = await query(
        `SELECT t.id, t.numero,
                COALESCE(fin.saldo_fin,0) AS saldo_fin,
                COALESCE(ini.saldo_ini,0) AS saldo_ini,
                COALESCE(dia.saldo_ini_dia, fin.saldo_fin) AS saldo_ini_dia
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
           LEFT JOIN LATERAL (
             SELECT saldo_anterior AS saldo_ini_dia
               FROM movimiento
              WHERE tarjeta_id = t.id AND creado_en >= $2 AND creado_en <= $3
              ORDER BY creado_en ASC
              LIMIT 1
           ) dia ON true
          WHERE t.agente_id = $1
          ORDER BY t.numero`,
        [agId, start.toDate(), end.toDate()],
      );

      const linesTot = [];
      const linesDia = [];
      const linesUlt = [];
      for (const c of cardRes.rows) {
        const fin = parseFloat(c.saldo_fin) || 0;
        const iniTot = parseFloat(c.saldo_ini) || 0;
        const iniDia = parseFloat(c.saldo_ini_dia);

        const deltaTot = fin - iniTot;
        const emTot = deltaTot > 0 ? '📈' : deltaTot < 0 ? '📉' : '➖';
        const lineTot = `${pad(c.numero, 8)} <code>${fmtMoney(iniTot)}</code> → <code>${fmtMoney(
          fin,
        )}</code> (Δ <code>${deltaTot >= 0 ? '+' : ''}${fmtMoney(deltaTot)}</code>) ${emTot}`;
        linesTot.push(lineTot);

        const deltaDia = fin - iniDia;
        const emDia = deltaDia > 0 ? '📈' : deltaDia < 0 ? '📉' : '➖';
        const lineDia = `${pad(c.numero, 8)} <code>${fmtMoney(iniDia)}</code> → <code>${fmtMoney(
          fin,
        )}</code> (Δ <code>${deltaDia >= 0 ? '+' : ''}${fmtMoney(deltaDia)}</code>) ${emDia}`;
        linesDia.push(lineDia);

        const change = changes.get(agId)?.get(c.id);
        if (change) {
          const antes = parseFloat(change.antes) || 0;
          const despues = parseFloat(change.despues) || 0;
          const deltaUlt = despues - antes;
          const emUlt = deltaUlt > 0 ? '📈' : deltaUlt < 0 ? '📉' : '➖';
          const lineUlt = `${pad(c.numero, 8)} <code>${fmtMoney(antes)}</code> → <code>${fmtMoney(
            despues,
          )}</code> (Δ <code>${deltaUlt >= 0 ? '+' : ''}${fmtMoney(deltaUlt)}</code>) ${emUlt}`;
          linesUlt.push(lineUlt);
        }
      }

      const agentMsg =
        `👤 Agente: ${escapeHtml(agName)}\n` +
        'Tarjeta   Saldo inicial → Saldo actual   Δ\n' +
        linesTot.join('\n');
      await broadcast(ctx, recipients, agentMsg);

      const agentDia =
        `📆 Actualización del día – ${escapeHtml(agName)}\n` +
        'Tarjeta   Saldo inicial → Saldo actual   Δ\n' +
        linesDia.join('\n');
      await broadcast(ctx, recipients, agentDia);

      if (linesUlt.length) {
        const agentUlt =
          `🕘 Última actualización – ${escapeHtml(agName)}\n` +
          'Tarjeta   Saldo anterior → Saldo nuevo   Δ\n' +
          linesUlt.join('\n');
      await broadcast(ctx, recipients, agentUlt);
      }

      agentSummaries.push({ agName, changed: cards.size, total: cardRes.rows.length });
    }

    if (isGroupChat && privateChatId) {
      await safeReply(
        ctx,
        '📬 Resumen de cambios enviado por privado para evitar spam en el grupo.'
      ).catch((err) => {
        console.error('[sessionSummary] no se pudo notificar en grupo:', err?.message);
      });
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


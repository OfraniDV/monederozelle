// commands/monitor.js
/**
 * /monitor [dia|mes|año] [banco|agente|moneda|tarjeta]
 * Ejemplos:
 *   /monitor
 *   /monitor mes banco
 *   /monitor año agente
 *
 * Compara el snapshot final del periodo actual vs el anterior y muestra
 * detalle por tarjeta y, opcionalmente, resumen agrupado.
 */
const { Markup } = require('telegraf');
const pool = require('../psql/db.js'); // ajuste según tu ruta real

/* ───────── util: cálculo de rangos ───────── */
function calcFechas(nivel = 'dia') {
  const now = new Date();

  const utcStartOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const utcStartOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const utcStartOfYear = (d) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  let start, end, prevStart, label, prevLabel;

  if (nivel === 'mes') {
    start = utcStartOfMonth(now);
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    label = `${start.toLocaleString('default', { month: 'long' })} ${start.getUTCFullYear()}`;
    prevLabel = `${prevStart.toLocaleString('default', { month: 'long' })} ${prevStart.getUTCFullYear()}`;
  } else if (nivel === 'año') {
    start = utcStartOfYear(now);
    end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
    prevStart = new Date(Date.UTC(start.getUTCFullYear() - 1, 0, 1));
    label = `${start.getUTCFullYear()}`;
    prevLabel = `${prevStart.getUTCFullYear()}`;
  } else {
    // día
    start = utcStartOfDay(now);
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    prevStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const fmt = (d) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
    label = fmt(start);
    prevLabel = fmt(prevStart);
  }

  return { start, end, prevStart, label, prevLabel };
}

/* ───────── SQL base ───────── */
const SQL_CORE = `
WITH ultimos AS (
  SELECT tarjeta_id, MAX(creado_en) AS ts
    FROM movimiento
   WHERE creado_en < $1
   GROUP BY tarjeta_id
),
saldo_final AS (
  SELECT mv.tarjeta_id, mv.saldo_nuevo
    FROM ultimos u
    JOIN movimiento mv
      ON mv.tarjeta_id = u.tarjeta_id
     AND mv.creado_en = u.ts
),
anteriores AS (
  SELECT tarjeta_id, MAX(creado_en) AS ts
    FROM movimiento
   WHERE creado_en < $2
   GROUP BY tarjeta_id
),
saldo_ini AS (
  SELECT mv.tarjeta_id, mv.saldo_nuevo
    FROM anteriores a
    JOIN movimiento mv
      ON mv.tarjeta_id = a.tarjeta_id
     AND mv.creado_en = a.ts
)
SELECT t.id,
       t.numero,
       COALESCE(sf.saldo_nuevo,0) AS saldo_fin,
       COALESCE(si.saldo_nuevo,0) AS saldo_ini,
       (COALESCE(sf.saldo_nuevo,0) - COALESCE(si.saldo_nuevo,0)) AS delta,
       b.codigo AS banco,
       ag.nombre AS agente,
       m.codigo AS moneda
FROM tarjeta t
LEFT JOIN saldo_final sf ON sf.tarjeta_id = t.id
LEFT JOIN saldo_ini si   ON si.tarjeta_id = t.id
LEFT JOIN banco b       ON b.id = t.banco_id
LEFT JOIN agente ag     ON ag.id = t.agente_id
LEFT JOIN moneda m      ON m.id = t.moneda_id;
`;

/* ───────── util: resumen agrupado ───────── */
function agrupar(rows, campo) {
  const mapa = new Map();
  rows.forEach((r) => {
    const key = campo === 'tarjeta' ? r.numero || '—' : (r[campo] || '—') + '';
    const prev = mapa.get(key) || { saldo_ini: 0, saldo_fin: 0 };
    prev.saldo_ini += Number(r.saldo_ini || 0);
    prev.saldo_fin += Number(r.saldo_fin || 0);
    mapa.set(key, prev);
  });
  return mapa;
}

/* ───────── export: comando monitor ───────── */
module.exports = (bot) => {
  bot.command('monitor', async (ctx) => {
    try {
      const raw = ctx.message.text || '';
      const parts = raw.trim().split(/\s+/).slice(1).map(p => p.toLowerCase());

      const nivel = parts.find(p => ['dia', 'mes', 'año', 'ano', 'anio'].includes(p)) || 'dia';
      const detalle = parts.find(p => ['banco', 'agente', 'moneda', 'tarjeta'].includes(p)); // opcional
      const nivelNorm = nivel === 'ano' || nivel === 'anio' ? 'año' : nivel;

      const { start, end, prevStart, label, prevLabel } = calcFechas(nivelNorm);

      const { rows } = await pool.query(SQL_CORE, [end.toISOString(), start.toISOString()]);

      if (!rows.length) {
        return ctx.reply('No hay movimientos suficientes para generar el reporte.');
      }

      // Totales generales (sumas)
      let totalIni = 0,
        totalFin = 0,
        aumentos = 0,
        disminuciones = 0,
        sinCambios = 0;

      const tarjetas = rows.map((r) => {
        const ini = Number(r.saldo_ini || 0);
        const fin = Number(r.saldo_fin || 0);
        const delta = fin - ini;
        const pct = ini !== 0 ? ((delta / ini) * 100).toFixed(2) : '—';
        let estadoEmoji = '➖';
        if (delta > 0) estadoEmoji = '📈';
        else if (delta < 0) estadoEmoji = '📉';

        if (delta > 0) aumentos++;
        else if (delta < 0) disminuciones++;
        else sinCambios++;

        totalIni += ini;
        totalFin += fin;

        return {
          id: r.id,
          numero: r.numero,
          banco: r.banco || '—',
          agente: r.agente || '—',
          moneda: r.moneda || '—',
          saldo_ini: ini,
          saldo_fin: fin,
          delta,
          pct: ini === 0 ? 'nuevo' : `${pct}%`,
          emoji: estadoEmoji
        };
      });

      // Ordenar tarjetas por cambio absoluto descendente
      tarjetas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      // Encabezado
      let msg = `📊 *${label}* vs *${prevLabel}*\n`;
      msg += `Total anterior: *${totalIni.toFixed(2)}*  →  Actual: *${totalFin.toFixed(2)}*  `;
      const deltaTotal = totalFin - totalIni;
      const totalEmoji = deltaTotal > 0 ? '📈' : deltaTotal < 0 ? '📉' : '➖';
      msg += `${totalEmoji} *${deltaTotal.toFixed(2)}*\n`;
      msg += `Aumentos: ${aumentos}, Disminuciones: ${disminuciones}, Sin cambio: ${sinCambios}\n\n`;

      if (totalIni === 0 && totalFin > 0) {
        msg += '_Nota: no había saldo previo (posible primer registro), se muestra el balance actual como base._\n\n';
      }

      // Detalle por tarjeta (top 20 para no saturar)
      msg += '*Detalle por tarjeta:*\n';
      tarjetas.slice(0, 30).forEach((t) => {
        const cambioStr =
          t.saldo_ini === 0
            ? `nuevo ${t.saldo_fin.toFixed(2)}`
            : `${t.saldo_ini.toFixed(2)} → ${t.saldo_fin.toFixed(2)} (${t.pct})`;
        msg += `• ${t.emoji} ${t.numero} — ${t.agente} — ${t.banco} — ${t.moneda}: ${cambioStr} (Δ ${t.delta.toFixed(2)})\n`;
      });

      // Si se pidió detalle agrupado (banco/agente/moneda/tarjeta), agregarlo
      if (detalle) {
        msg += `\n*Resumen por ${detalle}:*\n`;
        const agrup = agrupar(rows, detalle);
        for (const [key, val] of agrup.entries()) {
          const delta = val.saldo_fin - val.saldo_ini;
          const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
          msg += `• ${key}: ${val.saldo_ini.toFixed(2)} → ${val.saldo_fin.toFixed(2)} ${emoji} ${delta.toFixed(2)}\n`;
        }
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('[monitor] error:', e);
      await ctx.reply('❌ Ocurrió un error al generar el monitoreo.');
    }
  });
};

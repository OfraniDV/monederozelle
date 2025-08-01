 // commands/monitor.js
 /**
  * /monitor [dia|mes|año] [banco|agente|moneda|tarjeta]
  * Ejemplos:
  *   /monitor
  *   /monitor mes banco
  *   /monitor año agente
  *
  * Compara el snapshot final del periodo actual vs el anterior y muestra
  * totales y deltas. No usa librerías externas para fechas.
  */
const { Markup } = require('telegraf');
const pool = require('../psql/db.js.js');

/* ───────── util: cálculo de rangos ───────── */
function calcFechas(nivel = 'dia') {
  const now = new Date();

  // helper para truncar a UTC midnight
  const utcStartOfDay = (d) => {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  const utcStartOfMonth = (d) => {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  };
  const utcStartOfYear = (d) => {
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  };

  let start, end, prevStart, label, prevLabel;

  if (nivel === 'mes') {
    start = utcStartOfMonth(now);
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    const prevEnd = start;
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

  return {
    start,
    end,
    prevStart,
    label,
    prevLabel
  };
}

/* ───────── util: armar resumen textual ───────── */
function buildResumen(rows, detalle, labels) {
  const keyFn = (r) => {
    if (!detalle) return 'TOTAL';
    // map detalle to property
    if (detalle === 'tarjeta') return r.numero || '—';
    return (r[detalle] || '—').toString();
  };

  const agrup = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    const existente = agrup.get(k) || { saldo_ini: 0, saldo_fin: 0 };
    existente.saldo_ini += Number(r.saldo_ini || 0);
    existente.saldo_fin += Number(r.saldo_fin || 0);
    agrup.set(k, existente);
  });

  let texto = `📊 *${labels.label}* vs *${labels.prevLabel}*\n`;
  let totalIni = 0;
  let totalFin = 0;
  agrup.forEach((v, k) => {
    const delta = v.saldo_fin - v.saldo_ini;
    totalIni += v.saldo_ini;
    totalFin += v.saldo_fin;
    const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
    texto += `• *${k}*: ${v.saldo_fin.toFixed(2)} (antes ${v.saldo_ini.toFixed(2)}) ${emoji} ${delta.toFixed(2)}\n`;
  });

  const totalDelta = totalFin - totalIni;
  const totalEmoji = totalDelta > 0 ? '📈' : totalDelta < 0 ? '📉' : '➖';
  texto += `\n*Total*: ${totalFin.toFixed(2)} (antes ${totalIni.toFixed(2)}) ${totalEmoji} ${totalDelta.toFixed(2)}`;

  return texto;
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

/* ───────── export: registro del comando ───────── */
module.exports = (bot) => {
  bot.command('monitor', async (ctx) => {
    try {
      const raw = ctx.message.text || '';
      const parts = raw.trim().split(/\s+/).slice(1).map(p => p.toLowerCase());

      const nivel = parts.find(p => ['dia', 'mes', 'año', 'ano', 'anio'].includes(p)) || 'dia';
      const detalle = parts.find(p => ['banco', 'agente', 'moneda', 'tarjeta'].includes(p));
      // normalizar 'anio' y 'ano' -> 'año'
      const nivelNorm = nivel === 'ano' || nivel === 'anio' ? 'año' : nivel;

      const { start, end, prevStart, label, prevLabel } = calcFechas(nivelNorm);

      // snapshot final del periodo actual (< end) y final del anterior (< start)
      const { rows } = await pool.query(SQL_CORE, [end.toISOString(), start.toISOString()]);

      if (!rows.length) {
        return ctx.reply('No hay datos de movimientos suficientes para generar estadísticas.');
      }

      const resumenTexto = buildResumen(rows, detalle, { label, prevLabel });
      await ctx.reply(resumenTexto, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('[monitor] error:', e);
      await ctx.reply('❌ Ocurrió un error al generar estadísticas.');
    }
  });
};

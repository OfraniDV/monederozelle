// commands/monitor.js
// Implementación avanzada del comando /monitor para Telegraf.
// Genera un monitoreo financiero por tarjeta agrupando por moneda y agente.
// Asegúrate de tener la extensión unaccent instalada:
//   CREATE EXTENSION IF NOT EXISTS unaccent;

const moment = require('moment-timezone');
const path = require('path');
// Migrado a HTML parse mode con sanitización centralizada en escapeHtml.
const { escapeHtml } = require('../helpers/format');

let db;
try {
  db = require(path.join(__dirname, '..', 'psql', 'db.js'));
} catch (err) {
  console.error('[monitor] Error al cargar la base de datos', err);
  throw err;
}
const { query } = db;

/* ───────── utilidades básicas ───────── */
function normalize(str = '') {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/gi, 'n')
    .toLowerCase();
}

function parseArgs(raw = '') {
  const tokens = raw.split(/\s+/).slice(1); // quitar /monitor
  const opts = {
    period: 'dia',
    historial: false,
    soloCambio: false,
    agente: null,
    banco: null,
    moneda: null,
    tz: 'America/Havana',
    limite: 30,
    orden: 'delta',
  };

  tokens.forEach((t) => {
    if (!t) return;
    const norm = normalize(t);
    if (['dia', 'semana', 'mes', 'ano', 'anio'].includes(norm)) {
      opts.period = norm === 'anio' ? 'ano' : norm;
      return;
    }
    if (t.startsWith('--')) {
      const [flagRaw, valRaw] = t.split('=');
      const flag = normalize(flagRaw);
      const val = valRaw || '';
      switch (flag) {
        case '--historial':
          opts.historial = true;
          break;
        case '--solo-cambio':
        case '--solocambio':
          opts.soloCambio = true;
          break;
        case '--agente':
          opts.agente = val;
          break;
        case '--banco':
          opts.banco = val;
          break;
        case '--moneda':
          opts.moneda = val;
          break;
        case '--tz':
          if (val) opts.tz = val;
          break;
        case '--limite':
          opts.limite = parseInt(val, 10) || opts.limite;
          break;
        case '--orden':
          const ord = normalize(val);
          if (['delta', 'vol', 'movs'].includes(ord)) opts.orden = ord;
          break;
        default:
          break;
      }
    }
  });
  return opts;
}

function calcRanges(period, tz) {
  const now = moment.tz(tz);
  let start;
  switch (period) {
    case 'semana':                         // últimos 7 días rodantes
      start = now.clone().startOf('day').subtract(6, 'days');
      break;
    case 'mes':
      start = now.clone().startOf('month');
      break;
    case 'ano':
      start = now.clone().startOf('year');
      break;
    default:
      start = now.clone().startOf('day');
  }
  const end  = now.clone().endOf('day'); // hasta el momento actual
  let prevStart;
  if (period === 'semana') prevStart = start.clone().subtract(7, 'days');
  else if (period === 'mes') prevStart = start.clone().subtract(1, 'month');
  else if (period === 'ano') prevStart = start.clone().subtract(1, 'year');
  else prevStart = start.clone().subtract(1, 'day');
  const prevEnd = start.clone();
  return { start, end, prevStart, prevEnd };
}


const moneyFmt = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtMoney(n) {
  return moneyFmt.format(parseFloat(n || 0));
}
function fmtPct(p) {
  return p === null || p === undefined ? '—' : `${p.toFixed(2)}%`;
}

function estadoEmoji(delta, pct, nUp, nDown) {
  let base = '➖';
  if (delta > 0) base = '📈';
  else if (delta < 0) base = '📉';
  let extra = '';
  if (nUp > 0 && nDown > 0) {
    extra = '🔁';
  } else if (delta > 0) {
    extra = '✅';
  } else if (delta < 0) {
    if (pct <= -20) extra = '🚨';
    else if (pct <= -5) extra = '⚠️';
  }
  return base + extra;
}

function pad(str, len, left = false) {
  str = String(str);
  return left ? str.padStart(len).slice(-len) : str.padEnd(len).slice(0, len);
}

function resumenPor(rows, campo) {
  const mapa = new Map();
  rows.forEach((r) => {
    const key = r[campo] || '—';
    const obj = mapa.get(key) || { ini: 0, fin: 0 };
    obj.ini += r.saldo_ini;
    obj.fin += r.saldo_fin;
    mapa.set(key, obj);
  });
  return mapa;
}

async function sendChunks(ctx, text) {
  const max = 3900;
  let restante = text;
  while (restante.length > 0) {
    let corte = restante.length <= max ? restante.length : restante.lastIndexOf('\n', max);
    if (corte <= 0) corte = Math.min(restante.length, max);
    const chunk = restante.slice(0, corte);
    restante = restante.slice(corte);
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply(chunk); // fallback sin parse_mode
    }
  }
}

/* ───────── SQL base ───────── */
const SQL_BASE = `
WITH movs AS (
  SELECT mv.tarjeta_id,
         COUNT(*) AS movs,
         COUNT(*) FILTER (WHERE saldo_nuevo > saldo_anterior) AS n_up,
         COUNT(*) FILTER (WHERE saldo_nuevo < saldo_anterior) AS n_down,
         SUM(ABS(saldo_nuevo - saldo_anterior)) AS vol
    FROM movimiento mv
   WHERE mv.creado_en >= $1 AND mv.creado_en < $2
   GROUP BY mv.tarjeta_id
),
ini AS (
  SELECT DISTINCT ON (tarjeta_id)
         tarjeta_id, saldo_nuevo AS saldo_ini
    FROM movimiento
   WHERE creado_en < $1
   ORDER BY tarjeta_id, creado_en DESC
),
fin AS (
  SELECT DISTINCT ON (tarjeta_id)
         tarjeta_id, saldo_nuevo AS saldo_fin
    FROM movimiento
   WHERE creado_en < $2
   ORDER BY tarjeta_id, creado_en DESC
)
SELECT t.id, t.numero,
       b.codigo AS banco_codigo, b.nombre AS banco_nombre,
       ag.nombre AS agente, m.codigo AS moneda,
       COALESCE(ini.saldo_ini,0) AS saldo_ini,
       COALESCE(fin.saldo_fin,0) AS saldo_fin,
       COALESCE(movs.movs,0) AS movs,
       COALESCE(movs.n_up,0) AS n_up,
       COALESCE(movs.n_down,0) AS n_down,
       COALESCE(movs.vol,0) AS vol
  FROM tarjeta t
  JOIN banco b ON b.id = t.banco_id
  JOIN agente ag ON ag.id = t.agente_id
  JOIN moneda m ON m.id = t.moneda_id
  LEFT JOIN ini ON ini.tarjeta_id = t.id
  LEFT JOIN fin ON fin.tarjeta_id = t.id
  LEFT JOIN movs ON movs.tarjeta_id = t.id
`;

/* ───────── mensaje por moneda ───────── */
function buildMessage(moneda, rows, opts, range, historiales) {
  const sorted = [...rows];
  switch (opts.orden) {
    case 'vol':
      sorted.sort((a, b) => b.vol - a.vol);
      break;
    case 'movs':
      sorted.sort((a, b) => b.movs - a.movs);
      break;
    default:
      sorted.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  const tableRows = sorted.slice(0, opts.limite);

  let totalIni = 0,
    totalFin = 0,
    up = 0,
    down = 0,
    same = 0;
  rows.forEach((r) => {
    totalIni += r.saldo_ini;
    totalFin += r.saldo_fin;
    if (r.delta > 0) up++;
    else if (r.delta < 0) down++;
    else same++;
  });

  const filtros = [];
  if (opts.agente) filtros.push(`agente=${escapeHtml(opts.agente)}`);
  if (opts.banco) filtros.push(`banco=${escapeHtml(opts.banco)}`);
  if (opts.moneda) filtros.push(`moneda=${escapeHtml(opts.moneda)}`);
  if (opts.soloCambio) filtros.push('solo-cambio');
  const filtStr = filtros.length ? `\nFiltros: ${filtros.join(', ')}\n` : '\n';

  let msg = `<b>Resumen de ${moneda} para periodo ${range.start.format('DD/MM/YYYY')} – ${range.end.clone().subtract(1, 'second').format('DD/MM/YYYY')}</b>${filtStr}`;
  msg += `Total inicio: ${fmtMoney(totalIni)} → Total fin: ${fmtMoney(totalFin)} (Δ ${fmtMoney(totalFin - totalIni)})\n`;
  msg += `Tarjetas: 📈 ${up}  📉 ${down}  ➖ ${same}\n\n`;

  // Tabla principal
  const header = `${pad('Tarjeta', 12)}${pad('Agente', 12)}${pad('Banco', 8)}${pad('Inicio', 12, true)}${pad('Fin', 12, true)}${pad('Δ', 12, true)}${pad('%', 7, true)}${pad('Movs', 6, true)}${pad('Vol', 8, true)}${pad('Estado', 8)}`;
  const lines = [header, '-'.repeat(header.length)];
  const agentOrder = [];
  const agentMap = new Map();
  tableRows.forEach((r) => {
    if (!agentMap.has(r.agente)) {
      agentMap.set(r.agente, []);
      agentOrder.push(r.agente);
    }
    agentMap.get(r.agente).push(r);
  });
  agentOrder.forEach((ag) => {
    lines.push(`———— Agente: ${ag} ————`);
    agentMap.get(ag).forEach((r) => {
      lines.push(
        pad(r.tarjeta, 12) +
          pad(r.agente, 12) +
          pad(r.banco, 8) +
          pad(fmtMoney(r.saldo_ini), 12, true) +
          pad(fmtMoney(r.saldo_fin), 12, true) +
          pad(fmtMoney(r.delta), 12, true) +
          pad(fmtPct(r.pct), 7, true) +
          pad(r.movs, 6, true) +
          pad(fmtMoney(r.vol), 8, true) +
          pad(r.estado, 8)
      );
    });
    lines.push('');
  });
  msg += `<pre>${lines.join('\n')}</pre>`;

  /* ─── Entradas / Salidas netas ───────────────────── */
  let totalIn = 0,
    totalOut = 0;
  rows.forEach((r) => {
    if (r.delta > 0) totalIn += r.delta;
    else if (r.delta < 0) totalOut += Math.abs(r.delta);
  });
  msg += `\n<b>Entradas netas:</b> <code>${fmtMoney(totalIn)}</code>`;
  msg += `\n<b>Salidas netas:</b>  <code>${fmtMoney(totalOut)}</code>\n`;


  // Resumenes por agente y banco
  const resAg = resumenPor(rows, 'agente');
  const resBa = resumenPor(rows, 'banco');
  msg += `\n<b>Resumen por agente</b>\n<pre>`;
  resAg.forEach((val, key) => {
    msg += `${pad(key, 15)}${pad(fmtMoney(val.ini), 12, true)}${pad(fmtMoney(val.fin), 12, true)}${pad(fmtMoney(val.fin - val.ini), 12, true)}\n`;
  });
  msg += `</pre>`;
  msg += `\n<b>Resumen por banco</b>\n<pre>`;
  resBa.forEach((val, key) => {
    msg += `${pad(key, 15)}${pad(fmtMoney(val.ini), 12, true)}${pad(fmtMoney(val.fin), 12, true)}${pad(fmtMoney(val.fin - val.ini), 12, true)}\n`;
  });
  msg += `</pre>`;

  // Historial detallado
  if (opts.historial) {
    msg += `\n<b>Historial detallado</b>`;
    tableRows.forEach((r) => {
      const hist = historiales[r.id];
      if (!hist || !hist.length) return;
      msg += `\n\n<b>Tarjeta ${escapeHtml(r.tarjeta)}</b>`;
      hist.forEach((h) => {
        const fecha = moment(h.creado_en).tz(opts.tz).format('DD/MM HH:mm');
        const delta = h.saldo_nuevo - h.saldo_anterior;
        msg += `\n• ${fecha} ${escapeHtml(h.descripcion || '')} ${fmtMoney(h.saldo_anterior)} → ${fmtMoney(h.saldo_nuevo)} (Δ ${fmtMoney(delta)})`;
      });
    });
  }

  return msg;
}

/* ───────── ejecución principal ───────── */
async function runMonitor(ctx, rawText) {
  console.log('[monitor] argumentos', rawText);
  const inicio = Date.now();
  try {
    const opts = parseArgs(rawText || '');
    console.log('[monitor] opciones', opts);
    const rango = calcRanges(opts.period, opts.tz);

    const params = [rango.start.toDate(), rango.end.toDate()];
    const condiciones = [];
    let idx = params.length;
    if (opts.moneda) {
      params.push(opts.moneda);
      idx++;
      condiciones.push(`unaccent(lower(m.codigo)) = unaccent(lower($${idx}))`);
    }
    if (opts.agente) {
      params.push(`%${opts.agente}%`);
      idx++;
      condiciones.push(`unaccent(lower(ag.nombre)) LIKE unaccent(lower($${idx}))`);
    }
    if (opts.banco) {
      params.push(`%${opts.banco}%`);
      idx++;
      condiciones.push(`unaccent(lower(b.codigo || ' ' || b.nombre)) LIKE unaccent(lower($${idx}))`);
    }

    let sql = SQL_BASE;
    if (condiciones.length) sql += ' WHERE ' + condiciones.join(' AND ');
    console.log('[monitor] parámetros de consulta', params);

    const { rows } = await query(sql, params);
    let datos = rows.map((r) => {
      const saldo_ini = parseFloat(r.saldo_ini) || 0;
      const saldo_fin = parseFloat(r.saldo_fin) || 0;
      const delta = saldo_fin - saldo_ini;
      const pct = saldo_ini !== 0 ? (delta / saldo_ini) * 100 : null;
      return {
        id: r.id,
        tarjeta: r.numero,
        banco: r.banco_codigo || r.banco_nombre || '—',
        agente: r.agente || '—',
        moneda: r.moneda || '—',
        saldo_ini,
        saldo_fin,
        delta,
        pct,
        movs: parseFloat(r.movs || 0),
        n_up: parseFloat(r.n_up || 0),
        n_down: parseFloat(r.n_down || 0),
        vol: parseFloat(r.vol || 0),
        estado: estadoEmoji(delta, pct, r.n_up, r.n_down),
      };
    });

    if (opts.soloCambio) {
      datos = datos.filter((d) => d.delta !== 0 || d.movs > 0);
    }

    if (!datos.length) {
      await ctx.reply('No se encontraron datos para ese periodo con los filtros indicados.');
      return;
    }

    // Historiales
    const historiales = {};
    if (opts.historial) {
      const ids = datos.filter((d) => d.movs > 0).map((d) => d.id);
      if (ids.length) {
        const histSql = `SELECT tarjeta_id, creado_en, descripcion, saldo_anterior, importe, saldo_nuevo
                           FROM movimiento
                          WHERE tarjeta_id = ANY($1) AND creado_en >= $2 AND creado_en < $3
                          ORDER BY tarjeta_id, creado_en ASC`;
        const histRes = await query(histSql, [ids, rango.start.toDate(), rango.end.toDate()]);
        histRes.rows.forEach((h) => {
          if (!historiales[h.tarjeta_id]) historiales[h.tarjeta_id] = [];
          historiales[h.tarjeta_id].push(h);
        });
      }
    }

    // Agrupar por moneda
    const porMoneda = new Map();
    datos.forEach((d) => {
      if (!porMoneda.has(d.moneda)) porMoneda.set(d.moneda, []);
      porMoneda.get(d.moneda).push(d);
    });

    for (const [mon, lista] of porMoneda.entries()) {
      const msg = buildMessage(mon, lista, opts, rango, historiales);
      await sendChunks(ctx, msg);
    }
    console.log(`[monitor] proceso completado en ${Date.now() - inicio}ms`);
  } catch (err) {
    console.error('[monitor] error', err);
    try {
      await ctx.reply('⚠️ Ocurrió un error al generar el monitoreo.');
    } catch (e) {}
  }
}

module.exports = { runMonitor };

// Comentarios de modificaciones:
// - Se implementó el comando /monitor con soporte de rangos (día, semana, mes, año).
// - Se añadieron filtros (--historial, --solo-cambio, --agente, --banco, --moneda, --tz, --limite, --orden).
// - Se utiliza moment-timezone fijado a America/Havana por defecto.
// - Se generan resúmenes por moneda, agente y banco en formato HTML.
// - Se incluyó manejo de tildes y eñes al parsear argumentos.
// - Se agregó historial detallado opcional por tarjeta.
// - Se añadieron logs prefijados [monitor] y manejo de errores en español.

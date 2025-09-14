// commands/monitor.js
// Implementación avanzada del comando /monitor para Telegraf.
// Genera un monitoreo financiero por tarjeta agrupando por moneda y agente.
// Asegúrate de tener la extensión unaccent instalada:
//   CREATE EXTENSION IF NOT EXISTS unaccent;

const moment = require('moment-timezone');
const path = require('path');
// Migrado a HTML parse mode con sanitización centralizada en escapeHtml.
const { escapeHtml, fmtMoney, boldHeader } = require('../helpers/format');
const { getDefaultPeriod } = require('../helpers/period');
const { buildEntityFilter } = require('../helpers/filters');
const { sendLargeMessage } = require('../helpers/sendLargeMessage');

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
    period: getDefaultPeriod(),
    historial: false,
    soloCambio: false,
    agente: null,
    banco: null,
    moneda: null,
    tz: 'America/Havana',
    limite: 30,
    orden: 'delta',
    fecha: null,
    mes: null,
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
        case '--fecha':
          opts.fecha = val;
          break;
        case '--mes':
          opts.mes = val;
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

function calcRanges(period, tz, fecha, mes) {
  if (fecha) {
    const d = moment.tz(fecha, tz);
    return { start: d.startOf('day'), end: d.endOf('day') };
  }
  if (mes) {
    const m = moment.tz(mes, 'YYYY-MM', tz);
    return { start: m.startOf('month'), end: m.endOf('month') };
  }
  const now = moment.tz(tz);
  let start;
  switch (period) {
    case 'semana':
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
  const end = now.clone().endOf('day');
  let prevStart;
  if (period === 'semana') prevStart = start.clone().subtract(7, 'days');
  else if (period === 'mes') prevStart = start.clone().subtract(1, 'month');
  else if (period === 'ano') prevStart = start.clone().subtract(1, 'year');
  else prevStart = start.clone().subtract(1, 'day');
  const prevEnd = start.clone();
  return { start, end, prevStart, prevEnd };
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

/* ───────── SQL base v2 (saldos del período + globales) ───────── */
const SQL_BASE = `
WITH movs AS (
  SELECT mv.tarjeta_id,
         COUNT(*) FILTER (WHERE mv.importe <> 0)                  AS movs,
         COUNT(*) FILTER (WHERE mv.importe > 0)                   AS n_up,
         COUNT(*) FILTER (WHERE mv.importe < 0)                   AS n_down,
         SUM(ABS(mv.importe))                                    AS vol
    FROM movimiento mv
   WHERE mv.creado_en >= $1 AND mv.creado_en < $2
     AND mv.descripcion NOT ILIKE '%saldo inicial%'
   GROUP BY mv.tarjeta_id
),
ini_total AS ( -- saldo inicial histórico
  SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo AS saldo_ini_total
    FROM movimiento
   ORDER BY tarjeta_id, creado_en ASC
),
fin_total AS ( -- saldo actual
  SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo AS saldo_fin_total
    FROM movimiento
   ORDER BY tarjeta_id, creado_en DESC
),
ini_per AS (  -- saldo justo antes del comienzo del período
  SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo AS saldo_ini_period
    FROM movimiento
   WHERE creado_en < $1
   ORDER BY tarjeta_id, creado_en DESC
),
fin_per AS (  -- saldo al cierre del período
  SELECT DISTINCT ON (tarjeta_id) tarjeta_id, saldo_nuevo AS saldo_fin_period
    FROM movimiento
   WHERE creado_en >= $1 AND creado_en < $2
   ORDER BY tarjeta_id, creado_en DESC
)
SELECT t.id, t.numero,
       b.codigo AS banco_codigo, b.nombre AS banco_nombre,
       ag.nombre AS agente, m.codigo AS moneda,
       COALESCE(m.tasa_usd,1)                                   AS tasa_usd,
       COALESCE(ini_total.saldo_ini_total,0)                    AS saldo_ini_total,
       COALESCE(fin_total.saldo_fin_total,0)                    AS saldo_fin_total,
       COALESCE(ini_per.saldo_ini_period,
                ini_total.saldo_ini_total,0)                    AS saldo_ini_period,
       COALESCE(fin_per.saldo_fin_period,
                ini_per.saldo_ini_period,
                ini_total.saldo_ini_total,0)                    AS saldo_fin_period,
       COALESCE(movs.movs,0)                                    AS movs,
       COALESCE(movs.n_up,0)                                    AS n_up,
       COALESCE(movs.n_down,0)                                  AS n_down,
       COALESCE(movs.vol,0)                                     AS vol
  FROM tarjeta t
  JOIN banco  b ON b.id = t.banco_id
  JOIN agente ag ON ag.id = t.agente_id
  JOIN moneda m ON m.id = t.moneda_id
  LEFT JOIN ini_total ON ini_total.tarjeta_id = t.id
  LEFT JOIN fin_total ON fin_total.tarjeta_id = t.id
  LEFT JOIN ini_per   ON ini_per.tarjeta_id   = t.id
  LEFT JOIN fin_per   ON fin_per.tarjeta_id   = t.id
  LEFT JOIN movs      ON movs.tarjeta_id      = t.id
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

  let totalIniPer = 0,
    totalFinPer = 0,
    totalIniTot = 0,
    totalFinTot = 0,
    totalUsd = 0,
    up = 0,
    down = 0,
    same = 0,
    totalPos = 0,
    totalNeg = 0,
    totalPosUsd = 0,
    totalNegUsd = 0;
  rows.forEach((r) => {
    totalIniPer += r.saldo_ini;
    totalFinPer += r.saldo_fin;
    totalIniTot += r.saldo_ini_total;
    totalFinTot += r.saldo_fin_total;
    totalUsd += r.delta_usd;
    if (r.delta > 0) up++;
    else if (r.delta < 0) down++;
    else same++;
    if (r.saldo_fin > 0) {
      totalPos += r.saldo_fin;
      totalPosUsd += r.saldo_fin_usd;
    } else if (r.saldo_fin < 0) {
      totalNeg += Math.abs(r.saldo_fin);
      totalNegUsd += Math.abs(r.saldo_fin_usd);
    }
  });

  const filtros = [];
  if (opts.agente) filtros.push(`agente=${escapeHtml(opts.agente)}`);
  if (opts.banco) filtros.push(`banco=${escapeHtml(opts.banco)}`);
  if (opts.moneda) filtros.push(`moneda=${escapeHtml(opts.moneda)}`);
  if (opts.soloCambio) filtros.push('solo-cambio');
  const filtStr = filtros.length ? `Filtros: ${filtros.join(', ')}\n` : '';

  let msg =
    `${boldHeader('📊', 'Monitor')}\n` +
    `Moneda: <b>${escapeHtml(moneda)}</b>\n` +
    `Periodo: <b>${range.start.format('DD/MM/YYYY')} – ${range.end.clone().subtract(1, 'second').format('DD/MM/YYYY')}</b>\n` +
    filtStr +
    `\n`;
  const deltaPer   = totalFinPer - totalIniPer;
  const emojiPer   = deltaPer > 0 ? '📈' : deltaPer < 0 ? '📉' : '➖';
  msg +=
    `Saldo inicio (período): <code>${fmtMoney(totalIniPer)}</code> → Saldo fin (período): <code>${fmtMoney(totalFinPer)}</code> (Δ <code>${(deltaPer >= 0 ? '+' : '') + fmtMoney(deltaPer)}</code>) ${emojiPer}\n`;

  const deltaTot   = totalFinTot - totalIniTot;
  const emojiTot   = deltaTot > 0 ? '📈' : deltaTot < 0 ? '📉' : '➖';
  msg +=
    `Saldo inicio (histórico): <code>${fmtMoney(totalIniTot)}</code> → Saldo actual: <code>${fmtMoney(totalFinTot)}</code> (Δ <code>${(deltaTot >= 0 ? '+' : '') + fmtMoney(deltaTot)}</code>) ${emojiTot} (equiv. <code>${fmtMoney(totalUsd)}</code> USD)\n`;
  msg += `Tarjetas: 📈 ${up}  📉 ${down}  ➖ ${same}\n\n`;

  // Tabla principal
  const header = `${pad('Tarjeta', 12)}${pad('Agente', 12)}${pad('Banco', 8)}${pad('Inicio', 12, true)}${pad('Fin', 12, true)}${pad('Δ', 12, true)}${pad('Δ USD', 10, true)}${pad('%', 7, true)}${pad('Movs', 6, true)}${pad('Vol', 8, true)}${pad('Estado', 8)}`;
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
          pad((r.delta >= 0 ? '+' : '') + fmtMoney(r.delta), 12, true) +
          pad((r.delta_usd >= 0 ? '+' : '') + fmtMoney(r.delta_usd), 10, true) +
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
  msg += `\n<b>Salidas netas:</b>  <code>${fmtMoney(totalOut)}</code>`;

  /* ─── Saldos totales ────────────────────────────── */
  const neto = totalPos - totalNeg;
  const netoUsd = totalPosUsd - totalNegUsd;
  msg += `\n<b>Saldo positivo total:</b> <code>${fmtMoney(totalPos)}</code> (equiv. <code>${fmtMoney(totalPosUsd)}</code> USD)`;
  msg += `\n<b>Saldo negativo total:</b> <code>${fmtMoney(totalNeg)}</code> (equiv. <code>${fmtMoney(totalNegUsd)}</code> USD)`;
  msg += `\n<b>Diferencia:</b> <code>${(neto >= 0 ? '+' : '') + fmtMoney(neto)}</code> (equiv. <code>${(netoUsd >= 0 ? '+' : '') + fmtMoney(netoUsd)}</code> USD)\n`;


  // Resumenes por agente y banco
  const resAg = resumenPor(rows, 'agente');
  const resBa = resumenPor(rows, 'banco');
  msg += `\n<b>Resumen por agente</b>\n<pre>`;
  resAg.forEach((val, key) => {
    const delta = val.fin - val.ini;
    const em = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
    msg += `${pad(key, 15)}${pad(fmtMoney(val.ini), 12, true)}${pad(fmtMoney(val.fin), 12, true)}${pad((delta >= 0 ? '+' : '') + fmtMoney(delta), 12, true)} ${em}\n`;
  });
  msg += `</pre>`;
  msg += `\n<b>Resumen por banco</b>\n<pre>`;
  resBa.forEach((val, key) => {
    const delta = val.fin - val.ini;
    const em = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';
    msg += `${pad(key, 15)}${pad(fmtMoney(val.ini), 12, true)}${pad(fmtMoney(val.fin), 12, true)}${pad((delta >= 0 ? '+' : '') + fmtMoney(delta), 12, true)} ${em}\n`;
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
        msg += `\n• ${fecha} ${escapeHtml(h.descripcion || '')} ${fmtMoney(h.saldo_anterior)} → ${fmtMoney(h.saldo_nuevo)} (Δ ${(delta >= 0 ? '+' : '') + fmtMoney(delta)})`;
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
    const rango = calcRanges(opts.period, opts.tz, opts.fecha, opts.mes);

    const params = [rango.start.toDate(), rango.end.toDate()];
    const condiciones = [];
    if (opts.moneda) {
      const c = await buildEntityFilter('m', opts.moneda, params, 'id', ['codigo', 'nombre']);
      if (c) condiciones.push(c);
    }
    if (opts.agente) {
      const c = await buildEntityFilter('ag', opts.agente, params, 'id', ['nombre']);
      if (c) condiciones.push(c);
    }
    if (opts.banco) {
      const c = await buildEntityFilter('b', opts.banco, params, 'id', ['codigo', 'nombre']);
      if (c) condiciones.push(c);
    }

    let sql = SQL_BASE;
    if (condiciones.length) sql += ' WHERE ' + condiciones.join(' AND ');
    console.log('[monitor] parámetros de consulta', params);

    const { rows } = await query(sql, params);
    let datos = rows.map((r) => {
      const saldo_ini  = parseFloat(r.saldo_ini_period) || 0;   // período
      const saldo_fin  = parseFloat(r.saldo_fin_period) || saldo_ini;
      const delta      = saldo_fin - saldo_ini;                 // Δ período
      const delta_total = (parseFloat(r.saldo_fin_total)||0) -
                          (parseFloat(r.saldo_ini_total)||0);   // Δ histórico
      const tasa = parseFloat(r.tasa_usd) || 1;
      const delta_usd = delta * tasa;
      const saldo_fin_usd = saldo_fin * tasa;
      const pct = saldo_ini !== 0 ? (delta / saldo_ini) * 100 : null;
      return {
        id: r.id,
        tarjeta: r.numero,
        banco: r.banco_codigo || r.banco_nombre || '—',
        agente: r.agente || '—',
        moneda: r.moneda || '—',
        saldo_ini,
        saldo_fin,
        saldo_ini_total: parseFloat(r.saldo_ini_total) || 0,
        saldo_fin_total: parseFloat(r.saldo_fin_total) || 0,
        delta,             // período
        delta_total,       // histórico
        delta_usd,
        saldo_fin_usd,
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
      console.warn('[monitor] consulta sin resultados; verificando filtros individuales');
      if (opts.agente) {
        const ap = [];
        const clause = await buildEntityFilter('ag', opts.agente, ap, 'id', ['nombre']);
        const r = await query(`SELECT COUNT(*) AS c FROM agente ag WHERE ${clause}`, ap);
        console.warn(`[monitor] agentes coincidentes para "${opts.agente}":`, r.rows[0]?.c || 0);
      }
      if (opts.banco) {
        const bp = [];
        const clause = await buildEntityFilter('b', opts.banco, bp, 'id', ['codigo', 'nombre']);
        const r = await query(`SELECT COUNT(*) AS c FROM banco b WHERE ${clause}`, bp);
        console.warn(`[monitor] bancos coincidentes para "${opts.banco}":`, r.rows[0]?.c || 0);
      }
      if (opts.moneda) {
        const mp = [];
        const clause = await buildEntityFilter('m', opts.moneda, mp, 'id', ['codigo', 'nombre']);
        const r = await query(`SELECT COUNT(*) AS c FROM moneda m WHERE ${clause}`, mp);
        console.warn(`[monitor] monedas coincidentes para "${opts.moneda}":`, r.rows[0]?.c || 0);
      }
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

    const allMsgs = [];
    for (const [mon, lista] of porMoneda.entries()) {
      const msg = buildMessage(mon, lista, opts, rango, historiales);
      allMsgs.push(msg);
      await sendLargeMessage(ctx, [msg]);
    }
    console.log(`[monitor] proceso completado en ${Date.now() - inicio}ms`);
    return allMsgs;
  } catch (err) {
    console.error('[monitor] error', err);
    try {
      await ctx.reply('⚠️ Ocurrió un error al generar el monitoreo.');
    } catch (e) {}
  }
}

module.exports = { runMonitor, parseArgs, calcRanges };

// Comentarios de modificaciones:
// - Se implementó el comando /monitor con soporte de rangos (día, semana, mes, año).
// - Se añadieron filtros (--historial, --solo-cambio, --agente, --banco, --moneda, --tz, --limite, --orden).
// - Se utiliza moment-timezone fijado a America/Havana por defecto.
// - Se generan resúmenes por moneda, agente y banco en formato HTML.
// - Se incluyó manejo de tildes y eñes al parsear argumentos.
// - Se agregó historial detallado opcional por tarjeta.
// - Se añadieron logs prefijados [monitor] y manejo de errores en español.
// ✔ probado con tarjeta 5278

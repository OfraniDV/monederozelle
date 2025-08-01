// Lista de tarjetas con saldo actual
const { Markup } = require('telegraf');
const pool = require('../psql/db.js');

module.exports = bot => {
  bot.command('tarjetas', async ctx => {
    try {
      const q = `
        SELECT t.id, t.numero,
               a.nombre   AS agente,
               b.codigo   AS banco,
               m.codigo   AS moneda,
               COALESCE(mv.saldo_nuevo,0) AS saldo
        FROM tarjeta t
        LEFT JOIN agente a  ON a.id = t.agente_id
        LEFT JOIN banco  b  ON b.id = t.banco_id
        LEFT JOIN moneda m  ON m.id = t.moneda_id
        LEFT JOIN LATERAL (
          SELECT saldo_nuevo
          FROM movimiento
          WHERE tarjeta_id = t.id
          ORDER BY creado_en DESC
          LIMIT 1
        ) mv ON true
        ORDER BY a.nombre, t.numero;`;
      const rows = (await pool.query(q)).rows;
      if (!rows.length) {
        return ctx.reply('No hay tarjetas registradas todavía.');
      }

      const txt = rows.map(r =>
        `• ${r.numero}  – ${r.agente || '—'}  – ${r.banco || 'sin banco'}  – ${r.moneda}  ⇒ saldo: ${r.saldo}`
      ).join('\n');

      await ctx.reply(`📄 Tarjetas y saldos actuales:\n${txt}`);
    } catch (e) {
      console.error('[tarjetas] error:', e);
      ctx.reply('❌ Error al listar tarjetas.');
    }
  });
};

// tests/filterConsistency.test.js
require('dotenv').config({ path: './.env.test' });
const { query } = require('../psql/db');
const { buildEntityFilter } = require('../helpers/filters');

async function testEntity(table, alias, id, name, idField = 'id', nameFields = ['nombre']) {
  let params = [];
  const clauseId = await buildEntityFilter(alias, String(id), params, idField, nameFields);
  const byId = await query(`SELECT ${idField} FROM ${table} ${alias} WHERE ${clauseId}`, params);
  params = [];
  const clauseName = await buildEntityFilter(alias, name, params, idField, nameFields);
  const byName = await query(`SELECT ${idField} FROM ${table} ${alias} WHERE ${clauseName}`, params);
  expect(byId.rows[0][idField]).toBe(byName.rows[0][idField]);
}

describe('consistencia de filtros', () => {
  it('agente por id/nombre', async () => {
    const ag = await query('SELECT id,nombre FROM agente LIMIT 1');
    if (!ag.rows.length) return;
    const { id, nombre } = ag.rows[0];
    await testEntity('agente', 'ag', id, nombre);
  });

  it('banco por id/código', async () => {
    const bn = await query('SELECT id,codigo FROM banco LIMIT 1');
    if (!bn.rows.length) return;
    const { id, codigo } = bn.rows[0];
    await testEntity('banco', 'b', id, codigo, 'id', ['codigo', 'nombre']);
  });

  it('moneda por id/código', async () => {
    const mn = await query('SELECT id,codigo FROM moneda LIMIT 1');
    if (!mn.rows.length) return;
    const { id, codigo } = mn.rows[0];
    await testEntity('moneda', 'm', id, codigo, 'id', ['codigo', 'nombre']);
  });
});

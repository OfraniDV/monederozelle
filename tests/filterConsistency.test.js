const assert = require('assert');
const { query } = require('../src/psql/db');
const { buildEntityFilter } = require('../src/helpers/filters');

async function testEntity(table, alias, id, name, idField = 'id', nameFields = ['nombre']) {
  let params = [];
  const clauseId = await buildEntityFilter(alias, String(id), params, idField, nameFields);
  const byId = await query(`SELECT ${idField} FROM ${table} ${alias} WHERE ${clauseId}`, params);
  params = [];
  const clauseName = await buildEntityFilter(alias, name, params, idField, nameFields);
  const byName = await query(`SELECT ${idField} FROM ${table} ${alias} WHERE ${clauseName}`, params);
  assert.strictEqual(byId.rows[0][idField], byName.rows[0][idField]);
}

async function run() {
  const ag = await query('SELECT id,nombre FROM agente LIMIT 1');
  if (ag.rows.length) {
    const { id, nombre } = ag.rows[0];
    await testEntity('agente', 'ag', id, nombre);
    console.log('✓ agente por id/nombre');
  } else {
    console.warn('⚠️ sin agentes, prueba omitida');
  }

  const bn = await query('SELECT id,codigo FROM banco LIMIT 1');
  if (bn.rows.length) {
    const { id, codigo } = bn.rows[0];
    await testEntity('banco', 'b', id, codigo, 'id', ['codigo', 'nombre']);
    console.log('✓ banco por id/código');
  } else {
    console.warn('⚠️ sin bancos, prueba omitida');
  }

  const mn = await query('SELECT id,codigo FROM moneda LIMIT 1');
  if (mn.rows.length) {
    const { id, codigo } = mn.rows[0];
    await testEntity('moneda', 'm', id, codigo, 'id', ['codigo', 'nombre']);
    console.log('✓ moneda por id/código');
  } else {
    console.warn('⚠️ sin monedas, prueba omitida');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed', err);
    process.exit(1);
  });

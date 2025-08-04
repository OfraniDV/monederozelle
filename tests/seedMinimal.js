const { readFileSync } = require('fs');
const { query } = require('../psql/db');

module.exports = async function seedMinimal() {
  const sql = readFileSync(__dirname + '/seedMinimal.sql', 'utf8');
  await query(sql);
};


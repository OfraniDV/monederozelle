require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_URL,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

module.exports = pool;

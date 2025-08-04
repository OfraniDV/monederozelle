// psql/seedMinimal.js
// Semillas mínimas para pruebas. Inserta un registro por tabla clave
// usando ON CONFLICT para que sea idempotente.

const { query } = require('./db');

const seedMinimal = async () => {
  await query(
    "INSERT INTO moneda (codigo, nombre, tasa_usd, emoji) VALUES ('USD','Dólar',1,'$') ON CONFLICT (codigo) DO NOTHING;"
  );
  await query(
    "INSERT INTO banco (codigo, nombre, emoji) VALUES ('default','Banco Default','🏦') ON CONFLICT (codigo) DO NOTHING;"
  );
  await query(
    "INSERT INTO agente (nombre, emoji) VALUES ('agente_demo','👤') ON CONFLICT (nombre) DO NOTHING;"
  );
  console.log('🌱 semillas mínimas aplicadas');
};

module.exports = seedMinimal;


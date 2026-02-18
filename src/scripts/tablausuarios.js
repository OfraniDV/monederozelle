const pool = require('../psql/db.js');

const crearTablaUsuarios = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS usuarios (
        user_id BIGINT PRIMARY KEY,
        fecha TIMESTAMP DEFAULT NOW()
      );
    `;

    await pool.query(query);
    console.log("Tabla 'usuarios' creada con éxito.");
  } catch (err) {
    console.error('Error al crear la tabla usuarios:', err);
  }
};

module.exports = crearTablaUsuarios;

if (require.main === module) {
  crearTablaUsuarios().catch((e) => {
    console.error(e);
    process.exit(1);
  }).then(() => process.exit(0));
}

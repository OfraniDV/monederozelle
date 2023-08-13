// usuariosconacceso.js

const pool = require('../psql/db.js');

const agregarUsuario = async (user_id) => {
  try {
    const query = `
      INSERT INTO usuarios (user_id, fecha)
      VALUES ($1, NOW());
    `;

    await pool.query(query, [user_id]);
    console.log(`Usuario con ID ${user_id} agregado a la tabla 'usuarios'.`);
  } catch (err) {
    console.error(`Error al agregar el usuario con ID ${user_id}:`, err);
  }
};

const eliminarUsuario = async (user_id) => {
  try {
    const query = `
      DELETE FROM usuarios
      WHERE user_id = $1;
    `;

    await pool.query(query, [user_id]);
    console.log(`Usuario con ID ${user_id} eliminado de la tabla 'usuarios'.`);
  } catch (err) {
    console.error(`Error al eliminar el usuario con ID ${user_id}:`, err);
  }
};

const usuarioExiste = async (user_id) => {
    try {
      const query = `
        SELECT 1
        FROM usuarios
        WHERE user_id = $1;
      `;
  
      const result = await pool.query(query, [user_id]);
  
      if (result.rowCount > 0) {
        return true;
      } else {
        return false;
      }
    } catch (err) {
      console.error(`Error al verificar la existencia del usuario con ID ${user_id}:`, err);
      return false;
    }
  };
  
  module.exports = {
    agregarUsuario,
    eliminarUsuario,
    usuarioExiste
  };

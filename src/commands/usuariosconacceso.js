// commands/usuariosconacceso.js
// -----------------------------------------------------------------------------
// Funciones de acceso a la tabla `usuarios`.
// Se documentan con JSDoc para facilitar su mantenimiento.

const pool = require('../psql/db.js');

/**
 * Agrega un usuario a la tabla de control de accesos.
 * @param {string|number} user_id Identificador numérico de Telegram.
 */
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

/**
 * Elimina un usuario de la tabla de control de accesos.
 * @param {string|number} user_id Identificador numérico de Telegram.
 */
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

/**
 * Verifica si un usuario ya tiene acceso registrado.
 * @param {string|number} user_id Identificador numérico de Telegram.
 * @returns {Promise<boolean>} true si existe, false en caso contrario.
 */
const usuarioExiste = async (user_id) => {
  try {
    const query = `
      SELECT 1
        FROM usuarios
       WHERE user_id = $1;
    `;
    const result = await pool.query(query, [user_id]);
    return result.rowCount > 0;
  } catch (err) {
    console.error(`Error al verificar la existencia del usuario con ID ${user_id}:`, err);
    return false;
  }
};

/**
 * Devuelve todos los usuarios con acceso registrado.
 * @returns {Promise<Array<{user_id: string}>>} Listado de IDs.
 */
const listarUsuarios = async () => {
  try {
    const { rows } = await pool.query('SELECT user_id FROM usuarios ORDER BY fecha');
    return rows;
  } catch (err) {
    console.error('Error al listar usuarios con acceso:', err);
    return [];
  }
};

module.exports = {
  agregarUsuario,
  eliminarUsuario,
  usuarioExiste,
  listarUsuarios,
};

// helpers/filters.js
// -----------------------------------------------------------------------------
// Utilidades para construir filtros parametrizados por entidad (agente, banco,
// moneda, etc.).  Normaliza textos con unaccent+lower si la extensión está
// disponible; de lo contrario, recurre a lower() y emite una advertencia.
// Detecta si el valor provisto es un ID numérico para usar comparaciones por
// clave foránea en lugar de LIKE sobre nombres.
// -----------------------------------------------------------------------------

const { query } = require('../psql/db');

let hasUnaccent = null;

async function checkUnaccent() {
  if (hasUnaccent !== null) return;
  try {
    await query("SELECT 1 FROM pg_extension WHERE extname='unaccent'");
    hasUnaccent = true;
  } catch (err) {
    hasUnaccent = false;
    console.warn(
      '[filters] Extensión unaccent no disponible. Ejecuta "CREATE EXTENSION unaccent;" para obtener comparaciones sin acentos.'
    );
  }
}

function normExpr(expr) {
  return hasUnaccent ? `unaccent(lower(${expr}))` : `lower(${expr})`;
}

/**
 * Construye una condición SQL parametrizada para una entidad.
 * @param {string} alias       Alias de la tabla en la consulta.
 * @param {string|number} val  Valor de filtro (ID numérico o nombre).
 * @param {Array} params       Arreglo donde se acumulan los parámetros.
 * @param {string} idField     Columna de ID (por defecto 'id').
 * @param {string[]} nameFields Columnas de texto a comparar si val no es numérico.
 * @returns {Promise<string|null>}  Condición lista para el WHERE o null si no aplica.
 */
async function buildEntityFilter(alias, val, params, idField = 'id', nameFields = ['nombre']) {
  if (!val) return null;
  await checkUnaccent();
  const value = String(val).trim();
  if (/^\d+$/.test(value)) {
    params.push(parseInt(value, 10));
    return `${alias}.${idField} = $${params.length}`;
  }
  params.push(`%${value}%`);
  const idx = params.length;
  const parts = nameFields.map(
    (f) => `${normExpr(`${alias}.${f}`)} LIKE ${normExpr(`$${idx}`)}`
  );
  return `(${parts.join(' OR ')})`;
}

module.exports = { buildEntityFilter, checkUnaccent, normExpr };

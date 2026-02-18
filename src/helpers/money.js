'use strict';

/**
 * Helpers de montos / dinero reutilizables.
 *
 * Objetivo principal:
 * - Interpretar correctamente montos introducidos por el usuario en distintos formatos:
 *   "1000"       -> 1000
 *   "1,000"      -> 1000
 *   "1,000.50"   -> 1000.5
 *   "12,345.67"  -> 12345.67
 *   "1.000,50"   -> 1000.5
 *   "12.345,67"  -> 12345.67
 *   "1000,50"    -> 1000.5
 *   "0,00"       -> 0
 *   "  1 000  "  -> 1000
 *
 * - Devolver NaN cuando el valor no sea numérico (ej: "abc", "10a", etc.)
 *
 * Uso típico:
 *   const { parseUserAmount } = require('../helpers/money');
 *   const num = parseUserAmount(ctx.message?.text);
 *   if (!Number.isFinite(num)) { ... manejar error ... }
 */

/**
 * Normaliza un string de monto a un formato compatible con Number().
 *
 * NO convierte a número, solo devuelve un string como:
 *   "1000.50", "12345", etc.
 *
 * Retorna:
 *   - string normalizado, o
 *   - null si no hay nada que parsear.
 */
function normalizeAmountString(raw) {
  if (raw === null || raw === undefined) return null;

  let s = String(raw).trim();
  if (!s) return null;

  // Quitar espacios internos (por si alguien pone "1 000,50")
  s = s.replace(/\s+/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Hay coma y punto: decidir quién es miles y quién es decimal
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastDot > lastComma) {
      // Caso tipo "1,000.50" o "12,345.67"
      // → comas = miles, punto = decimal
      //   "1,000.50" -> "1000.50"
      s = s.replace(/,/g, '');
    } else {
      // Caso tipo "1.000,50" o "12.345,67"
      // → puntos = miles, coma = decimal
      //   "1.000,50" -> "1000,50" -> "1000.50"
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma && !hasDot) {
    // Solo coma: puede ser miles ("1,000") o decimal ("1000,50")

    const parts = s.split(',');
    // Si hay exactamente una coma y después hay 3 dígitos, y todo son dígitos -> miles
    if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      /^[0-9]+$/.test(parts[0] + parts[1])
    ) {
      // "1,000" -> "1000"
      s = parts[0] + parts[1];
    } else {
      // En otro caso, tratamos la coma como separador decimal
      // "1000,50" -> "1000.50"
      s = s.replace(',', '.');
    }
  }
  // Si solo tiene punto o no tiene nada, lo dejamos tal cual

  return s;
}

/**
 * Convierte la entrada del usuario a número (float) interpretando miles/decimales.
 *
 * - Acepta number, string, null/undefined.
 * - Si recibe un number finito, lo devuelve tal cual.
 * - Si recibe string, usa normalizeAmountString y luego Number().
 * - Si el resultado no es un número finito, devuelve NaN.
 */
function parseUserAmount(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : NaN;
  }

  const normalized = normalizeAmountString(raw);
  if (normalized === null) return NaN;

  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Versión pensada para configs / .env:
 * - Intenta parsear con parseUserAmount.
 * - Si falla, devuelve el fallback.
 *
 * Ejemplo:
 *   const cupCushion = parseNumberFromEnv(process.env.ADVISOR_CUSHION_CUP, 0);
 */
function parseNumberFromEnv(value, fallback = 0) {
  const n = parseUserAmount(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  normalizeAmountString,
  parseUserAmount,
  parseNumberFromEnv,
};

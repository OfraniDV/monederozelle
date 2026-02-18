# /configfondo (asistente)

## Descripción
Asistente administrativo para configurar parámetros del Asesor de Fondo desde base de datos, sin editar `.env` manualmente.

## Parámetros editables
- `ADVISOR_CUSHION_CUP`
- `ADVISOR_SELL_RATE_CUP_PER_USD`
- `ADVISOR_MIN_SELL_USD`
- `LIMIT_MONTHLY_DEFAULT_CUP`
- `LIMIT_MONTHLY_BPA_CUP`
- `LIMIT_EXTENDABLE_BANKS`

## Flujo
1. Muestra el valor efectivo de cada clave y su fuente (`DB` o `.env`).
2. Permite seleccionar una clave desde botones inline.
3. El operador escribe el nuevo valor y se guarda en `advisor_setting`.
4. El botón `🗑 Usar valor de .env` elimina el override en DB para esa clave.

## Fallback
- Si no existe fila en `advisor_setting`, se usa el valor de `.env`.
- Si la tabla `advisor_setting` no existe, el sistema mantiene comportamiento con `.env`.

## Implementación
- `src/commands/fondo_config_assist.js`
- `src/helpers/advisorSettings.js`
- `src/middlewares/fondoAdvisor.js`

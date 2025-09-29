# /monedas

## Descripción
Wizard para administrar monedas soportadas por el sistema. Permite crear nuevas monedas con código, nombre, tasa USD y emoji, así como editar o eliminar las existentes mediante botones inline.【F:commands/moneda.js†L1-L200】

## Flujo principal
1. `/monedas` lista todas las monedas registradas, ofreciendo botones para editar, eliminar o añadir nuevas cuando la tabla está vacía.【F:commands/moneda.js†L182-L207】
2. `MONEDA_CREATE_WIZ` solicita código, nombre, unidades equivalentes a 1 USD (convertidas a `tasa_usd`) y un emoji opcional, guardando los datos con `INSERT`.【F:commands/moneda.js†L42-L107】
3. `MONEDA_EDIT_WIZ` carga la moneda seleccionada, permite actualizar código, nombre, tasa y emoji, y persiste cambios mediante `UPDATE`.【F:commands/moneda.js†L113-L172】
4. Los botones de eliminación piden confirmación y, al aceptar, borran la moneda de la tabla. El botón `↩️ Cancelar` y comandos `/cancel`/`salir` cierran cualquier wizard activo.【F:commands/moneda.js†L5-L37】【F:commands/moneda.js†L200-L230】

## Entradas relevantes
- Textos introducidos por el operador durante los wizards y callbacks `MONEDA_EDIT_*` / `MONEDA_DEL_*` generados desde la lista.【F:commands/moneda.js†L42-L230】

## Salidas
- Mensajes de confirmación (creada/actualizada/eliminada) o errores de validación, además de la lista formateada de monedas disponibles.【F:commands/moneda.js†L42-L230】

## Dependencias
- Utiliza el pool PostgreSQL (`psql/db.js`) para `INSERT`, `UPDATE`, `DELETE` y `SELECT`, junto con `Telegraf` (`Scenes`, `Markup`) para construir wizards y teclados inline.【F:commands/moneda.js†L1-L230】

# /bancos

## Descripción
Wizard multi-paso que permite crear, editar y eliminar bancos asociados a tarjetas, incluyendo código, nombre y emoji identificador. Gestiona botones inline para listar registros y maneja cancelaciones globales.【F:commands/banco.js†L1-L210】

## Flujo principal
1. `/bancos` lista todos los bancos registrados, muestra botones para editar/eliminar cada fila, ofrece la acción “Añadir banco” y agrega un botón `❌ Salir` permanente junto al recordatorio de que también se puede escribir “salir”.【F:commands/banco.js†L142-L203】
2. `BANCO_CREATE_WIZ` solicita código, nombre y emoji, guardándolos mediante `INSERT ... ON CONFLICT DO UPDATE` para permitir reusos.【F:commands/banco.js†L33-L79】
3. `BANCO_EDIT_WIZ` precarga el banco seleccionado, permite editar código, nombre y emoji, y actualiza la fila con `UPDATE`.【F:commands/banco.js†L81-L133】
4. Al eliminar un banco se consultan dependencias (tarjetas y movimientos) para advertir al operador; si confirma, se borran tarjetas y el banco dentro de una transacción.【F:commands/banco.js†L189-L233】
5. Todas las pantallas incluyen el botón `❌ Salir` y los mensajes terminan con “Puedes pulsar «Salir» o escribir "salir" en cualquier momento”; lo mismo aplica para `/cancel` o `/salir`.【F:commands/banco.js†L9-L78】【F:commands/banco.js†L142-L203】

## Entradas relevantes
- Texto del operador para código/nombre/emoji durante los wizards, y callbacks inline para seleccionar registros a editar o eliminar.【F:commands/banco.js†L33-L233】

## Salidas
- Confirmaciones de creación/actualización, advertencias de dependencias y mensajes de error basados en la ejecución de las consultas SQL.【F:commands/banco.js†L61-L233】

## Dependencias
- Requiere `psql/db.js` para consultar y modificar las tablas `banco` y `tarjeta`, y utiliza componentes de Telegraf (`Scenes`, `Markup`) para construir la interfaz de wizard.【F:commands/banco.js†L1-L259】

## Notas de mantenimiento
- La validación de cancelación en el wizard de edición reutiliza el helper `handleGlobalCancel`, evitando referencias a funciones inexistentes como `checkExit` y garantizando una salida consistente ante `/cancel` o "salir".【F:commands/banco.js†L71-L133】

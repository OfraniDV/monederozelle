# /tarjeta

## Descripción
Wizard completo para crear, actualizar o eliminar tarjetas asociadas a agentes. Ofrece selección de agente, listado de tarjetas existentes, creación con banco/moneda y saldo inicial, además de un submenú de edición y borrado seguro con confirmaciones.【F:commands/tarjeta_wizard.js†L1-L547】

## Flujo principal
1. Paso 0: inicia mostrando agentes disponibles y guarda el `message_id` para reutilizarlo en ediciones, siempre con el botón `❌ Salir` visible y textos que indican “Puedes pulsar «Salir» o escribir "salir"…”.【F:commands/tarjeta_wizard.js†L62-L180】
2. Paso 1: tras seleccionar agente, presenta un menú de tarjetas con acciones para editar, eliminar o añadir nuevas, manteniendo `Volver`/`❌ Salir` y el recordatorio de salida por texto.【F:commands/tarjeta_wizard.js†L196-L297】
3. Paso 2: al introducir un número nuevo verifica si la tarjeta existe; si sí, activa el submenú de edición (`EDIT_NUM/BANK/CURR`). Si no, solicita banco y moneda mediante listados generados dinámicamente, siempre mostrando `❌ Salir` y el texto guía de “salir”.【F:commands/tarjeta_wizard.js†L304-L407】
4. Paso 3: solicita saldo inicial (o botón “Iniciar en 0”), crea/actualiza la tarjeta con `INSERT ... ON CONFLICT DO UPDATE` y registra un movimiento “Saldo inicial”, reiterando el recordatorio de salida rápida.【F:commands/tarjeta_wizard.js†L414-L448】
5. Paso 4: el submenú de edición permite modificar número, banco o moneda existentes, actualizando la fila con `UPDATE` y manteniendo controles de retroceso y cancelación.【F:commands/tarjeta_wizard.js†L438-L544】
6. El menú de eliminación pide confirmación y avisa si existen movimientos antes de borrar la tarjeta; tras eliminar regresa al menú principal.【F:commands/tarjeta_wizard.js†L243-L276】

## Entradas relevantes
- Selección mediante callbacks inline (agentes, tarjetas, bancos, monedas) y texto libre para número de tarjeta y saldo inicial.【F:commands/tarjeta_wizard.js†L57-L435】

## Salidas
- Mensajes HTML actualizados con listados, advertencias y confirmaciones de creación/actualización/eliminación, reutilizando `editIfChanged` para evitar spam.【F:commands/tarjeta_wizard.js†L57-L500】

## Dependencias
- Requiere acceso a tablas `tarjeta`, `agente`, `banco`, `moneda` y `movimiento`. Emplea helpers de UI (`arrangeInlineButtons`, `buildBackExitRow`, `editIfChanged`) y registra cambios en la sesión con `recordChange`/`flushOnExit`.【F:commands/tarjeta_wizard.js†L5-L435】

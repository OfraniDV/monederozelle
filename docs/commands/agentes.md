# /agentes

## Descripción
Registra un conjunto de escenas para gestionar agentes (titulares) de tarjetas: listar existentes, crear nuevos, editar datos y eliminar registros junto con sus tarjetas asociadas cuando procede.【F:commands/agente.js†L1-L166】

## Flujo principal
1. El comando `/agentes` consulta la tabla `agente`, muestra la lista con botones de edición/eliminación y ofrece la opción de añadir uno nuevo.【F:commands/agente.js†L94-L123】
2. El wizard `AGENTE_CREATE_WIZ` solicita nombre y crea el agente mediante `INSERT ... ON CONFLICT DO NOTHING`, confirmando al usuario el resultado.【F:commands/agente.js†L34-L78】
3. El wizard `AGENTE_EDIT_WIZ` carga el agente seleccionado, permite modificar nombre y guarda los cambios gestionando colisiones por unicidad.【F:commands/agente.js†L80-L136】
4. Al eliminar se verifican dependencias (tarjetas y movimientos) para advertir al operador y, tras confirmación, se borran tarjetas relacionadas dentro de una transacción.【F:commands/agente.js†L138-L170】
5. Cualquier mensaje con `/cancel`, `salir` o botón `↩️ Cancelar` abandona la escena actual y notifica la cancelación.【F:commands/agente.js†L6-L32】【F:commands/agente.js†L170-L188】

## Entradas relevantes
- Textos enviados por el operador durante los wizards (`nombre` actualizado) y callbacks inline para editar o eliminar un agente específico.【F:commands/agente.js†L34-L170】

## Salidas
- Respuestas de confirmación o error según el resultado de las operaciones SQL, incluyendo advertencias cuando existen dependencias y mensajes de cancelación genéricos.【F:commands/agente.js†L44-L170】

## Dependencias
- Usa el pool PostgreSQL para `INSERT`, `UPDATE`, `DELETE` y verificaciones; se apoya en `Telegraf` (`Scenes`, `Markup`) para construir wizards y botones inline.【F:commands/agente.js†L1-L170】

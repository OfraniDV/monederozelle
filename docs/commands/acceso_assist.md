# /acceso (asistente)

## Descripción
Asistente interactivo basado en escenas de Telegraf para gestionar la tabla de usuarios autorizados. Permite listar, agregar y eliminar identificadores de Telegram con acceso al bot, actualizando el mensaje en sitio para evitar duplicados y manteniendo formato HTML seguro.【F:commands/acceso_assist.js†L1-L125】

## Flujo principal
1. La primera escena responde con “Cargando…” y guarda el `message_id` para ediciones posteriores; a continuación muestra la lista actual de usuarios con botones para eliminar, añadir o salir.【F:commands/acceso_assist.js†L84-L100】
2. Al pulsar “➕” cambia la ruta interna a `ADD` y solicita el ID del usuario mediante un mensaje editado con teclado inline de salida.【F:commands/acceso_assist.js†L95-L101】
3. Los botones de la lista disparan eliminaciones inmediatas usando `eliminarUsuario`, mientras que introducir un ID nuevo ejecuta `agregarUsuario` tras verificar duplicados con `usuarioExiste`. Luego se recarga la lista para reflejar cambios.【F:commands/acceso_assist.js†L103-L121】
4. El botón “Salir” edita el mensaje original con un aviso de cancelación y abandona la escena reutilizando `handleGlobalCancel`, que centraliza la limpieza del wizard.【F:commands/acceso_assist.js†L28-L41】【F:commands/acceso_assist.js†L97-L101】

## Entradas relevantes
- Identificadores numéricos de Telegram ingresados manualmente por el operador o seleccionados en botones inline.【F:commands/acceso_assist.js†L95-L121】

## Salidas
- Mensajes HTML actualizados con listados de usuarios y confirmaciones de alta/baja, evitando enviar mensajes adicionales gracias a `editIfChanged`.【F:commands/acceso_assist.js†L65-L79】【F:commands/acceso_assist.js†L95-L121】

## Dependencias
- Reutiliza los helpers `agregarUsuario`, `eliminarUsuario`, `usuarioExiste` y `listarUsuarios` para operar sobre la tabla `usuarios`.【F:commands/acceso_assist.js†L16-L21】

# Helper: usuarios con acceso

## Descripción
Módulo auxiliar que expone funciones CRUD simples sobre la tabla `usuarios`, utilizada por `/acceso` para gestionar la lista blanca del bot.【F:commands/usuariosconacceso.js†L1-L59】

## Funciones
- `agregarUsuario(user_id)`: inserta el identificador y fecha actual en la tabla, registrando la operación en consola.【F:commands/usuariosconacceso.js†L9-L21】
- `eliminarUsuario(user_id)`: borra la fila correspondiente y deja trazas de error si falla.【F:commands/usuariosconacceso.js†L24-L36】
- `usuarioExiste(user_id)`: comprueba la existencia del usuario devolviendo `true/false` según el conteo.【F:commands/usuariosconacceso.js†L39-L52】
- `listarUsuarios()`: devuelve un arreglo de ids ordenado por fecha; en caso de error retorna arreglo vacío.【F:commands/usuariosconacceso.js†L55-L59】

## Dependencias
- Utiliza el pool PostgreSQL definido en `psql/db.js`; las consultas se ejecutan con SQL sencillo e incluyen manejo básico de errores con `console.error`.【F:commands/usuariosconacceso.js†L1-L59】

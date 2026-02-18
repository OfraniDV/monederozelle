# /comandos

## Descripción
Devuelve un listado estático de comandos soportados por el bot, incluyendo descripción corta, permisos sugeridos y formato de uso para cada entrada. Sirve como referencia central para la ayuda en línea.【F:commands/comandos.js†L1-L104】

## Detalles
- La estructura es un arreglo de objetos con campos `nombre`, `descripcion`, `permiso` y `uso`, utilizado por otras partes del bot para renderizar menús o respuestas de ayuda.【F:commands/comandos.js†L3-L103】
- Incluye comandos legacy de cuentas (`crearcuenta`, `miscuentas`, `credito`, etc.) y módulos avanzados como `/tarjetas`, `/fondo`, `/monitor` y asistentes para acceso.【F:commands/comandos.js†L7-L103】

## Dependencias
- No interactúa con la base de datos; exporta un array de configuración consumido por el bot principal cuando construye menús o mensajes de ayuda.【F:commands/comandos.js†L1-L105】

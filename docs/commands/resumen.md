# /resumen

## Descripción
Genera un resumen detallado de las transacciones de una cuenta legacy almacenada como tabla independiente. Agrupa por día, calcula subtotales diarios y totales mensuales de créditos y débitos antes de responder al usuario.【F:commands/resumen.js†L1-L82】

## Flujo principal
1. Obtiene el nombre de la cuenta desde el mensaje (`/resumen <alias>`); si falta, devuelve una advertencia inmediata.【F:commands/resumen.js†L4-L10】
2. Ejecuta una consulta que recupera todas las filas de la tabla `<cuenta>` ordenadas por fecha e id ascendente.【F:commands/resumen.js†L12-L20】
3. Itera sobre las filas, reseteando subtotales al cambiar de día, acumulando totales mensuales y armando una cadena con movimientos marcados como crédito (+) o débito (-).【F:commands/resumen.js†L26-L67】
4. Devuelve el resumen completo en un único mensaje con el saldo final del mes y totales de débito/crédito acumulados.【F:commands/resumen.js†L32-L75】

## Entradas relevantes
- Nombre de la tabla/cuenta en el comando y datos almacenados en columnas `descripcion`, `debito`, `credito`, `total` y `fecha`.【F:commands/resumen.js†L4-L75】

## Salidas
- Texto plano con formato Markdown escapado que detalla movimientos por día y totales mensuales, además de manejar mensajes de error cuando la cuenta no existe o no tiene registros.【F:commands/resumen.js†L2-L79】

## Dependencias
- Utiliza `psql/db.js` para ejecutar consultas y `telegram-escape` para escapar caracteres especiales en el nombre de la cuenta.【F:commands/resumen.js†L1-L82】

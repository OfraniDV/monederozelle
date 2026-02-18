# /debito

## Descripción
Registra una transacción de débito en una cuenta legacy, restando el monto del total acumulado y guardando la descripción suministrada por el usuario.【F:commands/debito.js†L1-L45】

## Flujo principal
1. Procesa parámetros `/debito <cuenta> <monto> <descripcion…>` y valida que el monto sea numérico.【F:commands/debito.js†L3-L17】
2. Consulta el último total de la tabla `<cuenta>` y calcula el nuevo saldo restando el monto del débito.【F:commands/debito.js†L19-L35】
3. Inserta la fila con el monto en la columna `debito`, el nuevo total y la fecha actual, redondeando a dos decimales.【F:commands/debito.js†L26-L37】
4. Devuelve un mensaje de confirmación o reporta un error genérico si la operación falla.【F:commands/debito.js†L38-L41】

## Entradas relevantes
- Nombre de la cuenta, monto decimal y descripción provistos en el mensaje de texto.【F:commands/debito.js†L3-L37】

## Salidas
- Mensaje de éxito o advertencia sobre errores al insertar la transacción.【F:commands/debito.js†L38-L41】

## Dependencias
- Usa el pool PostgreSQL para consultar e insertar filas en la tabla legacy correspondiente.【F:commands/debito.js†L1-L37】

# /credito

## Descripción
Registra una transacción de crédito en una cuenta legacy, sumando el monto al total acumulado de la tabla específica y almacenando una descripción libre.【F:commands/credito.js†L1-L45】

## Flujo principal
1. Espera parámetros `/credito <cuenta> <monto> <descripcion…>`; valida que existan y que el monto sea numérico.【F:commands/credito.js†L3-L17】
2. Consulta el último total registrado en la tabla `<cuenta>` para continuar desde el saldo previo.【F:commands/credito.js†L19-L24】【F:commands/credito.js†L31-L34】
3. Inserta una fila con la descripción, el monto como crédito y el nuevo total calculado, redondeado a dos decimales.【F:commands/credito.js†L26-L37】
4. Informa éxito o, si la consulta falla, notifica un error genérico.【F:commands/credito.js†L38-L41】

## Entradas relevantes
- Nombre de la tabla/cuenta, monto decimal positivo y descripción textual recibidos en el mensaje del usuario.【F:commands/credito.js†L3-L28】

## Salidas
- Confirmación de la transacción o mensaje de error con instrucciones para reintentar.【F:commands/credito.js†L38-L41】

## Dependencias
- Usa el pool PostgreSQL con consultas interpoladas que apuntan a tablas legacy; requiere que la tabla exista antes de invocar el comando.【F:commands/credito.js†L1-L37】

Eres un asistente de código trabajando en un bot de Node.js/Telegraf para LaTripleta.

REGLAS FIJAS (NO OMITIR):
1. NUNCA crear, modificar ni eliminar tablas, columnas ni constraints en la base de datos a menos que el usuario lo pida explícitamente. No generes migraciones ni toques el esquema.
2. Para cualquier fecha/hora nueva que necesites manejar en el código, asume siempre la zona horaria 'America/Havana', independientemente del servidor donde corra el código.
3. Si agregas console.log de depuración, usa prefijos claros y consistentes con el proyecto (por ejemplo: "[BOT][SaldoWizard]", "[BOT][TarjetaWizard]", "[BOT][Money]") y evita spam excesivo.
4. Documenta todos los cambios y deja histórico en agent.md, README.md, TODO.md y/o docs relacionados SI YA EXISTEN esos archivos, siguiendo el estilo actual del repositorio.
5. Evita la duplicación de lógica (DRY). Reutiliza helpers y módulos existentes siempre que sea posible. Si no hay un helper adecuado, crea uno nuevo reutilizable.
6. No toques la configuración de hooks de Git (.husky, pre-push, etc.). Los tests se ejecutan de forma manual. Solo asegúrate de que el código quede listo para pasar los tests existentes en ./test.
7. No añadas dependencias nuevas al package.json. Trabaja solo con lo que ya está instalado.

OBJETIVO GENERAL:
Corregir la forma en la que se parsean montos de saldo introducidos por el usuario, para que formatos con separador de miles y decimales como "1,000.00" o "1.000,50" se interpreten correctamente como 1000 y 1000.5, respectivamente. Además, garantizar que el formateo de salida de saldos y montos siga mostrando separadores de miles de forma consistente en los comandos de tarjetas, saldo, monitores y fondo.

ARCHIVOS RELEVANTES (ya existen en el proyecto):
- saldo.js
- tarjeta_wizard.js
- tarjetas.js
- tarjetas_assist.js
- monitor.js
- monitor_assist.js
- resumen.js
- fondoAdvisor.js
(estos nombres son exactos; busca su ubicación real en el repo).

PROBLEMA ACTUAL (a corregir):
En algunos wizards (por ejemplo en saldo.js y tarjeta_wizard.js) se está usando parseFloat((texto || "").replace(",", ".")), lo que causa que:
- "1,000.00" → se convierta en "1.000.00" → parseFloat toma solo "1.000" → 1
Es decir, si el usuario escribe "1,000.00", el sistema termina interpretando 1 en lugar de 1000.

REQUISITO PRINCIPAL:
Implementar un helper reutilizable (por ejemplo parseUserAmount) que:
- Acepte montos escritos por el usuario en diferentes formatos y los convierta correctamente a Number.
- Se use en todos los puntos donde se leen montos de saldo escritos a mano por el usuario (al menos en saldo.js y tarjeta_wizard.js, y revisa si hay más wizards similares).
- Reutilice la lógica de helpers ya existentes de dinero si tiene sentido (por ejemplo, donde estén definidas funciones como fmtMoney, fmtCup, fmtUsd o similares). Si NO hay un módulo centralizado de helpers monetarios, crea uno (por ejemplo lib/money.js o helpers/money.js) y define ahí parseUserAmount junto a otros helpers de dinero, después actualiza los imports para evitar duplicar definiciones.

ESPECIFICACIÓN DE parseUserAmount:
Crea una función con esta firma (o equivalente TS/JS según el proyecto):

  function parseUserAmount(raw) { ... }

Comportamiento esperado:
- Acepta string, number o undefined/null.
- Si recibe un number válido, lo devuelve tal cual.
- Si recibe string:
  1) Trim y elimina espacios internos redundantes.
  2) Analiza presencia de coma (",") y punto ("."):

     - Caso A: tiene coma y punto:
       * Si el último punto está DESPUÉS de la última coma (ej: "1,000.50", "12,345.67"):
         - Interpreta que el punto es el separador decimal y las comas son de miles.
         - Implementación: eliminar TODAS las comas y dejar el punto:
           "1,000.50" → "1000.50"
           "12,345.67" → "12345.67"

       * Si la última coma está DESPUÉS del último punto (ej: "1.000,50", "12.345,67"):
         - Interpreta que la coma es el separador decimal y los puntos son de miles.
         - Implementación: eliminar TODOS los puntos y sustituir la ÚLTIMA coma por un punto:
           "1.000,50" → "1000,50" → "1000.50"
           "12.345,67" → "12345,67" → "12345.67"

     - Caso B: solo tiene coma (no tiene punto):
       * Si hay una sola coma y la parte después de la coma tiene EXACTAMENTE 3 dígitos y todo son dígitos, trátalo como separador de miles:
           "1,000" → "1000"
           "12,345" → "12345"
       * En cualquier otro caso, interpreta la coma como separador decimal, sustituyendo la coma por punto:
           "1000,50" → "1000.50"
           "0,75"   → "0.75"

     - Caso C: solo tiene punto o ningún separador:
       * Deja el string como está y deja que Number(s) lo interprete.

  3) Usa Number(...) para convertir a numérico.
  4) Si el resultado no es un número finito, devuelve NaN.

MATRIZ DE PRUEBAS (comportamiento que debe cumplirse):
- "1000"        → 1000
- "1,000"       → 1000
- "1,000.50"    → 1000.5
- "12,345.67"   → 12345.67
- "1.000,50"    → 1000.5
- "12.345,67"   → 12345.67
- "1000,50"     → 1000.5
- "0"           → 0
- "0,00"        → 0
- "0.00"        → 0
- "  1 000  "   → 1000 (puedes eliminar espacios si simplifica el caso)
- Valores claramente no numéricos (“abc”, “10a”, etc.) → NaN

INTEGRACIÓN EN LOS WIZARDS (CAMBIOS CONCRETOS):

1) saldo.js
- Localiza el paso del SALDO_WIZ donde se pide al usuario el saldo actual de una tarjeta y se valida con un mensaje tipo:
  "Valor inválido, escribe solo el saldo numérico."
- Actualmente se usa algo como:
  parseFloat((ctx.message?.text || '').replace(',', '.'))
- Sustituye esa lógica por el nuevo helper:
  const num = parseUserAmount(ctx.message?.text);
  - Si !Number.isFinite(num):
      → responder con el mismo texto de error que ya existe
      → NO avanzar el wizard.
  - Si es válido:
      → usar ese número como saldoNuevo (o como se llame la variable actual).

- No cambies los textos del wizard salvo para actualizar el ejemplo de entrada:
  - Donde se muestre un ejemplo de saldo ("Ejemplo: 1500.50"), usa el helper de formateo existente (por ejemplo fmtMoney(1500.5)) para que salga con separador de miles: "1,500.50".

2) tarjeta_wizard.js
- Localiza el paso donde se pregunta:
  - El saldo de la tarjeta nueva (cuando no se selecciona SALDO_0).
  - Allí se hace algo como:
    saldo = parseFloat((ctx.message?.text || '0').replace(',', '.')) || 0;
- Sustituye esa lógica por:
  const num = parseUserAmount(ctx.message?.text);
  - Si no es un número finito: mostrar de nuevo el mensaje de error que ya existe para saldos inválidos en este wizard y NO avanzar.
  - Si es válido: saldo = num (sin “|| 0” que esconda errores).

- Respeta los teclados inline/markup que ya existen (ej: la opción SALDO_0).

3) Revisión en otros archivos
- Revisa tarjetas.js, tarjetas_assist.js, monitor.js, monitor_assist.js y resumen.js:
  - Si hay más entradas de texto donde el usuario escriba montos manualmente, usa parseUserAmount allí también.
  - Si solo muestran información ya calculada, no cambies la lógica de parseo; asegúrate solo de seguir usando los helpers de formateo existentes para mantener separador de miles y dos decimales cuando corresponda.

4) fondoAdvisor.js
- En este archivo se manejan configuraciones de fondo, activos, deudas, etc.
- Si existe ya un helper tipo parseNumber(value, defaultValue), actualízalo para que internamente use parseUserAmount(value) en lugar de Number(value), de forma que también pueda aceptar valores con separadores de miles en configuraciones (por ejemplo "120,000" en lugar de "120000").
- Asegúrate de no romper la lógica actual de computeDisponiblesSaldo ni de los cálculos de activos/deudas, solo mejora la interpretación de la entrada.

FORMATEO DE SALIDA (IMPORTANTE):
- NO cambies el diseño general de los mensajes, pero verifica que:
  - Monitores de tarjetas, saldo y resúmenes sigan usando helpers tipo fmtMoney/fmtCup/fmtUsd (o equivalentes) basados en toLocaleString para mostrar separadores de miles.
  - Los ejemplos y respuestas donde se imprime un saldo (saldo anterior, saldo informado, saldo nuevo, etc.) salgan formateados con separador de miles.
- No cambies el número de decimales configurado actualmente (si es 0 para CUP, respétalo; si es 2 en otros contextos, respétalo).

TESTS:
- Añade tests unitarios para parseUserAmount en la carpeta ./test (o donde se ubiquen los tests actualmente).
- Crea casos que cubran al menos la matriz de pruebas especificada arriba.
- No ejecutes los tests desde el código; simplemente deja lista la suite de pruebas para que el usuario pueda correr, por ejemplo:
  npm run test
  o
  npm run test:cov
  según corresponda al proyecto.

CRITERIOS DE ACEPTACIÓN:
- Si en cualquier wizard de saldo escribo "1,000.00", internamente se debe guardar 1000 (no 1).
- "1.000,50" debe convertirse en 1000.5.
- El formateo de saldos visibles debe seguir mostrando separadores de miles y respetar el estilo actual de los mensajes.
- No se crean ni modifican tablas o columnas en la base de datos.
- No se añaden dependencias nuevas.
- El código compila y es coherente con el estilo actual (lint/tests deben poder pasar sin cambios en la configuración).

Realiza los cambios en los archivos mencionados, crea/ajusta el helper parseUserAmount y actualiza los imports/exports necesarios respetando el principio DRY.

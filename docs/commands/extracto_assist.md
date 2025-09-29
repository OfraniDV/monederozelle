# /extracto (asistente)

## Descripción
Wizard que guía al usuario para generar un extracto bancario filtrando por agente, moneda, banco, tarjeta y periodo. Cada pantalla reutiliza el mismo mensaje con `editIfChanged`, ofrece botón para generar informe y mantiene un encabezado con filtros actuales.【F:commands/extracto_assist.js†L1-L220】

## Flujo principal
1. Carga catálogos (agentes, bancos, monedas, tarjetas) mediante consultas parametrizadas y helpers de filtrado `buildEntityFilter` para combinar criterios seleccionados.【F:commands/extracto_assist.js†L72-L138】【F:commands/extracto_assist.js†L148-L220】
2. Presenta menú de filtros jerárquico con opción “Generar informe” en cada paso y navegación `Anterior/Menú inicial/Salir`. Usa `smartPaginate` para dividir textos extensos antes de enviarlos.【F:commands/extracto_assist.js†L31-L199】
3. Al ejecutar `RUN`, obtiene movimientos del periodo especificado, formatea los montos con `fmtMoney`, arma un encabezado HTML con los filtros activos y envía el extracto usando `sendReportWithKb` o `sendAndLog` según corresponda.【F:commands/extracto_assist.js†L161-L220】
4. El asistente registra acciones en consola y permite cancelar en cualquier momento, llamando a `flushOnExit` para limpiar resúmenes pendientes.【F:commands/extracto_assist.js†L57-L68】【F:commands/extracto_assist.js†L172-L220】

## Entradas relevantes
- Selecciones realizadas a través de callbacks (`FIL_*`, `AG_*`, `MO_*`, `BK_*`, etc.) y definiciones de periodo/día/mes controladas con `moment-timezone`.【F:commands/extracto_assist.js†L13-L220】

## Salidas
- Bloques HTML paginados con encabezado y lista de movimientos, enviados en uno o varios mensajes según el tamaño del texto final.【F:commands/extracto_assist.js†L31-L220】

## Dependencias
- Utiliza helpers de UI (`editIfChanged`, `arrangeInlineButtons`, `buildBackExitRow`, `buildSaveExitRow`, `sendReportWithKb`), utilidades de formato (`fmtMoney`, `boldHeader`) y la conexión PostgreSQL para cargar tarjetas y movimientos.【F:commands/extracto_assist.js†L15-L220】

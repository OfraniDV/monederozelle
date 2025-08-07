<h1 align="center">💳 <span style="color:#ff6600;">Monedero Zelle Bot</span></h1>

<p align="center"><em>Un asistente de Telegram para manejar cuentas, tarjetas y movimientos de forma elegante.</em></p>

## 🧠 ¿Qué es?

Monedero Zelle Bot es una solución integral de administración financiera pensada para operar desde **Telegram**. El sistema combina wizards interactivos, una base de datos robusta y comandos heredados para ofrecer un control total sobre múltiples tarjetas Zelle y otras cuentas.

## ✨ Características principales

- Gestión completa de <span style="color:#3498db;">monedas</span>, <span style="color:#2ecc71;">bancos</span>, <span style="color:#e67e22;">agentes</span> y <span style="color:#9b59b6;">tarjetas</span> con búsquedas optimizadas.
- Registro de movimientos multi-moneda y seguimiento de saldos históricos.
- Wizards con botones y paginación para crear, editar o eliminar datos de forma guiada.
- `/tarjetas`, `/monitor`, `/extracto` y otros comandos ofrecen reportes y análisis filtrables.
- Control de acceso para permitir solo usuarios autorizados y comandos legacy para sistemas previos.
- Interfaz HTML segura con sanitización, listas compactas y teclados de dos botones por fila.
- Arranque resiliente: verifica la base PostgreSQL, extensiones e índices antes de iniciar el bot.

## 🛠️ Tecnologías y arquitectura

- **Node.js + Telegraf** para interactuar con la API de Telegram mediante scenes y sesiones.
- **PostgreSQL** como almacenamiento principal; el bootstrap crea tablas, extensiones `unaccent` e índices de búsqueda.
- **Jest** para pruebas automatizadas; el script `pretest` configura una base temporal.

## 📂 Estructura del proyecto

- `commands/`: comandos y asistentes de Telegram.
- `helpers/`: funciones reutilizables.
- `scripts/`: tareas y utilidades ejecutables con `npm run`.
- `tests/`: suite de pruebas dividida en `tests/commands/`, `tests/helpers/` y `tests/scenes/`.

## 🚀 Instalación

```bash
git clone <repositorio>
cd monederozelle
npm install
node bot.js
```

## 🧪 Pruebas

Instala dependencias y ejecuta la suite con:

```bash
npm install
npm test
```

El proceso `pretest` levanta una base PostgreSQL de pruebas y aplica el esquema necesario de forma automática.

Ejecuta tareas de base de datos desde la carpeta `scripts/` con npm:

```bash
npm run db:bootstrap   # prepara índices y extensiones
npm run db:seed        # inserta datos mínimos
```

### Tests de Extracto

El asistente de extracto incluye pruebas específicas que inicializan la base de datos con movimientos de ejemplo.
Ejecuta únicamente estas pruebas con:

```bash
npm run test:extracto
```

## 📦 Tablas principales

El bot utiliza una base de datos PostgreSQL con las siguientes tablas:

- **moneda**: código, nombre, tasa respecto al USD y emoji.
- **banco**: código, nombre legible y emoji identificador.
- **agente**: nombre del dueño de las tarjetas y emoji opcional.
- **tarjeta**: número o alias, referencias a agente, banco y moneda.
- **movimiento**: historial de cambios de saldo por tarjeta.

## 🧩 Helpers comunes

Estas utilidades facilitan la creación de asistentes consistentes:

- `escapeHtml(text)`: sanitiza valores dinámicos para usarlos con `parse_mode: 'HTML'`.
- `editIfChanged(ctx, text, options)`: evita editar mensajes cuando el contenido no cambia.
- `buildNavKeyboard(opts)`: genera un teclado de navegación con paginación y controles Volver/Salir.
- `arrangeInlineButtons(buttons)`: organiza botones en filas de dos para teclados más elegantes.
- `buildSaveExitRow()`: crea una fila única con botones 💾 Salvar / ❌ Salir.
- `sendReportWithKb(ctx, pages, kb)`: envía páginas largas y añade al final un teclado Save/Exit.

## UX de teclados

Para mejorar la experiencia, los reportes extensos se envían en varias páginas
seguidas de un mensaje final con los botones en una sola fila
`💾 Salvar` / `❌ Salir`. Utiliza los helpers `buildSaveExitRow()` y
`sendReportWithKb()` para aplicar esta convención:

```js
const kb = Markup.inlineKeyboard([buildSaveExitRow()]).reply_markup;
await sendReportWithKb(ctx, paginas, kb);
```

## 📚 Uso de comandos

Cada comando se invoca escribiendo el texto en el chat del bot. Los asistentes muestran botones y confirmaciones según corresponda.

### 🟢 <span style="color:#27ae60;">/start</span>
Saluda y confirma que el bot está activo.

**Ejemplo:**
```text
/start
Hola, ¡bienvenido al bot de Monedero Zelle!
```

### 🛰️ <span style="color:#f1c40f;">/ping</span>
Comprueba la latencia del bot.

**Ejemplo:**
```text
/ping
Pong! 123 ms
```

### 🆔 <span style="color:#e67e22;">/crearcuenta</span>
Crea una cuenta en el sistema legacy.

**Uso:** `/crearcuenta`

**Ejemplo:**
```text
/crearcuenta
✅ Cuenta creada.
```

### 📋 <span style="color:#e67e22;">/miscuentas</span>
Lista las cuentas existentes en el sistema legacy.

**Ejemplo:**
```text
/miscuentas
• tarjeta1
• tarjeta2
```

### 🗑️ <span style="color:#e67e22;">/eliminarcuenta</span>
Elimina una cuenta legacy.

**Ejemplo:**
```text
/eliminarcuenta tarjeta1
🗑️ Cuenta eliminada.
```

### ➕ <span style="color:#e74c3c;">/credito &lt;alias&gt; &lt;monto&gt; [descripcion]</span>
Agrega crédito a una cuenta legacy.

**Ejemplo:**
```text
/credito tarjeta1 25 Recarga
✅ Crédito registrado.
```

### ➖ <span style="color:#e74c3c;">/debito &lt;alias&gt; &lt;monto&gt; [descripcion]</span>
Registra un débito en una cuenta legacy.

**Ejemplo:**
```text
/debito tarjeta1 10 Compra
✅ Débito registrado.
```

### 📊 <span style="color:#e74c3c;">/resumen &lt;alias&gt;</span>
Muestra el historial de una cuenta legacy.

**Ejemplo:**
```text
/resumen tarjeta1
Saldo actual: 15
Últimos movimientos...
```

### 🧾 <span style="color:#e74c3c;">/resumentotal</span>
Resumen consolidado de todas las cuentas legacy.

**Ejemplo:**
```text
/resumentotal
Total: 150
```

### 🪙 <span style="color:#3498db;">/monedas</span>
Lista y permite crear, editar o eliminar monedas.

**Ejemplo de respuesta:**
```text
Monedas:
• 💵 USD — Dólar estadounidense
✏️ USD 🗑️
➕ Añadir moneda
```

### 🏦 <span style="color:#2ecc71;">/bancos</span>
Gestiona bancos y sus emojis.

**Ejemplo:**
```text
/bancos
Bancos:
• 🏦 BANDEC — BANDEC Oficial
✏️ BANDEC 🗑️
➕ Añadir banco
```

### 👤 <span style="color:#e67e22;">/agentes</span>
Maneja agentes o dueños de tarjetas.

**Ejemplo:**
```text
/agentes
• Juan
✏️ Juan 🗑️
➕ Añadir
```

### 💳 <span style="color:#9b59b6;">/tarjeta</span>
Inicia el asistente para crear o actualizar una tarjeta. Permite elegir agente, banco, moneda y saldo inicial.

**Ejemplo:**
```text
/tarjeta
👤 Elige agente:
[Juan]
```

### 📇 <span style="color:#9b59b6;">/tarjetas</span>
Lista todas las tarjetas con sus saldos actuales, agrupadas por moneda y banco.
Incluye un botón <strong>Ver todas</strong> para mostrar toda la información sin aplicar filtros.

**Ejemplo:**
```text
/tarjetas
💱 Moneda: USD
• 1234 – Juan – BANDEC ⇒ 100
```

### 💰 <span style="color:#1abc9c;">/saldo</span>
Actualiza el saldo de una tarjeta existente registrando el movimiento correspondiente.

**Ejemplo:**
```text
/saldo
Selecciona agente...
```

### 📈 <span style="color:#8e44ad;">/monitor [dia|mes|año]</span>
Compara la salud financiera en distintos periodos. Desde el asistente puedes filtrar por moneda, agente y banco, o elegir "Todos" para ver un resumen global.

**Ejemplo:**
```text
/monitor mes
Resultados del mes actual vs anterior...
```

### 📄 <span style="color:#34495e;">/extracto</span>
Genera un extracto bancario con filtros combinables. Puedes elegir el agente y luego filtrar por moneda, banco o tarjeta, con botones de **Todos** para obtener resúmenes globales. El reporte indica entradas, salidas, saldo actual y su equivalente en USD para cada moneda.

**Ejemplo:**
```text
/extracto
Selecciona un agente...
```

### 🛂 <span style="color:#c0392b;">/acceso</span>
Abre un asistente para listar los usuarios con acceso y permitir añadir o eliminar IDs.

**Ejemplo:**
```text
/acceso
🛂 Usuarios con acceso:
👤 Juan (123456) 🗑️
➕ Añadir
```

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT.


<h1 align="center">💳 <span style="color:#ff6600;">Monedero Zelle Bot</span></h1>

<p align="center"><em>Un asistente de Telegram para manejar cuentas, tarjetas y movimientos de forma elegante.</em></p>

## ✨ Características principales

- Gestión de <span style="color:#3498db;">monedas</span>, <span style="color:#2ecc71;">bancos</span>, <span style="color:#e67e22;">agentes</span> y <span style="color:#9b59b6;">tarjetas</span>.
- Asistentes interactivos con botones para crear, editar y eliminar elementos.
- Registro de movimientos y saldos con múltiples monedas.
- Controles de acceso para varios usuarios.

## 🚀 Instalación

```bash
git clone <repositorio>
cd monederozelle
npm install
node bot.js
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

### 📈 <span style="color:#8e44ad;">/monitor [dia|mes|año] [banco|agente|moneda|tarjeta]</span>
Compara la salud financiera en distintos periodos.

**Ejemplo:**
```text
/monitor mes banco
Resultados del mes actual vs anterior...
```

### 🛡️ <span style="color:#c0392b;">/daracceso &lt;user_id&gt;</span>
Concede acceso a otro usuario.

**Ejemplo:**
```text
/daracceso 123456
✅ Acceso concedido.
```

### 🚫 <span style="color:#c0392b;">/denegaracceso &lt;user_id&gt;</span>
Revoca el acceso de un usuario.

**Ejemplo:**
```text
/denegaracceso 123456
❌ Acceso revocado.
```

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT.


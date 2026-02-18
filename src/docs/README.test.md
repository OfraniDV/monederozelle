# Instrucciones de pruebas (test setup)

Este documento explica cómo levantar el entorno de pruebas y ejecutar la suite con PostgreSQL.

## Requisitos previos

- Node.js (>=18)
- PostgreSQL accesible en `localhost:5432`
- No subir credenciales reales: usa `.env.example` como plantilla y mantén `.env` / `.env.test` en `.gitignore`.

## Archivos importantes

- `.env` — configuración de desarrollo.
- `.env.test` — generado automáticamente por `scripts/ensureTestDb.js`.
- `scripts/` — utilidades de base de datos (`initWalletSchema.js`, `seedMinimal.js`, etc.).
- `tests/setup.js` — asegura el esquema antes de correr Jest.
- `tests/commands/` — pruebas de comandos.
- `tests/helpers/` — pruebas de helpers.
- `tests/scenes/` — pruebas de escenas.

## Mocks de Telegraf

Las pruebas que validan la UX del teclado usan mocks de Jest para
`ctx.reply` y las funciones `ctx.telegram.editMessage*`. Esto permite
comprobar el orden de los mensajes y que el último envío incluya el
teclado de una sola fila.

## Nuevos tests

- `tests/commands/assistantsUX.test.js`: verifica que los asistentes
  terminen con el mensaje `Reporte generado.` seguido por los botones
  `💾 Salvar` y `❌ Salir`.
- `tests/commands/saldo.leave.test.js`: asegura que el asistente de
  saldo ejecute el asesor de fondo al salir.

## Flujo local (desarrollo)

1. Clona el repositorio y entra:
   ```bash
   git clone <repo>
   cd monederozelle
   ```
2. Instala dependencias y prepara la base:
   ```bash
   npm install
   npm run db:bootstrap
   npm run db:seed
   ```
3. Ejecuta la suite de tests:
   ```bash
   npm test
   ```

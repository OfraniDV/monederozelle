# AGENTS

## Pruebas
- Ejecuta `npm test` para correr la suite. Esto instala y prepara PostgreSQL automáticamente.

## Salud de la base
- Para verificar la base local usa:
  ```bash
  PGPASSWORD=123456789 psql -h localhost -U wallet -d wallet_test -c 'SELECT 1';
  ```
- Si el contenedor se reinicia o necesitas recrear todo, ejecuta:
  ```bash
  node scripts/ensureTestDb.js
  ```
  Exporta `ADMIN_DATABASE_URL` si deseas apuntar a un servidor externo persistente.

## Protocolo de contribución
- Documenta en la carpeta correspondiente todo cambio que realices (README, docs, TODOs, etc.). Ningún ajuste queda sin registro.
- No modifiques la lógica existente ni esquemas/datos de la base de datos a menos que las instrucciones lo indiquen explícitamente.
- Las pruebas nuevas deben ubicarse dentro de `tests/` en el subdirectorio que corresponda (`commands/`, `helpers/`, `scenes/`, etc.).

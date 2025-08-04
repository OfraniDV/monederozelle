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

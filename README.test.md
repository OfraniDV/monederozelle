# Instrucciones de pruebas (test setup)

Este documento explica cómo levantar el entorno de pruebas, crear la base de datos de test y ejecutar la suite con PostgreSQL.

## Requisitos previos

- Node.js (idealmente la misma versión usada en el proyecto, p. ej. `>=18`).
- PostgreSQL accesible en `localhost:5432` (el script lo inicializa si está corriendo).
- Que no se cometan credenciales reales: usa `.env.example` como plantilla y ten `.env` / `.env.test` en `.gitignore`.

## Archivos importantes

- `.env` — configuración de desarrollo (debe tener `ADMIN_DATABASE_URL` y credenciales de la app).  
- `.env.test` — generado automáticamente por el script de pretest; apunta a `wallet_test`.  
- `scripts/ensureTestDb.js` — crea el role `wallet`, la base `wallet_test` y genera `.env.test`.  
- `tests/setup.js` — cargado por Jest antes de los tests; asegura el esquema completo.  
- `tests/dbConnection.test.js` — prueba básica de conexión.  
- `tests/filterConsistency.test.js` — valida consistencia de filtros con datos reales.

## Flujo local (desarrollo)

1. Clona el repositorio y entra:
   sh
   git clone `<repo>`
   cd monederozelle

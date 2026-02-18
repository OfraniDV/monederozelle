# Pasos de verificación

1. Ejecuta la suite automatizada para validar cálculos, normalización de bancos y consultas de límites mensuales:
   ```bash
   npm test
   ```
2. Revisa los registros generados por `middlewares/fondoAdvisor` para confirmar el diagnóstico detallado de exclusiones:
   - Deben aparecer líneas con el prefijo `[fondoAdvisor]` indicando los saldos agregados por moneda.
   - Verifica también mensajes de exclusión explícitos (regex de deudas, moneda distinta a CUP, banco no reconocido) durante la agregación o lectura de límites.
3. Para validar manualmente la normalización de bancos en consultas, ejecuta el caso de prueba unitario específico:
   ```bash
   npx jest tests/__tests__/fondoAdvisor.limits.test.js --runInBand --testNamePattern "normaliza"
   ```
   Esto asegura que sinónimos como “MI TRANSFER” y “BANCO METROPOLITANO” se mapeen correctamente a los códigos estándar.

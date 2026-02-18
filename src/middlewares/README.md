# Middlewares

Este directorio contiene la lógica de middleware usada por el bot.

## fondoAdvisor.js

Asesor financiero que se ejecuta al salir de los asistentes principales. Calcula necesidad en CUP, determina urgencia con los helpers `computeHeadlineSeverity()` y `sumNonBolsaDepositCap()` y genera bloques HTML con inventario USD/Zelle, límites mensuales (incluye totales por columnas) y sugerencias de distribución.


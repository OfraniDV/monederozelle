# TODO

## UX pendientes
- [ ] Localizar los botones `💾 Salvar` / `❌ Salir` en escenas multilingües para los demás idiomas soportados (revisar helpers y escenas). 
- [ ] Revisar la accesibilidad de emojis en lectores de pantalla y aportar alternativas textuales en los mensajes largos.
- [ ] Implementar un modo compacto para chats grupales de alto volumen (revisar paginación y helpers de navegación).
- [ ] Recoger feedback de usuarias/os sobre el nuevo formato `CUP (≈ USD)` y la columna `≈USD(LIBRE)` del asesor para ajustar textos o precisiones si fuera necesario.

## Auditoría de comandos financieros
- [ ] Restringir las tablas que puede consultar `/resumen` para evitar interpolar nombres arbitrarios en SQL y prevenir inyección. 【F:commands/resumen.js†L13-L18】
- [ ] Restringir y sanear la enumeración de tablas en `/resumentotal` antes de ejecutar consultas dinámicas sobre cada cuenta. 【F:commands/resumentotal.js†L6-L34】
- [ ] Validar los cálculos de `saldo final` mensual en `/resumen` y `/resumentotal`, utilizando el campo `total` persistido en la base en lugar de recomputar subtotales diarios. 【F:commands/resumen.js†L24-L63】【F:commands/resumentotal.js†L28-L70】
- [ ] Añadir pruebas de comandos para `/resumen` y `/resumentotal` que cubran cuentas con múltiples días, errores de entrada y tablas sin datos. Ubicar los archivos en `tests/commands/`. 【F:commands/resumen.js†L5-L78】【F:commands/resumentotal.js†L36-L82】

## Documentación y procesos
- [ ] Documentar en `docs/auditorias/` el nuevo protocolo de contribución (documentar cambios, no tocar lógica/base sin orden, ubicación de tests) para dejar constancia histórica. 【F:AGENTS.md†L3-L23】【F:agent.md†L1-L11】
- [x] Mantener actualizado este `TODO.md` después de cada auditoría o cambio significativo.

## Refactoring y DRY
- [ ] Evaluar la unificación de los wizards de datos maestros (`agente.js`, `banco.js`, `moneda.js`) en un helper genérico `masterDataWizard.js` para reducir la duplicación de lógica de listado, edición y borrado.
- [ ] Centralizar los IDs de emojis premium que aún aparecen como fallbacks hardcoded en `premiumEmojiText.js` (algunos ya fueron limpiados).

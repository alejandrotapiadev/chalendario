# ADR-002: Versionado de eventos

**Estado:** aceptada

## Contexto

Los eventos pueden modificarse y necesitamos conservar su historial.

## Decisión

Mantener el estado actual del evento y snapshots inmutables por cada modificación.
Cada modificación crea una nueva versión; las versiones nunca se modifican. Restaurar crea
una versión nueva. No se adopta Event Sourcing completo.

## Consecuencias

- **Pro:** Historial completo
- **Pro:** Rollback sencillo
- **Pro:** Auditoría
- **Pro:** Base para sincronización y resolución de conflictos
- **Contra:** Más almacenamiento

# ADR-005: El borrado de un evento es una versión

**Estado:** aceptada

## Contexto

La regla del proyecto es que cada modificación de un evento crea una versión y las versiones
nunca se modifican (ADR-002). Borrar un evento tiene que encajar en esa regla: si el borrado
fuera un `DELETE` o una marca `deleted_at` en `events`, el historial quedaría incompleto
(«¿cuándo se borró y quién?») y `restaurar` tendría un camino especial.

## Decisión

`event_versions.deleted` (booleano). Borrar inserta una versión nueva con el contenido
anterior y `deleted = true` (`change_reason = 'deleted'`). Las consultas de la API filtran
las versiones vigentes con `deleted = true`.

## Consecuencias

- **Pro:** el borrado queda auditado como cualquier otro cambio (quién, cuándo).
- **Pro:** restaurar un evento borrado es igual que restaurar cualquier versión.
- **Pro:** `events` no necesita columnas de estado extra.
- **Contra:** los eventos «borrados» siguen ocupando filas; la eliminación definitiva (p. ej.
  para cumplir una petición de borrado de datos) requerirá un procedimiento aparte, porque
  el trigger de inmutabilidad también bloquea los `DELETE`.

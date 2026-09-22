# ADR-008: Recurrencia como regla en el evento, con ocurrencias calculadas

**Estado:** aceptada

## Contexto

El MVP advierte de no acabar tratando una recurrencia como cientos de registros
independientes. «Entrenamiento todos los lunes» es una serie con ocurrencias, no cientos de
eventos. Además la serie debe tener historial y poder restaurarse como cualquier evento
(ADR-002), y la primera versión solo pide diaria, semanal y mensual.

## Decisión

- **Un evento recurrente es un único evento** cuya versión vigente lleva una regla
  `recurrence` (columna `jsonb` en `event_versions`). No existen filas por ocurrencia.
  `start_at`/`end_at` son los de la **primera** ocurrencia.
- Las ocurrencias se **calculan al consultar** (`expandOccurrences`, en `packages/domain`,
  sin I/O) para la ventana pedida. `GET /events` devuelve cada una con el `id` de la serie y
  su propio inicio y fin; `GET /events/:id` devuelve la serie tal como está definida.
- **Regla:** subconjunto de RRULE. `freq` (diaria, semanal, mensual), `interval`,
  `byWeekday` (solo semanal; debe incluir el día del inicio, así la primera ocurrencia es
  siempre el inicio) y fin con `until` (fecha inclusiva) o `count` (excluyentes). La
  validación vive en el dominio y la regla se guarda normalizada, de modo que dos reglas
  equivalentes son iguales y `hasChanges` no crea versiones espurias.
- **Hora de pared estable:** las ocurrencias se calculan en la zona horaria del evento, así
  que «a las 10:00» sigue siendo a las 10:00 tras un cambio de hora aunque el instante UTC
  cambie. Los eventos de todo el día conservan su número de días y la medianoche local
  (ADR-006). Una hora local inexistente (salto de primavera) se desplaza hacia delante; una
  ambigua (fin del horario de verano) usa la primera.
- **Mensual** repite el mismo día del mes y **salta** los meses que no lo tienen (31, 29 feb),
  como iCalendar, en vez de ajustar al último día.
- **Límites:** `interval` ≤ 99, `count` ≤ 999, 1000 ocurrencias por serie y consulta (una
  serie diaria en el máximo rango de 400 días devuelve 399). Si la serie no tiene `count` se
  salta directamente a la ventana en lugar de recorrer desde el inicio.
- Editar, borrar, restaurar y ver el historial actúan siempre sobre **la serie completa**.

## Consecuencias

- **Pro:** una fila y un historial por serie; cambiar la regla es una versión más, y el
  historial describe el cambio («Cada semana → Cada 2 semanas»).
- **Pro:** el dominio es puro y se prueba de forma exhaustiva (incluidos cambios de hora y
  el equivalente «saltar a la ventana» frente a enumerar desde el principio).
- **Contra, resuelto en ADR-013:** cambiar o borrar **una sola ocurrencia** o «esta y las
  siguientes» (y arrastrar una ocurrencia suelta) ya funciona; ver esa decisión para el
  cómo.
- **Contra:** la base de datos no sabe qué ocurrencias caen en un rango: para cada consulta se
  cargan las series que empezaron antes del fin de la ventana y se expanden en memoria. Es
  adecuado para un calendario personal (decenas de series); con miles habría que acotar por
  fecha de fin de serie o materializar ventanas.
- **Contra:** RRULE completo («cada segundo martes», `BYSETPOS`, `EXDATE`) queda para la
  fase 4; la columna `jsonb` permite ampliar la regla sin migrar.

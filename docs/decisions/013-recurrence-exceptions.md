# ADR-013: Excepciones de una serie

**Estado:** aceptada

## Contexto

ADR-008 dejaba pendiente poder cambiar o borrar «solo esta ocurrencia» o «esta y las
siguientes» de una serie, y ya anticipaba el camino: una excepción como un evento propio con
`events.series_id` (existente desde el principio, sin usar) apuntando a la serie madre. Faltaba
decidir cómo identificar qué ocurrencia sustituye cada excepción, cómo tratar «esta y las
siguientes», y cómo mantener la concurrencia sencilla.

## Decisión

- **Nueva columna `events.recurrence_id`** (timestamptz, nullable): el instante exacto de la
  ocurrencia original que una excepción sustituye. `series_id` ahora tiene FK a `events(id)`, y
  solo tiene sentido si `series_id` no es nulo (`CHECK`); única por `(series_id, recurrence_id)`
  (una ocurrencia solo se puede sustituir una vez).
- **«Solo esta ocurrencia»** (edición o borrado) crea (o edita, si ya existe) esa excepción: un
  evento normal con su propio historial de versiones. Al expandir la serie
  (`occurrencesOf`/`listEvents`, y el cálculo de recordatorios activos), se excluyen las fechas
  que ya tienen una excepción (borrada o no) y se añaden las excepciones vivas como su propio
  evento. Una excepción nunca tiene regla de repetición propia ni admite una: el cuerpo de la
  petición la ignora si llega.
- **«Esta y las siguientes» no usa excepciones**: parte la serie en dos
  (`splitRecurrenceAt` en `packages/domain`, función pura). La serie original se trunca con
  `until` = el día antes de la ocurrencia elegida, o se borra entera si esa ocurrencia era la
  primera. Se crea una serie nueva, propia, que empieza ahí con el contenido editado y la misma
  cadencia (mismo `interval`/`byWeekday`; `count` recalculado con lo ya consumido si la regla lo
  usaba). Las excepciones posteriores al corte se reasignan a la serie nueva (o se borran, si el
  alcance era un borrado) para no dejarlas huérfanas.
- **API**: `PATCH`/`DELETE /events/:id` admiten `scope` (`series` por defecto, `this`,
  `following`) y `occurrenceStart` (obligatorio salvo con `series`), retrocompatibles con las
  llamadas de siempre.
- **Concurrencia**: toda escritura con `scope` distinto de `series` bloquea primero la fila de
  la serie (el mismo `FOR UPDATE OF e` que ya se usaba), así que dos ediciones a la vez sobre la
  misma serie se serializan aunque toquen ocurrencias distintas. Más simple que bloquear también
  la excepción, y suficiente para el volumen de un calendario personal.
- **Interfaz**: al guardar o borrar una ocurrencia de una serie que sigue viva (no una excepción
  ya creada), se ofrece elegir entre las tres opciones — salvo que se haya cambiado la propia
  regla de repetición, que siempre es de toda la serie (como en la mayoría de calendarios). Se
  puede arrastrar una ocurrencia suelta: crea la excepción de «solo esta ocurrencia» con la
  nueva hora. Ni «solo esta ocurrencia» ni «esta y las siguientes» ofrecen «Deshacer» (pueden
  tocar más de un evento a la vez).

## Consecuencias

- **Pro:** reutiliza casi todo lo que ya existía (versionado, restaurar, historial) sin ningún
  concepto nuevo aparte de `recurrence_id`: una excepción es un evento como cualquier otro.
- **Pro:** «esta y las siguientes» reutiliza crear y editar tal cual; lo único nuevo es partir la
  regla (`splitRecurrenceAt`), una función pura y fácil de probar.
- **Contra:** el `EXDATE`/`RECURRENCE-ID` de `.ics` (importar y exportar excepciones desde/para
  Google, Apple, Outlook) queda fuera de esta decisión; sigue sin soportarse (ADR-010).
- **Contra:** bloquear toda la serie para cualquier cambio de una sola ocurrencia es más
  restrictivo de lo necesario en teoría, pero irrelevante en la práctica para un calendario
  personal.

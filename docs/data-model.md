# Modelo de datos

> Estado: implementado hasta la fase 2 (migraciones 002–006; el versionado no necesitó
> ninguna nueva). Recordatorios y recurrencia son diseño para la fase 3.
> Regla clave (ADR-002): **cada modificación de un evento crea una nueva versión; las
> versiones nunca se modifican.**

## Usuarios y calendarios

```
users:     id, email (citext, único), name, password_hash (scrypt), created_at, updated_at
calendars: id, user_id -> users, name, color (#rrggbb), created_at, updated_at
sessions:  id, user_id -> users (ON DELETE CASCADE), token_hash (SHA-256, único), created_at, expires_at
```

Un evento pertenece a un calendario y un calendario a un usuario: toda consulta de eventos
se acota por `calendars.user_id`.

## Eventos: estado actual + historial inmutable

```
events                          event_versions
- id                            - id
- calendar_id -> calendars      - event_id  -> events.id
- series_id (nullable, sin FK)  - version   (1, 2, 3…; único por event_id)
- current_version               - title, description, location
- created_at                    - start_at / end_at (timestamptz, end > start)
- updated_at                    - timezone (IANA), all_day
                                - status: confirmed | tentative | cancelled
                                - color (nulo = el del calendario)
                                - deleted
                                - created_at, created_by -> users
                                - change_reason
```

`events.current_version` apunta a la versión vigente mediante una clave foránea compuesta
`(id, current_version) -> event_versions(event_id, version)`, **diferida**: al crear un evento
se inserta primero `events` y después su versión 1 en la misma transacción.

Las versiones son inmutables a nivel de base de datos: un trigger rechaza `UPDATE` y
`DELETE` sobre `event_versions`.

### Escritura

- **Crear:** `INSERT events` + versión 1.
- **Editar:** bloquear la fila del evento (`FOR UPDATE`), aplicar el cambio parcial sobre la
  versión actual, validar el resultado completo, insertar versión N+1 y mover
  `current_version`. Todo en una transacción. Si el resultado es idéntico al actual, no se
  crea versión (no hubo modificación).
- **Borrar:** también es una modificación: se inserta una versión N+1 con `deleted = true`
  (ADR-005). El evento desaparece de la API pero su historial se conserva.
- **Concurrencia:** `PATCH` acepta `expectedVersion`; si no coincide con la versión vigente,
  la API responde 409. Sin él, gana la última escritura (siempre serializada por el bloqueo).
- **Restaurar:** `POST /events/:id/restore/:version` copia una versión antigua como versión
  nueva (`change_reason = 'restored from version N'`); nunca se reescribe el historial.
  Restaurar un evento borrado es lo mismo (la copia lleva `deleted = false`). Si el evento
  está vivo y su contenido ya coincide con el de la versión pedida, no hay modificación y
  no se crea versión.
- **Deshacer** (UI): no existe como operación propia; es una restauración. Deshacer una
  edición restaura la versión anterior; deshacer un borrado restaura la última versión
  viva; deshacer una creación borra el evento. Se pasa `expectedVersion` para no pisar
  cambios hechos entretanto.

### Qué cambió entre versiones

No se almacena: se **deriva** de los snapshots inmutables al consultar el historial
(`describeChanges` en `packages/domain`). Cada versión devuelve `changes: [{ field, from,
to }]` respecto a la anterior (vacío en la versión 1); el cliente lo convierte en frases
como «Inicio: 21 sept, 10:00 → 21 sept, 11:00». Al no duplicar datos, nunca puede quedar
desincronizado con las versiones.

### Fechas, zonas horarias y todo el día

`start_at`/`end_at` son instantes absolutos (`timestamptz`); `timezone` es la zona IANA en la
que se creó el evento. Un evento de todo el día usa la misma representación (ADR-006):
`start_at` = medianoche local del primer día y `end_at` = medianoche local del día siguiente
al último (fin **exclusivo**). El dominio lo valida, así que las consultas por rango no
necesitan un caso especial.

Consulta por rango `[from, to)`: eventos vigentes, no borrados, con
`start_at < to AND end_at > from` (un evento que termina justo en `from` no se incluye).

## Recordatorios (fase 3)

```
event_reminders: id, event_id, minutes_before, channel
```

MVP: canal `in_app`.

## Eventos vs. ocurrencias (fase 3)

Una recurrencia no son N eventos independientes. MVP: `events.series_id` nullable (ya existe,
sin uso). Fase posterior: `event_series` (regla de recurrencia, zona horaria) y
`event_occurrences`.

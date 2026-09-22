# Modelo de datos

> Estado: implementado hasta la fase 4 (migraciones 002–014).
> Regla clave (ADR-002): **cada modificación de un evento crea una nueva versión; las
> versiones nunca se modifican.**

## Usuarios y calendarios

```
users:     id, email (citext, único), name, password_hash (scrypt), created_at, updated_at
calendars: id, user_id -> users, name, color (#rrggbb), created_at, updated_at
sessions:  id, user_id -> users (ON DELETE CASCADE), token_hash (SHA-256, único), created_at, expires_at
categories: id, user_id -> users, name (citext, único por usuario), color (#rrggbb), created_at, updated_at
calendar_members:       calendar_id, user_id -> users, role (viewer|editor), status (pending|accepted),
                        invited_by, created_at, responded_at        PK (calendar_id, user_id)
calendar_feeds:         calendar_id (PK), token_hash (SHA-256, único), created_at
calendar_subscriptions: calendar_id (PK), url, timezone, last_synced_at, last_attempt_at, last_error
```

Un evento pertenece a un calendario y un calendario a un usuario (el propietario). Toda consulta
de eventos se acota por acceso: propietario **o** miembro con invitación aceptada (ADR-011). Las
invitaciones pendientes no dan acceso. `events.uid` guarda el UID externo de los eventos que
vienen de una importación o de una suscripción (ADR-010).

## Eventos: estado actual + historial inmutable

```
events                          event_versions
- id                            - id
- calendar_id -> calendars      - event_id  -> events.id
- series_id -> events.id        - version   (1, 2, 3…; único por event_id)
  (nullable; es una excepción)  - title, description, location
- recurrence_id (timestamptz;   - start_at / end_at (timestamptz, end > start)
  nullable; solo si hay         - timezone (IANA), all_day
  series_id; único junto a      - status: confirmed | tentative | cancelled
  series_id)                    - color (nulo = el de la categoría o el calendario)
- current_version               - category_id -> categories (nulo = sin categoría)
- created_at                    - recurrence (jsonb; nulo = no se repite)
- updated_at                    - deleted
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

### Categorías

Cada evento puede tener una categoría (`category_id`, parte del contenido versionado: cambiarla
crea versión y sale en el historial). Se crean y se renombran/recolorean, pero **no se borran**:
las versiones son inmutables y la referencian. El color de un evento se resuelve como color
propio, si no el de su categoría y, si no, el de su calendario.

## Recurrencia: series y ocurrencias

Un evento recurrente es **un solo evento** cuya versión vigente lleva la regla en `recurrence`
(ADR-008); no hay filas por ocurrencia. `start_at`/`end_at` son los de la primera ocurrencia y
el resto se calcula al consultar con `expandOccurrences` (`packages/domain`).

```
recurrence = { freq: 'daily' | 'weekly' | 'monthly',
               interval,              -- cada N días/semanas/meses (1–99)
               byWeekday?,            -- solo weekly; 0 = lunes … 6 = domingo
               until? | count? }      -- excluyentes; sin ninguno, no termina
```

- `GET /events?from&to` expande las series a ocurrencias (mismo `id`, inicio y fin propios).
  `GET /events/:id` devuelve la serie tal como está definida.
- Editar y borrar admiten tres alcances (`scope`, ver ADR-013): `series` (todos, por
  defecto), `this` (solo una ocurrencia) y `following` (esa ocurrencia y las siguientes).
  Restaurar e historial no necesitan `scope`: una excepción ya creada es un evento normal,
  con sus propios `GET /events/:id/versions` y `POST /events/:id/restore/:version`.
- **Excepción de una sola ocurrencia** (`scope: 'this'`): un evento propio con
  `events.series_id` → id de la serie madre (con FK) y `events.recurrence_id` (timestamptz) →
  instante exacto de la ocurrencia original que sustituye. Única por `(series_id,
recurrence_id)`. No tiene `recurrence` propia. La expansión de la serie (`occurrencesOf` en
  `events.service.ts`) excluye esas fechas y añade la excepción como su propio evento.
- **"Esta y las siguientes"** (`scope: 'following'`): no usa excepciones; parte la serie en
  dos (`splitRecurrenceAt` en `packages/domain`). La serie original se trunca con
  `until = día anterior`, o se borra entera si se cortaba en la primera ocurrencia. Se crea
  una serie nueva a partir de ahí, con la misma cadencia (`count` recalculado si aplica). Las
  excepciones ya existentes con `recurrence_id` posterior al corte se reasignan a la serie
  nueva (o se borran, si el alcance era un borrado).

## Recordatorios

```
event_reminders: id, event_id -> events (ON DELETE CASCADE), minutes_before (0–40320),
                 channel ('in_app'), created_at; único (event_id, minutes_before, channel)
```

No forman parte del contenido versionado (cambiarlos no crea versión; restaurar no los toca). En
una serie se aplican a cada ocurrencia. `GET /reminders/active` calcula al vuelo los avisos cuya
hora ya pasó y cuya ocurrencia no ha terminado (ADR-009).

## Búsqueda

`GET /events/search?q=` busca en título, descripción y ubicación con `unaccent` + `ILIKE`
(sin distinguir mayúsculas ni acentos; `%` y `_` se tratan como texto). Recorre cualquier fecha,
usa el contenido vigente y devuelve cada serie una sola vez.

## Calendarios compartidos

Roles y permisos en el ADR-011. Resumen: propietario, editor (escribe eventos) y lector (solo lee).
Solo el propietario gestiona miembros, ajustes, enlace `.ics` y suscripción. Cada versión de un
evento guarda `created_by`, y el historial muestra su autor.

## Interoperabilidad

- **Exportar / importar** un calendario en `.ics`. Importar es un _upsert_ por UID que crea
  versiones con `change_reason = 'import'` (o `'sync'` al sincronizar una URL).
- **Enlace de suscripción** de solo lectura (`calendar_feeds`), con token del que solo se guarda el
  hash.
- **Suscripción a una URL** (`calendar_subscriptions`): el calendario refleja un `.ics` externo y es de
  solo lectura para todos. Detalles, límites de seguridad (SSRF) y alcance en el ADR-010.

## Zona horaria de un evento

`timezone` (IANA) es la zona en la que se creó y en la que se interpretan sus horas y su
repetición (ADR-012); los instantes `start_at`/`end_at` son absolutos. La interfaz dibuja siempre
en la zona del navegador.

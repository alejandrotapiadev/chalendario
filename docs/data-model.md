# Modelo de datos

> Estado: diseño. Las tablas se crearán con migraciones en las fases 1 y 2.
> Regla clave (ADR-002): **cada modificación de un evento crea una nueva versión; las
> versiones nunca se modifican.**

## Eventos: estado actual + historial inmutable

```
events                          event_versions
- id                            - id
- calendar_id                   - event_id  -> events.id
- series_id (nullable)          - version   (1, 2, 3…; único por event_id)
- current_version               - title
- created_at                    - description
- updated_at                    - start_at / end_at
                                - timezone
                                - all_day
                                - location
                                - status
                                - created_at, created_by
                                - change_reason
```

`events.current_version` apunta a la versión vigente. Editar = insertar una fila nueva en
`event_versions` y actualizar `current_version`, en una sola transacción. Restaurar una
versión antigua también crea una versión nueva (copia de la antigua); no se reescribe el
historial.

Evolución posible: guardar además un `changes` (JSON `{campo: {from, to}}`) por versión.

## Recordatorios

```
event_reminders: id, event_id, minutes_before, channel
```

MVP: canal `in_app`.

## Eventos vs. ocurrencias

Una recurrencia no son N eventos independientes. MVP: `events.series_id` nullable. Fase
posterior: `event_series` (regla de recurrencia, zona horaria) y `event_occurrences`.

## Usuarios y calendarios

`users` (email `citext`), `calendars` (pertenecen a un usuario; color/categoría).

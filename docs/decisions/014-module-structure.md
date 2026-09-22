# ADR-014: Sin módulos separados para recurrencia y versionado

**Estado:** aceptada

## Contexto

`MVP.txt` proponía una separación lógica con módulos `recurrence` y `versioning` junto a
`auth`, `calendars`, `events` y `reminders`. En la práctica, desde la fase 1, ninguno de los
dos llegó a existir como módulo de `apps/api/src/modules/`:

- **Versionado** (ADR-002): no es un caso de uso propio con sus propias rutas; es un
  mecanismo transversal que usan `events` (y, desde ADR-013, sus excepciones) en cada
  escritura. Vive como `appendVersion` dentro de `events.service.ts`, apoyado en
  `hasChanges`/`describeChanges` de `packages/domain`.
- **Recurrencia** (ADR-008): es lógica de dominio pura (expandir una regla en ocurrencias,
  partir una serie en dos), sin I/O ni estado — encaja mejor en `packages/domain` que en un
  módulo de la API con sus propias rutas. La API solo la consume desde `events.service.ts`.

## Decisión

Dejarlo como está: no crear módulos `recurrence` ni `versioning` en `apps/api/src/modules/`.

- El versionado sigue siendo un mecanismo dentro del módulo `events` (y de cualquier otro
  módulo que en el futuro necesite historial, si lo hubiera).
- La recurrencia sigue siendo lógica pura en `packages/domain/src/recurrence.ts`, consumida
  por `events` (ocurrencias, excepciones) y `reminders` (avisos activos).

## Consecuencias

- **Pro:** ninguno de los dos conceptos tiene entidad propia con rutas HTTP o tablas
  propias; forzar un módulo habría sido una carpeta con un `*.routes.ts` vacío.
- **Pro:** la recurrencia, al vivir en el dominio puro, se reutiliza sin depender de
  Fastify ni de la base de datos (se prueba con Vitest normal, sin PostgreSQL).
- **Contra:** quien busque "recurrencia" o "versionado" como conceptos de primer nivel no
  los encontrará como carpetas propias en `apps/api/src/modules/`; están repartidos entre
  `packages/domain` y el módulo `events`. Se documenta aquí y en `docs/architecture.md` para
  evitar la búsqueda en vano.

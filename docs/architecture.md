# Arquitectura

## Visión general

```
Frontend (apps/web)
   |
   v
API (apps/api)
   ├── auth
   ├── calendars
   ├── events
   ├── recurrence
   ├── reminders
   └── versioning
           |
           v
       PostgreSQL
```

Monolito modular: un solo proceso, con la separación lógica en módulos dentro de
`apps/api/src/modules/<módulo>`. Cada módulo registra sus rutas en `buildApp`
(`apps/api/src/app.ts`). Los módulos no acceden a las tablas de otros: se hablan por su
interfaz pública.

`packages/domain` contiene la lógica pura (sin I/O ni dependencias de framework), de modo
que se pueda testear en aislamiento y reutilizar en el frontend (p. ej. expandir
recurrencias). `packages/shared` contiene solo tipos/contratos de la API.

## Lo que NO hay (todavía)

Microservicios, Redis, Event Sourcing, worker de notificaciones. Se añadirán cuando una
necesidad real lo pida (recordatorios → worker; caché → Redis).

## Transversal

- **Configuración:** variables de entorno validadas con zod al arrancar (`config.ts`).
- **Logging:** pino (integrado en Fastify), JSON en producción, `pino-pretty` en desarrollo.
- **Salud:** `GET /health` comprueba la conexión a PostgreSQL (503 si falla).
- **Migraciones:** SQL puro en `migrations/` (ver ADR-004).
- **Testing:** Vitest; unitarios junto al código, integración en `tests/`.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`): formato, lint, typecheck, tests con
  PostgreSQL real y build.

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
(`apps/api/src/app.ts`). Cada módulo es dueño de sus tablas y solo él las escribe; los
demás usan su interfaz pública (p. ej. `events` pregunta a `calendars` si un calendario es
del usuario). La única excepción es de lectura: las consultas de eventos hacen `JOIN` con
`calendars` para acotar los resultados al usuario.

Cada módulo sigue la misma forma: `*.routes.ts` (HTTP + validación con los esquemas de
`@calendar/shared`), `*.service.ts` (casos de uso y transacciones, cuando hay lógica) y
`*.repository.ts` (SQL). Las reglas de negocio no viven aquí sino en `packages/domain`.

**Autenticación:** sesiones en cookie `HttpOnly` respaldadas por la tabla `sessions`
(ADR-007). Todo lo registrado dentro del scope protegido de `buildApp` pasa por un hook
`onRequest` que valida la cookie y fija `request.userId`; los módulos solo leen ese valor.

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
- **Recurrencia:** una regla en el evento y ocurrencias calculadas al consultar, en el dominio
  puro (ADR-008).
- **Interoperabilidad:** ICS puro en el dominio; importar es un _upsert_ por UID que crea versiones;
  enlace público de solo lectura y suscripción a URLs con descarga protegida contra SSRF. La
  sincronización periódica corre dentro del proceso de la API (ADR-010).
- **Compartir:** roles propietario/editor/lector con un único predicado de acceso en las consultas
  y un chequeo antes de escribir (ADR-011).
- **Sin conexión:** service worker de lectura en la versión compilada; escribir requiere red y los
  conflictos de edición se resuelven con un panel sobre `expectedVersion` (ADR-012).
- **Recordatorios:** calculados al consultar y consultados por el cliente cada 30 s, sin cola ni
  worker (ADR-009). El módulo `reminders` lee de `events` a través de su repositorio.
- **Testing:** Vitest; unitarios junto al código, integración en `tests/`.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`): formato, lint, typecheck, tests con
  PostgreSQL real y build.

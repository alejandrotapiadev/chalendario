# Personal Calendar

Calendario personal con historial de versiones de eventos. Los requisitos del MVP están en
[`MVP.txt`](MVP.txt); las decisiones de arquitectura, en [`docs/`](docs/).

## Requisitos

- Node.js 24+
- pnpm 12 (`npm i -g pnpm`)
- Docker (para PostgreSQL)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL en docker (crea también la BD calendar_test)
pnpm migrate:up     # aplica migrations/
pnpm dev:api        # http://localhost:3000/health
pnpm dev:web        # http://localhost:5173 (proxy /api -> :3000)
```

> Aún no hay autenticación: la API actúa como un único usuario local. No la expongas
> fuera de tu máquina.

## API

| Método y ruta           | Descripción                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `GET /health`           | Estado del servicio y de la base de datos                      |
| `GET /calendars`        | Calendarios del usuario                                        |
| `POST /calendars`       | Crear calendario (`name`, `color?`)                            |
| `PATCH /calendars/:id`  | Editar nombre o color                                          |
| `GET /events?from=&to=` | Eventos que se solapan con `[from, to)` (ISO 8601, máx. 400 d) |
| `GET /events/:id`       | Un evento                                                      |
| `POST /events`          | Crear evento (versión 1)                                       |
| `PATCH /events/:id`     | Editar: crea una versión nueva; `expectedVersion` opcional     |
| `DELETE /events/:id`    | Borrado lógico (crea una versión con `deleted`); 204           |

Los contratos (esquemas zod y DTOs) están en `packages/shared`. Errores:
`{ error, message, issues? }` con 400 (validación), 404, 409 (`version_conflict`).

## Comandos

| Comando                            | Qué hace                                       |
| ---------------------------------- | ---------------------------------------------- |
| `pnpm test`                        | Vitest. Los tests de BD requieren `pnpm db:up` |
| `pnpm lint` / `pnpm format:check`  | ESLint / Prettier                              |
| `pnpm typecheck`                   | `tsc --noEmit` en todos los paquetes           |
| `pnpm build`                       | Build del frontend                             |
| `pnpm migrate:create -- nombre`    | Nueva migración SQL en `migrations/`           |
| `pnpm migrate:up` / `migrate:down` | Aplica / revierte migraciones                  |

## Estructura

```
apps/api         API (Fastify) — monolito modular
apps/web         Frontend (React + Vite)
packages/domain  Lógica de dominio pura: eventos, versionado, recurrencia
packages/shared  Tipos compartidos entre API y web
migrations/      Migraciones SQL versionadas
tests/           Tests de integración (requieren PostgreSQL)
docs/            Arquitectura, modelo de datos y ADRs
```

## Flujo de trabajo

- Rama `main` + ramas `feature/*`; commits pequeños.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`,
  `docs:`, `chore:`, `refactor:`…
- Todo cambio de esquema va en una migración nueva; nunca se edita una ya aplicada.
- Toda decisión de arquitectura relevante se registra como ADR en `docs/decisions/`.

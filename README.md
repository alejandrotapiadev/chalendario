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

La primera vez, crea tu cuenta en la pantalla de acceso (email y contraseña de 8+
caracteres). Cuando tengas la tuya, pon `REGISTRATION_OPEN=false` en `.env` para cerrar el
alta de cuentas nuevas. Detalles en [ADR-007](docs/decisions/007-authentication.md).

En la interfaz: **arrastra** un evento para moverlo (en semana/día también a otra
hora o día, con saltos de 15 min), **arrastra su borde inferior** para cambiar la duración,
y en la vista mensual arrástralo a otro día. Escape cancela; tras cada cambio hay un aviso
con «Deshacer». La barra lateral crea, renombra y recolorea calendarios y los muestra u oculta.

## API

| Método y ruta                       | Descripción                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`               | Crear cuenta e iniciar sesión (cookie `sid`); 409 si el email existe                                                 |
| `POST /auth/login`                  | Iniciar sesión; 401 genérico si los datos no son correctos                                                           |
| `POST /auth/logout`                 | Cerrar sesión; 204                                                                                                   |
| `GET /auth/me`                      | Usuario de la sesión actual                                                                                          |
| `GET /health`                       | Estado del servicio y de la base de datos                                                                            |
| `GET /calendars`                    | Calendarios del usuario                                                                                              |
| `POST /calendars`                   | Crear calendario (`name`, `color?`)                                                                                  |
| `PATCH /calendars/:id`              | Editar nombre o color                                                                                                |
| `GET /events?from=&to=`             | Eventos que se solapan con `[from, to)` (ISO 8601, máx. 400 d)                                                       |
| `GET /events/:id`                   | Un evento                                                                                                            |
| `POST /events`                      | Crear evento (versión 1)                                                                                             |
| `PATCH /events/:id`                 | Editar: crea una versión nueva; `expectedVersion` opcional                                                           |
| `DELETE /events/:id`                | Borrado lógico (crea una versión con `deleted`); 204                                                                 |
| `GET /events/:id/versions`          | Historial (más reciente primero) con qué cambió en cada versión; funciona también con eventos borrados               |
| `GET /events/:id/versions/:version` | Una versión concreta                                                                                                 |
| `POST /events/:id/restore/:version` | Restaurar: crea una versión nueva con ese contenido (también recupera un evento borrado); `expectedVersion` opcional |

Todas las rutas salvo `/health`, `/auth/register` y `/auth/login` exigen sesión (401 si no).
Los contratos (esquemas zod y DTOs) están en `packages/shared`. Errores:
`{ error, message, issues? }` con 400 (validación), 401, 404, 409 (`version_conflict`), 429.

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

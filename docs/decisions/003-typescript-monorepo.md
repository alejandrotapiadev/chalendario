# ADR-003: Monorepo TypeScript con pnpm workspaces

**Estado:** aceptada

## Contexto

La estructura del MVP separa `apps/web`, `apps/api`, `packages/domain` y `packages/shared`.
Queremos compartir dominio y contratos entre frontend y backend.

## Decisión

- TypeScript en todo el repositorio, pnpm workspaces.
- API: Fastify. Web: React + Vite. Tests: Vitest. Lint/format: ESLint + Prettier.
- La API se ejecuta con Node 24 directamente sobre `.ts` (type stripping): sin paso de
  build. Implica `erasableSyntaxOnly` (nada de `enum` ni parameter properties) e imports
  relativos con extensión `.ts`.
- TypeScript fijado en `~6.0`: `typescript-eslint` no soporta aún TS 7. Revisar al
  actualizar typescript-eslint.

## Consecuencias

- **Pro:** Un solo lenguaje; dominio reutilizable en front y back.
- **Pro:** Sin bundling ni watch de compilación en la API.
- **Contra:** Restricciones de sintaxis por `erasableSyntaxOnly`.
- **Contra:** Si algún día se despliega la API fuera de Node ≥ 24 habrá que añadir un paso de build.

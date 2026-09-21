# ADR-004: Migraciones en SQL puro con node-pg-migrate

**Estado:** aceptada

## Contexto

El esquema debe ser reproducible: partiendo de una base vacía, ejecutar las migraciones
produce exactamente el esquema esperado.

## Decisión

Ficheros SQL numerados en `migrations/` (`001_…`, `002_…`) con secciones
`-- Up Migration` / `-- Down Migration`, ejecutados con `node-pg-migrate`. Un test de
integración (`tests/migrations.test.ts`) aplica todo sobre una base vacía y lo revierte.
Las migraciones ya aplicadas no se editan; se añade una nueva.

## Consecuencias

- **Pro:** El esquema es explícito y revisable; sin magia de ORM.
- **Pro:** Se usa SQL específico de PostgreSQL sin restricciones.
- **Contra:** Los tipos TypeScript de las filas se escriben a mano (o se generan más adelante).

# ADR-001: Usar PostgreSQL

**Estado:** aceptada

## Contexto

Necesitamos persistencia relacional con transacciones (crear versión + actualizar el
evento actual deben ser atómicos), tipos de fecha/hora con zona horaria y buen soporte de
JSON para futuros diffs de versiones.

## Decisión

PostgreSQL como única base de datos. En desarrollo, vía Docker (`docker-compose.yml`).

## Consecuencias

- **Pro:** Transacciones, `timestamptz`, `citext`, JSONB, rangos.
- **Pro:** Un solo sistema que operar.
- **Contra:** Requiere Docker o una instancia local para desarrollar y testear.

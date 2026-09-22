-- Up Migration
-- Archivar en vez de borrar (ADR-015): las versiones de los eventos referencian el
-- calendario y la categoría, y son inmutables, así que ninguno de los dos se puede borrar.
ALTER TABLE calendars ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE categories DROP COLUMN archived;
ALTER TABLE calendars DROP COLUMN archived;

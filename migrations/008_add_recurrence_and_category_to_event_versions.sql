-- Up Migration
-- `recurrence`: regla de repetición (ver RecurrenceRule en packages/domain), o NULL si el
-- evento no se repite. Es jsonb para poder ampliar la regla sin migrar el esquema. Con regla,
-- start_at/end_at son los de la primera ocurrencia y el resto se calcula al consultar.
ALTER TABLE event_versions
  ADD COLUMN recurrence jsonb CHECK (recurrence IS NULL OR jsonb_typeof(recurrence) = 'object'),
  ADD COLUMN category_id uuid REFERENCES categories (id);

CREATE INDEX event_versions_category_id_idx ON event_versions (category_id)
  WHERE category_id IS NOT NULL;

-- Down Migration
DROP INDEX event_versions_category_id_idx;
ALTER TABLE event_versions DROP COLUMN category_id, DROP COLUMN recurrence;

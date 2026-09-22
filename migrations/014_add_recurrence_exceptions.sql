-- Up Migration
-- Una excepción de serie es un evento propio (events.series_id -> el id de la serie madre)
-- que sustituye una ocurrencia concreta; recurrence_id es el instante exacto de esa
-- ocurrencia original. Solo tiene sentido junto con series_id (evento suelto: ninguno de
-- los dos). Ver ADR-008.
ALTER TABLE events
  ADD COLUMN recurrence_id timestamptz,
  ADD CONSTRAINT events_series_id_fkey FOREIGN KEY (series_id) REFERENCES events (id),
  ADD CONSTRAINT events_recurrence_id_requires_series
    CHECK (series_id IS NOT NULL OR recurrence_id IS NULL);

-- Una ocurrencia de una serie solo se puede sustituir una vez.
CREATE UNIQUE INDEX events_series_recurrence_id_idx
  ON events (series_id, recurrence_id) WHERE series_id IS NOT NULL;

-- Down Migration
DROP INDEX events_series_recurrence_id_idx;
ALTER TABLE events
  DROP CONSTRAINT events_recurrence_id_requires_series,
  DROP CONSTRAINT events_series_id_fkey,
  DROP COLUMN recurrence_id;

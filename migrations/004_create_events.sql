-- Up Migration
-- Estado actual del evento. El contenido (título, fechas…) vive en event_versions;
-- aquí solo hay identidad y un puntero a la versión vigente (ver ADR-002).
-- La clave foránea (id, current_version) -> event_versions se añade en la migración 005,
-- porque event_versions todavía no existe.
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id     uuid NOT NULL REFERENCES calendars (id),
  -- Serie recurrente a la que pertenece (fase 3). Sin FK hasta que exista event_series.
  series_id       uuid,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_calendar_id_idx ON events (calendar_id);
CREATE INDEX events_series_id_idx ON events (series_id) WHERE series_id IS NOT NULL;

-- Down Migration
DROP TABLE events;

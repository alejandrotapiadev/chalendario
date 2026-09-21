-- Up Migration
-- Historial inmutable: cada modificación de un evento inserta una fila nueva.
CREATE TABLE event_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events (id),
  version       integer NOT NULL CHECK (version >= 1),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  description   text NOT NULL DEFAULT '',
  -- Instantes absolutos. Para all_day: medianoche local (en `timezone`) del primer día
  -- y medianoche local del día siguiente al último (fin exclusivo).
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  timezone      text NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  location      text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  color         text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Borrar un evento también es una modificación: crea una versión con deleted = true.
  deleted       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES users (id),
  change_reason text,
  UNIQUE (event_id, version),
  CHECK (end_at > start_at)
);

-- Consultas por rango de fechas (vistas mes/semana/día).
CREATE INDEX event_versions_start_at_idx ON event_versions (start_at);

CREATE FUNCTION forbid_event_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_versions are immutable: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER event_versions_immutable
  BEFORE UPDATE OR DELETE ON event_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_event_version_mutation();

-- El evento apunta a una versión que existe. Diferida porque, al crear un evento, se
-- inserta primero la fila de events y después su versión 1 dentro de la misma transacción.
ALTER TABLE events
  ADD CONSTRAINT events_current_version_fk
  FOREIGN KEY (id, current_version) REFERENCES event_versions (event_id, version)
  DEFERRABLE INITIALLY DEFERRED;

-- Down Migration
ALTER TABLE events DROP CONSTRAINT events_current_version_fk;
DROP TRIGGER event_versions_immutable ON event_versions;
DROP FUNCTION forbid_event_version_mutation();
DROP TABLE event_versions;

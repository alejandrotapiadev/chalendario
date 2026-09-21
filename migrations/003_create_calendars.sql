-- Up Migration
CREATE TABLE calendars (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  color      text NOT NULL DEFAULT '#3b82f6' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendars_user_id_idx ON calendars (user_id);

-- Down Migration
DROP TABLE calendars;

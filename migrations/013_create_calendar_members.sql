-- Up Migration
-- Calendarios compartidos. El propietario es `calendars.user_id`; el resto de personas con
-- acceso están aquí. La fila nace `pending` (invitación) y pasa a `accepted` cuando el
-- invitado la acepta; rechazar, salir o que el propietario lo quite borra la fila.
CREATE TABLE calendar_members (
  calendar_id  uuid NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('viewer', 'editor')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  invited_by   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (calendar_id, user_id)
);

-- «¿A qué calendarios tiene acceso este usuario?» y «¿qué invitaciones tiene?».
CREATE INDEX calendar_members_user_idx ON calendar_members (user_id, status);

-- Down Migration
DROP TABLE calendar_members;

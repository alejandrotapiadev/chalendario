-- Up Migration
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Nulo hasta que se implemente la autenticación (ver docs/data-model.md).
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE users;

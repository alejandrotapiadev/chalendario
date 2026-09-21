-- Up Migration
-- Categorías de eventos (p. ej. «Salud», «Trabajo»). Un evento referencia una categoría desde
-- su versión (event_versions.category_id), y las versiones son inmutables: por eso una
-- categoría no se puede borrar (la FK lo impide); se renombra o se recolorea.
CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  name       citext NOT NULL CHECK (length(btrim(name::text)) > 0),
  color      text NOT NULL DEFAULT '#8b5cf6' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- Down Migration
DROP TABLE categories;

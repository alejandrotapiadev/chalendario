-- Up Migration
-- citext: emails y nombres de usuario sin distinguir mayúsculas (tabla users, fase 1).
CREATE EXTENSION IF NOT EXISTS citext;

-- Down Migration
DROP EXTENSION IF EXISTS citext;

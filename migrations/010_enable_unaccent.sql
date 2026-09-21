-- Up Migration
-- unaccent: la búsqueda encuentra «Reunión» al escribir «reunion».
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Down Migration
DROP EXTENSION IF EXISTS unaccent;

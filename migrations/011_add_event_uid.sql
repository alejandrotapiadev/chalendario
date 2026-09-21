-- Up Migration
-- UID externo del evento (iCalendar). Es identidad del evento, no contenido versionado: lo
-- fija la importación o la sincronización con una URL para reconocer el mismo evento en la
-- siguiente descarga y actualizarlo en vez de duplicarlo. Los eventos creados en la app no
-- lo tienen (al exportarlos se usa su id).
ALTER TABLE events ADD COLUMN uid text;

CREATE UNIQUE INDEX events_calendar_uid_idx ON events (calendar_id, uid) WHERE uid IS NOT NULL;

-- Down Migration
DROP INDEX events_calendar_uid_idx;
ALTER TABLE events DROP COLUMN uid;

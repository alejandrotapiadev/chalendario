-- Up Migration
-- Recordatorios de un evento: «N minutos antes». No se versionan: no forman parte del
-- contenido del evento y cambiarlos no debe llenar el historial. Con un evento recurrente,
-- se aplican a cada ocurrencia.
CREATE TABLE event_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  minutes_before integer NOT NULL CHECK (minutes_before BETWEEN 0 AND 40320),
  channel        text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, minutes_before, channel)
);

-- Down Migration
DROP TABLE event_reminders;

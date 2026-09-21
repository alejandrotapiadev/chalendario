-- Up Migration
-- Enlace público de solo lectura (formato .ics) para suscribirse a un calendario desde Google,
-- Apple, Outlook… Solo se guarda el hash del token: el enlace se muestra al crearlo y, si se
-- pierde, se regenera (lo que invalida el anterior).
CREATE TABLE calendar_feeds (
  calendar_id uuid PRIMARY KEY REFERENCES calendars (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Calendario que refleja una URL .ics externa. Mientras exista la suscripción, los eventos
-- del calendario los gestiona la sincronización y no se pueden editar aquí.
CREATE TABLE calendar_subscriptions (
  calendar_id    uuid PRIMARY KEY REFERENCES calendars (id) ON DELETE CASCADE,
  url            text NOT NULL,
  -- Zona horaria para las horas «flotantes» y los eventos de todo el día del feed.
  timezone       text NOT NULL,
  last_synced_at timestamptz,
  -- Último intento (con o sin éxito): evita reintentar cada pocos minutos una URL que falla.
  last_attempt_at timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE calendar_subscriptions;
DROP TABLE calendar_feeds;

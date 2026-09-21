import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Db } from './db.ts';
import { registerErrorHandler } from './errors.ts';
import { registerDevAuth } from './modules/auth/dev-user.ts';
import { registerCalendarRoutes } from './modules/calendars/calendars.routes.ts';
import { registerEventRoutes } from './modules/events/events.routes.ts';
import { registerHealthRoutes } from './routes/health.ts';

export interface AppDeps {
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Email del usuario local mientras no haya autenticación real. */
  devUserEmail?: string;
}

/**
 * Monolito modular: cada módulo (auth, calendars, events y, más adelante, recurrence,
 * reminders y versioning) registra aquí sus rutas. Ver docs/architecture.md.
 */
export function buildApp({
  db,
  logger = false,
  devUserEmail = 'me@personal-calendar.local',
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerErrorHandler(app);
  registerHealthRoutes(app, db);

  // Todo lo que cuelga de este scope requiere un usuario (request.userId).
  app.register(async (authed) => {
    registerDevAuth(authed, db, devUserEmail);
    registerCalendarRoutes(authed, db);
    registerEventRoutes(authed, db);
  });

  return app;
}

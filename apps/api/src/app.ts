import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Db } from './db.ts';
import { registerErrorHandler } from './errors.ts';
import {
  registerAuthRoutes,
  registerSessionRoutes,
  requireSession,
  type AuthOptions,
} from './modules/auth/auth.routes.ts';
import { DEFAULT_SCRYPT } from './modules/auth/password.ts';
import { registerCalendarRoutes } from './modules/calendars/calendars.routes.ts';
import { registerCategoryRoutes } from './modules/categories/categories.routes.ts';
import { registerEventRoutes } from './modules/events/events.routes.ts';
import { registerFeedRoute, registerInteropRoutes } from './modules/interop/interop.routes.ts';
import { defaultFetchIcs, type FetchIcs } from './modules/interop/interop.service.ts';
import { registerReminderRoutes } from './modules/reminders/reminders.routes.ts';
import { registerHealthRoutes } from './routes/health.ts';

export interface AppDeps extends Partial<AuthOptions> {
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Descarga de `.ics` externos; se sustituye en las pruebas para no usar la red. */
  fetchIcs?: FetchIcs;
}

/**
 * Monolito modular: cada módulo (auth, calendars, categories, events, reminders) registra aquí sus rutas. Ver docs/architecture.md.
 */
export function buildApp({
  db,
  logger = false,
  secureCookies = false,
  registrationOpen = true,
  rateLimit: limitLogins = true,
  scrypt = DEFAULT_SCRYPT,
  fetchIcs = defaultFetchIcs,
}: AppDeps): FastifyInstance {
  const auth: AuthOptions = { secureCookies, registrationOpen, rateLimit: limitLogins, scrypt };
  const app = Fastify({ logger });

  registerErrorHandler(app);
  app.register(cookie);
  // `global: false`: el límite solo se aplica a las rutas que lo piden (login y registro).
  app.register(rateLimit, { global: false });

  // Públicas.
  registerHealthRoutes(app, db);
  app.register(async (open) => {
    registerAuthRoutes(open, db, auth);
    registerFeedRoute(open, db, { rateLimit: limitLogins });
  });

  // Todo lo que cuelga de este scope requiere sesión (request.userId).
  app.register(async (authed) => {
    requireSession(authed, db);
    registerSessionRoutes(authed, db, auth);
    registerCalendarRoutes(authed, db);
    registerCategoryRoutes(authed, db);
    registerEventRoutes(authed, db);
    registerReminderRoutes(authed, db);
    registerInteropRoutes(authed, db, fetchIcs);
  });

  return app;
}

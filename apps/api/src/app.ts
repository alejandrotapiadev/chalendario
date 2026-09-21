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
import { registerEventRoutes } from './modules/events/events.routes.ts';
import { registerHealthRoutes } from './routes/health.ts';

export interface AppDeps extends Partial<AuthOptions> {
  db: Db;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Monolito modular: cada módulo (auth, calendars, events y, más adelante, recurrence,
 * reminders y versioning) registra aquí sus rutas. Ver docs/architecture.md.
 */
export function buildApp({
  db,
  logger = false,
  secureCookies = false,
  registrationOpen = true,
  rateLimit: limitLogins = true,
  scrypt = DEFAULT_SCRYPT,
}: AppDeps): FastifyInstance {
  const auth: AuthOptions = { secureCookies, registrationOpen, rateLimit: limitLogins, scrypt };
  const app = Fastify({ logger });

  registerErrorHandler(app);
  app.register(cookie);
  // `global: false`: el límite solo se aplica a las rutas que lo piden (login y registro).
  app.register(rateLimit, { global: false });

  // Públicas.
  registerHealthRoutes(app, db);
  app.register(async (open) => registerAuthRoutes(open, db, auth));

  // Todo lo que cuelga de este scope requiere sesión (request.userId).
  app.register(async (authed) => {
    requireSession(authed, db);
    registerSessionRoutes(authed, db, auth);
    registerCalendarRoutes(authed, db);
    registerEventRoutes(authed, db);
  });

  return app;
}

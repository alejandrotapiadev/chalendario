import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Db } from './db.ts';
import { registerHealthRoutes } from './routes/health.ts';

export interface AppDeps {
  db: Db;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Monolito modular: cada módulo (auth, calendars, events, recurrence, reminders,
 * versioning) registrará aquí sus rutas. Ver docs/architecture.md.
 */
export function buildApp({ db, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerHealthRoutes(app, db);
  return app;
}

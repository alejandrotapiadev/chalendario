import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@calendar/shared';
import type { Db } from '../db.ts';

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/health', async (request, reply): Promise<HealthResponse> => {
    let database: HealthResponse['database'] = 'up';
    try {
      await db.query('SELECT 1');
    } catch (err) {
      request.log.error({ err }, 'health check: database unreachable');
      database = 'down';
    }
    if (database === 'down') reply.code(503);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
}

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importIcsSchema, subscribeSchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { NotFoundError } from '../../errors.ts';
import {
  FEED_FILE,
  createFeed,
  deleteFeed,
  exportCalendar,
  feedStatus,
  importIcs,
  readFeed,
  subscribe,
  syncCalendar,
  unsubscribe,
  type FetchIcs,
} from './interop.service.ts';

const params = z.object({ id: z.uuid() });

/** Nombre de fichero ASCII a partir del nombre del calendario. */
function fileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'calendario';
}

/** Rutas con sesión: importar, exportar, enlace de suscripción y sincronización con una URL. */
export function registerInteropRoutes(app: FastifyInstance, db: Db, fetchIcs: FetchIcs): void {
  app.get('/calendars/:id/export.ics', async (request, reply) => {
    const { id } = params.parse(request.params);
    const { name, text } = await exportCalendar(db, request.userId, id);
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName(name)}.ics"`)
      .send(text);
  });

  // El cuerpo lleva el `.ics` entero en JSON: se sube el límite por defecto (1 MiB).
  app.post('/calendars/:id/import', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const { id } = params.parse(request.params);
    return importIcs(db, request.userId, id, importIcsSchema.parse(request.body));
  });

  app.get('/calendars/:id/feed', async (request) => {
    const { id } = params.parse(request.params);
    return feedStatus(db, request.userId, id);
  });

  app.post('/calendars/:id/feed', async (request, reply) => {
    const { id } = params.parse(request.params);
    return reply.code(201).send(await createFeed(db, request.userId, id));
  });

  app.delete('/calendars/:id/feed', async (request, reply) => {
    const { id } = params.parse(request.params);
    await deleteFeed(db, request.userId, id);
    return reply.code(204).send();
  });

  app.post('/subscriptions', async (request, reply) => {
    const input = subscribeSchema.parse(request.body);
    return reply.code(201).send(await subscribe(db, request.userId, input, fetchIcs));
  });

  app.post('/calendars/:id/sync', async (request) => {
    const { id } = params.parse(request.params);
    return syncCalendar(db, request.userId, id, fetchIcs);
  });

  app.delete('/calendars/:id/subscription', async (request, reply) => {
    const { id } = params.parse(request.params);
    await unsubscribe(db, request.userId, id);
    return reply.code(204).send();
  });
}

/**
 * Feed público: el token de la URL es la única credencial, así que es largo y aleatorio, se puede
 * revocar y no se escribe en los logs (ver `redactFeedToken`). Solo lectura.
 */
export function registerFeedRoute(
  app: FastifyInstance,
  db: Db,
  opts: { rateLimit: boolean },
): void {
  const limited = opts.rateLimit
    ? { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }
    : {};

  app.get('/feeds/:file', limited, async (request, reply) => {
    const { file } = z.object({ file: z.string() }).parse(request.params);
    const match = FEED_FILE.exec(file);
    const text = match ? await readFeed(db, match[1]!) : null;
    if (text === null) throw new NotFoundError('Calendario');

    const etag = `"${createHash('sha1').update(text).digest('hex')}"`;
    reply.header('etag', etag).header('cache-control', 'private, max-age=0, must-revalidate');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.header('content-type', 'text/calendar; charset=utf-8').send(text);
  });
}

/** Sustituye el token de una URL de feed por `[redacted]` para que no aparezca en los logs. */
export function redactFeedToken(url: string): string {
  return url.replace(/(\/feeds\/)[^/?#]+/, '$1[redacted]');
}

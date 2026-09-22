import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createEventSchema,
  deleteEventQuerySchema,
  listEventsQuerySchema,
  restoreEventSchema,
  searchEventsQuerySchema,
  updateEventSchema,
  versionParamsSchema,
} from '@calendar/shared';
import type { Db } from '../../db.ts';
import {
  createEvent,
  deleteEvent,
  getEvent,
  getVersion,
  listEvents,
  listVersions,
  restoreVersion,
  searchEvents,
  updateEvent,
} from './events.service.ts';

const params = z.object({ id: z.uuid() });

export function registerEventRoutes(app: FastifyInstance, db: Db): void {
  app.get('/events', async (request) => {
    const query = listEventsQuerySchema.parse(request.query);
    return listEvents(db, request.userId, query);
  });

  // Rutas estáticas: tienen prioridad sobre `/events/:id`.
  app.get('/events/search', async (request) => {
    const query = searchEventsQuerySchema.parse(request.query);
    return searchEvents(db, request.userId, query);
  });

  app.get('/events/:id', async (request) => {
    const { id } = params.parse(request.params);
    return getEvent(db, request.userId, id);
  });

  app.post('/events', async (request, reply) => {
    const input = createEventSchema.parse(request.body);
    const event = await createEvent(db, request.userId, input);
    return reply.code(201).send(event);
  });

  app.patch('/events/:id', async (request) => {
    const { id } = params.parse(request.params);
    const input = updateEventSchema.parse(request.body);
    return updateEvent(db, request.userId, id, input);
  });

  app.delete('/events/:id', async (request, reply) => {
    const { id } = params.parse(request.params);
    const query = deleteEventQuerySchema.parse(request.query);
    await deleteEvent(db, request.userId, id, query);
    return reply.code(204).send();
  });

  app.get('/events/:id/versions', async (request) => {
    const { id } = params.parse(request.params);
    return listVersions(db, request.userId, id);
  });

  app.get('/events/:id/versions/:version', async (request) => {
    const { id, version } = versionParamsSchema.parse(request.params);
    return getVersion(db, request.userId, id, version);
  });

  app.post('/events/:id/restore/:version', async (request) => {
    const { id, version } = versionParamsSchema.parse(request.params);
    const { expectedVersion } = restoreEventSchema.parse(request.body ?? {});
    return restoreVersion(db, request.userId, id, version, expectedVersion);
  });
}

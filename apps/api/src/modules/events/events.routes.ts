import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createEventSchema, listEventsQuerySchema, updateEventSchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { createEvent, deleteEvent, getEvent, listEvents, updateEvent } from './events.service.ts';

const params = z.object({ id: z.uuid() });

export function registerEventRoutes(app: FastifyInstance, db: Db): void {
  app.get('/events', async (request) => {
    const query = listEventsQuerySchema.parse(request.query);
    return listEvents(db, request.userId, query);
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
    await deleteEvent(db, request.userId, id);
    return reply.code(204).send();
  });
}

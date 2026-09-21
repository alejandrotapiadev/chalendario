import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createCalendarSchema, updateCalendarSchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { NotFoundError } from '../../errors.ts';
import { insertCalendar, listCalendars, updateCalendar } from './calendars.repository.ts';

const params = z.object({ id: z.uuid() });

export function registerCalendarRoutes(app: FastifyInstance, db: Db): void {
  app.get('/calendars', async (request) => listCalendars(db, request.userId));

  app.post('/calendars', async (request, reply) => {
    const input = createCalendarSchema.parse(request.body);
    const calendar = await insertCalendar(db, request.userId, input);
    return reply.code(201).send(calendar);
  });

  app.patch('/calendars/:id', async (request) => {
    const { id } = params.parse(request.params);
    const input = updateCalendarSchema.parse(request.body);
    const calendar = await updateCalendar(db, request.userId, id, input);
    if (!calendar) throw new NotFoundError('Calendario');
    return calendar;
  });
}

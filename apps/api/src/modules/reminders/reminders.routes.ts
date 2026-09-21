import type { FastifyInstance } from 'fastify';
import { activeRemindersQuerySchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { activeReminders } from './reminders.service.ts';

export function registerReminderRoutes(app: FastifyInstance, db: Db): void {
  app.get('/reminders/active', async (request) => {
    const { at } = activeRemindersQuerySchema.parse(request.query);
    return activeReminders(db, request.userId, at ? new Date(at) : new Date());
  });
}

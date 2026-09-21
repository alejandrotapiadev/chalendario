import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inviteSchema, updateMemberSchema } from '@calendar/shared';
import type { Db } from '../../db.ts';
import {
  invite,
  listInvitations,
  listMembers,
  removeMember,
  respondToInvitation,
  updateMemberRole,
} from './sharing.service.ts';

const calendarParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const invitationParams = z.object({ calendarId: z.uuid() });

export function registerSharingRoutes(
  app: FastifyInstance,
  db: Db,
  opts: { rateLimit: boolean },
): void {
  // Invitar por email permite comprobar si una cuenta existe: se limita el ritmo.
  const limited = opts.rateLimit
    ? { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }
    : {};

  app.get('/calendars/:id/members', async (request) => {
    const { id } = calendarParams.parse(request.params);
    return listMembers(db, request.userId, id);
  });

  app.post('/calendars/:id/members', limited, async (request, reply) => {
    const { id } = calendarParams.parse(request.params);
    const input = inviteSchema.parse(request.body);
    return reply.code(201).send(await invite(db, request.userId, id, input));
  });

  app.patch('/calendars/:id/members/:userId', async (request) => {
    const { id, userId } = memberParams.parse(request.params);
    const { role } = updateMemberSchema.parse(request.body);
    return updateMemberRole(db, request.userId, id, userId, role);
  });

  app.delete('/calendars/:id/members/:userId', async (request, reply) => {
    const { id, userId } = memberParams.parse(request.params);
    await removeMember(db, request.userId, id, userId);
    return reply.code(204).send();
  });

  app.get('/invitations', async (request) => listInvitations(db, request.userId));

  app.post('/invitations/:calendarId/accept', async (request, reply) => {
    const { calendarId } = invitationParams.parse(request.params);
    await respondToInvitation(db, request.userId, calendarId, 'accept');
    return reply.code(204).send();
  });

  app.post('/invitations/:calendarId/decline', async (request, reply) => {
    const { calendarId } = invitationParams.parse(request.params);
    await respondToInvitation(db, request.userId, calendarId, 'decline');
    return reply.code(204).send();
  });
}

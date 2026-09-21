import type { InvitationDto, InviteInput, MemberDto, MemberRole } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { AppError, ConflictError, NotFoundError } from '../../errors.ts';
import { calendarBelongsToUser } from '../calendars/calendars.repository.ts';

// El propietario es `calendars.user_id`; aquí solo viven las demás personas con acceso.
// Una invitación nace `pending` y no da acceso hasta que se acepta (ver `readableBy`).

/** Solo el propietario gestiona quién tiene acceso; a los demás el calendario no les «existe». */
async function assertOwner(db: Db, userId: string, calendarId: string): Promise<void> {
  if (!(await calendarBelongsToUser(db, userId, calendarId))) throw new NotFoundError('Calendario');
}

interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  role: MemberRole;
  status: 'pending' | 'accepted';
}

const toMember = (r: MemberRow): MemberDto => ({
  userId: r.user_id,
  email: r.email,
  name: r.name,
  role: r.role,
  status: r.status,
});

export async function listMembers(
  db: Db,
  ownerId: string,
  calendarId: string,
): Promise<MemberDto[]> {
  await assertOwner(db, ownerId, calendarId);
  const { rows } = await db.query<MemberRow>(
    `SELECT m.user_id, u.email::text AS email, u.name, m.role, m.status
       FROM calendar_members m JOIN users u ON u.id = m.user_id
      WHERE m.calendar_id = $1
      ORDER BY m.status, u.name`,
    [calendarId],
  );
  return rows.map(toMember);
}

export async function invite(
  db: Db,
  ownerId: string,
  calendarId: string,
  input: InviteInput,
): Promise<MemberDto> {
  await assertOwner(db, ownerId, calendarId);
  const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    input.email,
  ]);
  const invitee = users[0];
  if (!invitee) {
    throw new AppError(404, 'user_not_found', 'No hay ningún usuario registrado con ese email');
  }
  if (invitee.id === ownerId) {
    throw new AppError(400, 'cannot_invite_self', 'Ya eres el propietario de este calendario');
  }

  const { rowCount } = await db.query(
    `INSERT INTO calendar_members (calendar_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4) ON CONFLICT (calendar_id, user_id) DO NOTHING`,
    [calendarId, invitee.id, input.role, ownerId],
  );
  if (rowCount === 0) {
    throw new ConflictError(
      'already_member',
      'Ese usuario ya tiene acceso o una invitación pendiente',
    );
  }
  return (await listMembers(db, ownerId, calendarId)).find((m) => m.userId === invitee.id)!;
}

export async function updateMemberRole(
  db: Db,
  ownerId: string,
  calendarId: string,
  memberId: string,
  role: MemberRole,
): Promise<MemberDto> {
  await assertOwner(db, ownerId, calendarId);
  const { rowCount } = await db.query(
    'UPDATE calendar_members SET role = $3 WHERE calendar_id = $1 AND user_id = $2',
    [calendarId, memberId, role],
  );
  if (rowCount === 0) throw new NotFoundError('Miembro');
  return (await listMembers(db, ownerId, calendarId)).find((m) => m.userId === memberId)!;
}

/** Quita a un miembro. El propietario puede quitar a cualquiera; un miembro puede salir él mismo. */
export async function removeMember(
  db: Db,
  actingUserId: string,
  calendarId: string,
  memberId: string,
): Promise<void> {
  if (actingUserId !== memberId) await assertOwner(db, actingUserId, calendarId);
  const { rowCount } = await db.query(
    'DELETE FROM calendar_members WHERE calendar_id = $1 AND user_id = $2',
    [calendarId, memberId],
  );
  if (rowCount === 0) throw new NotFoundError('Miembro');
}

export async function listInvitations(db: Db, userId: string): Promise<InvitationDto[]> {
  const { rows } = await db.query<{
    calendar_id: string;
    calendar_name: string;
    calendar_color: string;
    role: MemberRole;
    inviter_name: string;
    inviter_email: string;
    created_at: Date;
  }>(
    `SELECT m.calendar_id, c.name AS calendar_name, c.color AS calendar_color, m.role,
            i.name AS inviter_name, i.email::text AS inviter_email, m.created_at
       FROM calendar_members m
       JOIN calendars c ON c.id = m.calendar_id
       JOIN users i ON i.id = m.invited_by
      WHERE m.user_id = $1 AND m.status = 'pending'
      ORDER BY m.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    calendarId: r.calendar_id,
    calendarName: r.calendar_name,
    calendarColor: r.calendar_color,
    role: r.role,
    invitedByName: r.inviter_name,
    invitedByEmail: r.inviter_email,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Aceptar da acceso; rechazar borra la invitación. */
export async function respondToInvitation(
  db: Db,
  userId: string,
  calendarId: string,
  action: 'accept' | 'decline',
): Promise<void> {
  const { rowCount } =
    action === 'accept'
      ? await db.query(
          `UPDATE calendar_members SET status = 'accepted', responded_at = now()
            WHERE calendar_id = $1 AND user_id = $2 AND status = 'pending'`,
          [calendarId, userId],
        )
      : await db.query(
          `DELETE FROM calendar_members
            WHERE calendar_id = $1 AND user_id = $2 AND status = 'pending'`,
          [calendarId, userId],
        );
  if (rowCount === 0) throw new NotFoundError('Invitación');
}

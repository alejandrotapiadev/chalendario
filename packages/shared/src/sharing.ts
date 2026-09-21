import { z } from 'zod';

export const MEMBER_ROLES = ['viewer', 'editor'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const inviteSchema = z.strictObject({
  /** Email de un usuario ya registrado. */
  email: z.email().max(254),
  role: z.enum(MEMBER_ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const updateMemberSchema = z.strictObject({ role: z.enum(MEMBER_ROLES) });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** Persona con la que se comparte un calendario (vista del propietario). */
export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  /** `pending`: invitación enviada y sin responder. */
  status: 'pending' | 'accepted';
}

/** Invitación pendiente que has recibido. */
export interface InvitationDto {
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  role: MemberRole;
  invitedByName: string;
  invitedByEmail: string;
  createdAt: string;
}

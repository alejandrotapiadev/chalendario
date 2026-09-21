import { z } from 'zod';
import { COLOR_PATTERN } from '@calendar/domain';

const name = z.string().trim().min(1).max(100);
const color = z.string().regex(COLOR_PATTERN, 'debe tener el formato #rrggbb');

export const createCalendarSchema = z.strictObject({
  name,
  color: color.optional(),
});
export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;

export const updateCalendarSchema = z.strictObject({
  name: name.optional(),
  color: color.optional(),
});
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;

export interface CalendarDto {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  /** Si refleja una URL `.ics` externa (entonces es de solo lectura), datos de la suscripción. */
  subscription: {
    /** Dominio de la URL; el resto puede contener un secreto y no se devuelve. */
    host: string;
    lastSyncedAt: string | null;
    /** Error de la última sincronización, o null si fue bien. */
    lastError: string | null;
  } | null;
}

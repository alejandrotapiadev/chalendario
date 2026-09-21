import { expandOccurrences } from '@calendar/domain';
import { REMINDER_MAX_MINUTES, type ReminderDto } from '@calendar/shared';
import type { Db } from '../../db.ts';
import { listReminderCandidates } from '../events/events.repository.ts';

const MINUTE_MS = 60_000;

/**
 * Recordatorios que deben mostrarse en el instante `at`: su hora de aviso ya pasó y la
 * ocurrencia todavía no ha terminado. Se calcula al consultar (sin tabla de avisos
 * pendientes ni worker), así que un aviso se recibe aunque la aplicación estuviera cerrada
 * cuando tocaba, mientras el evento siga en curso. Descartar el aviso es cosa del cliente.
 */
export async function activeReminders(db: Db, userId: string, at: Date): Promise<ReminderDto[]> {
  // Ningún recordatorio avisa con más antelación que esto.
  const horizon = new Date(at.getTime() + (REMINDER_MAX_MINUTES + 1) * MINUTE_MS);
  const rows = await listReminderCandidates(db, userId, at, horizon);

  const result: ReminderDto[] = [];
  for (const row of rows) {
    const occurrences = row.recurrence
      ? expandOccurrences(
          {
            startAt: row.start_at,
            endAt: row.end_at,
            timezone: row.timezone,
            allDay: row.all_day,
            recurrence: row.recurrence,
          },
          { from: at, to: horizon },
        )
      : [{ startAt: row.start_at, endAt: row.end_at }];

    for (const occurrence of occurrences) {
      for (const minutesBefore of row.reminders) {
        const triggerAt = new Date(occurrence.startAt.getTime() - minutesBefore * MINUTE_MS);
        if (triggerAt > at || occurrence.endAt <= at) continue;
        result.push({
          eventId: row.id,
          title: row.title,
          location: row.location,
          allDay: row.all_day,
          occurrenceStartAt: occurrence.startAt.toISOString(),
          occurrenceEndAt: occurrence.endAt.toISOString(),
          minutesBefore,
          triggerAt: triggerAt.toISOString(),
        });
      }
    }
  }
  return result.sort(
    (a, b) =>
      a.triggerAt.localeCompare(b.triggerAt) ||
      a.occurrenceStartAt.localeCompare(b.occurrenceStartAt) ||
      a.eventId.localeCompare(b.eventId),
  );
}

import type { ReminderDto } from '@calendar/shared';

/** Antelaciones (minutos) que ofrece el formulario. La API admite cualquier valor 0–40320. */
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

const plural = (n: number, singular: string, many: string) => `${n} ${n === 1 ? singular : many}`;

/** «10 minutos antes», «1 hora antes», «2 días antes»; 0 = «A la hora del evento». */
export function describeReminder(minutes: number): string {
  if (minutes === 0) return 'A la hora del evento';
  if (minutes % 10_080 === 0) return `${plural(minutes / 10_080, 'semana', 'semanas')} antes`;
  if (minutes % 1_440 === 0) return `${plural(minutes / 1_440, 'día', 'días')} antes`;
  if (minutes % 60 === 0) return `${plural(minutes / 60, 'hora', 'horas')} antes`;
  return `${plural(minutes, 'minuto', 'minutos')} antes`;
}

/** Identifica un aviso concreto (evento + ocurrencia + antelación) para descartarlo. */
export function reminderKey(
  r: Pick<ReminderDto, 'eventId' | 'occurrenceStartAt' | 'minutesBefore'>,
) {
  return `${r.eventId}|${r.occurrenceStartAt}|${r.minutesBefore}`;
}

/** «empieza en 10 min», «empieza en 2 h», «en curso», «empezó hace 5 min». */
export function whenLabel(occurrenceStartAt: string, now: Date): string {
  const minutes = Math.round((new Date(occurrenceStartAt).getTime() - now.getTime()) / 60_000);
  if (minutes > 0) {
    if (minutes < 60) return `empieza en ${minutes} min`;
    if (minutes < 1_440) return `empieza en ${Math.round(minutes / 60)} h`;
    return `empieza en ${Math.round(minutes / 1_440)} d`;
  }
  if (minutes === 0) return 'empieza ahora';
  const ago = -minutes;
  return ago < 60 ? `empezó hace ${ago} min` : `en curso desde hace ${Math.round(ago / 60)} h`;
}

/** Avisos aún no descartados, en el orden recibido. */
export function pending(reminders: ReminderDto[], dismissed: Set<string>): ReminderDto[] {
  return reminders.filter((r) => !dismissed.has(reminderKey(r)));
}

/** Avisos que no estaban en `known`: los que acaban de aparecer. */
export function fresh(reminders: ReminderDto[], known: Set<string>): ReminderDto[] {
  return reminders.filter((r) => !known.has(reminderKey(r)));
}

/** Descartados que siguen activos: los demás ya no hace falta recordarlos. */
export function pruneDismissed(dismissed: Set<string>, active: ReminderDto[]): Set<string> {
  const activeKeys = new Set(active.map(reminderKey));
  return new Set([...dismissed].filter((key) => activeKeys.has(key)));
}

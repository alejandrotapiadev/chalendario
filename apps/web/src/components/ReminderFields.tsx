import { REMINDERS_MAX_PER_EVENT } from '@calendar/shared';
import { REMINDER_PRESETS, describeReminder } from '../calendar/reminders.ts';

interface Props {
  /** Minutos de antelación de cada recordatorio. */
  value: number[];
  onChange: (next: number[]) => void;
}

export function ReminderFields({ value, onChange }: Props) {
  const available = REMINDER_PRESETS.filter((minutes) => !value.includes(minutes));

  return (
    <div className="field">
      <span>Recordatorios</span>
      {value.length > 0 && (
        <ul className="tags">
          {[...value]
            .sort((a, b) => a - b)
            .map((minutes) => (
              <li key={minutes} className="tag">
                {describeReminder(minutes)}
                <button
                  type="button"
                  aria-label={`Quitar recordatorio: ${describeReminder(minutes)}`}
                  onClick={() => onChange(value.filter((m) => m !== minutes))}
                >
                  ×
                </button>
              </li>
            ))}
        </ul>
      )}
      {value.length < REMINDERS_MAX_PER_EVENT && available.length > 0 && (
        <select
          aria-label="Añadir recordatorio"
          value=""
          onChange={(e) => e.target.value !== '' && onChange([...value, Number(e.target.value)])}
        >
          <option value="" disabled>
            Añadir recordatorio…
          </option>
          {available.map((minutes) => (
            <option key={minutes} value={minutes}>
              {describeReminder(minutes)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

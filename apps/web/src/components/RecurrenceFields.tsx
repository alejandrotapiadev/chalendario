import { RECURRENCE_LIMITS, type BySetPos } from '@calendar/domain';
import { isLastWeekdayInMonth, weekdayOrdinalInMonth } from '../calendar/dates.ts';
import {
  bySetPosLabel,
  WEEKDAY_LETTERS,
  WEEKDAY_LONG,
  type RepeatForm,
  type RepeatMode,
} from '../calendar/recurrence.ts';

const MONTH_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MODES: { value: RepeatMode; label: string }[] = [
  { value: 'none', label: 'No se repite' },
  { value: 'daily', label: 'Cada día' },
  { value: 'weekly', label: 'Cada semana' },
  { value: 'monthly', label: 'Cada mes' },
  { value: 'yearly', label: 'Cada año' },
];

const UNIT: Record<Exclude<RepeatMode, 'none'>, [string, string]> = {
  daily: ['día', 'días'],
  weekly: ['semana', 'semanas'],
  monthly: ['mes', 'meses'],
  yearly: ['año', 'años'],
};

interface Props {
  value: RepeatForm;
  onChange: (next: RepeatForm) => void;
  /** Día de la semana (0 = lunes) en que empieza el evento: siempre forma parte de la regla. */
  startWeekday: number;
  /** Fecha de inicio del evento (hora local), para describir las opciones de mes/año. */
  startDate: Date;
}

export function RecurrenceFields({ value, onChange, startWeekday, startDate }: Props) {
  const set = (patch: Partial<RepeatForm>) => onChange({ ...value, ...patch });
  const repeating = value.repeat !== 'none';
  const startBySetPos: BySetPos = isLastWeekdayInMonth(startDate)
    ? -1
    : (weekdayOrdinalInMonth(startDate) as BySetPos);

  const toggleWeekday = (day: number) => {
    const marked = value.weekdays.includes(day)
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day];
    set({ weekdays: marked });
  };

  return (
    <fieldset className="field repeat">
      <legend>Repetición</legend>
      <select
        aria-label="Repetir"
        value={value.repeat}
        onChange={(e) => set({ repeat: e.target.value as RepeatMode })}
      >
        {MODES.map(({ value: mode, label }) => (
          <option key={mode} value={mode}>
            {label}
          </option>
        ))}
      </select>

      {repeating && (
        <>
          <label className="inline">
            Cada
            <input
              type="number"
              min={1}
              max={RECURRENCE_LIMITS.intervalMax}
              value={value.interval}
              onChange={(e) => set({ interval: Number(e.target.value) })}
              aria-label="Intervalo"
            />
            {UNIT[value.repeat as Exclude<RepeatMode, 'none'>][value.interval === 1 ? 0 : 1]}
          </label>

          {value.repeat === 'weekly' && (
            <div className="weekdays" role="group" aria-label="Días de la semana">
              {WEEKDAY_LETTERS.map((letter, day) => {
                const isStart = day === startWeekday;
                return (
                  <button
                    key={day}
                    type="button"
                    className="weekday"
                    aria-label={WEEKDAY_LONG[day]}
                    aria-pressed={isStart || value.weekdays.includes(day)}
                    // El día en que empieza el evento siempre forma parte de la repetición.
                    disabled={isStart}
                    onClick={() => toggleWeekday(day)}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          )}

          {(value.repeat === 'monthly' || value.repeat === 'yearly') && (
            <div className="repeat-end" role="radiogroup" aria-label="Día del mes o del año">
              <label className="inline">
                <input
                  type="radio"
                  name="monthly-mode"
                  checked={value.monthlyMode === 'onDay'}
                  onChange={() => set({ monthlyMode: 'onDay' })}
                />
                El día {startDate.getDate()}
                {value.repeat === 'yearly' && ` de ${MONTH_LONG[startDate.getMonth()]}`}
              </label>
              <label className="inline">
                <input
                  type="radio"
                  name="monthly-mode"
                  checked={value.monthlyMode === 'bySetPos'}
                  onChange={() => set({ monthlyMode: 'bySetPos' })}
                />
                El {bySetPosLabel(startBySetPos, startWeekday)}
                {value.repeat === 'yearly' && ` de ${MONTH_LONG[startDate.getMonth()]}`}
              </label>
            </div>
          )}

          <div className="repeat-end" role="radiogroup" aria-label="Fin de la repetición">
            <label className="inline">
              <input
                type="radio"
                name="repeat-end"
                checked={value.endMode === 'never'}
                onChange={() => set({ endMode: 'never' })}
              />
              Nunca termina
            </label>
            <label className="inline">
              <input
                type="radio"
                name="repeat-end"
                checked={value.endMode === 'until'}
                onChange={() => set({ endMode: 'until' })}
              />
              Hasta el
              <input
                type="date"
                aria-label="Fecha de fin de la repetición"
                value={value.until}
                disabled={value.endMode !== 'until'}
                required={value.endMode === 'until'}
                onChange={(e) => set({ until: e.target.value })}
              />
            </label>
            <label className="inline">
              <input
                type="radio"
                name="repeat-end"
                checked={value.endMode === 'count'}
                onChange={() => set({ endMode: 'count' })}
              />
              Tras
              <input
                type="number"
                min={1}
                max={RECURRENCE_LIMITS.countMax}
                aria-label="Número de repeticiones"
                value={value.count}
                disabled={value.endMode !== 'count'}
                onChange={(e) => set({ count: Number(e.target.value) })}
              />
              repeticiones
            </label>
          </div>
        </>
      )}
    </fieldset>
  );
}

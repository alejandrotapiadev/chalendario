import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CalendarDto, CreateEventInput, EventDto, UpdateEventInput } from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import {
  addDays,
  browserTimezone,
  fromInputs,
  startOfDay,
  toDateInput,
  toTimeInput,
} from '../calendar/dates.ts';

/** Valores iniciales para crear un evento. */
export interface EventDraft {
  start: Date;
  end: Date;
  allDay: boolean;
}

export type DialogTarget =
  { kind: 'create'; draft: EventDraft } | { kind: 'edit'; event: EventDto };

const STATUS_LABELS: Record<EventDto['status'], string> = {
  confirmed: 'Confirmado',
  tentative: 'Provisional',
  cancelled: 'Cancelado',
};

const PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

interface Props {
  target: DialogTarget;
  calendars: CalendarDto[];
  onClose: () => void;
  /** Se llama tras guardar o borrar con éxito, para recargar los eventos. */
  onChanged: () => void;
}

interface FormState {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  color: string | null;
  status: EventDto['status'];
}

function initialState(target: DialogTarget, calendars: CalendarDto[]): FormState {
  if (target.kind === 'create') {
    const { start, end, allDay } = target.draft;
    return {
      title: '',
      calendarId: calendars[0]?.id ?? '',
      allDay,
      startDate: toDateInput(start),
      startTime: toTimeInput(start),
      endDate: toDateInput(end),
      endTime: toTimeInput(end),
      location: '',
      description: '',
      color: null,
      status: 'confirmed',
    };
  }
  const { event } = target;
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return {
    title: event.title,
    calendarId: event.calendarId,
    allDay: event.allDay,
    startDate: toDateInput(start),
    startTime: toTimeInput(start),
    // En los eventos de todo el día el fin es exclusivo; el formulario muestra el último día.
    endDate: toDateInput(event.allDay ? addDays(end, -1) : end),
    endTime: toTimeInput(end),
    location: event.location,
    description: event.description,
    color: event.color,
    status: event.status,
  };
}

function toInstants(form: FormState): { start: Date; end: Date } {
  if (form.allDay) {
    return {
      start: startOfDay(fromInputs(form.startDate)),
      end: addDays(startOfDay(fromInputs(form.endDate)), 1),
    };
  }
  return {
    start: fromInputs(form.startDate, form.startTime),
    end: fromInputs(form.endDate, form.endTime),
  };
}

export function EventDialog({ target, calendars, onClose, onChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => initialState(target, calendars));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = target.kind === 'edit' ? target.event : null;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo conectar con el servidor');
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const { start, end } = toInstants(form);
    if (!(end > start)) {
      setError('El fin debe ser posterior al inicio');
      return;
    }
    const content = {
      title: form.title,
      description: form.description,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: browserTimezone(),
      allDay: form.allDay,
      location: form.location,
      status: form.status,
      color: form.color,
    };
    if (editing) {
      const input: UpdateEventInput = { ...content, expectedVersion: editing.version };
      void run(() => api.updateEvent(editing.id, input));
    } else {
      const input: CreateEventInput = { ...content, calendarId: form.calendarId };
      void run(() => api.createEvent(input));
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit} className="form">
        <h2>{editing ? 'Editar evento' : 'Nuevo evento'}</h2>

        <label className="field">
          <span>Título</span>
          <input
            autoFocus
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={200}
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => set('allDay', e.target.checked)}
          />
          Todo el día
        </label>

        <div className="field-row">
          <label className="field">
            <span>Inicio</span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </label>
          {!form.allDay && (
            <label className="field">
              <span className="sr-only">Hora de inicio</span>
              <input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="field-row">
          <label className="field">
            <span>Fin</span>
            <input
              type="date"
              required
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </label>
          {!form.allDay && (
            <label className="field">
              <span className="sr-only">Hora de fin</span>
              <input
                type="time"
                required
                value={form.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="field-row">
          {!editing && (
            <label className="field">
              <span>Calendario</span>
              <select value={form.calendarId} onChange={(e) => set('calendarId', e.target.value)}>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Estado</span>
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as FormState['status'])}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Ubicación</span>
          <input
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            maxLength={500}
          />
        </label>

        <label className="field">
          <span>Descripción</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>

        <fieldset className="field swatches">
          <legend>Color</legend>
          <button
            type="button"
            className="swatch swatch-auto"
            aria-label="Color del calendario"
            aria-pressed={form.color === null}
            onClick={() => set('color', null)}
          >
            auto
          </button>
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              aria-label={color}
              aria-pressed={form.color === color}
              onClick={() => set('color', color)}
            />
          ))}
        </fieldset>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="form-actions">
          {editing && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`¿Eliminar «${editing.title}»?`)) {
                  void run(() => api.deleteEvent(editing.id));
                }
              }}
            >
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </dialog>
  );
}

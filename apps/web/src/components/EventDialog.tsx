import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CalendarDto,
  CategoryDto,
  CreateEventInput,
  EventDto,
  UpdateEventInput,
} from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import {
  addDays,
  browserTimezone,
  fromInputs,
  startOfDay,
  toDateInput,
  toTimeInput,
  weekdayIndex,
} from '../calendar/dates.ts';
import { STATUS_LABELS } from '../calendar/history.ts';
import {
  DEFAULT_REPEAT_FORM,
  describeRule,
  formFromRule,
  ruleFromForm,
  type RepeatForm,
} from '../calendar/recurrence.ts';
import { HistoryPanel } from './HistoryPanel.tsx';
import { RecurrenceFields } from './RecurrenceFields.tsx';
import { ReminderFields } from './ReminderFields.tsx';

/** Valores iniciales para crear un evento. */
export interface EventDraft {
  start: Date;
  end: Date;
  allDay: boolean;
}

export type DialogTarget =
  | { kind: 'create'; draft: EventDraft }
  /** `event` debe ser el evento tal como está definido (con el inicio de su primera ocurrencia). */
  | { kind: 'edit'; event: EventDto };

/** Lo que ha pasado tras una operación con éxito; permite ofrecer «Deshacer». */
export type ChangeInfo =
  | { kind: 'created'; event: EventDto }
  | { kind: 'updated'; event: EventDto; previousVersion: number }
  | { kind: 'restored'; event: EventDto; previousVersion: number }
  /** `event` es el estado justo antes de borrar. */
  | { kind: 'deleted'; event: EventDto };

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
  categories: CategoryDto[];
  onClose: () => void;
  /** Se llama tras guardar, borrar o restaurar con éxito, para recargar los eventos. */
  onChanged: (change: ChangeInfo) => void;
}

interface FormState {
  title: string;
  calendarId: string;
  categoryId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  color: string | null;
  status: EventDto['status'];
  repeat: RepeatForm;
  reminders: number[];
}

function initialState(target: DialogTarget, calendars: CalendarDto[]): FormState {
  if (target.kind === 'create') {
    const { start, end, allDay } = target.draft;
    return {
      title: '',
      calendarId: calendars[0]?.id ?? '',
      categoryId: '',
      allDay,
      startDate: toDateInput(start),
      startTime: toTimeInput(start),
      endDate: toDateInput(end),
      endTime: toTimeInput(end),
      location: '',
      description: '',
      color: null,
      status: 'confirmed',
      repeat: { ...DEFAULT_REPEAT_FORM },
      reminders: [],
    };
  }
  const { event } = target;
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return {
    title: event.title,
    calendarId: event.calendarId,
    categoryId: event.categoryId ?? '',
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
    repeat: formFromRule(event.recurrence),
    reminders: event.reminders,
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

export function EventDialog({ target, calendars, categories, onClose, onChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => initialState(target, calendars));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const editing = target.kind === 'edit' ? target.event : null;
  const isSeries = editing?.recurrence != null;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function run(action: () => Promise<ChangeInfo>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
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
      categoryId: form.categoryId || null,
      recurrence: ruleFromForm(form.repeat, weekdayIndex(start)),
      reminders: form.reminders,
    };
    if (editing) {
      const input: UpdateEventInput = { ...content, expectedVersion: editing.version };
      void run(async () => ({
        kind: 'updated',
        event: await api.updateEvent(editing.id, input),
        previousVersion: editing.version,
      }));
    } else {
      const input: CreateEventInput = { ...content, calendarId: form.calendarId };
      void run(async () => ({ kind: 'created', event: await api.createEvent(input) }));
    }
  }

  const startWeekday = weekdayIndex(fromInputs(form.startDate || toDateInput(new Date())));

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      {showHistory && editing ? (
        <HistoryPanel
          eventId={editing.id}
          categories={categories}
          busy={busy}
          onBack={() => setShowHistory(false)}
          onRestore={(version) =>
            void run(async () => ({
              kind: 'restored',
              event: await api.restoreEvent(editing.id, version, {
                expectedVersion: editing.version,
              }),
              previousVersion: editing.version,
            }))
          }
        />
      ) : (
        <form onSubmit={submit} className="form">
          <h2>{editing ? 'Editar evento' : 'Nuevo evento'}</h2>

          {isSeries && editing?.recurrence && (
            <p className="notice" role="note">
              Este evento se repite ({describeRule(editing.recurrence)}). Los cambios afectan a toda
              la serie.
            </p>
          )}

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

          <RecurrenceFields
            value={form.repeat}
            onChange={(repeat) => set('repeat', repeat)}
            startWeekday={startWeekday}
          />

          <ReminderFields
            value={form.reminders}
            onChange={(reminders) => set('reminders', reminders)}
          />

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
              <span>Categoría</span>
              <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
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
              aria-label="Color de la categoría o del calendario"
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
                  const what = isSeries
                    ? `«${editing.title}» y todas sus repeticiones`
                    : `«${editing.title}»`;
                  if (window.confirm(`¿Eliminar ${what}?`)) {
                    void run(async () => {
                      await api.deleteEvent(editing.id);
                      return { kind: 'deleted', event: editing };
                    });
                  }
                }}
              >
                Eliminar
              </button>
            )}
            {editing && (
              <button type="button" className="btn" onClick={() => setShowHistory(true)}>
                Historial
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
      )}
    </dialog>
  );
}

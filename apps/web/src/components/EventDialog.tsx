import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CalendarDto,
  CategoryDto,
  CreateEventInput,
  EventDto,
  UpdateEventInput,
} from '@calendar/shared';
import { describeChanges, weekdayIn, type EventSnapshot } from '@calendar/domain';
import { ApiError, api } from '../api.ts';
import {
  browserTimezone,
  fromInputs,
  toDateInput,
  toTimeInput,
  weekdayIndex,
} from '../calendar/dates.ts';
import { STATUS_LABELS, describeChange } from '../calendar/history.ts';
import {
  availableTimezones,
  fromWallFields,
  isTimezone,
  localEquivalent,
  toWallFields,
} from '../calendar/zoned.ts';
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

const TIMEZONES = availableTimezones();

/** Contenido de un evento tal como lo entiende el dominio, para poder compararlo. */
function snapshotOf(event: EventDto, override: UpdateEventInput = {}): EventSnapshot {
  return {
    title: override.title ?? event.title,
    description: override.description ?? event.description,
    startAt: new Date(override.startAt ?? event.startAt),
    endAt: new Date(override.endAt ?? event.endAt),
    timezone: override.timezone ?? event.timezone,
    allDay: override.allDay ?? event.allDay,
    location: override.location ?? event.location,
    status: override.status ?? event.status,
    color: override.color === undefined ? event.color : override.color,
    recurrence: override.recurrence === undefined ? event.recurrence : override.recurrence,
    categoryId: override.categoryId === undefined ? event.categoryId : override.categoryId,
    deleted: false,
  };
}

/** Otra persona (u otra pestaña) cambió el evento mientras se editaba. */
interface Conflict {
  /** Estado actual del evento, o `deleted` si ya no existe. */
  latest: EventDto | 'deleted';
  /** Lo que se intentó guardar. */
  mine: UpdateEventInput;
}

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
  /** Si se indica, el evento se muestra pero no se puede modificar (y se explica por qué). */
  readOnlyReason?: string | undefined;
  onClose: () => void;
  /** Se llama tras guardar, borrar o restaurar con éxito, para recargar los eventos. */
  onChanged: (change: ChangeInfo) => void;
}

interface FormState {
  title: string;
  calendarId: string;
  categoryId: string;
  /** Zona horaria en la que se interpretan las fechas y horas del formulario. */
  timezone: string;
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
      timezone: browserTimezone(),
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
    timezone: event.timezone,
    // Fecha y hora en la zona del propio evento (en los de todo el día el fin se muestra inclusivo).
    ...toWallFields(start, end, event.allDay, event.timezone),
    location: event.location,
    description: event.description,
    color: event.color,
    status: event.status,
    repeat: formFromRule(event.recurrence),
    reminders: event.reminders,
  };
}

/** Instantes que describe el formulario, o null si alguna fecha u hora no es válida. */
function toInstants(form: FormState): { start: Date; end: Date } | null {
  return fromWallFields(form, form.allDay, form.timezone);
}

export function EventDialog({
  target,
  calendars,
  categories,
  readOnlyReason,
  onClose,
  onChanged,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => initialState(target, calendars));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const editing = target.kind === 'edit' ? target.event : null;
  const isSeries = editing?.recurrence != null;
  const readOnly = readOnlyReason !== undefined;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function run(
    action: () => Promise<ChangeInfo>,
    /** Devuelve true si el error se gestionó (no se muestra el mensaje genérico). */
    handle?: (err: unknown) => Promise<boolean>,
  ) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      onClose();
    } catch (err) {
      if (handle && (await handle(err))) {
        setBusy(false);
        return;
      }
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo conectar con el servidor');
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isTimezone(form.timezone)) {
      setError('Zona horaria desconocida: elige una de la lista (p. ej. Europe/Madrid)');
      return;
    }
    const instants = toInstants(form);
    if (!instants) {
      setError('La fecha u hora no es válida');
      return;
    }
    const { start, end } = instants;
    if (!(end > start)) {
      setError('El fin debe ser posterior al inicio');
      return;
    }
    const content = {
      title: form.title,
      description: form.description,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: form.timezone,
      allDay: form.allDay,
      location: form.location,
      status: form.status,
      color: form.color,
      categoryId: form.categoryId || null,
      recurrence: ruleFromForm(form.repeat, weekdayIn(start, form.timezone)),
      reminders: form.reminders,
    };
    if (editing) {
      const input: UpdateEventInput = { ...content, expectedVersion: editing.version };
      void run(
        async () => ({
          kind: 'updated',
          event: await api.updateEvent(editing.id, input),
          previousVersion: editing.version,
        }),
        async (err) => {
          // 409: otra persona lo modificó. 404: lo eliminó (el servidor ya no lo considera vivo).
          const stale =
            err instanceof ApiError &&
            (err.body?.error === 'version_conflict' || err.status === 404);
          if (!stale) return false;
          try {
            setConflict({ latest: await api.getEvent(editing.id), mine: input });
          } catch (fetchErr) {
            if (!(fetchErr instanceof ApiError && fetchErr.status === 404)) return false;
            setConflict({ latest: 'deleted', mine: input });
          }
          return true;
        },
      );
    } else {
      const input: CreateEventInput = { ...content, calendarId: form.calendarId };
      void run(async () => ({ kind: 'created', event: await api.createEvent(input) }));
    }
  }

  /** Guarda los cambios propios encima de la versión que hay ahora. */
  const overwrite = () => {
    if (!editing || !conflict || conflict.latest === 'deleted') return;
    const { latest, mine } = conflict;
    void run(async () => ({
      kind: 'updated',
      event: await api.updateEvent(editing.id, { ...mine, expectedVersion: latest.version }),
      previousVersion: latest.version,
    }));
  };

  /** Descarta los cambios propios: se cierra y la pantalla se recarga con lo que hay. */
  const discard = () => {
    if (conflict && conflict.latest !== 'deleted') {
      onChanged({
        kind: 'updated',
        event: conflict.latest,
        previousVersion: conflict.latest.version,
      });
    }
    onClose();
  };

  const conflictChanges =
    conflict && conflict.latest !== 'deleted'
      ? describeChanges(snapshotOf(conflict.latest), snapshotOf(conflict.latest, conflict.mine))
      : [];
  const categoryContext = {
    categoryName: (id: string) => categories.find((c) => c.id === id)?.name,
  };

  const zoneHint = localEquivalent(
    toInstants(form)?.start ?? null,
    form.timezone,
    browserTimezone(),
  );
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

          {readOnly && (
            <p className="notice" role="note">
              {readOnlyReason}
            </p>
          )}

          <fieldset className="ro" disabled={readOnly}>
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

            <label className="field">
              <span>Zona horaria</span>
              <input
                list="timezone-options"
                aria-label="Zona horaria"
                autoComplete="off"
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
              />
              <datalist id="timezone-options">
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              {zoneHint && <span className="muted">{zoneHint}</span>}
            </label>

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
                  <select
                    value={form.calendarId}
                    onChange={(e) => set('calendarId', e.target.value)}
                  >
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
          </fieldset>

          {conflict && (
            <div className="conflict" role="alert">
              {conflict.latest === 'deleted' ? (
                <p>
                  <strong>Este evento se eliminó mientras lo editabas.</strong> Tus cambios no se
                  pueden guardar. Puedes recuperarlo desde el aviso «Deshacer» de quien lo eliminó o
                  desde su historial.
                </p>
              ) : (
                <>
                  <p>
                    <strong>Este evento cambió mientras lo editabas</strong> (ahora está en la
                    versión {conflict.latest.version}, y tú partías de la {editing?.version}).
                  </p>
                  {conflictChanges.length > 0 ? (
                    <>
                      <p className="muted">Si guardas tus cambios sobre la versión actual:</p>
                      <ul>
                        {conflictChanges.map((change) => (
                          <li key={change.field}>{describeChange(change, categoryContext)}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="muted">Tus cambios coinciden con la versión actual.</p>
                  )}
                </>
              )}
              <div className="side-editor-row">
                {conflict.latest !== 'deleted' && (
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={busy}
                    onClick={overwrite}
                  >
                    Sobrescribir con mis cambios
                  </button>
                )}
                <button type="button" className="btn btn-small" onClick={discard}>
                  {conflict.latest === 'deleted' ? 'Cerrar' : 'Descartar los míos'}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setConflict(null)}>
                  Seguir editando
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <div className="form-actions">
            {editing && !readOnly && (
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
              {readOnly ? 'Cerrar' : 'Cancelar'}
            </button>
            {!readOnly && (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Guardar
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}

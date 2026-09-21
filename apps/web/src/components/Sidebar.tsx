import { useState, type FormEvent } from 'react';
import type { CalendarDto } from '@calendar/shared';
import { ApiError } from '../api.ts';

const DEFAULT_COLOR = '#3b82f6';

interface Props {
  open: boolean;
  calendars: CalendarDto[];
  hiddenCalendars: Set<string>;
  onToggleCalendar: (id: string) => void;
  onCreateCalendar: (input: { name: string; color: string }) => Promise<unknown>;
  onUpdateCalendar: (id: string, input: { name: string; color: string }) => Promise<unknown>;
}

interface EditorProps {
  initial: { name: string; color: string };
  submitLabel: string;
  onSubmit: (value: { name: string; color: string }) => Promise<unknown>;
  onCancel: () => void;
}

function CalendarEditor({ initial, submitLabel, onSubmit, onCancel }: EditorProps) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, color });
      onCancel();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo guardar');
      setBusy(false);
    }
  }

  return (
    <form className="side-editor" onSubmit={submit}>
      <div className="side-editor-row">
        <input
          type="color"
          aria-label="Color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          autoFocus
          required
          aria-label="Nombre"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="side-editor-row">
        <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Sidebar({
  open,
  calendars,
  hiddenCalendars,
  onToggleCalendar,
  onCreateCalendar,
  onUpdateCalendar,
}: Props) {
  // id del calendario que se está editando, 'new' al crear uno, null si ninguno.
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Calendarios">
      <section>
        <h2 className="side-title">Mis calendarios</h2>
        <ul className="side-list">
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              {editing === calendar.id ? (
                <CalendarEditor
                  initial={calendar}
                  submitLabel="Guardar"
                  onSubmit={(value) => onUpdateCalendar(calendar.id, value)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="side-item">
                  <label className="side-check">
                    <input
                      type="checkbox"
                      checked={!hiddenCalendars.has(calendar.id)}
                      style={{ accentColor: calendar.color }}
                      onChange={() => onToggleCalendar(calendar.id)}
                    />
                    <span className="side-name">{calendar.name}</span>
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Editar ${calendar.name}`}
                    onClick={() => setEditing(calendar.id)}
                  >
                    ✎
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {editing === 'new' ? (
          <CalendarEditor
            initial={{ name: '', color: DEFAULT_COLOR }}
            submitLabel="Crear"
            onSubmit={onCreateCalendar}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button type="button" className="link" onClick={() => setEditing('new')}>
            + Nuevo calendario
          </button>
        )}
      </section>
    </aside>
  );
}

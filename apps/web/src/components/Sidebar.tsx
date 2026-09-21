import { useState, type FormEvent } from 'react';
import type { CalendarDto, CategoryDto } from '@calendar/shared';
import { ApiError } from '../api.ts';

interface Item {
  id: string;
  name: string;
  color: string;
}

type Value = { name: string; color: string };

interface EditorProps {
  initial: Value;
  submitLabel: string;
  onSubmit: (value: Value) => Promise<unknown>;
  onCancel: () => void;
}

function ItemEditor({ initial, submitLabel, onSubmit, onCancel }: EditorProps) {
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

interface ListProps {
  title: string;
  /** Texto del botón de alta, p. ej. «+ Nuevo calendario». */
  newLabel: string;
  defaultColor: string;
  items: Item[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onCreate: (value: Value) => Promise<unknown>;
  onUpdate: (id: string, value: Value) => Promise<unknown>;
}

/** Lista con casillas de visibilidad y edición en línea; sirve para calendarios y categorías. */
function EditableList({
  title,
  newLabel,
  defaultColor,
  items,
  hidden,
  onToggle,
  onCreate,
  onUpdate,
}: ListProps) {
  // id del elemento que se está editando, 'new' al crear uno, null si ninguno.
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <section className="side-section">
      <h2 className="side-title">{title}</h2>
      <ul className="side-list">
        {items.map((item) => (
          <li key={item.id}>
            {editing === item.id ? (
              <ItemEditor
                initial={item}
                submitLabel="Guardar"
                onSubmit={(value) => onUpdate(item.id, value)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="side-item">
                <label className="side-check">
                  <input
                    type="checkbox"
                    checked={!hidden.has(item.id)}
                    style={{ accentColor: item.color }}
                    onChange={() => onToggle(item.id)}
                  />
                  <span className="side-name">{item.name}</span>
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Editar ${item.name}`}
                  onClick={() => setEditing(item.id)}
                >
                  ✎
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? (
        <ItemEditor
          initial={{ name: '', color: defaultColor }}
          submitLabel="Crear"
          onSubmit={onCreate}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className="link" onClick={() => setEditing('new')}>
          {newLabel}
        </button>
      )}
    </section>
  );
}

interface Props {
  open: boolean;
  calendars: CalendarDto[];
  hiddenCalendars: Set<string>;
  onToggleCalendar: (id: string) => void;
  onCreateCalendar: (value: Value) => Promise<unknown>;
  onUpdateCalendar: (id: string, value: Value) => Promise<unknown>;
  categories: CategoryDto[];
  hiddenCategories: Set<string>;
  onToggleCategory: (id: string) => void;
  onCreateCategory: (value: Value) => Promise<unknown>;
  onUpdateCategory: (id: string, value: Value) => Promise<unknown>;
}

export function Sidebar({
  open,
  calendars,
  hiddenCalendars,
  onToggleCalendar,
  onCreateCalendar,
  onUpdateCalendar,
  categories,
  hiddenCategories,
  onToggleCategory,
  onCreateCategory,
  onUpdateCategory,
}: Props) {
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Calendarios y categorías">
      <EditableList
        title="Mis calendarios"
        newLabel="+ Nuevo calendario"
        defaultColor="#3b82f6"
        items={calendars}
        hidden={hiddenCalendars}
        onToggle={onToggleCalendar}
        onCreate={onCreateCalendar}
        onUpdate={onUpdateCalendar}
      />
      <EditableList
        title="Categorías"
        newLabel="+ Nueva categoría"
        defaultColor="#8b5cf6"
        items={categories}
        hidden={hiddenCategories}
        onToggle={onToggleCategory}
        onCreate={onCreateCategory}
        onUpdate={onUpdateCategory}
      />
    </aside>
  );
}

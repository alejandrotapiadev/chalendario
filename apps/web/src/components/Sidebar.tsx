import { useState, type FormEvent } from 'react';
import type { CalendarDto, CategoryDto, InvitationDto } from '@calendar/shared';
import { ApiError } from '../api.ts';
import { availableTimezones } from '../calendar/zoned.ts';

const TIMEZONES = availableTimezones();

interface Item {
  id: string;
  name: string;
  color: string;
  archived: boolean;
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
  onArchive: (id: string, archived: boolean) => Promise<unknown>;
}

/**
 * Lista con casillas de visibilidad y edición en línea; sirve para categorías. Las
 * archivadas (ADR-015) van aparte, solo con «Restaurar»: dejan de ofrecerse en eventos
 * nuevos, pero los que ya las llevan las conservan.
 */
function EditableList({
  title,
  newLabel,
  defaultColor,
  items,
  hidden,
  onToggle,
  onCreate,
  onUpdate,
  onArchive,
}: ListProps) {
  // id del elemento que se está editando, 'new' al crear uno, null si ninguno.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const active = items.filter((item) => !item.archived);
  const archived = items.filter((item) => item.archived);

  return (
    <section className="side-section">
      <h2 className="side-title">{title}</h2>
      <ul className="side-list">
        {active.map((item) => (
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
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Archivar ${item.name}`}
                  title="Archivar"
                  onClick={() => void onArchive(item.id, true)}
                >
                  🗄
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
      {archived.length > 0 && (
        <>
          <h3 className="side-subtitle muted">Archivadas</h3>
          <ul className="side-list">
            {archived.map((item) => (
              <li key={item.id}>
                <div className="side-item">
                  <span className="side-name muted">{item.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Restaurar ${item.name}`}
                    title="Restaurar"
                    onClick={() => void onArchive(item.id, false)}
                  >
                    ↺
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface CalendarsProps {
  calendars: CalendarDto[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onCreate: (value: Value) => Promise<unknown>;
  onOpenSettings: (calendar: CalendarDto) => void;
  onOpenSubscribe: () => void;
  onLeave: (calendar: CalendarDto) => void;
}

const ROLE_TAG = { editor: 'edita', viewer: 'lectura' } as const;

/**
 * Calendarios propios (con ajustes) y compartidos conmigo (con opción de dejar de verlos).
 * Los archivados (ADR-015) van en su propia sección, sin casilla de visibilidad: para
 * restaurarlos hay que abrir sus ajustes.
 */
function CalendarLists({
  calendars,
  hidden,
  onToggle,
  onCreate,
  onOpenSettings,
  onOpenSubscribe,
  onLeave,
}: CalendarsProps) {
  const [creating, setCreating] = useState(false);
  const owned = calendars.filter((c) => c.role === 'owner' && !c.archived);
  const shared = calendars.filter((c) => c.role !== 'owner' && !c.archived);
  const archived = calendars.filter((c) => c.role === 'owner' && c.archived);

  const row = (calendar: CalendarDto) => (
    <li key={calendar.id}>
      <div className="side-item">
        <label className="side-check">
          <input
            type="checkbox"
            checked={!hidden.has(calendar.id)}
            style={{ accentColor: calendar.color }}
            onChange={() => onToggle(calendar.id)}
          />
          <span className="side-name">{calendar.name}</span>
          {calendar.subscription && (
            <span
              className="side-tag"
              title={
                calendar.subscription.lastError ?? `Sincronizado con ${calendar.subscription.host}`
              }
              aria-label="Calendario sincronizado"
            >
              {calendar.subscription.lastError ? '⚠' : '↻'}
            </span>
          )}
          {calendar.role !== 'owner' && (
            <span className="side-tag" title={`De ${calendar.ownerName ?? ''}`}>
              {ROLE_TAG[calendar.role]}
            </span>
          )}
        </label>
        {calendar.role === 'owner' ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Ajustes de ${calendar.name}`}
            onClick={() => onOpenSettings(calendar)}
          >
            ⚙
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Dejar de ver ${calendar.name}`}
            onClick={() => onLeave(calendar)}
          >
            ✕
          </button>
        )}
      </div>
      {calendar.role !== 'owner' && <p className="side-owner muted">de {calendar.ownerName}</p>}
    </li>
  );

  return (
    <>
      <section className="side-section">
        <h2 className="side-title">Mis calendarios</h2>
        <ul className="side-list">{owned.map(row)}</ul>
        {creating ? (
          <ItemEditor
            initial={{ name: '', color: '#3b82f6' }}
            submitLabel="Crear"
            onSubmit={onCreate}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <>
            <button type="button" className="link" onClick={() => setCreating(true)}>
              + Nuevo calendario
            </button>
            <button type="button" className="link side-link" onClick={onOpenSubscribe}>
              + Suscribirse a una URL
            </button>
          </>
        )}
      </section>
      {shared.length > 0 && (
        <section className="side-section">
          <h2 className="side-title">Compartidos conmigo</h2>
          <ul className="side-list">{shared.map(row)}</ul>
        </section>
      )}
      {archived.length > 0 && (
        <section className="side-section">
          <h2 className="side-title">Calendarios archivados</h2>
          <ul className="side-list">
            {archived.map((calendar) => (
              <li key={calendar.id}>
                <div className="side-item">
                  <span className="side-name muted">{calendar.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Ajustes de ${calendar.name}`}
                    onClick={() => onOpenSettings(calendar)}
                  >
                    ⚙
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Invitations({
  invitations,
  onRespond,
}: {
  invitations: InvitationDto[];
  onRespond: (invitation: InvitationDto, action: 'accept' | 'decline') => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <section className="side-section invitations" aria-label="Invitaciones">
      <h2 className="side-title">Invitaciones</h2>
      <ul className="side-list">
        {invitations.map((inv) => (
          <li key={inv.calendarId} className="invitation">
            <p>
              <strong>{inv.invitedByName}</strong> te invita a «{inv.calendarName}» (
              {inv.role === 'editor' ? 'puedes editar' : 'solo lectura'})
            </p>
            <div className="side-editor-row">
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => onRespond(inv, 'accept')}
              >
                Aceptar
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onRespond(inv, 'decline')}
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Props {
  open: boolean;
  calendars: CalendarDto[];
  hiddenCalendars: Set<string>;
  onToggleCalendar: (id: string) => void;
  onCreateCalendar: (value: Value) => Promise<unknown>;
  onOpenSettings: (calendar: CalendarDto) => void;
  onOpenSubscribe: () => void;
  onLeaveCalendar: (calendar: CalendarDto) => void;
  invitations: InvitationDto[];
  onRespondInvitation: (invitation: InvitationDto, action: 'accept' | 'decline') => void;
  categories: CategoryDto[];
  hiddenCategories: Set<string>;
  onToggleCategory: (id: string) => void;
  onCreateCategory: (value: Value) => Promise<unknown>;
  onUpdateCategory: (id: string, value: Value) => Promise<unknown>;
  onArchiveCategory: (id: string, archived: boolean) => Promise<unknown>;
  onOpenTrash: () => void;
  /** Zona horaria en la que se pintan las vistas (T-10). */
  displayTimezone: string;
  onChangeDisplayTimezone: (timeZone: string) => void;
}

export function Sidebar({
  open,
  calendars,
  hiddenCalendars,
  onToggleCalendar,
  onCreateCalendar,
  onOpenSettings,
  onOpenSubscribe,
  onLeaveCalendar,
  invitations,
  onRespondInvitation,
  categories,
  hiddenCategories,
  onToggleCategory,
  onCreateCategory,
  onUpdateCategory,
  onArchiveCategory,
  onOpenTrash,
  displayTimezone,
  onChangeDisplayTimezone,
}: Props) {
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Calendarios y categorías">
      <Invitations invitations={invitations} onRespond={onRespondInvitation} />
      <CalendarLists
        calendars={calendars}
        hidden={hiddenCalendars}
        onToggle={onToggleCalendar}
        onCreate={onCreateCalendar}
        onOpenSettings={onOpenSettings}
        onOpenSubscribe={onOpenSubscribe}
        onLeave={onLeaveCalendar}
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
        onArchive={onArchiveCategory}
      />
      <section className="side-section">
        <h2 className="side-title">Zona horaria de visualización</h2>
        <select
          aria-label="Zona horaria de visualización"
          value={displayTimezone}
          onChange={(e) => onChangeDisplayTimezone(e.target.value)}
        >
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="muted">Cambia cómo se ven las horas en la cuadrícula, no las guardadas.</p>
      </section>
      <button type="button" className="link side-link" onClick={onOpenTrash}>
        🗑 Papelera
      </button>
    </aside>
  );
}

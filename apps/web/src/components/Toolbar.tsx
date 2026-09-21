import type { ReactNode } from 'react';
import type { UserDto } from '@calendar/shared';
import { viewTitle, type ViewMode } from '../calendar/dates.ts';

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'month', label: 'Mes' },
  { mode: 'week', label: 'Semana' },
  { mode: 'day', label: 'Día' },
];

interface Props {
  view: ViewMode;
  cursor: Date;
  onViewChange: (view: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreate: () => void;
  user: UserDto;
  onLogout: () => void;
  onToggleSidebar: () => void;
  /** Búsqueda y recordatorios: se pasan ya construidos para que la barra no dependa de ellos. */
  search: ReactNode;
  reminders: ReactNode;
}

export function Toolbar({
  view,
  cursor,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  onCreate,
  user,
  onLogout,
  onToggleSidebar,
  search,
  reminders,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <button
          type="button"
          className="btn btn-menu"
          aria-label="Calendarios"
          onClick={onToggleSidebar}
        >
          ☰
        </button>
        <h1 className="toolbar-title">{viewTitle(view, cursor)}</h1>
      </div>
      {search}
      <div className="toolbar-controls">
        <button type="button" className="btn" onClick={onToday}>
          Hoy
        </button>
        <div className="btn-group">
          <button type="button" className="btn" aria-label="Anterior" onClick={onPrev}>
            ‹
          </button>
          <button type="button" className="btn" aria-label="Siguiente" onClick={onNext}>
            ›
          </button>
        </div>
        <div className="btn-group" role="group" aria-label="Vista">
          {VIEWS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className="btn"
              aria-pressed={view === mode}
              onClick={() => onViewChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {reminders}
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          + Evento
        </button>
        <button type="button" className="btn" title={user.email} onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  );
}

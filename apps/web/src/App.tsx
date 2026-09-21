import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarDto, EventDto, UserDto } from '@calendar/shared';
import { ApiError, api } from './api.ts';
import {
  shiftCursor,
  startOfDay,
  visibleRange,
  weekDays,
  type ViewMode,
} from './calendar/dates.ts';
import { EventDialog, type ChangeInfo, type DialogTarget } from './components/EventDialog.tsx';
import { MonthView } from './components/MonthView.tsx';
import { TimeGridView } from './components/TimeGridView.tsx';
import { Toolbar } from './components/Toolbar.tsx';

const FALLBACK_COLOR = '#3b82f6';
const TOAST_MS = 8000;

interface Toast {
  id: number;
  message: string;
  undo?: () => Promise<unknown>;
}

/** Mensaje y acción de deshacer para cada tipo de cambio. Deshacer = restaurar (ADR-002). */
function toastFor(change: ChangeInfo): Omit<Toast, 'id'> | null {
  const { event } = change;
  switch (change.kind) {
    case 'created':
      return { message: 'Evento creado', undo: () => api.deleteEvent(event.id) };
    case 'updated':
      // Un guardado sin cambios reales no crea versión: no hay nada que deshacer.
      if (event.version === change.previousVersion) return null;
      return {
        message: 'Evento actualizado',
        undo: () =>
          api.restoreEvent(event.id, change.previousVersion, { expectedVersion: event.version }),
      };
    case 'restored':
      return {
        message: `Versión restaurada`,
        undo: () =>
          api.restoreEvent(event.id, change.previousVersion, { expectedVersion: event.version }),
      };
    case 'deleted':
      // `event` es la última versión viva; el borrado creó la siguiente.
      return {
        message: 'Evento eliminado',
        undo: () =>
          api.restoreEvent(event.id, event.version, { expectedVersion: event.version + 1 }),
      };
  }
}

/** Primera hora en punto a partir de ahora: hueco por defecto para un evento nuevo. */
function nextFullHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

interface AppProps {
  user: UserDto;
  onLogout: () => void;
}

export function App({ user, onLogout }: AppProps) {
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [calendars, setCalendars] = useState<CalendarDto[]>([]);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const range = visibleRange(view, cursor);
  const from = range.from.getTime();
  const to = range.to.getTime();

  useEffect(() => {
    api
      .listCalendars()
      .then(setCalendars)
      .catch(() => setError('No se pudo conectar con el servidor'));
  }, []);

  useEffect(() => {
    let stale = false;
    api
      .listEvents(new Date(from), new Date(to))
      .then((list) => {
        if (stale) return;
        setEvents(list);
        setError(null);
      })
      .catch(() => {
        if (!stale) setError('No se pudieron cargar los eventos');
      });
    return () => {
      stale = true;
    };
  }, [from, to, reloadKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (next: Omit<Toast, 'id'>) => setToast({ id: Date.now(), ...next });

  const handleChanged = (change: ChangeInfo) => {
    setReloadKey((k) => k + 1);
    const next = toastFor(change);
    if (next) showToast(next);
    else setToast(null);
  };

  const undo = async () => {
    const action = toast?.undo;
    if (!action) return;
    setToast(null);
    try {
      await action();
      setReloadKey((k) => k + 1);
      showToast({ message: 'Cambio deshecho' });
    } catch (err) {
      showToast({
        message: `No se pudo deshacer: ${err instanceof ApiError ? err.message : 'sin conexión'}`,
      });
    }
  };

  const calendarColors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const colorOf = useCallback(
    (event: EventDto) => event.color ?? calendarColors.get(event.calendarId) ?? FALLBACK_COLOR,
    [calendarColors],
  );

  /** Abre el diálogo y retira el aviso anterior, que quedaría oculto tras él. */
  const openDialog = (target: DialogTarget) => {
    setToast(null);
    setDialog(target);
  };

  const openCreate = (start: Date, allDay = false) => {
    const day = startOfDay(start);
    openDialog({
      kind: 'create',
      draft: allDay
        ? { start: day, end: day, allDay: true }
        : { start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false },
    });
  };

  const goToDay = (day: Date) => {
    setCursor(day);
    setView('day');
  };

  return (
    <div className="app">
      <Toolbar
        view={view}
        cursor={cursor}
        onViewChange={setView}
        onPrev={() => setCursor(shiftCursor(view, cursor, -1))}
        onNext={() => setCursor(shiftCursor(view, cursor, 1))}
        onToday={() => setCursor(new Date())}
        onCreate={() => openCreate(nextFullHour())}
        user={user}
        onLogout={onLogout}
      />
      {error && (
        <div role="alert" className="banner-error">
          {error}
        </div>
      )}
      <main className="view">
        {view === 'month' && (
          <MonthView
            cursor={cursor}
            events={events}
            colorOf={colorOf}
            onSelectDay={goToDay}
            onSelectEvent={(event) => openDialog({ kind: 'edit', event })}
            onCreateOn={(day) => openCreate(day, true)}
          />
        )}
        {view !== 'month' && (
          <TimeGridView
            // Al cambiar de vista/fecha se reinicia el scroll a la mañana.
            key={`${view}-${from}`}
            days={view === 'week' ? weekDays(cursor) : [startOfDay(cursor)]}
            events={events}
            colorOf={colorOf}
            onSelectDay={goToDay}
            onSelectEvent={(event) => openDialog({ kind: 'edit', event })}
            onCreateAt={(start) => openCreate(start)}
          />
        )}
      </main>
      {toast && (
        <div role="status" className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="toast-action" onClick={() => void undo()}>
              Deshacer
            </button>
          )}
        </div>
      )}
      {dialog && (
        <EventDialog
          // Nueva instancia (y estado de formulario) por cada evento o borrador abierto.
          key={dialog.kind === 'edit' ? `${dialog.event.id}-${dialog.event.version}` : 'new'}
          target={dialog}
          calendars={calendars}
          onClose={() => setDialog(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}

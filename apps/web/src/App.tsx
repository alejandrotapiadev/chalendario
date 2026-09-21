import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarDto, EventDto, UserDto } from '@calendar/shared';
import { ApiError, api } from './api.ts';
import {
  browserTimezone,
  shiftCursor,
  startOfDay,
  visibleRange,
  weekDays,
  type ViewMode,
} from './calendar/dates.ts';
import { EventDialog, type ChangeInfo, type DialogTarget } from './components/EventDialog.tsx';
import { MonthView } from './components/MonthView.tsx';
import { TimeGridView } from './components/TimeGridView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { loadStringSet, saveStringSet } from './storage.ts';

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hiddenKey = `hiddenCalendars:${user.id}`;
  const [hiddenCalendars, setHiddenCalendars] = useState(() => loadStringSet(hiddenKey));

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

  /**
   * Arrastrar o redimensionar un evento. Se actualiza la pantalla al instante y, si el
   * servidor lo rechaza (p. ej. conflicto de versión), se recarga el estado real.
   */
  const moveEvent = async (event: EventDto, start: Date, end: Date) => {
    const startAt = start.toISOString();
    const endAt = end.toISOString();
    setEvents((list) => list.map((e) => (e.id === event.id ? { ...e, startAt, endAt } : e)));
    try {
      const updated = await api.updateEvent(event.id, {
        startAt,
        endAt,
        // Los de todo el día se alinean a medianoche en la zona del navegador.
        ...(event.allDay && { timezone: browserTimezone() }),
        expectedVersion: event.version,
      });
      handleChanged({ kind: 'updated', event: updated, previousVersion: event.version });
    } catch (err) {
      setReloadKey((k) => k + 1);
      showToast({
        message:
          err instanceof ApiError
            ? `No se pudo mover: ${err.userMessage.split('\n')[0]}`
            : 'No se pudo mover el evento',
      });
    }
  };

  const toggleCalendar = (id: string) => {
    const next = new Set(hiddenCalendars);
    if (!next.delete(id)) next.add(id);
    setHiddenCalendars(next);
    saveStringSet(hiddenKey, next);
  };

  const createCalendar = async (input: { name: string; color: string }) => {
    const created = await api.createCalendar(input);
    setCalendars((list) => [...list, created]);
  };

  const updateCalendar = async (id: string, input: { name: string; color: string }) => {
    const updated = await api.updateCalendar(id, input);
    setCalendars((list) => list.map((c) => (c.id === id ? updated : c)));
  };

  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenCalendars.has(e.calendarId)),
    [events, hiddenCalendars],
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
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      {error && (
        <div role="alert" className="banner-error">
          {error}
        </div>
      )}
      <div className="layout">
        <Sidebar
          open={sidebarOpen}
          calendars={calendars}
          hiddenCalendars={hiddenCalendars}
          onToggleCalendar={toggleCalendar}
          onCreateCalendar={createCalendar}
          onUpdateCalendar={updateCalendar}
        />
        <main className="view">
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              events={visibleEvents}
              colorOf={colorOf}
              onSelectDay={goToDay}
              onSelectEvent={(event) => openDialog({ kind: 'edit', event })}
              onCreateOn={(day) => openCreate(day, true)}
              onMoveEvent={(event, start, end) => void moveEvent(event, start, end)}
            />
          )}
          {view !== 'month' && (
            <TimeGridView
              // Al cambiar de vista/fecha se reinicia el scroll a la mañana.
              key={`${view}-${from}`}
              days={view === 'week' ? weekDays(cursor) : [startOfDay(cursor)]}
              events={visibleEvents}
              colorOf={colorOf}
              onSelectDay={goToDay}
              onSelectEvent={(event) => openDialog({ kind: 'edit', event })}
              onCreateAt={(start) => openCreate(start)}
              onMoveEvent={(event, start, end) => void moveEvent(event, start, end)}
            />
          )}
        </main>
      </div>
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

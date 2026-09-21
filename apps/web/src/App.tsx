import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CalendarDto, EventDto } from '@calendar/shared';
import { api } from './api.ts';
import {
  shiftCursor,
  startOfDay,
  visibleRange,
  weekDays,
  type ViewMode,
} from './calendar/dates.ts';
import { EventDialog, type DialogTarget } from './components/EventDialog.tsx';
import { MonthView } from './components/MonthView.tsx';
import { TimeGridView } from './components/TimeGridView.tsx';
import { Toolbar } from './components/Toolbar.tsx';

const FALLBACK_COLOR = '#3b82f6';

/** Primera hora en punto a partir de ahora: hueco por defecto para un evento nuevo. */
function nextFullHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

export function App() {
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [calendars, setCalendars] = useState<CalendarDto[]>([]);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  const calendarColors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const colorOf = useCallback(
    (event: EventDto) => event.color ?? calendarColors.get(event.calendarId) ?? FALLBACK_COLOR,
    [calendarColors],
  );

  const openCreate = (start: Date, allDay = false) => {
    const day = startOfDay(start);
    setDialog({
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
            onSelectEvent={(event) => setDialog({ kind: 'edit', event })}
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
            onSelectEvent={(event) => setDialog({ kind: 'edit', event })}
            onCreateAt={(start) => openCreate(start)}
          />
        )}
      </main>
      {dialog && (
        <EventDialog
          // Nueva instancia (y estado de formulario) por cada evento o borrador abierto.
          key={dialog.kind === 'edit' ? `${dialog.event.id}-${dialog.event.version}` : 'new'}
          target={dialog}
          calendars={calendars}
          onClose={() => setDialog(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import type { EventDto } from '@calendar/shared';
import { LOCALE, isSameDay, startOfDay } from '../calendar/dates.ts';
import { eventsForDay, layoutSegments } from '../calendar/layout.ts';

const HOUR_PX = 48;
const MIN_EVENT_PX = 20;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const dayName = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

interface Props {
  days: Date[];
  events: EventDto[];
  colorOf: (event: EventDto) => string;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: EventDto) => void;
  /** Hueco vacío pulsado: inicio (redondeado a 30 min) del nuevo evento. */
  onCreateAt: (start: Date) => void;
}

/** Vista de columnas por día con eje de horas: sirve para semana (7 días) y día (1). */
export function TimeGridView({
  days,
  events,
  colorOf,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = new Date();

  // Al abrir la vista, dejar visible la mañana en vez de la medianoche.
  useEffect(() => {
    // Un margen de 16 px evita que la cabecera fija tape la etiqueta de las 07:00.
    scroller.current?.scrollTo({ top: 7 * HOUR_PX - 16 });
  }, []);

  const perDay = days.map((day) => ({ day, ...eventsForDay(events, day) }));

  const createFromClick = (day: Date, e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30;
    const start = startOfDay(day);
    start.setHours(0, minutes);
    onCreateAt(start);
  };

  return (
    <div className="timegrid" ref={scroller} style={{ '--cols': days.length } as CSSProperties}>
      <div className="tg-top">
        <div className="tg-row">
          <div className="tg-gutter" />
          {perDay.map(({ day }) => (
            <button
              key={day.toISOString()}
              type="button"
              className={`tg-dayhead ${isSameDay(day, now) ? 'is-today' : ''}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="tg-dayname">{dayName.format(day)}</span>
              <span className="tg-daynum">{day.getDate()}</span>
            </button>
          ))}
        </div>
        <div className="tg-row tg-allday">
          <div className="tg-gutter tg-gutter-label">todo el día</div>
          {perDay.map(({ day, allDay }) => (
            <div key={day.toISOString()} className="tg-allday-cell">
              {allDay.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`chip chip-solid ${event.status === 'cancelled' ? 'is-cancelled' : ''}`}
                  style={{ '--event-color': colorOf(event) } as CSSProperties}
                  onClick={() => onSelectEvent(event)}
                >
                  <span className="chip-title">{event.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="tg-body" style={{ height: 24 * HOUR_PX }}>
        <div className="tg-gutter">
          {HOURS.slice(1).map((h) => (
            <div key={h} className="tg-hour-label" style={{ top: h * HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {perDay.map(({ day, timed }) => (
          <div key={day.toISOString()} className="tg-col" onClick={(e) => createFromClick(day, e)}>
            {HOURS.map((h) => (
              <div key={h} className="tg-hour-line" style={{ top: h * HOUR_PX }} />
            ))}
            {isSameDay(day, now) && (
              <div
                className="tg-now"
                style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }}
              />
            )}
            {layoutSegments(timed).map(({ event, startMinute, endMinute, column, columns }) => {
              const height = Math.max(((endMinute - startMinute) / 60) * HOUR_PX, MIN_EVENT_PX);
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`tg-event ${event.status === 'cancelled' ? 'is-cancelled' : ''}`}
                  style={
                    {
                      top: (startMinute / 60) * HOUR_PX,
                      height,
                      left: `${(column / columns) * 100}%`,
                      width: `calc(${100 / columns}% - 2px)`,
                      '--event-color': colorOf(event),
                    } as CSSProperties
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(event);
                  }}
                >
                  <span className="tg-event-title">{event.title}</span>
                  {height >= 34 && (
                    <span className="tg-event-time">
                      {timeFormat.format(new Date(event.startAt))} –{' '}
                      {timeFormat.format(new Date(event.endAt))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

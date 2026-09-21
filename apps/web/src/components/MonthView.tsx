import type { CSSProperties } from 'react';
import type { EventDto } from '@calendar/shared';
import { LOCALE, isSameDay, monthGridDays } from '../calendar/dates.ts';
import { eventsForDay } from '../calendar/layout.ts';

const MAX_VISIBLE = 3;
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(new Date(2026, 8, 21 + i)),
);
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

interface Props {
  cursor: Date;
  events: EventDto[];
  colorOf: (event: EventDto) => string;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: EventDto) => void;
  onCreateOn: (day: Date) => void;
}

export function MonthView({
  cursor,
  events,
  colorOf,
  onSelectDay,
  onSelectEvent,
  onCreateOn,
}: Props) {
  const today = new Date();
  const days = monthGridDays(cursor);

  return (
    <div className="month">
      <div className="month-head">
        {WEEKDAYS.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const { allDay, timed } = eventsForDay(events, day);
          const items = [
            ...allDay.map((event) => ({ event, time: null as string | null })),
            ...timed.map(({ event }) => ({
              event,
              time: timeFormat.format(new Date(event.startAt)),
            })),
          ];
          const hidden = items.length - MAX_VISIBLE;
          const classes = [
            'month-cell',
            day.getMonth() !== cursor.getMonth() && 'is-outside',
            isSameDay(day, today) && 'is-today',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={day.toISOString()} className={classes} onClick={() => onCreateOn(day)}>
              <button
                type="button"
                className="month-daynum"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectDay(day);
                }}
              >
                {day.getDate()}
              </button>
              {items.slice(0, MAX_VISIBLE).map(({ event, time }) => (
                <button
                  key={event.id}
                  type="button"
                  className={`chip ${event.allDay ? 'chip-solid' : 'chip-dot'} ${event.status === 'cancelled' ? 'is-cancelled' : ''}`}
                  style={{ '--event-color': colorOf(event) } as CSSProperties}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(event);
                  }}
                >
                  {time && <span className="chip-time">{time}</span>}
                  <span className="chip-title">{event.title}</span>
                </button>
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  className="chip chip-more"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDay(day);
                  }}
                >
                  +{hidden} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

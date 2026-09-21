import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { EventDto } from '@calendar/shared';
import {
  LOCALE,
  daysBetween,
  fromInputs,
  isSameDay,
  monthGridDays,
  toDateInput,
} from '../calendar/dates.ts';
import { moveSpan } from '../calendar/drag.ts';
import { eventsForDay } from '../calendar/layout.ts';
import { startDrag } from '../calendar/pointerDrag.ts';

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
  /** Un evento se ha arrastrado a otro día. */
  onMoveEvent: (event: EventDto, start: Date, end: Date) => void;
}

/** Día (de la cuadrícula) que hay bajo el puntero, si lo hay. */
function dayAt(x: number, y: number): Date | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]');
  return cell?.dataset.day ? fromInputs(cell.dataset.day) : null;
}

export function MonthView({
  cursor,
  events,
  colorOf,
  onSelectDay,
  onSelectEvent,
  onCreateOn,
  onMoveEvent,
}: Props) {
  const today = new Date();
  const days = monthGridDays(cursor);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);

  const beginDrag = (
    e: ReactPointerEvent<HTMLElement>,
    event: EventDto,
    key: string,
    from: Date,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const reset = () => {
      setDragKey(null);
      setDropDay(null);
    };
    startDrag(e, {
      onMove: (_dx, _dy, pointer) => {
        setDragKey(key);
        const target = dayAt(pointer.clientX, pointer.clientY);
        setDropDay(target ? toDateInput(target) : null);
      },
      onEnd: (_dx, _dy, pointer) => {
        reset();
        const target = dayAt(pointer.clientX, pointer.clientY);
        const dayDelta = target ? daysBetween(from, target) : 0;
        if (dayDelta === 0) return;
        const next = moveSpan(
          { start: new Date(event.startAt), end: new Date(event.endAt) },
          event.allDay,
          dayDelta,
        );
        onMoveEvent(event, next.start, next.end);
      },
      onCancel: reset,
    });
  };

  return (
    <div className="month">
      <div className="month-head">
        {WEEKDAYS.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
      <div className={`month-grid ${dragKey ? 'is-dragging' : ''}`}>
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
          const dayKey = toDateInput(day);
          const classes = [
            'month-cell',
            day.getMonth() !== cursor.getMonth() && 'is-outside',
            isSameDay(day, today) && 'is-today',
            dropDay === dayKey && 'is-drop-target',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={dayKey} data-day={dayKey} className={classes} onClick={() => onCreateOn(day)}>
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
              {items.slice(0, MAX_VISIBLE).map(({ event, time }) => {
                const key = `${event.id}@${dayKey}`;
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={`chip ${event.allDay ? 'chip-solid' : 'chip-dot'} ${
                      event.status === 'cancelled' ? 'is-cancelled' : ''
                    } ${dragKey === key ? 'is-dragging' : ''}`}
                    style={{ '--event-color': colorOf(event) } as CSSProperties}
                    onPointerDown={(e) => beginDrag(e, event, key, day)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(event);
                    }}
                  >
                    {time && <span className="chip-time">{time}</span>}
                    <span className="chip-title">{event.title}</span>
                  </button>
                );
              })}
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

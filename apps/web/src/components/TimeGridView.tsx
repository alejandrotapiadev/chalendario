import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { EventDto } from '@calendar/shared';
import { LOCALE, isSameDay, startOfDay } from '../calendar/dates.ts';
import { moveSpan, resizeSpan, sameSpan, snapMinutes, type Span } from '../calendar/drag.ts';
import { eventsForDay, layoutSegments } from '../calendar/layout.ts';
import { startDrag } from '../calendar/pointerDrag.ts';

const HOUR_PX = 48;
const MIN_EVENT_PX = 20;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const dayName = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

const pxPerMinute = HOUR_PX / 60;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface Props {
  days: Date[];
  events: EventDto[];
  colorOf: (event: EventDto) => string;
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: EventDto) => void;
  /** Hueco vacío pulsado: inicio (redondeado a 30 min) del nuevo evento. */
  onCreateAt: (start: Date) => void;
  /** Un evento se ha arrastrado o redimensionado a un nuevo intervalo. */
  onMoveEvent: (event: EventDto, start: Date, end: Date) => void;
}

interface DragState {
  key: string;
  mode: 'move' | 'resize';
  dayDelta: number;
  minuteDelta: number;
  colWidth: number;
}

/** Vista de columnas por día con eje de horas: sirve para semana (7 días) y día (1). */
export function TimeGridView({
  days,
  events,
  colorOf,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
  onMoveEvent,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
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

  /** Intervalo resultante de un arrastre (mover) o de redimensionar. */
  const spanFor = (
    event: EventDto,
    state: Pick<DragState, 'mode' | 'dayDelta' | 'minuteDelta'>,
  ) => {
    const original: Span = { start: new Date(event.startAt), end: new Date(event.endAt) };
    return state.mode === 'move'
      ? moveSpan(original, event.allDay, state.dayDelta, state.minuteDelta)
      : resizeSpan(original, state.minuteDelta);
  };

  const beginDrag = (
    e: ReactPointerEvent<HTMLElement>,
    event: EventDto,
    key: string,
    dayIndex: number,
    mode: DragState['mode'],
  ) => {
    if (e.button !== 0) return;
    e.preventDefault(); // evita seleccionar texto mientras se arrastra
    e.stopPropagation();
    const colWidth = e.currentTarget.closest<HTMLElement>('.tg-col')!.offsetWidth;
    const measure = (dx: number, dy: number) => ({
      mode,
      colWidth,
      dayDelta:
        mode === 'move'
          ? clamp(Math.round(dx / colWidth), -dayIndex, days.length - 1 - dayIndex)
          : 0,
      minuteDelta: snapMinutes(dy / pxPerMinute),
    });

    startDrag(e, {
      onMove: (dx, dy) => setDrag({ key, ...measure(dx, dy) }),
      onEnd: (dx, dy) => {
        setDrag(null);
        const next = spanFor(event, measure(dx, dy));
        if (!sameSpan(next, { start: new Date(event.startAt), end: new Date(event.endAt) })) {
          onMoveEvent(event, next.start, next.end);
        }
      },
      onCancel: () => setDrag(null),
    });
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
        {perDay.map(({ day, timed }, dayIndex) => (
          <div
            key={day.toISOString()}
            className="tg-col"
            data-day={day.toISOString()}
            onClick={(e) => createFromClick(day, e)}
          >
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
              const key = `${event.id}@${day.toISOString()}`;
              const dragging = drag?.key === key ? drag : null;
              const baseHeight = Math.max((endMinute - startMinute) * pxPerMinute, MIN_EVENT_PX);
              const shown = dragging ? spanFor(event, dragging) : null;
              const style: CSSProperties & Record<string, string | number> = {
                top: startMinute * pxPerMinute,
                height: baseHeight,
                left: `${(column / columns) * 100}%`,
                width: `calc(${100 / columns}% - 2px)`,
                '--event-color': colorOf(event),
              };
              if (dragging?.mode === 'move') {
                style.transform = `translate(${dragging.dayDelta * dragging.colWidth}px, ${
                  dragging.minuteDelta * pxPerMinute
                }px)`;
              } else if (dragging?.mode === 'resize') {
                style.height = Math.max(
                  baseHeight + dragging.minuteDelta * pxPerMinute,
                  MIN_EVENT_PX,
                );
              }
              const first = shown?.start ?? new Date(event.startAt);
              const last = shown?.end ?? new Date(event.endAt);

              return (
                <button
                  key={key}
                  type="button"
                  className={`tg-event ${event.status === 'cancelled' ? 'is-cancelled' : ''} ${
                    dragging ? 'is-dragging' : ''
                  }`}
                  style={style}
                  onPointerDown={(e) => beginDrag(e, event, key, dayIndex, 'move')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(event);
                  }}
                >
                  <span className="tg-event-title">{event.title}</span>
                  {baseHeight >= 34 && (
                    <span className="tg-event-time">
                      {timeFormat.format(first)} – {timeFormat.format(last)}
                    </span>
                  )}
                  <span
                    className="tg-resize"
                    aria-hidden="true"
                    onPointerDown={(e) => beginDrag(e, event, key, dayIndex, 'resize')}
                    onClick={(e) => e.stopPropagation()}
                  />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState, type FocusEvent } from 'react';
import type { EventDto } from '@calendar/shared';
import { api } from '../api.ts';
import { LOCALE } from '../calendar/dates.ts';
import { describeRule } from '../calendar/recurrence.ts';

const DEBOUNCE_MS = 250;
const when = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const whenAllDay = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

interface Props {
  colorOf: (event: EventDto) => string;
  onOpen: (event: EventDto) => void;
}

/** Resultados y la búsqueda a la que pertenecen: sirve para descartar respuestas antiguas. */
interface Results {
  query: string;
  events: EventDto[] | 'error';
}

export function SearchBox({ colorOf, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) return;
    let stale = false;
    const timer = setTimeout(() => {
      api
        .searchEvents(trimmed)
        .then((events) => !stale && setResults({ query: trimmed, events }))
        .catch(() => !stale && setResults({ query: trimmed, events: 'error' }));
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  // Solo se muestra lo que corresponde a lo que hay escrito ahora.
  const current = results && results.query === trimmed ? results.events : null;
  const showPanel = open && trimmed.length > 0;

  const close = () => {
    setOpen(false);
    setQuery('');
    setResults(null);
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };

  return (
    <div className="search" onBlur={onBlur}>
      <input
        type="search"
        className="search-input"
        placeholder="Buscar eventos…"
        aria-label="Buscar eventos"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      {showPanel && (
        <div className="search-panel" role="listbox" aria-label="Resultados de la búsqueda">
          {current === null && <p className="muted search-empty">Buscando…</p>}
          {current === 'error' && <p className="form-error search-empty">No se pudo buscar</p>}
          {Array.isArray(current) && current.length === 0 && (
            <p className="muted search-empty">Sin resultados</p>
          )}
          {Array.isArray(current) &&
            current.map((event) => (
              <button
                key={event.id}
                type="button"
                role="option"
                aria-selected={false}
                className="search-item"
                onClick={() => {
                  onOpen(event);
                  close();
                }}
              >
                <span
                  className="search-dot"
                  style={{ background: colorOf(event) }}
                  aria-hidden="true"
                />
                <span className="search-text">
                  <span className="search-title">{event.title}</span>
                  <span className="muted search-meta">
                    {(event.allDay ? whenAllDay : when).format(new Date(event.startAt))}
                    {event.recurrence && ` · ${describeRule(event.recurrence)}`}
                    {event.location && ` · ${event.location}`}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

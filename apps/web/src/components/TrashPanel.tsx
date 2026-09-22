import { useEffect, useRef, useState } from 'react';
import type { CalendarDto, EventDto } from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import { LOCALE } from '../calendar/dates.ts';

const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  calendars: CalendarDto[];
  onClose: () => void;
  /** Se llama tras restaurar con éxito, para recargar los eventos y avisar. */
  onRestored: (event: EventDto) => void;
}

/** Eventos borrados: la API ya sabe restaurarlos, aquí solo se listan. */
export function TrashPanel({ calendars, onClose, onRestored }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<EventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    api
      .listTrash()
      .then(setItems)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar la papelera');
      });
  }, []);

  const calendarName = (id: string) => calendars.find((c) => c.id === id)?.name ?? '?';

  async function restore(event: EventDto) {
    setBusyId(event.id);
    setError(null);
    try {
      const restored = await api.restoreEvent(event.id, event.version);
      setItems((list) => list?.filter((e) => e.id !== event.id) ?? null);
      onRestored(restored);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo restaurar');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="form">
        <h2>Papelera</h2>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!items && !error && <p className="muted">Cargando…</p>}
        {items && items.length === 0 && <p className="muted">La papelera está vacía.</p>}
        {items && items.length > 0 && (
          <ol className="history">
            {items.map((event) => (
              <li key={event.id} className="history-item">
                <div className="history-head">
                  <strong>{event.title}</strong>
                  <span className="muted">{calendarName(event.calendarId)}</span>
                  <time className="muted" dateTime={event.updatedAt}>
                    Borrado el {stamp.format(new Date(event.updatedAt))}
                  </time>
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyId === event.id}
                  onClick={() => void restore(event)}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </dialog>
  );
}

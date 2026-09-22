import { useEffect, useRef, useState } from 'react';
import type { SessionDto } from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import { LOCALE } from '../calendar/dates.ts';

const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  onClose: () => void;
  /** Se cerró la sesión con la que se hizo esta petición: hay que ir a la pantalla de acceso. */
  onLoggedOut: () => void;
}

/** Sesiones activas de la cuenta (T-11): verlas y cerrarlas por separado. */
export function SessionsPanel({ onClose, onLoggedOut }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    api
      .listSessions()
      .then(setItems)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.userMessage : 'No se pudieron cargar las sesiones');
      });
  }, []);

  async function close(session: SessionDto) {
    setBusyId(session.id);
    setError(null);
    try {
      await api.deleteSession(session.id);
      if (session.current) {
        onLoggedOut();
        return;
      }
      setItems((list) => list?.filter((s) => s.id !== session.id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo cerrar la sesión');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="form">
        <h2>Sesiones activas</h2>
        <p className="muted">
          Los inicios de sesión abiertos en esta cuenta. No se guarda desde qué dispositivo o red.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!items && !error && <p className="muted">Cargando…</p>}
        {items && items.length > 0 && (
          <ol className="history">
            {items.map((session) => (
              <li key={session.id} className="history-item">
                <div className="history-head">
                  <strong>{session.current ? 'Esta sesión' : 'Otra sesión'}</strong>
                  <time className="muted" dateTime={session.createdAt}>
                    Iniciada el {stamp.format(new Date(session.createdAt))}
                  </time>
                </div>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  disabled={busyId === session.id}
                  onClick={() => void close(session)}
                >
                  Cerrar sesión
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

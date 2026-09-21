import { useEffect, useState } from 'react';
import type { CategoryDto, EventVersionDto } from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import { LOCALE } from '../calendar/dates.ts';
import { describeChange, describeReason } from '../calendar/history.ts';

const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  eventId: string;
  categories: CategoryDto[];
  busy: boolean;
  onRestore: (version: number) => void;
  onBack: () => void;
}

/** Historial de versiones de un evento, con la opción de restaurar cualquiera. */
export function HistoryPanel({ eventId, categories, busy, onRestore, onBack }: Props) {
  const [versions, setVersions] = useState<EventVersionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .listVersions(eventId)
      .then((list) => !stale && setVersions(list))
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar');
      });
    return () => {
      stale = true;
    };
  }, [eventId]);

  const context = { categoryName: (id: string) => categories.find((c) => c.id === id)?.name };

  return (
    <div className="form">
      <h2>Historial</h2>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!versions && !error && <p className="muted">Cargando…</p>}
      {versions && (
        <ol className="history">
          {versions.map((v) => {
            const reason = describeReason(v.changeReason);
            return (
              <li key={v.version} className="history-item">
                <div className="history-head">
                  <strong>Versión {v.version}</strong>
                  {v.isCurrent && <span className="badge">actual</span>}
                  <time className="muted" dateTime={v.createdAt}>
                    {stamp.format(new Date(v.createdAt))}
                  </time>
                </div>
                {v.version === 1 ? (
                  <p className="history-line">Creado como «{v.title}»</p>
                ) : (
                  <ul className="history-changes">
                    {v.changes.map((change) => (
                      <li key={change.field}>{describeChange(change, context)}</li>
                    ))}
                  </ul>
                )}
                {reason && <p className="muted history-line">{reason}</p>}
                {!v.isCurrent && !v.deleted && (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => onRestore(v.version)}
                  >
                    Restaurar esta versión
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { LOCALE } from '../calendar/dates.ts';
import type { ConflictEntry } from '../offline/queue.ts';

const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

const KIND_LABEL = { create: 'Crear', update: 'Editar', delete: 'Borrar' } as const;

interface Props {
  conflicts: ConflictEntry[];
  onClose: () => void;
  onDiscard: (id: string) => void;
  /** Reintenta; devuelve si se pudo aplicar (para poder recargar los eventos). */
  onRetry: (id: string) => Promise<boolean>;
}

/**
 * Cambios hechos sin conexión (T-13) que, al volver la red, ya no se pudieron aplicar tal
 * cual (alguien más cambió o borró el evento, o el servidor los rechazó por otro motivo).
 */
export function SyncPanel({ conflicts, onClose, onDiscard, onRetry }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function retry(entry: ConflictEntry) {
    setBusyId(entry.id);
    await onRetry(entry.id);
    setBusyId(null);
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="form">
        <h2>Sincronización</h2>
        <p className="muted">
          Se hicieron sin conexión y no se pudieron enviar tal cual al volver la red. «Reintentar»
          los aplica sobre el estado actual; «Descartar» los abandona.
        </p>
        {conflicts.length === 0 && <p className="muted">No hay nada pendiente de revisar.</p>}
        {conflicts.length > 0 && (
          <ol className="history">
            {conflicts.map((entry) => (
              <li key={entry.id} className="history-item">
                <div className="history-head">
                  <strong>
                    {KIND_LABEL[entry.op.send.kind]}: {entry.op.display.title || '(sin título)'}
                  </strong>
                  <time className="muted" dateTime={entry.createdAt}>
                    {stamp.format(new Date(entry.createdAt))}
                  </time>
                </div>
                <p className="form-error">{entry.reason}</p>
                <div className="side-editor-row">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={busyId === entry.id}
                    onClick={() => void retry(entry)}
                  >
                    Reintentar
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busyId === entry.id}
                    onClick={() => onDiscard(entry.id)}
                  >
                    Descartar
                  </button>
                </div>
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

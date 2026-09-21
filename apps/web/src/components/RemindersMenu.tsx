import { useState, type FocusEvent } from 'react';
import type { ReminderDto } from '@calendar/shared';
import { describeReminder, reminderKey, whenLabel } from '../calendar/reminders.ts';

interface Props {
  /** Avisos activos que el usuario aún no ha descartado. */
  reminders: ReminderDto[];
  now: Date;
  onDismiss: (reminder: ReminderDto) => void;
  onDismissAll: () => void;
  onOpenEvent: (eventId: string) => void;
}

function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function RemindersMenu({ reminders, now, onDismiss, onDismissAll, onOpenEvent }: Props) {
  const [open, setOpen] = useState(false);
  // Se vuelve a leer al abrir el menú: el permiso puede cambiar desde el navegador.
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'denied',
  );

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };

  return (
    <div className="bell" onBlur={onBlur}>
      <button
        type="button"
        className="btn bell-btn"
        aria-label={
          reminders.length > 0 ? `Recordatorios: ${reminders.length} pendientes` : 'Recordatorios'
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {reminders.length > 0 && <span className="bell-badge">{reminders.length}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Recordatorios">
          {reminders.length === 0 ? (
            <p className="muted bell-empty">No tienes recordatorios pendientes.</p>
          ) : (
            <>
              <ul className="bell-list">
                {reminders.map((r) => (
                  <li key={reminderKey(r)} className="bell-item">
                    <button
                      type="button"
                      className="bell-event"
                      onClick={() => {
                        onOpenEvent(r.eventId);
                        setOpen(false);
                      }}
                    >
                      <strong>{r.title}</strong>
                      <span className="muted">
                        {whenLabel(r.occurrenceStartAt, now)} · {describeReminder(r.minutesBefore)}
                        {r.location && ` · ${r.location}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn is-visible"
                      aria-label={`Descartar recordatorio de ${r.title}`}
                      onClick={() => onDismiss(r)}
                    >
                      ✓
                    </button>
                  </li>
                ))}
              </ul>
              {reminders.length > 1 && (
                <button type="button" className="link bell-all" onClick={onDismissAll}>
                  Descartar todos
                </button>
              )}
            </>
          )}
          {notificationsSupported() && permission === 'default' && (
            <button
              type="button"
              className="link bell-all"
              onClick={() => void Notification.requestPermission().then(setPermission)}
            >
              Activar avisos del navegador
            </button>
          )}
        </div>
      )}
    </div>
  );
}

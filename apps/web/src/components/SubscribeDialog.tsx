import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SubscribeResultDto } from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import { browserTimezone } from '../calendar/dates.ts';

interface Props {
  onClose: () => void;
  onSubscribed: (result: SubscribeResultDto) => void;
}

/** Sigue un calendario `.ics` externo (Google, iCloud, Outlook…) como uno de solo lectura. */
export function SubscribeDialog({ onClose, onSubscribed }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSubscribed(await api.subscribe({ name, url, timezone: browserTimezone() }));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo conectar con el servidor');
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onCancel={onClose}>
      <form className="form" onSubmit={submit}>
        <h2>Suscribirse a un calendario</h2>
        <p className="muted">
          Pega la dirección <code>.ics</code> de un calendario público o su «dirección secreta en
          formato iCal» (Google Calendar → Configuración del calendario → Integrar). Se creará un
          calendario de solo lectura que se mantiene actualizado.
        </p>
        <label className="field">
          <span>Nombre</span>
          <input
            autoFocus
            required
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>URL del calendario</span>
          <input
            required
            type="url"
            placeholder="https://… o webcal://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Descargando…' : 'Suscribirse'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CalendarDto,
  FeedStatusDto,
  ImportResultDto,
  MemberDto,
  MemberRole,
} from '@calendar/shared';
import { ApiError, api } from '../api.ts';
import { LOCALE, browserTimezone } from '../calendar/dates.ts';
import { ImportSummary } from './ImportSummary.tsx';

const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const ROLE_LABELS: Record<MemberRole, string> = { viewer: 'Solo lectura', editor: 'Puede editar' };

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.userMessage : 'No se pudo conectar con el servidor';

interface Props {
  calendar: CalendarDto;
  onClose: () => void;
  /** El nombre o el color cambiaron. */
  onSaved: (calendar: CalendarDto) => void;
  /** Se importaron o sincronizaron eventos: hay que recargarlos. */
  onEventsChanged: () => void;
  /** Cambió la suscripción del calendario: hay que recargar la lista de calendarios. */
  onCalendarsChanged: () => void;
}

// ---------------------------------------------------------------------------------------

function GeneralSection({ calendar, onSaved }: Pick<Props, 'calendar' | 'onSaved'>) {
  const [name, setName] = useState(calendar.name);
  const [color, setColor] = useState(calendar.color);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onSaved(await api.updateCalendar(calendar.id, { name, color }));
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <form className="settings-section" onSubmit={submit}>
      <h3>General</h3>
      <div className="side-editor-row">
        <input
          type="color"
          aria-label="Color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          required
          aria-label="Nombre"
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <button type="submit" className="btn btn-small btn-primary">
          Guardar
        </button>
      </div>
      {saved && <p className="muted">Guardado.</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------------------

/** Archivar (ADR-015): deja de ofrecerse ni de mostrarse, sin borrar nada; es reversible. */
function ArchiveSection({
  calendar,
  onSaved,
  onEventsChanged,
}: Pick<Props, 'calendar' | 'onSaved' | 'onEventsChanged'>) {
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    if (!calendar.archived && !window.confirm(`¿Archivar «${calendar.name}»?`)) return;
    try {
      onSaved(await api.updateCalendar(calendar.id, { archived: !calendar.archived }));
      // Un calendario archivado deja de aportar eventos a la vista (y al revés al restaurarlo).
      onEventsChanged();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="settings-section">
      <h3>Archivar</h3>
      <p className="muted">
        {calendar.archived
          ? 'Este calendario está archivado: no aparece en la barra lateral ni admite eventos nuevos. Sus eventos no se han tocado.'
          : 'Deja de mostrarse y de admitir eventos nuevos, sin borrar nada. Se puede restaurar cuando quieras.'}
      </p>
      <button type="button" className="btn btn-small" onClick={() => void toggle()}>
        {calendar.archived ? 'Restaurar calendario' : 'Archivar calendario'}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------

function SharingSection({ calendar }: { calendar: CalendarDto }) {
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .listMembers(calendar.id)
      .then((list) => !stale && setMembers(list))
      .catch((err: unknown) => !stale && setError(messageOf(err)));
    return () => {
      stale = true;
    };
  }, [calendar.id]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const member = await api.invite(calendar.id, { email, role });
      setMembers((list) => [...(list ?? []), member]);
      setEmail('');
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function change(member: MemberDto, next: MemberRole) {
    setError(null);
    try {
      const updated = await api.updateMember(calendar.id, member.userId, next);
      setMembers((list) => list?.map((m) => (m.userId === member.userId ? updated : m)) ?? null);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function remove(member: MemberDto) {
    setError(null);
    try {
      await api.removeMember(calendar.id, member.userId);
      setMembers((list) => list?.filter((m) => m.userId !== member.userId) ?? null);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="settings-section">
      <h3>Compartir</h3>
      <p className="muted">
        Invita a personas que ya tengan cuenta. Verán la invitación al entrar y podrán aceptarla.
      </p>
      {members && members.length > 0 && (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.userId} className="member">
              <span className="member-who">
                <strong>{m.name}</strong>
                <span className="muted">
                  {m.email}
                  {m.status === 'pending' && ' · invitación pendiente'}
                </span>
              </span>
              <select
                aria-label={`Permiso de ${m.name}`}
                value={m.role}
                onChange={(e) => void change(m, e.target.value as MemberRole)}
              >
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn is-visible"
                aria-label={`Quitar a ${m.name}`}
                onClick={() => void remove(m)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="side-editor-row invite-row" onSubmit={invite}>
        <input
          required
          type="email"
          aria-label="Email a invitar"
          placeholder="email@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          aria-label="Permiso"
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-small btn-primary">
          Invitar
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------

function TransferSection({
  calendar,
  onEventsChanged,
}: Pick<Props, 'calendar' | 'onEventsChanged'>) {
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const readOnly = calendar.subscription !== null || calendar.role === 'viewer';

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const ics = await chosen.text();
      setResult(await api.importIcs(calendar.id, { ics, timezone: browserTimezone() }));
      onEventsChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  return (
    <section className="settings-section">
      <h3>Importar y exportar</h3>
      <div className="side-editor-row">
        <a className="btn btn-small" href={api.exportUrl(calendar.id)} download>
          Exportar (.ics)
        </a>
        {!readOnly && (
          <>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              Importar (.ics)…
            </button>
            <input
              ref={file}
              type="file"
              accept=".ics,text/calendar"
              hidden
              aria-label="Fichero .ics"
              onChange={(e) => void pick(e)}
            />
          </>
        )}
      </div>
      <p className="muted">
        Al importar, los eventos se identifican por su UID: volver a importar el mismo fichero
        actualiza en vez de duplicar.
      </p>
      {result && <ImportSummary result={result} />}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------

/** Enlace público de solo lectura para suscribirse desde Google, Apple, Outlook… */
function FeedSection({ calendar }: { calendar: CalendarDto }) {
  const [status, setStatus] = useState<FeedStatusDto | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

  useEffect(() => {
    let stale = false;
    api
      .feedStatus(calendar.id)
      .then((s) => !stale && setStatus(s))
      .catch((err: unknown) => !stale && setError(messageOf(err)));
    return () => {
      stale = true;
    };
  }, [calendar.id]);

  async function create() {
    setError(null);
    setCopied(false);
    try {
      const { path } = await api.createFeed(calendar.id);
      setUrl(`${location.origin}/api${path}`);
      setStatus(await api.feedStatus(calendar.id));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function disable() {
    setError(null);
    try {
      await api.deleteFeed(calendar.id);
      setUrl(null);
      setStatus({ enabled: false, createdAt: null });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // sin permiso de portapapeles: el campo es seleccionable
    }
  }

  return (
    <section className="settings-section">
      <h3>Enlace de suscripción</h3>
      <p className="muted">
        Una dirección de solo lectura para ver este calendario en Google Calendar, Apple Calendar u
        Outlook. Cualquiera que la tenga puede verlo: no la compartas, y regénérala si se filtra.
      </p>
      {isLocal && (
        <p className="notice" role="note">
          Estás en <code>localhost</code>: los servicios externos no podrán abrir este enlace hasta
          que la aplicación sea accesible desde Internet.
        </p>
      )}
      {url && (
        <div className="feed-url">
          <input
            readOnly
            aria-label="Enlace de suscripción"
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn btn-small" onClick={() => void copy()}>
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <p className="muted">
            Se muestra solo ahora. Para Apple Calendar usa{' '}
            <code>{url.replace(/^https?:/, 'webcal:')}</code>
          </p>
        </div>
      )}
      <div className="side-editor-row">
        <button type="button" className="btn btn-small" onClick={() => void create()}>
          {status?.enabled ? 'Regenerar enlace' : 'Crear enlace'}
        </button>
        {status?.enabled && (
          <button type="button" className="btn btn-small btn-danger" onClick={() => void disable()}>
            Desactivar
          </button>
        )}
      </div>
      {status?.enabled && !url && (
        <p className="muted">
          Enlace activo desde {stamp.format(new Date(status.createdAt!))}. Regenerarlo desactiva el
          anterior.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------

function SubscriptionSection({
  calendar,
  onEventsChanged,
  onCalendarsChanged,
  onClose,
}: Pick<Props, 'calendar' | 'onEventsChanged' | 'onCalendarsChanged' | 'onClose'>) {
  const sub = calendar.subscription!;
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.syncCalendar(calendar.id));
      onEventsChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      onCalendarsChanged();
    }
  }

  async function stop() {
    if (!window.confirm('¿Dejar de sincronizar? Los eventos se conservan y podrás editarlos.'))
      return;
    try {
      await api.unsubscribe(calendar.id);
      onCalendarsChanged();
      onClose();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="settings-section">
      <h3>Sincronización</h3>
      <p>
        Refleja un calendario de <strong>{sub.host}</strong> y es de solo lectura. Se actualiza solo
        cada pocos minutos.
      </p>
      <p className="muted">
        {sub.lastSyncedAt
          ? `Última sincronización: ${stamp.format(new Date(sub.lastSyncedAt))}`
          : 'Aún no se ha sincronizado.'}
      </p>
      {sub.lastError && (
        <p className="form-error" role="alert">
          Último intento fallido: {sub.lastError}
        </p>
      )}
      <div className="side-editor-row">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={() => void sync()}
        >
          Sincronizar ahora
        </button>
        <button type="button" className="btn btn-small" onClick={() => void stop()}>
          Dejar de sincronizar
        </button>
      </div>
      {result && <ImportSummary result={result} />}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------

export function CalendarSettings(props: Props) {
  const { calendar, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="dialog dialog-wide" onClose={onClose} onCancel={onClose}>
      <div className="form">
        <h2>{calendar.name}</h2>
        <GeneralSection calendar={calendar} onSaved={props.onSaved} />
        {calendar.subscription && <SubscriptionSection {...props} />}
        <SharingSection calendar={calendar} />
        <TransferSection calendar={calendar} onEventsChanged={props.onEventsChanged} />
        <FeedSection calendar={calendar} />
        {calendar.role === 'owner' && (
          <ArchiveSection
            calendar={calendar}
            onSaved={props.onSaved}
            onEventsChanged={props.onEventsChanged}
          />
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

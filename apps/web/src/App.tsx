import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CalendarDto,
  CategoryDto,
  CreateEventInput,
  EditScope,
  EventDto,
  InvitationDto,
  ReminderDto,
  UpdateEventInput,
  UserDto,
} from '@calendar/shared';
import { ApiError, api, setConnectionHandler, type ConnectionState } from './api.ts';
import {
  browserTimezone,
  fromDisplay,
  shiftCursor,
  startOfDay,
  toDisplay,
  visibleRange,
  weekDays,
  type ViewMode,
} from './calendar/dates.ts';
import { isTimezone } from './calendar/zoned.ts';
import { EventDialog, type ChangeInfo, type DialogTarget } from './components/EventDialog.tsx';
import {
  discardConflict,
  drainQueue,
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  listConflicts,
  listOps,
  overlayEvents,
  retryConflict,
  OfflineUnsupportedError,
  type ConflictEntry,
  type QueueOp,
} from './offline/queue.ts';
import { SyncPanel } from './components/SyncPanel.tsx';
import { MonthView } from './components/MonthView.tsx';
import { TimeGridView } from './components/TimeGridView.tsx';
import { RemindersMenu } from './components/RemindersMenu.tsx';
import { SearchBox } from './components/SearchBox.tsx';
import { CalendarSettings } from './components/CalendarSettings.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SessionsPanel } from './components/SessionsPanel.tsx';
import { SubscribeDialog } from './components/SubscribeDialog.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { TrashPanel } from './components/TrashPanel.tsx';
import { loadString, loadStringSet, saveString, saveStringSet } from './storage.ts';
import { useReminders } from './useReminders.ts';
import { whenLabel } from './calendar/reminders.ts';

const FALLBACK_COLOR = '#3b82f6';
const TOAST_MS = 8000;

interface Toast {
  id: number;
  message: string;
  undo?: () => Promise<unknown>;
}

/** Mensaje y acción de deshacer para cada tipo de cambio. Deshacer = restaurar (ADR-002). */
function toastFor(change: ChangeInfo): Omit<Toast, 'id'> | null {
  const { event } = change;
  // "Solo esta ocurrencia" o "esta y las siguientes" pueden tocar más de un evento a la
  // vez (crear una excepción, o partir una serie en dos): no se ofrece deshacer para ellas.
  if ('scope' in change && change.scope) {
    return { message: change.kind === 'deleted' ? 'Evento eliminado' : 'Evento actualizado' };
  }
  // Un evento aún en la cola de escritura sin conexión (T-13) no tiene id real: nada que
  // deshacer (borrarlo o restaurarlo en el servidor no tiene sentido todavía).
  if (event.id.startsWith('offline:')) {
    return {
      message:
        change.kind === 'created'
          ? 'Evento creado (pendiente de sincronizar)'
          : change.kind === 'deleted'
            ? 'Evento eliminado'
            : 'Evento actualizado (pendiente de sincronizar)',
    };
  }
  switch (change.kind) {
    case 'created':
      return { message: 'Evento creado', undo: () => api.deleteEvent(event.id) };
    case 'updated':
      // Un guardado sin cambios reales no crea versión: no hay nada que deshacer.
      if (event.version === change.previousVersion) return null;
      return {
        message: 'Evento actualizado',
        undo: () =>
          api.restoreEvent(event.id, change.previousVersion, { expectedVersion: event.version }),
      };
    case 'restored':
      return {
        message: `Versión restaurada`,
        undo: () =>
          api.restoreEvent(event.id, change.previousVersion, { expectedVersion: event.version }),
      };
    case 'deleted':
      // `event` es la última versión viva; el borrado creó la siguiente.
      return {
        message: 'Evento eliminado',
        undo: () =>
          api.restoreEvent(event.id, event.version, { expectedVersion: event.version + 1 }),
      };
  }
}

/** Primera hora en punto a partir de ahora (en `timeZone`): hueco por defecto de un evento nuevo. */
function nextFullHour(timeZone: string): Date {
  const d = toDisplay(new Date().toISOString(), timeZone);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

interface AppProps {
  user: UserDto;
  onLogout: () => void;
}

export function App({ user, onLogout }: AppProps) {
  const [view, setView] = useState<ViewMode>('month');
  // Zona horaria en la que se pintan y se arrastran las vistas (T-10); por defecto, la del
  // navegador. `cursor` y los eventos que se ven dependen de ella, así que se necesita antes.
  const displayTimezoneKey = `displayTimezone:${user.id}`;
  const [displayTimezone, setDisplayTimezoneState] = useState(() => {
    const saved = loadString(displayTimezoneKey);
    return saved && isTimezone(saved) ? saved : browserTimezone();
  });
  const [cursor, setCursor] = useState(() => toDisplay(new Date().toISOString(), displayTimezone));
  const [calendars, setCalendars] = useState<CalendarDto[]>([]);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hiddenKey = `hiddenCalendars:${user.id}`;
  const [hiddenCalendars, setHiddenCalendars] = useState(() => loadStringSet(hiddenKey));
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const hiddenCategoriesKey = `hiddenCategories:${user.id}`;
  const [hiddenCategories, setHiddenCategories] = useState(() =>
    loadStringSet(hiddenCategoriesKey),
  );
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('live');
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  // Cola de escritura sin conexión (T-13): eventos creados/editados/borrados sin red,
  // pendientes de enviar, y lo que no se pudo aplicar al reconectar (conflicto real).
  const [queuedOps, setQueuedOps] = useState<QueueOp[]>(() => listOps(user.id));
  const [syncConflicts, setSyncConflicts] = useState<ConflictEntry[]>(() => listConflicts(user.id));
  const [syncOpen, setSyncOpen] = useState(false);
  const refreshQueue = () => {
    setQueuedOps(listOps(user.id));
    setSyncConflicts(listConflicts(user.id));
  };

  // `range` está en la zona de visualización; se convierte a instantes reales para la API.
  const range = visibleRange(view, cursor);
  const from = fromDisplay(range.from, displayTimezone).getTime();
  const to = fromDisplay(range.to, displayTimezone).getTime();

  useEffect(() => {
    api
      .listCalendars()
      .then(setCalendars)
      .catch(() => setError('No se pudo conectar con el servidor'));
    api
      .listCategories()
      .then(setCategories)
      .catch(() => undefined); // los avisos de conexión ya salen al cargar los calendarios
  }, []);

  useEffect(() => {
    let stale = false;
    api
      .listEvents(new Date(from), new Date(to))
      .then((list) => {
        if (stale) return;
        setEvents(list);
        setError(null);
      })
      .catch(() => {
        if (!stale) setError('No se pudieron cargar los eventos');
      });
    return () => {
      stale = true;
    };
  }, [from, to, reloadKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (next: Omit<Toast, 'id'>) => setToast({ id: Date.now(), ...next });

  /** Envía lo que haya en la cola de escritura sin conexión (T-13); no hace nada si está vacía. */
  const syncQueue = async () => {
    if (listOps(user.id).length === 0) return;
    const { synced, conflicts } = await drainQueue(user.id);
    refreshQueue();
    if (synced > 0) setReloadKey((k) => k + 1);
    // Los conflictos ya quedan avisados en el banner persistente (hasta que se revisen);
    // un aviso aparte solo para lo que sí se sincronizó bien, para no duplicar el mensaje.
    if (synced > 0 && conflicts.length === 0) {
      showToast({ message: `${synced} cambio(s) sin conexión sincronizados` });
    }
  };

  // Avisa cuando lo que se ve viene de lo guardado (sin conexión), recarga al volver la red y
  // envía lo que se haya escrito sin conexión (T-13).
  useEffect(() => {
    setConnectionHandler(setConnection);
    const goOffline = () => setConnection('offline');
    const goOnline = () => void syncQueue();
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    // Al entrar, si hay conexión, envía lo que se hubiera quedado pendiente la vez anterior.
    const initialSync = setTimeout(goOnline, 0);
    return () => {
      setConnectionHandler(null);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      clearTimeout(initialSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user.id es constante (Root remonta con `key={user.id}`)
  }, []);

  const reloadCalendars = useCallback(
    () =>
      api
        .listCalendars()
        .then(setCalendars)
        .catch(() => undefined),
    [],
  );

  // Las invitaciones llegan cuando otra persona invita: se consultan al entrar y cada minuto.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .listInvitations()
        .then((list) => !cancelled && setInvitations(list))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const respondInvitation = async (invitation: InvitationDto, action: 'accept' | 'decline') => {
    try {
      await api.respondInvitation(invitation.calendarId, action);
      setInvitations((list) => list.filter((i) => i.calendarId !== invitation.calendarId));
      if (action === 'accept') {
        await reloadCalendars();
        setReloadKey((k) => k + 1);
        showToast({ message: `Ahora ves «${invitation.calendarName}»` });
      }
    } catch (err) {
      showToast({ message: err instanceof ApiError ? err.message : 'No se pudo responder' });
    }
  };

  const leaveCalendar = async (calendar: CalendarDto) => {
    if (!window.confirm(`¿Dejar de ver «${calendar.name}»? Tendrían que volver a invitarte.`))
      return;
    try {
      await api.removeMember(calendar.id, user.id);
      await reloadCalendars();
      setReloadKey((k) => k + 1);
    } catch (err) {
      showToast({
        message: err instanceof ApiError ? err.message : 'No se pudo salir del calendario',
      });
    }
  };

  // Solo lectura: calendarios compartidos como lector y calendarios que refleja una URL.
  const calendarById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.role !== 'viewer' && !c.subscription && !c.archived),
    [calendars],
  );
  const readOnlyReasonFor = (event: EventDto): string | undefined => {
    const calendar = calendarById.get(event.calendarId);
    if (!calendar) return undefined;
    if (calendar.subscription) {
      return `Este evento viene de un calendario sincronizado (${calendar.subscription.host}) y no se puede modificar aquí.`;
    }
    if (calendar.role === 'viewer') {
      return `Tienes permiso de solo lectura en «${calendar.name}», de ${calendar.ownerName}.`;
    }
    return undefined;
  };
  const canEditEvent = (event: EventDto) => readOnlyReasonFor(event) === undefined;

  const handleChanged = (change: ChangeInfo) => {
    setReloadKey((k) => k + 1);
    const next = toastFor(change);
    if (next) showToast(next);
    else setToast(null);
  };

  const undo = async () => {
    const action = toast?.undo;
    if (!action) return;
    setToast(null);
    try {
      await action();
      setReloadKey((k) => k + 1);
      showToast({ message: 'Cambio deshecho' });
    } catch (err) {
      showToast({
        message: `No se pudo deshacer: ${err instanceof ApiError ? err.message : 'sin conexión'}`,
      });
    }
  };

  const notifyFresh = (news: ReminderDto[]) => {
    const now = new Date();
    const first = news[0]!;
    const more = news.length > 1 ? ` (+${news.length - 1} más)` : '';
    showToast({ message: `🔔 ${first.title}: ${whenLabel(first.occurrenceStartAt, now)}${more}` });
    // Aviso del sistema si el usuario lo ha permitido; en cualquier caso hay aviso en la app.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const r of news) {
        new Notification(r.title, {
          body: [whenLabel(r.occurrenceStartAt, now), r.location].filter(Boolean).join(' · '),
          tag: `${r.eventId}|${r.occurrenceStartAt}|${r.minutesBefore}`,
        });
      }
    }
  };
  const reminders = useReminders({ userId: user.id, refreshKey: reloadKey, onFresh: notifyFresh });

  const calendarColors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const categoryColors = useMemo(
    () => new Map(categories.map((c) => [c.id, c.color])),
    [categories],
  );
  const colorOf = useCallback(
    (event: EventDto) =>
      event.color ??
      (event.categoryId ? categoryColors.get(event.categoryId) : undefined) ??
      calendarColors.get(event.calendarId) ??
      FALLBACK_COLOR,
    [calendarColors, categoryColors],
  );

  /**
   * Crear, editar y borrar un evento (T-13): si la API no responde por falta de red, se deja
   * en la cola de escritura sin conexión (salvo que sea una serie, que no se admite sin
   * conexión: ver offline/queue.ts) y se devuelve el contenido optimista, como si hubiera ido
   * bien. `run()` en EventDialog no distingue los dos casos.
   */
  const submitCreateEvent = async (input: CreateEventInput): Promise<EventDto> => {
    try {
      return await api.createEvent(input);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const op = enqueueCreate(user.id, input);
      refreshQueue();
      return op.display;
    }
  };

  const submitUpdateEvent = async (
    current: EventDto,
    input: UpdateEventInput,
  ): Promise<EventDto> => {
    try {
      return await api.updateEvent(current.id, input);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const op = enqueueUpdate(user.id, current, input);
      refreshQueue();
      return op.display;
    }
  };

  const submitDeleteEvent = async (
    current: EventDto,
    scope?: { scope: EditScope; occurrenceStart: string },
  ): Promise<void> => {
    try {
      await api.deleteEvent(current.id, scope);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      enqueueDelete(user.id, current, scope);
      refreshQueue();
    }
  };

  /**
   * Arrastrar o redimensionar un evento. Se actualiza la pantalla al instante y, si el
   * servidor lo rechaza (p. ej. conflicto de versión), se recarga el estado real.
   */
  const moveEvent = async (event: EventDto, start: Date, end: Date) => {
    // `start`/`end` vienen de la cuadrícula, en la zona de visualización: hay que pasarlos
    // a instantes reales antes de guardarlos o de mandarlos a la API.
    const startAt = fromDisplay(start, displayTimezone).toISOString();
    const endAt = fromDisplay(end, displayTimezone).toISOString();
    // Varias ocurrencias de una misma serie comparten `id`: solo se mueve la que tenía
    // exactamente este inicio, no todas las de la serie.
    setEvents((list) =>
      list.map((e) =>
        e.id === event.id && e.startAt === event.startAt ? { ...e, startAt, endAt } : e,
      ),
    );
    // La primera vez que se arrastra una ocurrencia viva de una serie, se crea una
    // excepción de "solo esta ocurrencia"; a partir de ahí ya es un evento suelto normal.
    const isSeriesOccurrence = event.recurrence != null;
    const input: UpdateEventInput = {
      startAt,
      endAt,
      // Los de todo el día se alinean a medianoche en la zona de visualización.
      ...(event.allDay && { timezone: displayTimezone }),
      ...(isSeriesOccurrence
        ? { scope: 'this', occurrenceStart: event.startAt }
        : { expectedVersion: event.version }),
    };
    try {
      const updated = await submitUpdateEvent(event, input);
      handleChanged({
        kind: 'updated',
        event: updated,
        previousVersion: event.version,
        ...(isSeriesOccurrence && { scope: 'this' as const }),
      });
    } catch (err) {
      setReloadKey((k) => k + 1);
      showToast({
        message:
          err instanceof ApiError
            ? `No se pudo mover: ${err.userMessage.split('\n')[0]}`
            : err instanceof OfflineUnsupportedError
              ? err.message
              : 'No se pudo mover el evento',
      });
    }
  };

  const changeDisplayTimezone = (timeZone: string) => {
    setDisplayTimezoneState(timeZone);
    saveString(displayTimezoneKey, timeZone);
    // El instante real que cubre la vista cambia con la zona: hay que volver a pedir los eventos.
    setReloadKey((k) => k + 1);
  };

  const toggleCalendar = (id: string) => {
    const next = new Set(hiddenCalendars);
    if (!next.delete(id)) next.add(id);
    setHiddenCalendars(next);
    saveStringSet(hiddenKey, next);
  };

  const createCalendar = async (input: { name: string; color: string }) => {
    const created = await api.createCalendar(input);
    setCalendars((list) => [...list, created]);
  };

  const toggleCategory = (id: string) => {
    const next = new Set(hiddenCategories);
    if (!next.delete(id)) next.add(id);
    setHiddenCategories(next);
    saveStringSet(hiddenCategoriesKey, next);
  };

  const createCategory = async (input: { name: string; color: string }) => {
    const created = await api.createCategory(input);
    setCategories((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const updateCategory = async (id: string, input: { name: string; color: string }) => {
    const updated = await api.updateCategory(id, input);
    setCategories((list) =>
      list.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const archiveCategory = async (id: string, archived: boolean) => {
    const updated = await api.updateCategory(id, { archived });
    setCategories((list) => list.map((c) => (c.id === id ? updated : c)));
  };

  // Los eventos sin categoría siempre se ven: los filtros solo ocultan lo que se marca. Antes
  // de filtrar, se superponen los pendientes de la cola sin conexión (T-13): los ya
  // enviados se ocultan de la respuesta del servidor y se muestra la versión optimista.
  const visibleEvents = useMemo(
    () =>
      overlayEvents(user.id, events).filter(
        (e) =>
          !hiddenCalendars.has(e.calendarId) &&
          !(e.categoryId && hiddenCategories.has(e.categoryId)),
      ),
    // `queuedOps` no se lee aquí directamente: `overlayEvents` lee la cola (localStorage) al
    // vuelo, pero solo hace falta recalcular cuando `queuedOps` avisa de que cambió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hiddenCalendars, hiddenCategories, queuedOps, user.id],
  );

  /** Abre el diálogo y retira el aviso anterior, que quedaría oculto tras él. */
  const openDialog = (target: DialogTarget) => {
    setToast(null);
    setDialog(target);
  };

  /**
   * Abre un evento para editarlo. Una ocurrencia de una serie trae las fechas de esa
   * ocurrencia; el formulario necesita las de la serie, así que se pide el evento completo.
   */
  const openEvent = async (event: EventDto) => {
    try {
      openDialog({
        kind: 'edit',
        event: event.recurrence ? await api.getEvent(event.id) : event,
        // La ocurrencia concreta pulsada: permite luego elegir "solo esta" / "esta y las
        // siguientes" al guardar o borrar.
        occurrenceStart: event.recurrence ? new Date(event.startAt) : undefined,
      });
    } catch {
      showToast({ message: 'No se pudo abrir el evento' });
    }
  };

  const openEventById = async (eventId: string) => {
    try {
      openDialog({ kind: 'edit', event: await api.getEvent(eventId) });
    } catch {
      showToast({ message: 'No se pudo abrir el evento' });
    }
  };

  const openCreate = (start: Date, allDay = false) => {
    // Los calendarios tardan un instante en llegar al entrar: sin uno no hay dónde crear.
    if (calendars.length === 0) return;
    const day = startOfDay(start);
    openDialog({
      kind: 'create',
      draft: allDay
        ? { start: day, end: day, allDay: true }
        : { start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false },
    });
  };

  const goToDay = (day: Date) => {
    setCursor(day);
    setView('day');
  };

  return (
    <div className="app">
      <Toolbar
        view={view}
        cursor={cursor}
        onViewChange={setView}
        onPrev={() => setCursor(shiftCursor(view, cursor, -1))}
        onNext={() => setCursor(shiftCursor(view, cursor, 1))}
        onToday={() => setCursor(toDisplay(new Date().toISOString(), displayTimezone))}
        onCreate={() => openCreate(nextFullHour(displayTimezone))}
        user={user}
        onLogout={onLogout}
        onOpenSessions={() => setSessionsOpen(true)}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        search={
          <SearchBox
            colorOf={colorOf}
            timeZone={displayTimezone}
            onOpen={(event) => {
              setCursor(toDisplay(event.startAt, displayTimezone));
              openDialog({
                kind: 'edit',
                event,
                occurrenceStart: event.recurrence ? new Date(event.startAt) : undefined,
              });
            }}
          />
        }
        reminders={
          <RemindersMenu
            reminders={reminders.reminders}
            now={reminders.now}
            onDismiss={reminders.dismiss}
            onDismissAll={reminders.dismissAll}
            onOpenEvent={(id) => void openEventById(id)}
          />
        }
      />
      {connection !== 'live' && (
        <div role="status" className="banner-offline">
          Sin conexión: se muestran los datos guardados en este dispositivo. Crear, editar o borrar
          un evento suelto se guarda en este dispositivo y se envía solo al volver la conexión (no
          vale para series).
        </div>
      )}
      {queuedOps.length > 0 && (
        <div role="status" className="banner-offline">
          {queuedOps.length} cambio(s) pendiente(s) de sincronizar.
        </div>
      )}
      {syncConflicts.length > 0 && (
        <div role="alert" className="banner-error">
          {syncConflicts.length} cambio(s) sin conexión no se pudieron sincronizar.{' '}
          <button type="button" className="link" onClick={() => setSyncOpen(true)}>
            Revisar
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="banner-error">
          {error}
        </div>
      )}
      <div className="layout">
        <Sidebar
          open={sidebarOpen}
          calendars={calendars}
          hiddenCalendars={hiddenCalendars}
          onToggleCalendar={toggleCalendar}
          onCreateCalendar={createCalendar}
          onOpenSettings={(calendar) => setSettingsFor(calendar.id)}
          onOpenSubscribe={() => setSubscribing(true)}
          onLeaveCalendar={(calendar) => void leaveCalendar(calendar)}
          invitations={invitations}
          onRespondInvitation={(invitation, action) => void respondInvitation(invitation, action)}
          categories={categories}
          hiddenCategories={hiddenCategories}
          onToggleCategory={toggleCategory}
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onArchiveCategory={archiveCategory}
          onOpenTrash={() => setTrashOpen(true)}
          displayTimezone={displayTimezone}
          onChangeDisplayTimezone={changeDisplayTimezone}
        />
        <main className="view">
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              events={visibleEvents}
              colorOf={colorOf}
              onSelectDay={goToDay}
              onSelectEvent={(event) => void openEvent(event)}
              onCreateOn={(day) => openCreate(day, true)}
              onMoveEvent={(event, start, end) => void moveEvent(event, start, end)}
              canEdit={canEditEvent}
              timeZone={displayTimezone}
            />
          )}
          {view !== 'month' && (
            <TimeGridView
              // Al cambiar de vista/fecha se reinicia el scroll a la mañana.
              key={`${view}-${from}`}
              days={view === 'week' ? weekDays(cursor) : [startOfDay(cursor)]}
              events={visibleEvents}
              colorOf={colorOf}
              onSelectDay={goToDay}
              onSelectEvent={(event) => void openEvent(event)}
              onCreateAt={(start) => openCreate(start)}
              onMoveEvent={(event, start, end) => void moveEvent(event, start, end)}
              canEdit={canEditEvent}
              timeZone={displayTimezone}
            />
          )}
        </main>
      </div>
      {toast && (
        <div role="status" className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="toast-action" onClick={() => void undo()}>
              Deshacer
            </button>
          )}
        </div>
      )}
      {settingsFor && calendarById.get(settingsFor) && (
        <CalendarSettings
          key={settingsFor}
          calendar={calendarById.get(settingsFor)!}
          onClose={() => setSettingsFor(null)}
          onSaved={(saved) =>
            setCalendars((list) => list.map((c) => (c.id === saved.id ? saved : c)))
          }
          onEventsChanged={() => setReloadKey((k) => k + 1)}
          onCalendarsChanged={() => void reloadCalendars()}
        />
      )}
      {subscribing && (
        <SubscribeDialog
          onClose={() => setSubscribing(false)}
          onSubscribed={({ calendar, result }) => {
            setCalendars((list) => [...list, calendar]);
            setReloadKey((k) => k + 1);
            showToast({ message: `«${calendar.name}»: ${result.created} eventos importados` });
          }}
        />
      )}
      {trashOpen && (
        <TrashPanel
          calendars={calendars}
          onClose={() => setTrashOpen(false)}
          onRestored={(event) => {
            setReloadKey((k) => k + 1);
            showToast({ message: `«${event.title}» restaurado` });
          }}
        />
      )}
      {sessionsOpen && (
        <SessionsPanel onClose={() => setSessionsOpen(false)} onLoggedOut={onLogout} />
      )}
      {syncOpen && (
        <SyncPanel
          conflicts={syncConflicts}
          onClose={() => setSyncOpen(false)}
          onDiscard={(id) => {
            discardConflict(user.id, id);
            refreshQueue();
          }}
          onRetry={async (id) => {
            const ok = await retryConflict(user.id, id);
            refreshQueue();
            if (ok) setReloadKey((k) => k + 1);
            return ok;
          }}
        />
      )}
      {dialog && (
        <EventDialog
          // Nueva instancia (y estado de formulario) por cada evento o borrador abierto.
          key={dialog.kind === 'edit' ? `${dialog.event.id}-${dialog.event.version}` : 'new'}
          target={dialog}
          calendars={writableCalendars}
          categories={categories}
          readOnlyReason={dialog.kind === 'edit' ? readOnlyReasonFor(dialog.event) : undefined}
          defaultTimezone={displayTimezone}
          onClose={() => setDialog(null)}
          onChanged={handleChanged}
          onCreateEvent={submitCreateEvent}
          onUpdateEvent={submitUpdateEvent}
          onDeleteEvent={submitDeleteEvent}
        />
      )}
    </div>
  );
}

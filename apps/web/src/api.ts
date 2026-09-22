import type {
  ApiErrorBody,
  CalendarDto,
  CategoryDto,
  CreateCalendarInput,
  CreateCategoryInput,
  UpdateCalendarInput,
  CreateEventInput,
  EditScope,
  EventDto,
  EventVersionDto,
  FeedCreatedDto,
  FeedStatusDto,
  ImportIcsInput,
  ImportResultDto,
  InvitationDto,
  InviteInput,
  MemberDto,
  MemberRole,
  LoginInput,
  RegisterInput,
  SessionDto,
  UserDto,
  ReminderDto,
  RestoreEventInput,
  SubscribeInput,
  SubscribeResultDto,
  UpdateCategoryInput,
  UpdateEventInput,
} from '@calendar/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    // Un 5xx sin cuerpo de la API es el proxy avisando de que el servidor no responde.
    super(
      body?.message ??
        (status >= 500
          ? 'El servidor no responde. Inténtalo de nuevo en unos momentos.'
          : `Error ${status}`),
    );
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** Mensaje para mostrar al usuario, con el detalle de validación si lo hay. */
  get userMessage(): string {
    return this.body?.issues?.length ? this.body.issues.join('\n') : this.message;
  }
}

/** Estado de la conexión según la última lectura: en vivo, desde lo guardado o sin red. */
export type ConnectionState = 'live' | 'cached' | 'offline';

let onConnection: ((state: ConnectionState) => void) | null = null;

export function setConnectionHandler(handler: ((state: ConnectionState) => void) | null): void {
  onConnection = handler;
}

/**
 * Vacía los datos que el service worker guardó para leer sin conexión. Hay que hacerlo al
 * cerrar sesión, al caducar y al entrar: esa caché es del navegador, no de la cuenta.
 */
export function clearOfflineCache(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage('clear-api-cache'))
    .catch(() => undefined);
}

let onUnauthorized: (() => void) | null = null;

/** Se llama cuando la API responde 401 fuera del formulario de acceso (sesión caducada). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const AUTH_FORM_PATHS = ['/auth/login', '/auth/register'];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    onConnection?.('offline');
    throw err;
  }
  if (method === 'GET' && res.ok)
    onConnection?.(res.headers.has('x-from-cache') ? 'cached' : 'live');
  if (res.status === 401 && !AUTH_FORM_PATHS.includes(path)) onUnauthorized?.();
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errorBody);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => request<UserDto>('GET', '/auth/me'),
  register: (input: RegisterInput) => request<UserDto>('POST', '/auth/register', input),
  login: (input: LoginInput) => request<UserDto>('POST', '/auth/login', input),
  logout: () => request<void>('POST', '/auth/logout'),
  listSessions: () => request<SessionDto[]>('GET', '/auth/sessions'),
  deleteSession: (id: string) => request<void>('DELETE', `/auth/sessions/${id}`),
  listCalendars: () => request<CalendarDto[]>('GET', '/calendars'),
  createCalendar: (input: CreateCalendarInput) => request<CalendarDto>('POST', '/calendars', input),
  updateCalendar: (id: string, input: UpdateCalendarInput) =>
    request<CalendarDto>('PATCH', `/calendars/${id}`, input),
  listEvents: (from: Date, to: Date) =>
    request<EventDto[]>(
      'GET',
      `/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ),
  exportUrl: (calendarId: string) => `/api/calendars/${calendarId}/export.ics`,
  importIcs: (calendarId: string, input: ImportIcsInput) =>
    request<ImportResultDto>('POST', `/calendars/${calendarId}/import`, input),
  feedStatus: (calendarId: string) =>
    request<FeedStatusDto>('GET', `/calendars/${calendarId}/feed`),
  createFeed: (calendarId: string) =>
    request<FeedCreatedDto>('POST', `/calendars/${calendarId}/feed`),
  deleteFeed: (calendarId: string) => request<void>('DELETE', `/calendars/${calendarId}/feed`),
  subscribe: (input: SubscribeInput) =>
    request<SubscribeResultDto>('POST', '/subscriptions', input),
  syncCalendar: (calendarId: string) =>
    request<ImportResultDto>('POST', `/calendars/${calendarId}/sync`),
  unsubscribe: (calendarId: string) =>
    request<void>('DELETE', `/calendars/${calendarId}/subscription`),
  listMembers: (calendarId: string) =>
    request<MemberDto[]>('GET', `/calendars/${calendarId}/members`),
  invite: (calendarId: string, input: InviteInput) =>
    request<MemberDto>('POST', `/calendars/${calendarId}/members`, input),
  updateMember: (calendarId: string, userId: string, role: MemberRole) =>
    request<MemberDto>('PATCH', `/calendars/${calendarId}/members/${userId}`, { role }),
  removeMember: (calendarId: string, userId: string) =>
    request<void>('DELETE', `/calendars/${calendarId}/members/${userId}`),
  listInvitations: () => request<InvitationDto[]>('GET', '/invitations'),
  respondInvitation: (calendarId: string, action: 'accept' | 'decline') =>
    request<void>('POST', `/invitations/${calendarId}/${action}`),
  listCategories: () => request<CategoryDto[]>('GET', '/categories'),
  createCategory: (input: CreateCategoryInput) =>
    request<CategoryDto>('POST', '/categories', input),
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    request<CategoryDto>('PATCH', `/categories/${id}`, input),
  getEvent: (id: string) => request<EventDto>('GET', `/events/${id}`),
  searchEvents: (q: string) =>
    request<EventDto[]>('GET', `/events/search?q=${encodeURIComponent(q)}`),
  listTrash: () => request<EventDto[]>('GET', '/events/trash'),
  activeReminders: () => request<ReminderDto[]>('GET', '/reminders/active'),
  createEvent: (input: CreateEventInput) => request<EventDto>('POST', '/events', input),
  updateEvent: (id: string, input: UpdateEventInput) =>
    request<EventDto>('PATCH', `/events/${id}`, input),
  deleteEvent: (id: string, scope?: { scope: EditScope; occurrenceStart: string }) =>
    request<void>(
      'DELETE',
      scope
        ? `/events/${id}?scope=${scope.scope}&occurrenceStart=${encodeURIComponent(scope.occurrenceStart)}`
        : `/events/${id}`,
    ),
  listVersions: (id: string) => request<EventVersionDto[]>('GET', `/events/${id}/versions`),
  restoreEvent: (id: string, version: number, input: RestoreEventInput = {}) =>
    request<EventDto>('POST', `/events/${id}/restore/${version}`, input),
};

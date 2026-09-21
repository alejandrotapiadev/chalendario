import type {
  ApiErrorBody,
  CalendarDto,
  CategoryDto,
  CreateCalendarInput,
  CreateCategoryInput,
  UpdateCalendarInput,
  CreateEventInput,
  EventDto,
  EventVersionDto,
  LoginInput,
  RegisterInput,
  UserDto,
  ReminderDto,
  RestoreEventInput,
  UpdateCategoryInput,
  UpdateEventInput,
} from '@calendar/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** Mensaje para mostrar al usuario, con el detalle de validación si lo hay. */
  get userMessage(): string {
    return this.body?.issues?.length ? this.body.issues.join('\n') : this.message;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Se llama cuando la API responde 401 fuera del formulario de acceso (sesión caducada). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const AUTH_FORM_PATHS = ['/auth/login', '/auth/register'];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  listCalendars: () => request<CalendarDto[]>('GET', '/calendars'),
  createCalendar: (input: CreateCalendarInput) => request<CalendarDto>('POST', '/calendars', input),
  updateCalendar: (id: string, input: UpdateCalendarInput) =>
    request<CalendarDto>('PATCH', `/calendars/${id}`, input),
  listEvents: (from: Date, to: Date) =>
    request<EventDto[]>(
      'GET',
      `/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ),
  listCategories: () => request<CategoryDto[]>('GET', '/categories'),
  createCategory: (input: CreateCategoryInput) =>
    request<CategoryDto>('POST', '/categories', input),
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    request<CategoryDto>('PATCH', `/categories/${id}`, input),
  getEvent: (id: string) => request<EventDto>('GET', `/events/${id}`),
  searchEvents: (q: string) =>
    request<EventDto[]>('GET', `/events/search?q=${encodeURIComponent(q)}`),
  activeReminders: () => request<ReminderDto[]>('GET', '/reminders/active'),
  createEvent: (input: CreateEventInput) => request<EventDto>('POST', '/events', input),
  updateEvent: (id: string, input: UpdateEventInput) =>
    request<EventDto>('PATCH', `/events/${id}`, input),
  deleteEvent: (id: string) => request<void>('DELETE', `/events/${id}`),
  listVersions: (id: string) => request<EventVersionDto[]>('GET', `/events/${id}/versions`),
  restoreEvent: (id: string, version: number, input: RestoreEventInput = {}) =>
    request<EventDto>('POST', `/events/${id}/restore/${version}`, input),
};

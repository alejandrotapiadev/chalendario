import type {
  ApiErrorBody,
  CalendarDto,
  CreateEventInput,
  EventDto,
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errorBody);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listCalendars: () => request<CalendarDto[]>('GET', '/calendars'),
  listEvents: (from: Date, to: Date) =>
    request<EventDto[]>(
      'GET',
      `/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ),
  createEvent: (input: CreateEventInput) => request<EventDto>('POST', '/events', input),
  updateEvent: (id: string, input: UpdateEventInput) =>
    request<EventDto>('PATCH', `/events/${id}`, input),
  deleteEvent: (id: string) => request<void>('DELETE', `/events/${id}`),
};

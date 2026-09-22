import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateEventInput, EventDto, UpdateEventInput } from '@calendar/shared';
import { ApiError } from '../api.ts';

vi.mock('../api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      getEvent: vi.fn(),
    },
  };
});

// localStorage no existe en el entorno de pruebas (Node normal, sin jsdom): se simula.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const USER = 'user-1';

const event = (over: Partial<EventDto> = {}): EventDto => ({
  id: 'evt-1',
  calendarId: 'cal-1',
  seriesId: null,
  recurrenceId: null,
  version: 3,
  title: 'Cena',
  description: '',
  startAt: '2026-09-21T08:00:00Z',
  endAt: '2026-09-21T09:00:00Z',
  timezone: 'UTC',
  allDay: false,
  location: '',
  status: 'confirmed',
  color: null,
  recurrence: null,
  categoryId: null,
  reminders: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});

const createInput = (over: Partial<CreateEventInput> = {}): CreateEventInput => ({
  calendarId: 'cal-1',
  title: 'Reunión',
  startAt: '2026-09-22T08:00:00Z',
  endAt: '2026-09-22T09:00:00Z',
  timezone: 'UTC',
  ...over,
});

interface MockedApi {
  createEvent: ReturnType<typeof vi.fn>;
  updateEvent: ReturnType<typeof vi.fn>;
  deleteEvent: ReturnType<typeof vi.fn>;
  getEvent: ReturnType<typeof vi.fn>;
}

let queue: typeof import('./queue.ts');
let api: MockedApi;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.resetModules();
  queue = await import('./queue.ts');
  const apiModule = await import('../api.ts');
  api = apiModule.api as unknown as MockedApi;
  vi.clearAllMocks();
});

describe('enqueueCreate', () => {
  it('crea una operación «create» con un id temporal y el contenido dado', () => {
    const op = queue.enqueueCreate(USER, createInput());
    expect(op.key).toBe(`temp:${op.display.id}`);
    expect(op.display.id).toMatch(/^offline:/);
    expect(op.display).toMatchObject({ title: 'Reunión', version: 1, recurrence: null });
    expect(queue.listOps(USER)).toEqual([op]);
  });

  it('rechaza una serie: no se pone en la cola', () => {
    const input = createInput({ recurrence: { freq: 'daily', interval: 1 } });
    expect(() => queue.enqueueCreate(USER, input)).toThrow(queue.OfflineUnsupportedError);
    expect(queue.listOps(USER)).toEqual([]);
  });
});

describe('enqueueUpdate', () => {
  it('la primera vez fija expectedVersion con la versión conocida', () => {
    const op = queue.enqueueUpdate(USER, event(), { title: 'Cena tardía' });
    expect(op.send).toMatchObject({
      kind: 'update',
      id: 'evt-1',
      input: { title: 'Cena tardía', expectedVersion: 3 },
    });
  });

  it('una segunda edición se funde en la misma operación, sin cambiar expectedVersion', () => {
    queue.enqueueUpdate(USER, event(), { title: 'Cena tardía' });
    const op = queue.enqueueUpdate(USER, event({ title: 'Cena tardía' }), { location: 'Casa' });
    expect(queue.listOps(USER)).toHaveLength(1);
    expect(op.send).toMatchObject({
      kind: 'update',
      input: { title: 'Cena tardía', location: 'Casa', expectedVersion: 3 },
    });
  });

  it('editar un evento aún no creado corrige la operación «create», no crea una «update»', () => {
    const created = queue.enqueueCreate(USER, createInput());
    const patched = queue.enqueueUpdate(USER, created.display, {
      title: 'Otro título',
      changeReason: 'no debe llegar a create',
    } as UpdateEventInput);
    expect(queue.listOps(USER)).toHaveLength(1);
    expect(patched.send.kind).toBe('create');
    expect(patched.display.title).toBe('Otro título');
    if (patched.send.kind === 'create') {
      expect(patched.send.input).not.toHaveProperty('changeReason');
      expect(patched.send.input.title).toBe('Otro título');
    }
  });

  it('rechaza editar una serie o una ocurrencia (scope) sin conexión', () => {
    expect(() =>
      queue.enqueueUpdate(USER, event({ recurrence: { freq: 'daily', interval: 1 } }), {}),
    ).toThrow(queue.OfflineUnsupportedError);
    expect(() =>
      queue.enqueueUpdate(USER, event(), {
        scope: 'this',
        occurrenceStart: '2026-09-21T08:00:00Z',
      }),
    ).toThrow(queue.OfflineUnsupportedError);
  });
});

describe('enqueueDelete', () => {
  it('borrar tras una edición pendiente sustituye la operación por un «delete»', () => {
    queue.enqueueUpdate(USER, event(), { title: 'Cena tardía' });
    const op = queue.enqueueDelete(USER, event());
    expect(queue.listOps(USER)).toHaveLength(1);
    expect(op?.send).toMatchObject({ kind: 'delete', id: 'evt-1' });
  });

  it('borrar algo creado sin conexión y aún no enviado no deja nada pendiente', () => {
    const created = queue.enqueueCreate(USER, createInput());
    const op = queue.enqueueDelete(USER, created.display);
    expect(op).toBeNull();
    expect(queue.listOps(USER)).toEqual([]);
  });

  it('rechaza borrar una serie sin conexión', () => {
    expect(() =>
      queue.enqueueDelete(USER, event({ recurrence: { freq: 'daily', interval: 1 } })),
    ).toThrow(queue.OfflineUnsupportedError);
  });
});

describe('overlayEvents', () => {
  it('superpone lo creado/editado y oculta lo borrado', () => {
    const created = queue.enqueueCreate(USER, createInput());
    queue.enqueueUpdate(USER, event({ id: 'evt-2' }), { title: 'Editado sin conexión' });
    queue.enqueueDelete(USER, event({ id: 'evt-3' }));

    const server = [
      event({ id: 'evt-2', title: 'Original' }),
      event({ id: 'evt-3' }),
      event({ id: 'evt-4' }),
    ];
    const result = queue.overlayEvents(USER, server);
    const byId = new Map(result.map((e) => [e.id, e]));
    expect(byId.has('evt-3')).toBe(false);
    expect(byId.get('evt-2')?.title).toBe('Editado sin conexión');
    expect(byId.get('evt-4')?.title).toBe('Cena');
    expect(byId.get(created.display.id)).toBeDefined();
  });
});

describe('drainQueue', () => {
  it('cuenta lo enviado con éxito y vacía la cola', async () => {
    queue.enqueueCreate(USER, createInput());
    queue.enqueueUpdate(USER, event({ id: 'evt-2' }), { title: 'X' });
    api.createEvent.mockResolvedValue(event());
    api.updateEvent.mockResolvedValue(event());

    const result = await queue.drainQueue(USER);
    expect(result).toEqual({ synced: 2, conflicts: [] });
    expect(queue.listOps(USER)).toEqual([]);
  });

  it('un 409/404 al editar pasa a conflictos, no se reintenta solo', async () => {
    queue.enqueueUpdate(USER, event(), { title: 'X' });
    api.updateEvent.mockRejectedValue(
      new ApiError(409, { error: 'version_conflict', message: 'alguien más lo cambió' }),
    );

    const result = await queue.drainQueue(USER);
    expect(result.synced).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(queue.listOps(USER)).toEqual([]);
    expect(queue.listConflicts(USER)).toHaveLength(1);
  });

  it('un 404 al borrar cuenta como éxito (ya no existe, que es lo que se quería)', async () => {
    queue.enqueueDelete(USER, event());
    api.deleteEvent.mockRejectedValue(
      new ApiError(404, { error: 'not_found', message: 'no existe' }),
    );

    const result = await queue.drainQueue(USER);
    expect(result).toEqual({ synced: 1, conflicts: [] });
    expect(queue.listConflicts(USER)).toEqual([]);
  });

  it('sin red (error que no es de la API), se queda en la cola para la próxima vez', async () => {
    queue.enqueueUpdate(USER, event(), { title: 'X' });
    api.updateEvent.mockRejectedValue(new TypeError('network error'));

    const result = await queue.drainQueue(USER);
    expect(result).toEqual({ synced: 0, conflicts: [] });
    expect(queue.listOps(USER)).toHaveLength(1);
  });
});

describe('discardConflict / retryConflict', () => {
  async function conflictedUpdate() {
    queue.enqueueUpdate(USER, event(), { title: 'X' });
    api.updateEvent.mockRejectedValueOnce(
      new ApiError(409, { error: 'version_conflict', message: 'x' }),
    );
    await queue.drainQueue(USER);
    return queue.listConflicts(USER)[0]!;
  }

  it('descartar quita el conflicto sin llamar a la API', async () => {
    const conflict = await conflictedUpdate();
    api.updateEvent.mockClear();
    queue.discardConflict(USER, conflict.id);
    expect(queue.listConflicts(USER)).toEqual([]);
    expect(api.updateEvent).not.toHaveBeenCalled();
  });

  it('reintentar una edición pide la versión más reciente antes de reenviar', async () => {
    const conflict = await conflictedUpdate();
    api.getEvent.mockResolvedValue(event({ version: 9 }));
    api.updateEvent.mockResolvedValue(event({ version: 10 }));

    const ok = await queue.retryConflict(USER, conflict.id);
    expect(ok).toBe(true);
    expect(api.updateEvent).toHaveBeenCalledWith('evt-1', { title: 'X', expectedVersion: 9 });
    expect(queue.listConflicts(USER)).toEqual([]);
  });

  it('si el reintento falla otra vez, el conflicto se queda con el motivo actualizado', async () => {
    const conflict = await conflictedUpdate();
    api.getEvent.mockResolvedValue(event({ version: 9 }));
    api.updateEvent.mockRejectedValue(
      new ApiError(409, { error: 'version_conflict', message: 'sigue' }),
    );

    const ok = await queue.retryConflict(USER, conflict.id);
    expect(ok).toBe(false);
    expect(queue.listConflicts(USER)).toHaveLength(1);
    expect(queue.listConflicts(USER)[0]!.reason).toBe('sigue');
  });
});

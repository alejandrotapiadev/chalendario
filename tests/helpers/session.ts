import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../apps/api/src/app.ts';

/** Cliente de pruebas: igual que `app.inject`, pero adjunta la cookie de sesión. */
export interface Client {
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
}

export interface TestUser {
  client: Client;
  cookie: string;
  userId: string;
  email: string;
  /** Calendario «Personal» creado al registrarse. */
  calendarId: string;
}

export const TEST_PASSWORD = 'correct horse battery';

/** App con coste de scrypt mínimo y sin límite de intentos, para que los tests vayan rápido. */
export async function buildTestApp(
  db: pg.Pool,
  overrides: Partial<Parameters<typeof buildApp>[0]> = {},
): Promise<FastifyInstance> {
  const app = buildApp({
    db,
    rateLimit: false,
    scrypt: { N: 1024, r: 8, p: 1 },
    ...overrides,
  });
  await app.ready();
  return app;
}

export function withCookie(app: FastifyInstance, cookie: string): Client {
  return {
    inject: (options) => app.inject({ ...options, headers: { ...options.headers, cookie } }),
  };
}

let counter = 0;

/** Crea una cuenta nueva y devuelve un cliente ya autenticado. */
export async function signUp(
  app: FastifyInstance,
  email = `user${++counter}@example.com`,
): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: TEST_PASSWORD, name: 'Test' },
  });
  if (res.statusCode !== 201) throw new Error(`registro falló: ${res.statusCode} ${res.body}`);
  const cookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
  const client = withCookie(app, cookie);
  const calendars = await client.inject({ method: 'GET', url: '/calendars' });
  return {
    client,
    cookie,
    userId: res.json().id,
    email,
    calendarId: calendars.json()[0].id,
  };
}

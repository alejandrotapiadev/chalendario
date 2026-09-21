import { describe, expect, it } from 'vitest';
import type { Db } from '../db.ts';
import { buildApp } from '../app.ts';

const fakeDb = (query: () => Promise<unknown>) => ({ query }) as unknown as Db;

describe('GET /health', () => {
  it('responde 200 cuando la base de datos responde', async () => {
    const app = buildApp({ db: fakeDb(async () => ({ rows: [{ '?column?': 1 }] })) });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('responde 503 cuando la base de datos falla', async () => {
    const app = buildApp({
      db: fakeDb(async () => {
        throw new Error('connection refused');
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'down' });
  });
});

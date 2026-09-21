import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('aplica valores por defecto', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(config).toMatchObject({ NODE_ENV: 'development', API_PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('convierte API_PORT a número', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

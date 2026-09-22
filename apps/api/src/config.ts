import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** `false` cierra el alta de cuentas nuevas (p. ej. tras crear la tuya en un servidor público). */
  REGISTRATION_OPEN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** `false` quita el límite de intentos en login/registro (usado por las pruebas E2E). */
  RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** `true` usa un coste de scrypt mucho menor (usado por las pruebas E2E, no en producción). */
  SCRYPT_FAST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

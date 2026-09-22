import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { redactFeedToken } from './modules/interop/interop.routes.ts';
import { defaultFetchIcs, startSubscriptionSync } from './modules/interop/interop.service.ts';
import { DEFAULT_SCRYPT } from './modules/auth/password.ts';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);

const app = buildApp({
  db,
  secureCookies: config.NODE_ENV === 'production',
  registrationOpen: config.REGISTRATION_OPEN,
  rateLimit: config.RATE_LIMIT,
  scrypt: config.SCRYPT_FAST ? { N: 1024, r: 8, p: 1 } : DEFAULT_SCRYPT,
  logger: {
    level: config.LOG_LEVEL,
    // El token del feed público va en la URL: no debe quedar escrito en los logs.
    serializers: {
      req: (req: { method: string; url: string; ip?: string }) => ({
        method: req.method,
        url: redactFeedToken(req.url),
        remoteAddress: req.ip,
      }),
    },
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  },
});

// Sin este listener, una caída de Postgres con clientes inactivos tumba el proceso.
db.on('error', (err) => app.log.error({ err }, 'idle database client error'));

// Mantiene al día los calendarios suscritos a una URL externa.
const stopSync = startSubscriptionSync(db, defaultFetchIcs, {
  onError: (calendarId, err) => app.log.warn({ err, calendarId }, 'subscription sync failed'),
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  stopSync();
  await app.close();
  await db.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}

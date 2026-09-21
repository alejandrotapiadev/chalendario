import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);

const app = buildApp({
  db,
  ...(config.DEV_USER_EMAIL && { devUserEmail: config.DEV_USER_EMAIL }),
  logger: {
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  },
});

// Sin este listener, una caída de Postgres con clientes inactivos tumba el proceso.
db.on('error', (err) => app.log.error({ err }, 'idle database client error'));

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
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

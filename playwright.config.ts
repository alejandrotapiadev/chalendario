import { defineConfig, devices } from '@playwright/test';

// apps/web/vite.config.ts tiene el proxy de /api fijo a localhost:3000: la API de
// las pruebas E2E tiene que escuchar ahí (para el `dev:api` normal, para el webServer).
const API_PORT = 3000;
const WEB_PORT = 4173;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

// Reutiliza la base de datos de los tests de integración (ver tests/helpers/db.ts):
// no se ejecuta a la vez que `pnpm test`, así que no hay conflicto.
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://calendar:calendar@localhost:5432/calendar_test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // En local, tantos navegadores a la vez como núcleos compiten por CPU con la propia API
  // y el registro (contraseñas incluidas); menos workers en paralelo es más fiable.
  workers: process.env.CI ? undefined : 4,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm migrate:up && pnpm --filter @calendar/api start',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(API_PORT),
        LOG_LEVEL: 'silent',
        REGISTRATION_OPEN: 'true',
        RATE_LIMIT: 'false',
        // El coste normal de scrypt (recomendado por OWASP) es deliberadamente lento;
        // con varios registros en paralelo, los tests podían agotar el temporizador.
        SCRYPT_FAST: 'true',
        DATABASE_URL,
      },
    },
    {
      // `preview` sirve el build de producción: solo así se registra el service worker,
      // necesario para el flujo de "sin conexión" (ver apps/web/vite.config.ts).
      command: 'pnpm build && pnpm --filter @calendar/web preview',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

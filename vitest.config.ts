import { defineConfig } from 'vitest/config';

// Carga .env en local (no pisa variables ya definidas, p. ej. en CI).
try {
  process.loadEnvFile();
} catch {
  // sin .env: los tests de integración se saltan si falta TEST_DATABASE_URL
}

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'tests/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    // Los tests de integración comparten una única base de datos.
    fileParallelism: false,
  },
});

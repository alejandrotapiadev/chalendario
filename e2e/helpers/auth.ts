import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const PASSWORD = 'correct horse battery';

/**
 * Email único por llamada: evita colisiones entre tests que comparten la misma BD. Cada
 * fichero de test de Playwright corre en su propio proceso worker, así que un contador o
 * `Date.now()` por sí solos pueden repetirse entre procesos que arrancan a la vez; un UUID
 * no depende de ningún estado compartido.
 */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}.${randomUUID()}@example.com`;
}

export interface Credentials {
  email: string;
  password: string;
  name: string;
}

/** Rellena el formulario de registro y espera a que la app cargue (barra de herramientas visible). */
export async function registerViaUi(
  page: Page,
  overrides: Partial<Credentials> = {},
): Promise<Credentials> {
  const creds: Credentials = {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? PASSWORD,
    name: overrides.name ?? 'Test User',
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await page.getByLabel('Nombre').fill(creds.name);
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Contraseña').fill(creds.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await waitForAppReady(page);
  return creds;
}

export async function loginViaUi(page: Page, creds: Credentials): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Contraseña').fill(creds.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await waitForAppReady(page);
}

/**
 * Espera a que la app haya cargado de verdad, no solo a que se vea la barra de
 * herramientas: el calendario "Personal" tarda un instante en llegar tras entrar, y crear
 * un evento antes de eso fallaría (no habría en qué calendario crearlo).
 */
async function waitForAppReady(page: Page): Promise<void> {
  // Un margen mayor que el timeout por defecto: con muchos tests en paralelo, el registro
  // (contraseña incluida) y la primera carga pueden tardar más de los 5s habituales. Se
  // vigila también la alerta de error para fallar con un mensaje claro en vez de agotar el
  // tiempo a ciegas si el registro o el login fallan de verdad.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await page.getByRole('button', { name: '+ Evento' }).isVisible()) {
      await expect(page.getByRole('button', { name: 'Ajustes de Personal' })).toBeVisible();
      return;
    }
    const alert = page.getByRole('alert').first();
    if (await alert.isVisible()) {
      throw new Error(`El registro o el login fallaron: ${await alert.textContent()}`);
    }
    await page.waitForTimeout(200);
  }
  throw new Error('La aplicación no terminó de cargar tras entrar (pasados 15s)');
}

/**
 * Crea un usuario llamando a la API directamente (sin pasar por el formulario). Al usar
 * `context.request`, la cookie de sesión que devuelve el registro queda en el propio
 * `BrowserContext`, así que una página nueva de ese contexto ya está autenticada.
 */
export async function registerViaApi(
  context: BrowserContext,
  overrides: Partial<Credentials> = {},
): Promise<Credentials> {
  const creds: Credentials = {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? PASSWORD,
    name: overrides.name ?? 'Test User',
  };
  const res = await context.request.post('/api/auth/register', { data: creds });
  if (!res.ok()) {
    throw new Error(`registro falló: ${res.status()} ${await res.text()}`);
  }
  return creds;
}

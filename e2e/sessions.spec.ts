import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';

test('ver las sesiones activas y cerrar la propia desde el panel', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: 'Sesiones' }).click();
  await expect(page.getByRole('heading', { name: 'Sesiones activas' })).toBeVisible();
  await expect(page.getByText('Esta sesión')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  // Cerrar la sesión actual vuelve a la pantalla de acceso.
  await expect(page.getByRole('button', { name: 'Crear una cuenta' })).toBeVisible();
});

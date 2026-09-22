import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';

test('archivar una categoría la retira de los eventos nuevos, sin borrarla', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: '+ Nueva categoría' }).click();
  await page.getByLabel('Nombre').fill('Salud');
  await page.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Salud')).toBeVisible();

  await page.getByRole('button', { name: 'Archivar Salud' }).click();
  await expect(page.getByText('Archivadas')).toBeVisible();
  await expect(page.getByLabel('Editar Salud')).not.toBeVisible();

  // No se ofrece para eventos nuevos.
  await page.getByRole('button', { name: '+ Evento' }).click();
  const options = await page.getByLabel('Categoría').locator('option').allTextContents();
  expect(options).not.toContain('Salud');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Restaurar Salud' }).click();
  await expect(page.getByLabel('Editar Salud')).toBeVisible();
  await expect(page.getByText('Archivadas')).not.toBeVisible();
});

test('archivar un calendario lo oculta y le impide recibir eventos nuevos', async ({ page }) => {
  await registerViaUi(page);

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Cena');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Cena/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Ajustes de Personal' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Archivar calendario' }).click();
  await expect(page.getByRole('button', { name: 'Restaurar calendario' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  const archivedSection = page.locator('.side-section', { hasText: 'Calendarios archivados' });
  await expect(archivedSection).toContainText('Personal');
  await expect(page.locator('.side-section', { hasText: 'Mis calendarios' })).not.toContainText(
    'Personal',
  );
  await expect(page.getByRole('button', { name: /Cena/ })).not.toBeVisible();

  await page.getByRole('button', { name: 'Ajustes de Personal' }).click();
  await page.getByRole('button', { name: 'Restaurar calendario' }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await expect(page.getByText('Calendarios archivados')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Cena/ }).first()).toBeVisible();
});

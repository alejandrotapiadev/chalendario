import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test('un evento borrado aparece en la papelera y se puede restaurar', async ({ page }) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Cita al dentista');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  const cell = page.locator(`[data-day="${today}"]`);
  const chip = cell.getByRole('button', { name: /Cita al dentista/ });
  await chip.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await expect(chip).toBeHidden();

  await page.getByRole('button', { name: '🗑 Papelera' }).click();
  await expect(page.getByText('Cita al dentista')).toBeVisible();

  await page.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('La papelera está vacía.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await expect(page.locator('.toast').filter({ hasText: 'restaurado' })).toBeVisible();
  await expect(chip).toBeVisible();
});

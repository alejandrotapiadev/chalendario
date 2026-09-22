import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test.describe('crear, editar y borrar eventos', () => {
  test.beforeEach(async ({ page }) => {
    await registerViaUi(page);
  });

  test('crea un evento con hora, lo edita y lo borra (con Deshacer)', async ({ page }) => {
    const today = ymd(new Date());

    await page.getByRole('button', { name: '+ Evento' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo evento' })).toBeVisible();
    await page.getByLabel('Título').fill('Reunión de equipo');
    await page.getByLabel('Inicio', { exact: true }).fill(today);
    await page.locator('input[type="time"]').first().fill('10:00');
    await page.getByLabel('Fin', { exact: true }).fill(today);
    await page.locator('input[type="time"]').nth(1).fill('11:00');
    await page.getByLabel('Ubicación').fill('Sala A');
    await page.getByLabel('Descripción').fill('Repasar el sprint');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.locator('.toast').filter({ hasText: 'Evento creado' })).toBeVisible();

    const cell = page.locator(`[data-day="${today}"]`);
    const chip = cell.getByRole('button', { name: /Reunión de equipo/ });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.getByRole('heading', { name: 'Editar evento' })).toBeVisible();
    await expect(page.getByLabel('Título')).toHaveValue('Reunión de equipo');
    await expect(page.getByLabel('Ubicación')).toHaveValue('Sala A');

    await page.getByLabel('Título').fill('Reunión de equipo (actualizada)');
    await page.getByLabel('Motivo del cambio (opcional)').fill('cambio de sala');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Evento actualizado' })).toBeVisible();

    const updatedChip = cell.getByRole('button', { name: /Reunión de equipo \(actualizada\)/ });
    await expect(updatedChip).toBeVisible();
    await updatedChip.click();

    // El motivo del cambio queda en el historial de versiones.
    await page.getByRole('button', { name: 'Historial' }).click();
    await expect(page.getByText('cambio de sala')).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Eliminar' }).click();

    const deletedToast = page.locator('.toast').filter({ hasText: 'Evento eliminado' });
    await expect(deletedToast).toBeVisible();
    await expect(updatedChip).toBeHidden();

    await deletedToast.getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'Cambio deshecho' })).toBeVisible();
    await expect(updatedChip).toBeVisible();
  });

  test('crea un evento de todo el día pulsando en una celda del mes', async ({ page }) => {
    const today = ymd(new Date());
    const cell = page.locator(`[data-day="${today}"]`);
    const box = await cell.boundingBox();
    if (!box) throw new Error('No se encontró la celda del día de hoy');
    // Se pulsa cerca de la esquina inferior para no acertar el número del día ni ningún chip.
    await page.mouse.click(box.x + 8, box.y + box.height - 8);

    await expect(page.getByRole('heading', { name: 'Nuevo evento' })).toBeVisible();
    await expect(page.getByLabel('Todo el día')).toBeChecked();
    await page.getByLabel('Título').fill('Día de vacaciones');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.locator('.toast').filter({ hasText: 'Evento creado' })).toBeVisible();
    await expect(cell.getByRole('button', { name: 'Día de vacaciones' })).toBeVisible();
  });
});

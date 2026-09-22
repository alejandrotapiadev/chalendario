import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { addDays, ymd } from './helpers/dates.ts';

test('una serie semanal se repite el número de veces indicado y no más', async ({ page }) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Serie semanal');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByLabel('Repetir').selectOption('weekly');
  await page.getByRole('radio', { name: /Tras/ }).check();
  await page.getByLabel('Número de repeticiones').fill('3');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  const event = page.getByRole('button', { name: /Serie semanal/ });

  // 1ª ocurrencia: la semana de hoy.
  await expect(event).toBeVisible();

  // 2ª ocurrencia.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(event).toBeVisible();

  // 3ª (última) ocurrencia.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(event).toBeVisible();

  // No debería haber una 4ª.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(event).toBeHidden();
});

test('editar una serie avisa de que el cambio afecta a toda la repetición', async ({ page }) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Serie con aviso');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByLabel('Repetir').selectOption('daily');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  const cell = page.locator(`[data-day="${today}"]`);
  await cell.getByRole('button', { name: /Serie con aviso/ }).click();
  await expect(page.getByRole('note')).toContainText('Este evento se repite');
});

test('editar "solo esta ocurrencia" no toca el resto de la serie', async ({ page }) => {
  await registerViaUi(page);
  const today = new Date();
  const [day0, day1, day2] = [today, addDays(today, 1), addDays(today, 2)].map(ymd);

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Serie ocurrencia');
  await page.getByLabel('Inicio', { exact: true }).fill(day0!);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(day0!);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByLabel('Repetir').selectOption('daily');
  await page.getByRole('radio', { name: /Tras/ }).check();
  await page.getByLabel('Número de repeticiones').fill('3');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  await page
    .locator(`[data-day="${day0}"]`)
    .getByRole('button', { name: /Serie ocurrencia/ })
    .click();
  await page.getByLabel('Título').fill('Ocurrencia especial');
  await page.getByRole('button', { name: 'Guardar' }).click();

  const chooser = page.getByRole('alert').filter({ hasText: '¿Aplicar el cambio a' });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Solo esta ocurrencia' }).click();

  // Sin "Deshacer": una excepción puede no ser trivial de revertir con un solo clic.
  const toast = page.locator('.toast').filter({ hasText: 'Evento actualizado' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Deshacer' })).toBeHidden();

  await expect(
    page.locator(`[data-day="${day0}"]`).getByRole('button', { name: /Ocurrencia especial/ }),
  ).toBeVisible();
  await expect(
    page.locator(`[data-day="${day1}"]`).getByRole('button', { name: /Serie ocurrencia/ }),
  ).toBeVisible();
  await expect(
    page.locator(`[data-day="${day2}"]`).getByRole('button', { name: /Serie ocurrencia/ }),
  ).toBeVisible();
});

test('borrar "esta y las siguientes" conserva las ocurrencias anteriores', async ({ page }) => {
  await registerViaUi(page);
  const today = new Date();
  const days = [0, 1, 2, 3, 4].map((n) => ymd(addDays(today, n)));

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Serie larga');
  await page.getByLabel('Inicio', { exact: true }).fill(days[0]!);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(days[0]!);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByLabel('Repetir').selectOption('daily');
  await page.getByRole('radio', { name: /Tras/ }).check();
  await page.getByLabel('Número de repeticiones').fill('5');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  // Corta a partir de la 3ª ocurrencia (día 2).
  await page
    .locator(`[data-day="${days[2]}"]`)
    .getByRole('button', { name: /Serie larga/ })
    .click();
  await page.getByRole('button', { name: 'Eliminar' }).click();
  const chooser = page.getByRole('alert').filter({ hasText: '¿Eliminar' });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Esta y las siguientes' }).click();

  for (const day of [days[0], days[1]]) {
    await expect(
      page.locator(`[data-day="${day}"]`).getByRole('button', { name: /Serie larga/ }),
    ).toBeVisible();
  }
  for (const day of [days[2], days[3], days[4]]) {
    await expect(
      page.locator(`[data-day="${day}"]`).getByRole('button', { name: /Serie larga/ }),
    ).toBeHidden();
  }
});

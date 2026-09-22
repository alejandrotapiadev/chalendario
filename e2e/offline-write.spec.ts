import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test('editar y borrar un evento existente sin conexión se sincroniza solo al volver la red', async ({
  page,
  context,
}) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Original');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  const cell = page.locator(`[data-day="${today}"]`);
  await context.setOffline(true);

  // Editar sin conexión: se guarda en este dispositivo y se ve al momento.
  await cell.getByRole('button', { name: /Original/ }).click();
  await page.getByLabel('Título').fill('Editado sin conexión');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar evento' })).not.toBeVisible();
  await expect(cell.getByRole('button', { name: /Editado sin conexión/ })).toBeVisible();
  await expect(page.getByText('1 cambio(s) pendiente(s) de sincronizar')).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.banner-offline')).toBeHidden();
  await expect(cell.getByRole('button', { name: /Editado sin conexión/ })).toBeVisible();

  // Borrar sin conexión: desaparece de la vista al momento.
  await context.setOffline(true);
  const chip = cell.getByRole('button', { name: /Editado sin conexión/ });
  await chip.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await expect(chip).toBeHidden();
  await expect(page.getByText('1 cambio(s) pendiente(s) de sincronizar')).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(/cambio\(s\) pendiente/)).toBeHidden();
  await expect(cell.getByRole('button', { name: /Editado sin conexión/ })).toBeHidden();
});

test('un conflicto real al reconectar se puede revisar y descartar', async ({ page, context }) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  const created = page.waitForResponse(
    (res) => res.url().includes('/api/events') && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Original');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  const event = await (await created).json();

  const cell = page.locator(`[data-day="${today}"]`);
  await context.setOffline(true);

  // Se edita en la interfaz (queda en la cola, con expectedVersion = la versión de antes).
  await cell.getByRole('button', { name: /Original/ }).click();
  await page.getByLabel('Título').fill('Mío, sin conexión');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar evento' })).not.toBeVisible();

  // Otro sitio (p. ej. otra pestaña) lo cambia mientras tanto, directamente por la API; el
  // contexto de Playwright comparte cookies con la página, pero `request` no pasa por la
  // emulación de «sin conexión» de esta página.
  const patched = await context.request.patch(`/api/events/${event.id}`, {
    data: { title: 'Cambiado por otra parte', expectedVersion: event.version },
  });
  expect(patched.ok()).toBe(true);

  await context.setOffline(false);
  await page.reload();

  await expect(page.getByText('1 cambio(s) sin conexión no se pudieron sincronizar')).toBeVisible();
  await page.getByRole('button', { name: 'Revisar' }).click();
  await expect(page.getByRole('heading', { name: 'Sincronización' })).toBeVisible();
  await expect(page.getByText('Editar: Mío, sin conexión')).toBeVisible();

  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByText('No hay nada pendiente de revisar.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText(/no se pudieron sincronizar/)).toBeHidden();

  // Lo que quedó guardado es lo de la otra parte: el cambio local descartado no se aplicó.
  await expect(cell.getByRole('button', { name: /Cambiado por otra parte/ })).toBeVisible();
});

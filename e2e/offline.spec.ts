import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test('el calendario sigue siendo legible sin conexión y avisa de que lo es', async ({
  page,
  context,
}) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Evento visible sin conexión');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  // Una segunda carga, ya con el service worker activo y controlando la página, deja
  // avisos, calendarios y eventos guardados en la caché de la API (`api-v1`).
  await page.reload();
  const cell = page.locator(`[data-day="${today}"]`);
  await expect(cell.getByRole('button', { name: /Evento visible sin conexión/ })).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.banner-offline')).toContainText('Sin conexión');
  await expect(cell.getByRole('button', { name: /Evento visible sin conexión/ })).toBeVisible();

  // Escribir un evento suelto sin conexión sí está soportado (T-13): se guarda en este
  // dispositivo y queda pendiente de enviar, en vez de fallar.
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Creado sin conexión');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('11:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('12:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();
  await expect(cell.getByRole('button', { name: /Creado sin conexión/ })).toBeVisible();
  await expect(page.getByText('1 cambio(s) pendiente(s) de sincronizar')).toBeVisible();

  // Al volver la conexión, la cola se envía sola (evento «online»), sin recargar.
  await context.setOffline(false);
  await expect(page.getByText(/cambio\(s\) pendiente/)).toBeHidden();

  await page.reload();
  await expect(page.locator('.banner-offline')).toBeHidden();
  await expect(cell.getByRole('button', { name: /Creado sin conexión/ })).toBeVisible({
    // Solo una vez: si se hubiera duplicado por enviarse dos veces, esto fallaría.
  });
  await expect(cell.getByRole('button', { name: /Creado sin conexión/ })).toHaveCount(1);
});

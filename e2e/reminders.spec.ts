import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('un evento en curso con recordatorio aparece en la campana', async ({ page }) => {
  await registerViaUi(page);

  const now = new Date();
  const start = new Date(now.getTime() - 60_000);
  const end = new Date(now.getTime() + 30 * 60_000);
  const today = ymd(now);

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Aviso inmediato');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill(hhmm(start));
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill(hhmm(end));
  await page.getByLabel('Añadir recordatorio').selectOption({ label: 'A la hora del evento' });
  await page.getByRole('button', { name: 'Guardar' }).click();
  // No se espera aquí al toast «Evento creado»: el aviso puede activarse casi al instante
  // (el sondeo de recordatorios se relanza en cuanto cambian los eventos) y sustituirlo por
  // el propio toast del recordatorio («🔔 …»), que comparte el mismo hueco en la pantalla.
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  const bell = page.getByRole('button', { name: /Recordatorios: 1 pendiente/ });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();

  const panel = page.getByRole('dialog', { name: 'Recordatorios' });
  await expect(panel.getByText('Aviso inmediato')).toBeVisible();

  await panel.getByRole('button', { name: 'Descartar recordatorio de Aviso inmediato' }).click();
  await expect(page.getByRole('button', { name: 'Recordatorios' })).toBeVisible();
});

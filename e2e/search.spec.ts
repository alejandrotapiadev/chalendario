import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test('busca un evento por título y lo abre desde los resultados', async ({ page }) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Presentación de resultados');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('16:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('17:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  const search = page.getByLabel('Buscar eventos');
  // Sin distinguir mayúsculas ni acentos: se busca sin la tilde y en minúsculas.
  await search.fill('presentacion');

  const panel = page.getByRole('listbox', { name: 'Resultados de la búsqueda' });
  const result = panel.getByRole('option', { name: /Presentación de resultados/ });
  await expect(result).toBeVisible();

  await result.click();
  await expect(page.getByRole('heading', { name: 'Editar evento' })).toBeVisible();
  await expect(page.getByLabel('Título')).toHaveValue('Presentación de resultados');
});

test('una búsqueda sin resultados lo dice claramente', async ({ page }) => {
  await registerViaUi(page);
  await page.getByLabel('Buscar eventos').fill('esto no existe en ningún evento');
  await expect(page.getByText('Sin resultados')).toBeVisible();
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample.ics');

test('importa un .ics y luego exporta el calendario', async ({ page }) => {
  await registerViaUi(page);

  // El registro crea un calendario "Personal" por defecto (ver apps/api auth.routes.ts).
  await page.getByRole('button', { name: 'Ajustes de Personal' }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible();

  await page.getByLabel('Fichero .ics').setInputFiles(FIXTURE);
  await expect(page.getByRole('status').filter({ hasText: 'nuevos' })).toContainText('1 nuevos');

  // Reimportar el mismo fichero no debe duplicar: el UID ya existe y no cambió.
  await page.getByLabel('Fichero .ics').setInputFiles(FIXTURE);
  await expect(page.getByRole('status').filter({ hasText: 'sin cambios' })).toContainText(
    '1 sin cambios',
  );

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar (.ics)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);

  await page.getByRole('button', { name: 'Cerrar' }).click();

  // El evento importado cae en diciembre de 2026: se confirma por búsqueda, no por la vista.
  await page.getByLabel('Buscar eventos').fill('Revision del proyecto');
  await expect(page.getByRole('option', { name: /Revision del proyecto/ })).toBeVisible();
});

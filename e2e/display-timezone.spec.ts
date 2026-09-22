import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

// El navegador está en Nueva York; se elige Tokio como zona de visualización (T-10). Ninguna
// de las dos coincide con la del evento (UTC), para no dejar pasar un error por coincidencia.
test.use({ timezoneId: 'America/New_York' });

test('la zona de visualización cambia lo que se ve, sin tocar el instante real guardado', async ({
  page,
}) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  // Evento con zona propia UTC y un instante real conocido: 00:00–01:00 UTC.
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Reunión UTC');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('00:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('01:00');
  await page.getByRole('combobox', { name: 'Zona horaria', exact: true }).fill('UTC');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  // 00:00–01:00 UTC son las 09:00–10:00 en Tokio (UTC+9): mismo día, sin cruzar medianoche.
  await page.getByLabel('Zona horaria de visualización').selectOption('Asia/Tokyo');
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  const event = page.getByRole('button', { name: /Reunión UTC/ });
  await expect(event).toContainText('09:00');
  await expect(event).toContainText('10:00');

  // Arrastra 60 minutos hacia abajo (48px/hora) dentro de la cuadrícula en hora de Tokio.
  const box = await event.boundingBox();
  if (!box) throw new Error('No se pudo medir el evento');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 24, { steps: 3 });
  await page.mouse.move(x, y + 48, { steps: 3 });
  await page.mouse.up();
  await expect(event).toContainText('10:00');
  await expect(event).toContainText('11:00');

  // El instante real (leído en la zona propia del evento, UTC, ajena a la de visualización)
  // debe haber avanzado exactamente esos 60 minutos: 01:00–02:00 UTC.
  await event.click();
  await expect(page.getByRole('heading', { name: 'Editar evento' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Zona horaria', exact: true })).toHaveValue(
    'UTC',
  );
  await expect(page.locator('input[type="time"]').first()).toHaveValue('01:00');
  await expect(page.locator('input[type="time"]').nth(1)).toHaveValue('02:00');
});

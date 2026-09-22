import { expect, test } from './fixtures.ts';
import { registerViaApi, registerViaUi, uniqueEmail } from './helpers/auth.ts';
import { ymd } from './helpers/dates.ts';

test('invitar a otro usuario, aceptar y editar un calendario compartido', async ({
  page,
  browser,
}) => {
  await registerViaUi(page);
  const today = ymd(new Date());

  // La propietaria crea un evento antes de compartir, para comprobar que la invitada lo ve.
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill('Evento compartido');
  await page.getByLabel('Inicio', { exact: true }).fill(today);
  await page.locator('input[type="time"]').first().fill('09:00');
  await page.getByLabel('Fin', { exact: true }).fill(today);
  await page.locator('input[type="time"]').nth(1).fill('10:00');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();

  // La invitada necesita cuenta previa: se crea por API, en un contexto de navegador aparte.
  const guestContext = await browser.newContext();
  const guest = await registerViaApi(guestContext, { email: uniqueEmail('guest') });
  const guestPage = await guestContext.newPage();

  await page.getByRole('button', { name: 'Ajustes de Personal' }).click();
  await page.getByLabel('Email a invitar').fill(guest.email);
  await page.getByLabel('Permiso').selectOption('editor');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText('invitación pendiente')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await guestPage.goto('/');
  const invitation = guestPage.locator('[aria-label="Invitaciones"]');
  await expect(invitation).toContainText('«Personal»');
  await invitation.getByRole('button', { name: 'Aceptar' }).click();

  const sharedSection = guestPage.locator('.side-section', { hasText: 'Compartidos conmigo' });
  await expect(sharedSection).toContainText('Personal');
  await expect(sharedSection).toContainText('edita');

  const guestCell = guestPage.locator(`[data-day="${today}"]`);
  await guestCell.getByRole('button', { name: /Evento compartido/ }).click();
  await expect(guestPage.getByRole('heading', { name: 'Editar evento' })).toBeVisible();
  // Con permiso de edición no aparece el aviso de solo lectura y se puede guardar.
  await expect(guestPage.getByRole('note')).not.toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Guardar' })).toBeVisible();

  await guestContext.close();
});

test('con permiso de solo lectura no se puede modificar el evento', async ({ page, browser }) => {
  await registerViaUi(page);

  const guestContext = await browser.newContext();
  const guest = await registerViaApi(guestContext, { email: uniqueEmail('viewer') });
  const guestPage = await guestContext.newPage();

  await page.getByRole('button', { name: 'Ajustes de Personal' }).click();
  await page.getByLabel('Email a invitar').fill(guest.email);
  await page.getByLabel('Permiso').selectOption('viewer');
  await page.getByRole('button', { name: 'Invitar' }).click();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await guestPage.goto('/');
  const invitation = guestPage.locator('[aria-label="Invitaciones"]');
  await expect(invitation).toContainText('«Personal»');
  await invitation.getByRole('button', { name: 'Aceptar' }).click();

  const sharedSection = guestPage.locator('.side-section', { hasText: 'Compartidos conmigo' });
  await expect(sharedSection).toContainText('lectura');

  await guestContext.close();
});

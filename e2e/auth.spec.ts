import { expect, test } from './fixtures.ts';
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers/auth.ts';

test.describe('registro, login y logout', () => {
  test('registra una cuenta nueva y entra directamente', async ({ page }) => {
    await registerViaUi(page);
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();
  });

  test('no deja registrar el mismo email dos veces', async ({ page }) => {
    const creds = await registerViaUi(page);
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByRole('heading', { name: 'Personal Calendar' })).toBeVisible();

    await page.getByRole('button', { name: 'Crear una cuenta' }).click();
    await page.getByLabel('Nombre').fill(creds.name);
    await page.getByLabel('Email').fill(creds.email);
    await page.getByLabel('Contraseña').fill(creds.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('rechaza credenciales incorrectas', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(uniqueEmail('nobody'));
    await page.getByLabel('Contraseña').fill('esto no es la contraseña');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('cierra sesión y permite volver a entrar', async ({ page }) => {
    const creds = await registerViaUi(page);
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByRole('heading', { name: 'Personal Calendar' })).toBeVisible();

    await loginViaUi(page, creds);
    await expect(page.getByRole('button', { name: '+ Evento' })).toBeVisible();
  });
});

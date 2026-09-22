import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { registerViaUi } from './helpers/auth.ts';
import { addDays, ymd } from './helpers/dates.ts';

// Coincide con LONG_PRESS_MS en apps/web/src/calendar/pointerDrag.ts.
const LONG_PRESS_MS = 350;

function point(loc: { x: number; y: number; width: number; height: number }) {
  return { x: loc.x + loc.width / 2, y: loc.y + loc.height / 2 };
}

async function createTimedEvent(
  page: Page,
  options: { title: string; day: string; start: string; end: string },
): Promise<void> {
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill(options.title);
  await page.getByLabel('Inicio', { exact: true }).fill(options.day);
  await page.locator('input[type="time"]').first().fill(options.start);
  await page.getByLabel('Fin', { exact: true }).fill(options.day);
  await page.locator('input[type="time"]').nth(1).fill(options.end);
  await page.getByRole('button', { name: 'Guardar' }).click();
  // El diálogo solo se cierra si el guardado tuvo éxito; el toast puede haberse sustituido
  // ya por un aviso de recordatorio, así que no es una señal fiable de "se ha creado".
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();
}

async function createWeeklyEvent(
  page: Page,
  options: { title: string; day: string; start: string; end: string },
): Promise<void> {
  await page.getByRole('button', { name: '+ Evento' }).click();
  await page.getByLabel('Título').fill(options.title);
  await page.getByLabel('Inicio', { exact: true }).fill(options.day);
  await page.locator('input[type="time"]').first().fill(options.start);
  await page.getByLabel('Fin', { exact: true }).fill(options.day);
  await page.locator('input[type="time"]').nth(1).fill(options.end);
  await page.getByLabel('Repetir').selectOption('weekly');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).not.toBeVisible();
}

/** Arrastra con pasos intermedios reales para superar el umbral de 4px de `startDrag`. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { cancelWithEscape = false } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  if (cancelWithEscape) {
    await page.keyboard.press('Escape');
  }
  await page.mouse.up();
}

/**
 * Simula un arrastre con el dedo despachando `PointerEvent`s reales (`pointerType:
 * 'touch'`), como haría un móvil. Espera de verdad `LONG_PRESS_MS` entre el toque inicial
 * y el movimiento: el temporizador de la pulsación larga vive en el navegador, no aquí.
 */
async function touchDrag(
  page: Page,
  chip: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { waitForLongPress = true } = {},
): Promise<void> {
  const pointerInit = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 };
  await chip.dispatchEvent('pointerdown', { ...pointerInit, clientX: from.x, clientY: from.y });
  if (waitForLongPress) await page.waitForTimeout(LONG_PRESS_MS + 100);
  await page.evaluate(
    ({ pointerInit, x, y }) => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { ...pointerInit, bubbles: true, clientX: x, clientY: y }),
      );
    },
    { pointerInit, x: to.x, y: to.y },
  );
  await page.evaluate(
    ({ pointerInit, x, y }) => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { ...pointerInit, bubbles: true, clientX: x, clientY: y }),
      );
    },
    { pointerInit, x: to.x, y: to.y },
  );
}

test.describe('arrastrar y redimensionar', () => {
  test.beforeEach(async ({ page }) => {
    await registerViaUi(page);
  });

  test('mueve un evento a otro día en la vista de mes', async ({ page }) => {
    const today = new Date();
    const todayStr = ymd(today);
    // Un desplazamiento de 2 días que se queda dentro del mismo mes casi siempre.
    const targetDate = today.getDate() <= 26 ? addDays(today, 2) : addDays(today, -2);
    const targetStr = ymd(targetDate);

    await createTimedEvent(page, {
      title: 'Mover mes',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Mover mes/ });
    await expect(chip).toBeVisible();

    const chipBox = await chip.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!chipBox || !targetBox) throw new Error('No se pudo medir el chip o la celda destino');

    await drag(
      page,
      { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
    );

    await expect(chip).toBeHidden();
    await expect(targetCell.getByRole('button', { name: /Mover mes/ })).toBeVisible();
  });

  test('Escape cancela el arrastre en la vista de mes', async ({ page }) => {
    const todayStr = ymd(new Date());
    const targetStr = ymd(addDays(new Date(), 2));

    await createTimedEvent(page, {
      title: 'Cancelar arrastre',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Cancelar arrastre/ });
    const chipBox = await chip.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!chipBox || !targetBox) throw new Error('No se pudo medir el chip o la celda destino');

    await drag(
      page,
      { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
      { cancelWithEscape: true },
    );

    await expect(chip).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Editar evento' })).not.toBeVisible();
  });

  test('mueve y redimensiona un evento en la vista de semana', async ({ page }) => {
    const todayStr = ymd(new Date());
    await page.getByRole('button', { name: 'Semana', exact: true }).click();
    await createTimedEvent(page, {
      title: 'Semana arrastre',
      day: todayStr,
      start: '10:00',
      end: '11:00',
    });

    const event = page.getByRole('button', { name: /Semana arrastre/ });
    await expect(event).toBeVisible();
    let box = await event.boundingBox();
    if (!box) throw new Error('No se pudo medir el evento');

    // Mover 60 minutos hacia abajo (48px/hora) sin cambiar de día: clic en la mitad superior
    // del bloque para no acertar el asa de redimensionar, que ocupa el borde inferior.
    await drag(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 3 },
      { x: box.x + box.width / 2, y: box.y + box.height / 3 + 48 },
    );
    await expect(event).toContainText('11:00');
    await expect(event).toContainText('12:00');

    const handle = event.locator('.tg-resize');
    box = await event.boundingBox();
    const handleBox = await handle.boundingBox();
    if (!box || !handleBox) throw new Error('No se pudo medir el asa de redimensionar');

    // Alarga el fin 30 minutos (24px) arrastrando el asa inferior.
    await drag(
      page,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 + 24 },
    );
    await expect(event).toContainText('11:00');
    await expect(event).toContainText('12:30');
  });

  test('arrastrar una ocurrencia de una serie solo mueve esa ocurrencia (crea una excepción)', async ({
    page,
  }) => {
    const today = new Date();
    const todayStr = ymd(today);
    const targetStr = ymd(addDays(today, 2));

    await createWeeklyEvent(page, {
      title: 'Serie fija',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Serie fija/ });
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!chipBox || !targetBox) throw new Error('No se pudo medir el chip o la celda destino');

    await drag(
      page,
      { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
    );

    // Esta ocurrencia se movió...
    await expect(chip).toBeHidden();
    await expect(targetCell.getByRole('button', { name: /Serie fija/ })).toBeVisible();

    // ...pero la siguiente semana sigue en su día original: no se movió la serie entera.
    await page.getByRole('button', { name: 'Semana', exact: true }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('button', { name: /Serie fija/ })).toBeVisible();
  });

  test('con el dedo, una pulsación larga mueve el evento', async ({ page }) => {
    const today = new Date();
    const todayStr = ymd(today);
    const targetDate = today.getDate() <= 26 ? addDays(today, 2) : addDays(today, -2);
    const targetStr = ymd(targetDate);

    await createTimedEvent(page, {
      title: 'Toque largo',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Toque largo/ });
    const chipBox = await chip.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!chipBox || !targetBox) throw new Error('No se pudo medir el chip o la celda destino');

    await touchDrag(page, chip, point(chipBox), point(targetBox));

    await expect(chip).toBeHidden();
    await expect(targetCell.getByRole('button', { name: /Toque largo/ })).toBeVisible();
  });

  test('con el dedo, mover antes de la pulsación larga no arrastra (era un scroll)', async ({
    page,
  }) => {
    const today = new Date();
    const todayStr = ymd(today);
    const targetDate = today.getDate() <= 26 ? addDays(today, 2) : addDays(today, -2);
    const targetStr = ymd(targetDate);

    await createTimedEvent(page, {
      title: 'Toque rápido',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Toque rápido/ });
    const chipBox = await chip.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!chipBox || !targetBox) throw new Error('No se pudo medir el chip o la celda destino');

    await touchDrag(page, chip, point(chipBox), point(targetBox), { waitForLongPress: false });

    // No dio tiempo a armarse: el evento sigue donde estaba.
    await expect(chip).toBeVisible();
    await expect(targetCell.getByRole('button', { name: /Toque rápido/ })).toBeHidden();
  });

  test('las flechas del teclado mueven el evento con foco (mes y semana)', async ({ page }) => {
    const today = new Date();
    const todayStr = ymd(today);
    // Un solo día de desplazamiento: tras moverse, el chip cambia de celda (nuevo nodo del
    // DOM) y el foco del navegador no se conserva de una tecla a la siguiente.
    const targetDate = today.getDate() <= 27 ? addDays(today, 1) : addDays(today, -1);
    const targetStr = ymd(targetDate);
    const sign = today.getDate() <= 27 ? 1 : -1;

    await createTimedEvent(page, {
      title: 'Con teclado',
      day: todayStr,
      start: '09:00',
      end: '10:00',
    });

    // En semana/día, arriba/abajo cambia la hora 15 minutos (sin tocar el día: no hay
    // riesgo de que el evento se salga de la semana visible).
    await page.getByRole('button', { name: 'Semana', exact: true }).click();
    const weekEvent = page.getByRole('button', { name: /Con teclado/ });
    await weekEvent.focus();
    await expect(weekEvent).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(weekEvent).toContainText('09:15');

    // Izquierda/derecha en la vista de mes cambia de día.
    await page.getByRole('button', { name: 'Mes', exact: true }).click();
    const originCell = page.locator(`[data-day="${todayStr}"]`);
    const targetCell = page.locator(`[data-day="${targetStr}"]`);
    const chip = originCell.getByRole('button', { name: /Con teclado/ });
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press(sign === 1 ? 'ArrowRight' : 'ArrowLeft');

    await expect(originCell.getByRole('button', { name: /Con teclado/ })).toBeHidden();
    await expect(targetCell.getByRole('button', { name: /Con teclado/ })).toBeVisible();
  });
});

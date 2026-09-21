/** Desplazamiento (px) a partir del cual un clic pasa a considerarse arrastre. */
export const DRAG_THRESHOLD_PX = 4;

interface Origin {
  button: number;
  clientX: number;
  clientY: number;
}

interface Callbacks {
  onMove: (dx: number, dy: number, event: PointerEvent) => void;
  /** Solo se llama si hubo arrastre real (no para un simple clic). */
  onEnd: (dx: number, dy: number, event: PointerEvent) => void;
  onCancel: () => void;
}

/**
 * Sigue un gesto de arrastre iniciado en `origin` (un `pointerdown`). Escucha en `window`,
 * así que el gesto sobrevive a re-renderizados del elemento de origen. Termina con
 * soltar, `pointercancel` o Escape. Tras un arrastre se anula el `click` que el navegador
 * dispara al soltar, para que no abra el evento.
 */
export function startDrag(origin: Origin, callbacks: Callbacks): void {
  if (origin.button !== 0) return;
  let moved = false;

  const delta = (e: PointerEvent) =>
    [e.clientX - origin.clientX, e.clientY - origin.clientY] as const;

  const cleanup = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKeyDown);
  };

  const swallowNextClick = () => {
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    // Si el navegador no llega a disparar el click, no dejar el listener puesto.
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };

  function onPointerMove(e: PointerEvent) {
    const [dx, dy] = delta(e);
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    moved = true;
    callbacks.onMove(dx, dy, e);
  }

  function onPointerUp(e: PointerEvent) {
    cleanup();
    if (!moved) return;
    swallowNextClick();
    const [dx, dy] = delta(e);
    callbacks.onEnd(dx, dy, e);
  }

  /** El navegador canceló el gesto (p. ej. empezó a hacer scroll): no habrá click. */
  function onCancel() {
    cleanup();
    if (moved) callbacks.onCancel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    cleanup();
    if (!moved) return;
    callbacks.onCancel();
    // El botón sigue pulsado: al soltarlo el navegador dispara un click que no debe abrir nada.
    window.addEventListener('pointerup', swallowNextClick, { once: true });
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKeyDown);
}
